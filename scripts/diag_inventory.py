# -*- coding: utf-8 -*-
"""Inventory: what useful tags exist in the snapshot for v2 features."""
import json, os, glob
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
snaps = sorted(glob.glob(os.path.join(ROOT, "data", "snapshots", "osm_snapshot_*.json")))
snap = json.load(open(snaps[-1], encoding="utf-8"))

gate_tags = Counter()
sport = Counter()
ped_area = 0
names_with_gate = []
amenity = Counter()
barrier = Counter()
leisure = Counter()

for el in snap["elements"]:
    tags = el.get("tags", {})
    if "barrier" in tags:
        barrier[tags["barrier"]] += 1
    if "amenity" in tags:
        amenity[tags["amenity"]] += 1
    if "leisure" in tags:
        leisure[tags["leisure"]] += 1
    if "sport" in tags:
        sport[tags["sport"]] += 1
    if tags.get("highway") == "pedestrian" and tags.get("area") in ("yes", "true", "1"):
        ped_area += 1
    nm = tags.get("name", "")
    if "门" in nm and nm not in ("校门",):
        names_with_gate.append((el["type"], el["id"], nm, tags.get("amenity", tags.get("barrier", ""))))

print("barrier:", dict(barrier))
print("amenity:", dict(amenity))
print("leisure:", dict(leisure))
print("sport:", dict(sport))
print("pedestrian areas:", ped_area)
print("names containing 门:")
for x in names_with_gate[:20]:
    print("  ", x)
