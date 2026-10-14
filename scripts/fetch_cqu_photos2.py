# -*- coding: utf-8 -*-
"""Download additional CQU Huxi photos (east gate, replica gate, library)."""
import os
import urllib.parse
import urllib.request

BASE = "https://www.cqu.edu.cn/images/23/10/11/1ucry5xfsw/"
NAMES = ["虎溪东大门", "虎溪复刻校门广场", "虎溪-图书馆夏", "虎溪-图书馆",
         "虎溪缙湖2", "虎溪-莲池"]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "work", "refs")
os.makedirs(OUT, exist_ok=True)
ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
for nm in NAMES:
    url = BASE + urllib.parse.quote(nm) + ".jpg"
    path = os.path.join(OUT, nm + ".jpg")
    try:
        data = urllib.request.urlopen(urllib.request.Request(url, headers=ua), timeout=40).read()
        with open(path, "wb") as f:
            f.write(data)
        print("OK", nm, len(data) // 1024, "KB")
    except Exception as e:  # noqa: BLE001
        print("FAIL", nm, repr(e))
