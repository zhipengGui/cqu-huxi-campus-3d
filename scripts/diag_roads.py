# -*- coding: utf-8 -*-
"""Diagnose: road kinds and their distance from campus centre."""
import json, os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "public", "data", "scene.json"), encoding="utf-8") as f:
    scene = json.load(f)

kinds = Counter()
kinds_inner = Counter()  # roads within 900m of origin (roughly campus interior)
for r in scene["roads"]:
    kinds[r["kind"]] += 1
    xs = [p[0] for p in r["pts"]]
    ys = [p[1] for p in r["pts"]]
    if max(xs) > -900 and min(xs) < 900 and max(ys) > -700 and min(ys) < 700:
        kinds_inner[r["kind"]] += 1

print("all roads by kind:")
for k, v in kinds.most_common():
    print("  %-14s %d" % (k, v))
print("roads within campus box (±900E, ±700N):")
for k, v in kinds_inner.most_common():
    print("  %-14s %d" % (k, v))
