# -*- coding: utf-8 -*-
"""Check: does the snapshot contain a campus boundary polygon for CQU Huxi?
Which named buildings lie outside it?"""
import json, math, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
snaps = sorted(glob.glob(os.path.join(ROOT, "data", "snapshots", "osm_snapshot_*.json")))
snap = json.load(open(snaps[-1], encoding="utf-8"))

nodes = {}
ways = {}
relations = []
for el in snap["elements"]:
    if el["type"] == "node":
        nodes[el["id"]] = el
    elif el["type"] == "way":
        ways[el["id"]] = el
    else:
        relations.append(el)

# find campus-ish polygons
candidates = []
for r in relations:
    t = r.get("tags", {})
    nm = t.get("name", "")
    if t.get("type") == "multipolygon" and (
        "大学" in nm or t.get("amenity") == "university" or t.get("landuse") == "education"):
        candidates.append(("rel", r["id"], nm, t))
for w in ways.values():
    t = w.get("tags", {})
    nm = t.get("name", "")
    closed = len(w.get("nodes", [])) >= 4 and w["nodes"][0] == w["nodes"][-1]
    if closed and ("大学" in nm or t.get("amenity") == "university" or t.get("landuse") == "education"):
        candidates.append(("way", w["id"], nm, t))

print("campus polygon candidates:")
for kind, i, nm, t in candidates[:15]:
    print("  %s %s name=%r amenity=%s landuse=%s" % (kind, i, nm, t.get("amenity"), t.get("landuse")))

# named buildings summary with rough position
def ring_pts(w):
    pts = []
    for nid in w["nodes"]:
        nd = nodes.get(nid)
        if nd:
            pts.append((nd["lon"], nd["lat"]))
    return pts

def way_bbox(pts):
    if not pts:
        return None
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    return min(lons), min(lats), max(lons), max(lats)

print("\nnamed buildings (way) with center:")
for w in ways.values():
    t = w.get("tags", {})
    nm = t.get("name", "")
    if nm and t.get("building") not in (None, "no"):
        pts = ring_pts(w)
        bb = way_bbox(pts)
        if bb:
            print("  %s center=(%.4f,%.4f)" % (nm, (bb[0]+bb[2])/2, (bb[1]+bb[3])/2))
