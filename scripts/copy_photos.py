# -*- coding: utf-8 -*-
"""Copy reference photos into public/photos for the place detail cards."""
import os
import shutil

SRC = r"D:\huxi-3d-map\work\refs"
DST = r"D:\huxi-3d-map\public\photos"
os.makedirs(DST, exist_ok=True)
pairs = {
    "虎溪信息大楼.jpg": "info.jpg",
    "虎溪体育中心.jpg": "gym.jpg",
    "虎溪学生活动中心.jpg": "activity.jpg",
    "虎溪-图书馆夏.jpg": "library.jpg",
    "虎溪东大门.jpg": "gate_east.jpg",
    "虎溪复刻校门广场.jpg": "gate_north.jpg",
    "虎溪综合楼.jpg": "zonghelou.jpg",
    "虎溪理工大楼.jpg": "likelou.jpg",
}
for src, dst in pairs.items():
    p = os.path.join(SRC, src)
    if os.path.exists(p):
        shutil.copy(p, os.path.join(DST, dst))
        print("OK", dst)
    else:
        print("MISS", src)
