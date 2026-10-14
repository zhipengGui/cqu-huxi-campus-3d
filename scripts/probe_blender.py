# -*- coding: utf-8 -*-
"""Probe blender.org for the latest 4.x LTS windows-x64 zip URL."""
import re
import urllib.request

MIRROR = "https://mirrors.tuna.tsinghua.edu.cn/blender/release/"
req = urllib.request.Request(MIRROR,
                             headers={"User-Agent": "huxi-3d-map/0.1"})
html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
dirs = sorted(set(re.findall(r"Blender4\.\d+", html)))
print("major dirs:", dirs)
best = None
for d in dirs:
    if not d.startswith(("Blender4.2", "Blender4.3", "Blender4.4", "Blender4.5")):
        continue
    req2 = urllib.request.Request(MIRROR + d + "/",
                                  headers={"User-Agent": "huxi-3d-map/0.1"})
    sub = urllib.request.urlopen(req2, timeout=40).read().decode("utf-8", "ignore")
    zips = re.findall(r'([\w.\-]+windows-x64\.zip)', sub)
    if zips:
        zips = sorted(set(zips))
        print(d, "->", zips[-3:])
        best = MIRROR + d + "/" + zips[-1]
print("BEST:", best)
