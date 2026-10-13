# -*- coding: utf-8 -*-
"""Build public/data/scene.json from the OSM snapshot.

Reads the newest data/snapshots/osm_snapshot_*.json, projects all
geometry to a local metre-based frame (origin = bbox centre, X east /
Y north), assembles multipolygon rings, assigns building heights
(tag height > tag levels > area-based default) and writes scene.json.

Usage:
    py scripts/build_scene_data.py
"""
import json
import math
import os
import glob
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_DIR = os.path.join(ROOT, "data", "snapshots")
OVERRIDES_PATH = os.path.join(ROOT, "data", "height_overrides.json")
OUT_PATH = os.path.join(ROOT, "public", "data", "scene.json")

LEVEL_HEIGHT = 3.3  # metres per storey when estimating from levels/area

ROAD_WIDTHS = {
    "motorway": 15, "trunk": 15, "primary": 14, "secondary": 12,
    "tertiary": 10, "residential": 8, "unclassified": 7,
    "living_street": 6, "service": 5, "pedestrian": 4,
    "footway": 2, "path": 1.5, "track": 3, "cycleway": 2,
}

GREEN_KINDS = {
    "park": "park", "garden": "park", "playground": "park",
    "pitch": "pitch", "grass": "grass", "forest": "forest",
    "meadow": "grass", "wood": "forest", "scrub": "forest",
    "recreation_ground": "pitch",
}


def load_snapshot():
    snaps = sorted(glob.glob(os.path.join(SNAP_DIR, "osm_snapshot_*.json")))
    if not snaps:
        raise SystemExit("no snapshot found, run fetch_osm.py first")
    with open(snaps[-1], encoding="utf-8") as f:
        return json.load(f)


def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        return {"byId": {}, "byName": {}}
    with open(OVERRIDES_PATH, encoding="utf-8") as f:
        return json.load(f)


class Projector:
    """WGS84 -> local metres, origin at bbox centre, X east / Y north."""

    def __init__(self, bbox):
        self.lon0 = (bbox[0] + bbox[2]) / 2.0
        self.lat0 = (bbox[1] + bbox[3]) / 2.0
        self.cos_lat = math.cos(math.radians(self.lat0))

    def xy(self, lon, lat):
        x = (lon - self.lon0) * self.cos_lat * 111320.0
        y = (lat - self.lat0) * 111320.0
        return [round(x, 2), round(y, 2)]


def shoelace_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def default_levels(area):
    if area >= 5000:
        return 5
    if area >= 2000:
        return 4
    if area >= 800:
        return 3
    return 2


def parse_height(tags):
    """Return (height_m, source)."""
    h = tags.get("height")
    if h:
        try:
            return float(str(h).strip().rstrip("m").strip()), "tag:height"
        except ValueError:
            pass
    lv = tags.get("building:levels")
    if lv:
        try:
            return round(float(lv) * LEVEL_HEIGHT, 1), "tag:levels"
        except ValueError:
            pass
    return None, None


def assemble_rings(member_way_ids, ways):
    """Chain fragmented ways into closed rings. Returns [ [node_id,...] ] or []."""
    unused = {wid: ways[wid]["nodes"] for wid in member_way_ids if wid in ways}
    rings = []
    while unused:
        wid = next(iter(unused))
        nodes = list(unused.pop(wid))
        ring = list(nodes)
        guard = 0
        while ring[0] != ring[-1] and guard < 10000:
            guard += 1
            end = ring[-1]
            nxt = None
            for owid, onodes in unused.items():
                if onodes[0] == end:
                    nxt = (owid, onodes[1:])
                elif onodes[-1] == end:
                    nxt = (owid, list(reversed(onodes))[1:])
                if nxt:
                    break
            if not nxt:
                return []  # dead end, give up on this relation
            owid, tail = nxt
            ring.extend(tail)
            del unused[owid]
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring[:-1])
    return rings


