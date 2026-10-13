# -*- coding: utf-8 -*-
"""Fetch an OSM snapshot for the CQU Huxi campus.

Tries multiple data sources in order and stores the first successful
result as a timestamped snapshot in data/snapshots/. All sources return
the same {"elements": [...]} shape, so the downstream parser is
source-agnostic.

Usage:
    py scripts/fetch_osm.py
"""
import json
import os
import urllib.request
import urllib.parse
import datetime

BBOX = [106.281, 29.584, 106.309, 29.606]  # left, bottom, right, top (WGS84)

UA = {"User-Agent": "huxi-3d-map/0.1 (local campus 3d map, one-time snapshot fetch)"}
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "data", "snapshots")


def osm_api_bbox():
    l, b, r, t = BBOX
    return "https://api.openstreetmap.org/api/0.6/map.json?bbox=" + \
        "%f,%f,%f,%f" % (l, b, r, t)


def overpass_query():
    l, b, r, t = BBOX
    q = ("[out:json][timeout:90];"
         "(way(%f,%f,%f,%f)[building];"
         "way(%f,%f,%f,%f)[highway];"
         "way(%f,%f,%f,%f)[natural];"
         "way(%f,%f,%f,%f)[leisure];"
         "way(%f,%f,%f,%f)[landuse];"
         "node(%f,%f,%f,%f)[natural=tree];"
         "relation(%f,%f,%f,%f)[building];"
         ");(._;>;);out;" % (l, b, r, t, l, b, r, t, l, b, r, t,
                             l, b, r, t, l, b, r, t, l, b, r, t,
                             l, b, r, t))
    return q


SOURCES = [
    ("osm-api", osm_api_bbox(), None),
    ("overpass-api.de", "https://overpass-api.de/api/interpreter", overpass_query()),
    ("overpass.kumi.systems", "https://overpass.kumi.systems/api/interpreter", overpass_query()),
    ("overpass.osm.jp", "https://overpass.osm.jp/api/interpreter", overpass_query()),
]


def try_fetch(name, url, post_data):
    print("trying source: " + name)
    if post_data is None:
        req = urllib.request.Request(url, headers=UA)
    else:
        body = urllib.parse.urlencode({"data": post_data}).encode()
        req = urllib.request.Request(url, data=body, headers=UA)
    raw = urllib.request.urlopen(req, timeout=150).read()
    doc = json.loads(raw.decode("utf-8"))
    elements = doc.get("elements", [])
    if not elements:
        raise ValueError("empty element list")
    kinds = {}
    for el in elements:
        kinds[el["type"]] = kinds.get(el["type"], 0) + 1
    print("OK %s: %d elements %s" % (name, len(elements), sorted(kinds.items())))
    return {
        "source": name,
        "url": url,
        "fetched_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "bbox": BBOX,
        "osm_version": doc.get("version"),
        "elements": elements,
    }


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    last_err = None
    for name, url, post_data in SOURCES:
        try:
            snap = try_fetch(name, url, post_data)
        except Exception as e:  # noqa: BLE001 - report and fall through
            last_err = e
            print("FAILED %s: %r" % (name, e))
            continue
        stamp = datetime.date.today().isoformat()
        path = os.path.join(OUT_DIR, "osm_snapshot_%s.json" % stamp)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False)
        print("SAVED %s (%.1f MB)" % (path, os.path.getsize(path) / 1e6))
        return 0
    print("ALL_SOURCES_FAILED, last error: %r" % last_err)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
