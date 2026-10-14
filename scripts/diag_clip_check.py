# -*- coding: utf-8 -*-
"""Classify named buildings as inside/outside the CQU Huxi campus boundary (way 239537195)."""
import json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
snaps = sorted(glob.glob(os.path.join(ROOT, "data", "snapshots", "osm_snapshot_*.json")))
snap = json.load(open(snaps[-1], encoding="utf-8"))

nodes = {}
ways = {}
for el in snap["elements"]:
    if el["type"] == "node":
        nodes[el["id"]] = el
    elif el["type"] == "way":
        ways[el["id"]] = el

BORDER_WAY = 239537195
poly = []
for nid in ways[BORDER_WAY]["nodes"]:
    nd = nodes[nid]
    poly.append((nd["lon"], nd["lat"]))

def inside(lon, lat, poly):
    c = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            c = not c
    return c

lons = [p[0] for p in poly]
lats = [p[1] for p in poly]
print("boundary bbox: lon %.4f-%.4f lat %.4f-%.4f, %d pts"
      % (min(lons), max(lons), min(lats), max(lats), len(poly)))

inside_names, outside_names = [], []
seen = set()
for w in ways.values():
    t = w.get("tags", {})
    nm = t.get("name", "")
    if not nm or t.get("building") in (None, "no"):
        continue
    pts = [(nodes[n]["lon"], nodes[n]["lat"]) for n in w["nodes"] if n in nodes]
    if len(pts) < 3:
        continue
    clon = sum(p[0] for p in pts) / len(pts)
    clat = sum(p[1] for p in pts) / len(pts)
    key = nm
    if key in seen:
        continue
    seen.add(key)
    (inside_names if inside(clon, clat, poly) else outside_names).append(nm)

print("\nINSIDE campus (%d):" % len(inside_names))
print("  " + "、".join(sorted(inside_names)))
print("\nOUTSIDE campus (%d):" % len(outside_names))
print("  " + "、".join(sorted(outside_names)))

# relations with names (big academic complexes are usually multipolygon relations)
relations = [el for el in snap["elements"] if el["type"] == "relation"]
print("\nnamed relations (buildings):")
for r in relations:
    t = r.get("tags", {})
    nm = t.get("name", "")
    if not nm or t.get("building") in (None, "no"):
        continue
    # use member ways' first nodes for a rough center
    pts = []
    for m in r.get("members", []):
        if m["type"] == "way" and m["ref"] in ways:
            w = ways[m["ref"]]
            for nid in w["nodes"][:5]:
                if nid in nodes:
                    pts.append((nodes[nid]["lon"], nodes[nid]["lat"]))
    if not pts:
        continue
    clon = sum(p[0] for p in pts) / len(pts)
    clat = sum(p[1] for p in pts) / len(pts)
    print("  %s center=(%.4f,%.4f) inside=%s" % (nm, clon, clat, inside(clon, clat, poly)))

# named nodes of interest (POIs like sports)
print("\nnamed nodes with sport/leisure/amenity:")
for nid, nd in nodes.items():
    t = nd.get("tags", {})
    nm = t.get("name", "")
    if nm and (t.get("leisure") in ("sports_centre", "sports_hall", "stadium") or t.get("amenity") in ("university", "college")):
        print("  %s (%.4f,%.4f) inside=%s leisure=%s amenity=%s"
              % (nm, nd["lon"], nd["lat"], inside(nd["lon"], nd["lat"], poly),
                 t.get("leisure"), t.get("amenity")))

# also classify the 4 current gates (scene.json coords -> lon/lat is roundtrip via origin)
import math
scene = json.load(open(os.path.join(ROOT, "public", "data", "scene.json"), encoding="utf-8"))
origin_lon, origin_lat = scene["meta"]["origin"]
cos_lat = math.cos(math.radians(origin_lat))
print("\ngates:")
for g in scene["gates"]:
    lon = origin_lon + g["x"] / (111320.0 * cos_lat)
    lat = origin_lat + g["y"] / 111320.0
    print("  %s (%.4f,%.4f) inside_boundary=%s scene=(%.0f,%.0f)"
          % (g["name"], lon, lat, inside(lon, lat, poly), g["x"], g["y"]))