def main():
    snap = load_snapshot()
    proj = Projector(snap["bbox"])
    nodes = {}
    ways = {}
    relations = []
    for el in snap["elements"]:
        if el["type"] == "node":
            nodes[el["id"]] = el
        elif el["type"] == "way":
            ways[el["id"]] = el
        elif el["type"] == "relation":
            relations.append(el)

    def ring_coords(node_ids):
        pts = []
        for nid in node_ids:
            nd = nodes.get(nid)
            if nd is None:
                return None
            pts.append(proj.xy(nd["lon"], nd["lat"]))
        return pts

    buildings = []
    roads = []
    water = []
    green = []
    trees = []
    skipped = []

    # -- ways ------------------------------------------------------------
    for wid, w in ways.items():
        tags = w.get("tags", {})
        closed = len(w["nodes"]) >= 4 and w["nodes"][0] == w["nodes"][-1]
        name = tags.get("name", "")

        if tags.get("building") not in (None, "no", "roof"):
            if not closed:
                skipped.append(("building-open-way", wid))
                continue
            pts = ring_coords(w["nodes"])
            if not pts or len(pts) < 3:
                skipped.append(("building-bad-geom", wid))
                continue
            buildings.append({"id": wid, "name": name, "tags": tags, "outers": [pts], "inners": []})
            continue

        if "highway" in tags:
            ht = tags["highway"]
            if ht in ("proposed", "construction", "steps", "corridor"):
                continue
            pts = [ring_coords([nid])[0] for nid in w["nodes"]]
            if len(pts) < 2:
                continue
            roads.append({"id": wid, "kind": ht, "name": name,
                          "width": ROAD_WIDTHS.get(ht, 4), "pts": pts})
            continue

        if tags.get("natural") == "water" or "water" in tags or tags.get("waterway") in ("riverbank", "dock"):
            if not closed:
                continue
            pts = ring_coords(w["nodes"])
            if pts and len(pts) >= 3:
                water.append({"id": wid, "name": name, "outers": [pts], "inners": []})
            continue

        gk = GREEN_KINDS.get(tags.get("leisure")) or GREEN_KINDS.get(tags.get("landuse")) \
            or GREEN_KINDS.get(tags.get("natural"))
        if gk and closed:
            pts = ring_coords(w["nodes"])
            if pts and len(pts) >= 3:
                green.append({"id": wid, "kind": gk, "name": name, "outers": [pts], "inners": []})
            continue

    # -- relations (multipolygon buildings / water) -----------------------
    for r in relations:
        tags = r.get("tags", {})
        if tags.get("type") != "multipolygon":
            continue
        if tags.get("building") in (None, "no") and tags.get("natural") != "water":
            continue
        outers, inners = [], []
        for m in r.get("members", []):
            if m["type"] == "way":
                (outers if m.get("role", "outer") != "inner" else inners).append(m["ref"])
        outer_rings = assemble_rings(outers, ways)
        if not outer_rings:
            skipped.append(("rel-no-outer-ring", r["id"]))
            continue
        inner_rings = assemble_rings(inners, ways) if inners else []
        name = tags.get("name", "")
        for i, ring in enumerate(outer_rings):
            pts = ring_coords(ring + [ring[0]])
            if not pts or len(pts) < 3:
                skipped.append(("rel-bad-geom", r["id"]))
                continue
            holes = []
            for iring in inner_rings:
                hpts = ring_coords(iring + [iring[0]])
                if hpts and len(hpts) >= 3:
                    holes.append(hpts)
            item = {"id": r["id"] if i == 0 else "%s-%d" % (r["id"], i + 1),
                    "name": name, "tags": tags, "outers": [pts], "inners": holes}
            if tags.get("natural") == "water":
                water.append(item)
            else:
                buildings.append(item)

    # -- trees -------------------------------------------------------------
    for nid, nd in nodes.items():
        tags = nd.get("tags", {})
        if tags.get("natural") == "tree":
            trees.append(proj.xy(nd["lon"], nd["lat"]))

    # -- heights ------------------------------------------------------------
    overrides = load_overrides()
    out_buildings = []
    for b in buildings:
        area = sum(shoelace_area(o) for o in b["outers"])
        h, src = parse_height(b["tags"])
        if h is None:
            h = round(default_levels(area) * LEVEL_HEIGHT, 1)
            src = "default"
        ov = overrides["byId"].get(str(b["id"]))
        if ov is None and b["name"]:
            ov = overrides["byName"].get(b["name"])
        if ov:
            if "levels" in ov:
                h = round(float(ov["levels"]) * LEVEL_HEIGHT, 1)
                src = "override"
            elif "height" in ov:
                h = round(float(ov["height"]), 1)
                src = "override"
        out_buildings.append({
            "id": b["id"], "name": b["name"],
            "type": b["tags"].get("building", "yes"),
            "height": h, "heightSource": src, "area": int(area),
            "polygon": b["outers"][0], "holes": b["inners"]})
    buildings = out_buildings

    scene = {
        "meta": {
            "origin": [proj.lon0, proj.lat0],
            "bbox": snap["bbox"],
            "source": snap["source"],
            "snapshotTakenAt": snap.get("fetched_at"),
            "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
            "note": "coordinates: X=east metres, Y=north metres from origin",
        },
        "buildings": buildings,
        "roads": roads,
        "water": water,
        "green": green,
        "trees": trees,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False)

    named = sum(1 for b in buildings if b["name"])
    tagged = sum(1 for b in buildings if b["heightSource"] != "default")
    print("buildings: %d (named %d, tagged-height %d)" % (len(buildings), named, tagged))
    print("roads: %d, water: %d, green: %d, trees: %d" % (len(roads), len(water), len(green), len(trees)))
    if skipped:
        print("skipped: %d %s" % (len(skipped), skipped[:8]))
    print("WROTE %s (%.2f MB)" % (OUT_PATH, os.path.getsize(OUT_PATH) / 1e6))


if __name__ == "__main__":
    main()
