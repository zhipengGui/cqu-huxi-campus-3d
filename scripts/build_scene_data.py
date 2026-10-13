# -*- coding: utf-8 -*-
"""Build public/data/scene.json from the OSM snapshot (v2).

v2 additions over v1:
- building `style` classification (dorm/canteen/hall/lab/teaching/library/office)
- green areas carry `sport` (basketball/tennis/...), new kinds: pool/track
- pedestrian-area ways exported as `paving`
- barrier=gate nodes exported as `gates` with road orientation
- `graph`: road network (node/edge list) for A* routing
- landmark flags on named signature buildings
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
# 步行导航图排除的路类（机动车快速路/楼梯）
GRAPH_EXCLUDE = {"motorway", "trunk", "trunk_link", "proposed", "construction",
                 "corridor", "steps", "elevator"}

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


def bbox_center_of(b):
    xs = [p[0] for p in b["outers"][0]]
    ys = [p[1] for p in b["outers"][0]]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


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


DORM_HINTS = ("宿舍", "公寓", "园#", "园一栋", "园二栋", "园三栋", "园四栋",
              "园五栋", "园六栋", "园七栋", "园八栋")


def classify_style(name, tags):
    b = tags.get("building", "")
    if "图书馆" in name:
        return "library"
    if "活动中心" in name or "礼堂" in name:
        return "hall"
    if "食堂" in name:
        return "canteen"
    if any(k in name for k in DORM_HINTS):
        return "dorm"
    if "实验" in name or "实训" in name:
        return "lab"
    if "教学楼" in name or "学院" in name or "教研" in name:
        return "teaching"
    if b in ("school", "university", "college"):
        return "teaching"
    if b in ("office", "commercial"):
        return "office"
    return "office"


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
                return []
            owid, tail = nxt
            ring.extend(tail)
            del unused[owid]
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring[:-1])
    return rings


def build_graph(roads):
    """Road network for walking A*: nodes on 0.5m grid, deduped edges."""
    nodes = []
    index = {}
    edges = {}
    excl = GRAPH_EXCLUDE

    def nid(x, y):
        key = (round(x * 2) / 2.0, round(y * 2) / 2.0)
        if key in index:
            return index[key]
        i = len(nodes)
        nodes.append([key[0], key[1]])
        index[key] = i
        return i

    for r in roads:
        if r["kind"] in excl:
            continue
        pts = r["pts"]
        for i in range(len(pts) - 1):
            a = nid(*pts[i])
            b = nid(*pts[i + 1])
            if a == b:
                continue
            length = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            key = (min(a, b), max(a, b))
            if key not in edges or edges[key][2] > length:
                edges[key] = [a, b, round(length, 1)]
    return {"nodes": nodes, "edges": list(edges.values())}


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
        for nid_ in node_ids:
            nd = nodes.get(nid_)
            if nd is None:
                return None
            pts.append(proj.xy(nd["lon"], nd["lat"]))
        return pts

    buildings = []
    roads = []
    water = []
    green = []
    paving = []
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
            if ht in ("proposed", "construction", "corridor"):
                continue
            if ht == "pedestrian" and closed and tags.get("area") in ("yes", "true", "1"):
                pts = ring_coords(w["nodes"])
                if pts and len(pts) >= 3:
                    paving.append({"id": wid, "name": name, "outers": [pts], "inners": []})
                continue
            if ht == "steps":
                continue
            pts = [ring_coords([nid_])[0] for nid_ in w["nodes"]]
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
        if tags.get("leisure") == "swimming_pool":
            gk = "pool"
        elif tags.get("leisure") == "track":
            gk = "track"
        if gk and closed:
            pts = ring_coords(w["nodes"])
            if pts and len(pts) >= 3:
                green.append({"id": wid, "kind": gk, "sport": tags.get("sport", ""),
                              "name": name, "outers": [pts], "inners": []})
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
    for nid_, nd in nodes.items():
        tags = nd.get("tags", {})
        if tags.get("natural") == "tree":
            trees.append(proj.xy(nd["lon"], nd["lat"]))

    # -- gates: barrier nodes + orientation from nearest road --------------
    gate_nodes = []
    for nid_, nd in nodes.items():
        tags = nd.get("tags", {})
        if tags.get("barrier") in ("gate", "lift_gate"):
            gate_nodes.append(proj.xy(nd["lon"], nd["lat"]))
    gates = []
    for i, (gx, gy) in enumerate(gate_nodes):
        # 只保留校区边缘的闸门（过远的其实是大学城公路闸口）
        if gx * gx + gy * gy > 950 ** 2:
            continue
        if any(math.hypot(gx - k["x"], gy - k["y"]) < 180 for k in gates):
            continue
        best = None  # (dist, angle)
        for r in roads:
            for j in range(len(r["pts"]) - 1):
                x1, y1 = r["pts"][j]
                x2, y2 = r["pts"][j + 1]
                dx, dy = x2 - x1, y2 - y1
                len2 = dx * dx + dy * dy
                if not len2:
                    continue
                t = max(0.0, min(1.0, ((gx - x1) * dx + (gy - y1) * dy) / len2))
                px, py = x1 + t * dx, y1 + t * dy
                d = math.hypot(gx - px, gy - py)
                if best is None or d < best[0]:
                    ang = math.degrees(math.atan2(dy, dx))
                    best = (d, ang)
        if best is None or best[0] > 80:
            continue
        # 按相对校区中心的方位命名
        if abs(gx) >= abs(gy):
            name = "东门" if gx > 0 else "西门"
        else:
            name = "北门" if gy > 0 else "南门"
        if any(k["name"] == name for k in gates):
            n = 2
            while any(k["name"] == "%s%d" % (name, n) for k in gates):
                n += 1
            name = "%s%d" % (name, n)
        gates.append({"id": "gate-%d" % (i + 1), "x": gx, "y": gy,
                      "angle": round(best[1], 1), "name": name})

    # -- heights / styles ---------------------------------------------------
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
        landmark = ""
        bc = bbox_center_of(b)
        if b["name"] == "图书馆" and abs(bc[0]) < 900 and abs(bc[1]) < 900:
            landmark = "library"
        elif b["name"] == "学生活动中心" and abs(bc[0]) < 900 and abs(bc[1]) < 900:
            landmark = "activity"
        out_buildings.append({
            "id": b["id"], "name": b["name"],
            "type": b["tags"].get("building", "yes"),
            "style": classify_style(b["name"], b["tags"]),
            "landmark": landmark,
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
        "paving": paving,
        "gates": gates,
        "graph": build_graph(roads),
        "trees": trees,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False)

    named = sum(1 for b in buildings if b["name"])
    tagged = sum(1 for b in buildings if b["heightSource"] != "default")
    styles = {}
    for b in buildings:
        styles[b["style"]] = styles.get(b["style"], 0) + 1
    print("buildings: %d (named %d, tagged-height %d) styles=%s"
          % (len(buildings), named, tagged, sorted(styles.items())))
    print("roads: %d, water: %d, green: %d, paving: %d, gates: %d, trees: %d"
          % (len(roads), len(water), len(green), len(paving), len(gates), len(trees)))
    g = scene["graph"]
    print("graph: %d nodes, %d edges" % (len(g["nodes"]), len(g["edges"])))
    if skipped:
        print("skipped: %d %s" % (len(skipped), skipped[:8]))
    print("WROTE %s (%.2f MB)" % (OUT_PATH, os.path.getsize(OUT_PATH) / 1e6))


if __name__ == "__main__":
    overrides = load_overrides()
    main()
