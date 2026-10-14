# -*- coding: utf-8 -*-
"""Run blender gym asset and dump full log to a file."""
import subprocess

p = subprocess.run(
    [r"D:\tools\blender-4.5.9-windows-x64\blender.exe", "-b",
     "--python", r"D:\huxi-3d-map\scripts\blender\build_models.py",
     "--", "--asset", "gym"],
    capture_output=True, text=True, timeout=280)
out = (p.stdout or "") + "\n===STDERR===\n" + (p.stderr or "")
keep = [l for l in out.splitlines()
        if l.strip() and not l.startswith(("Fra:", "Sample", "CLM", "Sync", "Updating"))]
open(r"D:\huxi-3d-map\work\render\gym_log.txt", "w", encoding="utf-8").write("\n".join(keep[-60:]))
print("exit", p.returncode, "written gym_log.txt")
