# -*- coding: utf-8 -*-
"""Blender parametric fine-model builder for CQU Huxi campus landmarks.

Run (after Blender is available):
    <blender> -b --python scripts/blender/build_models.py -- --asset library
    <blender> -b --python scripts/blender/build_models.py -- --asset all

Outputs:
    public/models/<asset>.glb   (origin conventions in DESIGN below)
    work/render/<asset>.png     (Cycles CPU preview)

Design conventions (must match src/landmarks.ts placement):
- Buildings: origin = footprint bbox centre; long axis = +X; +Y = north; Z up.
- Gates: origin = gate point; beam spans local +X (perpendicular to road);
  road runs along local ±Y.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCENE_JSON = os.path.join(ROOT, "public", "data", "scene.json")
OUT_GLB = os.path.join(ROOT, "public", "models")
OUT_RENDER = os.path.join(ROOT, "work", "render")
FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"

# ---------------------------------------------------------------- materials

MATS = {}


def mat(name, color, rough=0.85, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


def C(hexcolor):
    h = hexcolor.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def glass_mat(name, color):
    """玻璃材质：透明 + 低粗糙 + 高 IOR，glTF 导出为 transmission 扩展。"""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Transmission Weight"].default_value = 0.85
    bsdf.inputs["IOR"].default_value = 1.45
    MATS[name] = m
    return m


# ---------------------------------------------------------------- helpers

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for x in list(block):
            if x.users == 0:
                block.remove(x)


def box(name, sx, sy, sz, x, y, z, material, rz=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    o.rotation_euler[2] = rz
    o.data.materials.append(material)
    return o


def cyl(name, r, depth, x, y, z, material, rx=0.0, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts,
                                        location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler[0] = rx
    o.data.materials.append(material)
    return o


def triangulate_ring(pts):
    """耳切三角剖分（CCW 环，支持凹多边形），返回索引三元组列表。"""
    idx = list(range(len(pts)))
    tris = []
    guard = 0
    while len(idx) > 2 and guard < 20000:
        guard += 1
        n = len(idx)
        clipped = False
        for i in range(n):
            a, b, c = idx[(i - 1) % n], idx[i], idx[(i + 1) % n]
            ax, ay = pts[a]
            bx, by = pts[b]
            cx, cy = pts[c]
            cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
            if cross <= 1e-9:
                continue
            ok = True
            for j in idx:
                if j in (a, b, c):
                    continue
                px, py = pts[j]
                d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
                d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx)
                d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
                if d1 >= -1e-9 and d2 >= -1e-9 and d3 >= -1e-9:
                    ok = False
                    break
            if ok:
                tris.append((a, b, c))
                idx.remove(b)
                clipped = True
                break
        if not clipped:
            break
    return tris


def extrude_polygon(pts, h, name, material, holes=None):
    """Solid from closed polygon (list[(x,y)]), walls + top, origin at z=0.
    统一归一化为 CCW，保证顶面法线朝上（否则渲染黑面）。"""
    holes = holes or []

    def signed_area(ring):
        a = 0.0
        for i in range(len(ring)):
            x1, y1 = ring[i]
            x2, y2 = ring[(i + 1) % len(ring)]
            a += x1 * y2 - x2 * y1
        return a

    if signed_area(pts) < 0:
        pts = pts[::-1]
    holes = [r[::-1] if signed_area(r) > 0 else r for r in holes]
    verts = [(p[0], p[1], 0.0) for p in pts]
    top_start = len(verts)
    verts += [(p[0], p[1], h) for p in pts]
    faces = []
    n = len(pts)
    for i in range(n):  # walls (two triangles)
        j = (i + 1) % n
        faces.append([i, j, top_start + j, top_start + i])
    # top：耳切三角剖分（凹多边形安全）
    for (a, b, c) in triangulate_ring(pts):
        faces.append([top_start + a, top_start + b, top_start + c])
    for ring in holes:
        # 洞环侧壁：只有顶面高度时会生成零高度退化面（渲染黑斑），故不生成；
        # 洞区由屋顶覆盖（地图视角影响可忽略）
        pass
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def text_mesh(name, body_text, size, material, x, y, z, rx=math.pi / 2, rz=0.0,
              extrude=0.08, align_center=True):
    curve = bpy.data.curves.new(name, type="FONT")
    try:
        curve.font = bpy.data.fonts.load(FONT_PATH)
    except Exception:
        print("WARN: font not loaded, fallback default")
    curve.body = body_text
    curve.size = size
    curve.extrude = extrude
    curve.align_x = "CENTER" if align_center else "LEFT"
    ob = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(ob)
    ob.location = (x, y, z)
    ob.rotation_euler = (rx, 0, rz)
    ob.data.materials.append(material)
    return ob


def bbox_of(objects):
    pts = []
    for o in objects:
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)


def recenter(objects, cx=None, cy=None):
    """Shift objects so footprint centre lands at origin (keeps z)."""
    x0, y0, z0, x1, y1, z1 = bbox_of(objects)
    cx = (x0 + x1) / 2 if cx is None else cx
    cy = (y0 + y1) / 2 if cy is None else cy
    for o in objects:
        o.location.x -= cx
        o.location.y -= cy
    bpy.context.view_layer.update()


def join_objects(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


def perimeter_windows(wall_pts, spec, h_from, h_to, out):
    """Distribute window boxes along a closed wall polygon.

    spec: dict(step=float, width=float, depth=float, color=hex, along_gap=None)
    """
    per = []
    n = len(wall_pts)
    total = 0.0
    segs = []
    for i in range(n):
        x1, y1 = wall_pts[i]
        x2, y2 = wall_pts[(i + 1) % n]
        L = math.hypot(x2 - x1, y2 - y1)
        segs.append((x1, y1, x2, y2, L))
        total += L
    step = spec["step"]
    w = spec["width"]
    hh = h_to - h_from
    zc = (h_from + h_to) / 2
    dist = step / 2
    k = 0
    while dist < total:
        for (x1, y1, x2, y2, L) in segs:
            if dist <= total and dist - (total - L) <= L and dist > (total - L) - 1e-9:
                pass
        # locate segment
        acc = 0.0
        for (x1, y1, x2, y2, L) in segs:
            if acc <= dist <= acc + L:
                t = (dist - acc) / L
                px = x1 + (x2 - x1) * t
                py = y1 + (y2 - y1) * t
                dx, dy = (x2 - x1) / L, (y2 - y1) / L
                rz = math.atan2(dy, dx)
                b = box("win", L * 0 + w, 0.18, hh * 0.62, px, py, zc,
                        mat("glass", C(spec.get("color", "#3b4754")), 0.35), rz=rz)
                out.append(b)
                break
            acc += L
        dist += step
        k += 1
        if k > 4000:
            break


# ---------------------------------------------------------------- assets

def asset_library(D):
    """图书馆：红棕裙楼 + 玻璃底座 + 百叶板塔 + 塔顶校名。照片：library_red/虎溪-图书馆。"""
    b = D["buildings"]["library"]
    poly = b["polygon"]
    holes = b["holes"]
    x0 = min(p[0] for p in poly); x1 = max(p[0] for p in poly)
    y0 = min(p[1] for p in poly); y1 = max(p[1] for p in poly)
    east_long = (x1 - x0) >= (y1 - y0)
    L, W = (x1 - x0, y1 - y0) if east_long else (y1 - y0, x1 - x0)
    objs = []
    red = mat("libred", C("#a8523f"))
    red_dk = mat("libred_dk", C("#8a4036"))
    glass = glass_mat("libglass", C("#42525e"))
    white = mat("white", C("#f4f3ee"))
    # 裙楼（真实轮廓）上段 + 玻璃底座（内收）
    inner = [(px + (cx - px) * 0.965, py + (cy - py) * 0.965)
             for (px, py), (cx, cy) in zip(poly, [(sum(p[0] for p in poly) / len(poly),
                                                  sum(p[1] for p in poly) / len(poly))] * len(poly))]
    objs.append(extrude_polygon(poly, 8.0, "podium", red, holes))
    objs.append(extrude_polygon(inner, 3.6, "glassbase", glass))
    # 底层红柱
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2
    import math as _m
    per = 0.0
    n = len(poly)
    for i in range(n):
        px, py = poly[i]; qx, qy = poly[(i + 1) % n]
        per += _m.hypot(qx - px, qy - py)
    step = max(per / 18, 8)
    acc = step / 2
    i = 0
    while acc < per and i < 200:
        a = 0.0
        for j in range(n):
            px, py = poly[j]; qx, qy = poly[(j + 1) % n]
            Lj = _m.hypot(qx - px, qy - py)
            if a <= acc <= a + Lj:
                t = (acc - a) / Lj
                bx = px + (qx - px) * t
                by = py + (qy - py) * t
                rz = _m.atan2(qy - py, qx - px)
                objs.append(box("col", 1.0, 1.0, 3.6, bx, by, 1.8, red_dk, rz))
                break
            a += Lj
        acc += step
        i += 1
    # 板塔（百叶）：窄长体 + 竖向红百叶条（置于轮廓中心）
    towerL = min(L * 0.72, 95)
    towerW = max(14, min(W * 0.38, 24))
    towerH = max(b["height"], 30) - 8
    tx, ty = cx, cy
    objs.append(box("towercore", towerL, towerW, towerH, tx, ty, 8 + towerH / 2, red_dk))
    nf = int(towerL / 1.1)
    for i in range(nf):
        fx = tx - towerL / 2 + (i + 0.5) * (towerL / nf)
        objs.append(box("fin", 0.16, towerW + 0.5, towerH, fx, ty, 8 + towerH / 2, red))
    # 塔顶白带 + 校名（贴冠带上沿，避免背面子镜像字穿帮）
    objs.append(box("crown", towerL + 0.6, towerW + 0.6, 0.9, tx, ty, 8 + towerH + 0.45, white))
    sign = text_mesh("sign", "重庆大学", 2.6, mat("signred", C("#b8322c"), 0.5),
                     tx, ty + towerW / 2 + 0.35, 8 + towerH + 1.7, rz=0)
    objs.append(sign)
    sign2 = text_mesh("sign2", "重庆大学", 2.6, mat("signred", C("#b8322c"), 0.5),
                      tx, ty - towerW / 2 - 0.35, 8 + towerH + 1.7, rz=math.pi)
    objs.append(sign2)
    # 裙楼"图书馆"白字
    objs.append(text_mesh("lname", "图书馆", 2.6, white,
                          cx + (L * 0.24 if east_long else 0),
                          cy + (W / 2 + 0.3 if east_long else L * 0.24),
                          6.4, rz=0))
    recenter(objs)
    return objs, "library"


def asset_info(D):
    """信息技术科研楼（信息大楼）：白色框架网格外骨骼 + 玻璃 + 屋顶格栅。"""
    b = D["buildings"]["info"]
    poly, holes = b["polygon"], b["holes"]
    objs = []
    white = mat("infowhite", C("#f0f0ec"))
    glass = glass_mat("infoglass", C("#54666f"))
    objs.append(extrude_polygon(poly, b["height"], "mass", glass, holes))
    # 楼层横带（白肋）
    floors = max(3, int(b["height"] / 3.9))
    for f in range(floors + 1):
        z = f * (b["height"] / floors)
        objs.append(extrude_polygon(_offset(poly, 0.22), 0.5, "band", white, _offset_rings(holes, 0.22))
                    if False else _band(poly, z, white))
    # 竖向白肋沿外缘
    n = len(poly)
    for i in range(0, n, 2):
        px, py = poly[i]
        qx, qy = poly[(i + 1) % n]
        Lm = math.hypot(qx - px, qy - py)
        steps = max(1, int(Lm / 4.2))
        for s in range(steps):
            t = (s + 0.5) / steps
            bx = px + (qx - px) * t
            by = py + (qy - py) * t
            rz = math.atan2(qy - py, qx - px)
            objs.append(box("mull", 0.35, 0.35, b["height"] - 0.4, bx, by, (b["height"] - 0.4) / 2, white, rz))
    # 屋顶格栅架
    x0 = min(p[0] for p in poly); x1 = max(p[0] for p in poly)
    y0 = min(p[1] for p in poly); y1 = max(p[1] for p in poly)
    nx = max(4, int((x1 - x0) / 6))
    ny = max(3, int((y1 - y0) / 6))
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        objs.append(box("perg", 0.3, (y1 - y0) + 0.6, 0.3, x, (y0 + y1) / 2, b["height"] + 1.6, white))
    for j in range(ny + 1):
        y = y0 + (y1 - y0) * j / ny
        objs.append(box("perg2", (x1 - x0) + 0.6, 0.3, 0.3, (x0 + x1) / 2, y, b["height"] + 1.6, white))
    for c in [(x0, y0), (x0, y1), (x1, y0), (x1, y1)]:
        objs.append(box("pergc", 0.4, 0.4, 1.6, c[0], c[1], b["height"] + 0.8, white))
    recenter(objs)
    return objs, "info"


def _band(poly, z, material):
    """薄楼板带（外缘 0.25m 厚环，高 0.45）。"""
    inner = _offset(poly, -0.25)
    verts = [(p[0], p[1], z) for p in poly] + [(p[0], p[1], z + 0.45) for p in poly]
    faces = []
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    me = bpy.data.meshes.new("band")
    me.from_pydata(verts, [], faces)
    me.validate(); me.update()
    ob = bpy.data.objects.new("band", me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def _offset(poly, d):
    """顶点式多边形偏移（斜接钳制）。"""
    n = len(poly)
    out = []
    for i in range(n):
        px, py = poly[(i - 1) % n]
        cx, cy = poly[i]
        nx, ny = poly[(i + 1) % n]
        def nrm(ax, ay, bx, by):
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy) or 1
            return dy / L, -dx / L
        a1 = nrm(px, py, cx, cy)
        a2 = nrm(cx, cy, nx, ny)
        mx, my = a1[0] + a2[0], a1[1] + a2[1]
        ml = math.hypot(mx, my) or 1
        mx, my = mx / ml, my / ml
        cosh = max(0.45, mx * a2[0] + my * a2[1])
        s = min(1 / cosh, 2.5) * d
        out.append((cx + mx * s, cy + my * s))
    return out


def _offset_rings(rings, d):
    return [_offset(r, d) for r in rings]


def asset_gym(D):
    """体育馆（体育中心）：银灰弧形肋屋顶 + 红砖基座。"""
    b = D["buildings"]["gym"]
    poly, holes = b["polygon"], b["holes"]
    print("DEBUG gym poly bounds:",
          min(p[0] for p in poly), max(p[0] for p in poly),
          min(p[1] for p in poly), max(p[1] for p in poly),
          "pts:", len(poly))
    x0 = min(p[0] for p in poly); x1 = max(p[0] for p in poly)
    y0 = min(p[1] for p in poly); y1 = max(p[1] for p in poly)
    L, W = x1 - x0, y1 - y0
    objs = []
    brick = mat("brick", C("#9c5a4a"))
    brick_dk = mat("brick_dk", C("#7c4638"))
    metal = mat("metal", C("#cdd3d8"), 0.4, 0.55)
    base_h = 9
    objs.append(extrude_polygon(poly, base_h, "base", brick, holes))
    # 砖墙深色窗带
    n = len(poly)
    for i in range(n):
        px, py = poly[i]
        qx, qy = poly[(i + 1) % n]
        Lm = math.hypot(qx - px, qy - py)
        cnt = max(1, int(Lm / 8))
        for s in range(cnt):
            t = (s + 0.5) / cnt
            bx = px + (qx - px) * t
            by = py + (qy - py) * t
            rz = math.atan2(qy - py, qx - px)
            objs.append(box("bwin", Lm / cnt * 0.55, 0.2, 2.6, bx, by, 4.6, brick_dk, rz))
    # 弧形屋顶：真正的拱曲面网格（沿长轴挤出半拱剖面）
    span = L + 6
    rise = max(10, b["height"] - base_h + 4)
    seg = 20
    east_long = L >= W
    depth = W + 6
    cxm, cym = (x0 + x1) / 2, (y0 + y1) / 2

    def vault(axis_len, other_w):
        verts = []
        K = seg + 1
        for s in range(K):
            a = math.pi * s / seg
            yy = -math.cos(a) * other_w / 2
            zz = base_h + rise * math.sin(a)
            verts += [(cxm - axis_len / 2, cym + yy, zz), (cxm + axis_len / 2, cym + yy, zz)]
        faces = []
        for s in range(seg):
            i0 = s * 2
            faces.append([i0, i0 + 1, i0 + 3, i0 + 2])
        me = bpy.data.meshes.new("vault")
        me.from_pydata(verts, [], faces)
        me.validate()
        me.update()
        ob = bpy.data.objects.new("vault", me)
        bpy.context.collection.objects.link(ob)
        ob.data.materials.append(metal)
        return ob

    if east_long:
        objs.append(vault(span, depth))
    else:
        v = vault(span, depth)
        v.rotation_euler[2] = math.pi / 2
        objs.append(v)
    # 横向肋条
    for s in range(0, seg + 1, 2):
        a = math.pi * s / seg
        yy = -math.cos(a) * depth / 2
        zz = base_h + rise * math.sin(a) + 0.15
        if east_long:
            objs.append(box("ribline", span + 0.4, 0.35, 0.35, cxm, cym + yy, zz, brick_dk))
        else:
            objs.append(box("ribline", 0.35, span + 0.4, 0.35, cxm + yy, cym, zz, brick_dk))
    recenter(objs)
    return objs, "gym"


def asset_gongke(D):
    """工科大楼（无实拍，参数化演绎：白墙横带窗 + 端部楼梯塔）。可后续用实拍校准。"""
    b = D["buildings"]["gongke"]
    poly, holes = b["polygon"], b["holes"]
    objs = []
    wall = mat("gkwall", C("#ece9e2"))
    glass = glass_mat("gkglass", C("#3b4754"))
    white = mat("gkwhite", C("#f6f5f1"))
    h = max(b["height"], 15)
    objs.append(extrude_polygon(poly, h, "mass", wall, holes))
    # 横向窗带（每层）
    floors = max(3, int(h / 3.6))
    for f in range(floors):
        z0 = 1.4 + f * (h / floors)
        n = len(poly)
        for i in range(n):
            px, py = poly[i]
            qx, qy = poly[(i + 1) % n]
            Lm = math.hypot(qx - px, qy - py)
            cnt = max(1, int(Lm / 5))
            for s in range(cnt):
                t = (s + 0.5) / cnt
                bx = px + (qx - px) * t
                by = py + (qy - py) * t
                rz = math.atan2(qy - py, qx - px)
                objs.append(box("w", Lm / cnt * 0.72, 0.16, 1.7, bx, by, z0 + 0.85, glass, rz))
    # 端部楼梯塔（比主体高一级）
    x0 = min(p[0] for p in poly); x1 = max(p[0] for p in poly)
    y0 = min(p[1] for p in poly); y1 = max(p[1] for p in poly)
    for (tx, ty) in [(x0 + 6, (y0 + y1) / 2), (x1 - 6, (y0 + y1) / 2)]:
        objs.append(box("tower", 7, 8, h + 3, tx, ty, (h + 3) / 2, white))
        objs.append(box("tw", 7.2, 8.2, 0.5, tx, ty, h + 3, wall))
    recenter(objs)
    return objs, "gongke"


def asset_activity(D):
    """学生活动中心：铁锈红新月楼 + 深窗洞 + 红柱玻璃底座。照片：虎溪学生活动中心。"""
    b = D["buildings"]["activity"]
    poly, holes = b["polygon"], b["holes"]
    objs = []
    rust = mat("rust", C("#9c4a26"))
    rust_dk = mat("rust_dk", C("#7c3a1e"))
    glass = glass_mat("acglass", C("#42525e"))
    body_h = max(b["height"], 12)
    objs.append(extrude_polygon(poly, 3.8, "base", glass))
    objs.append(extrude_polygon(poly, body_h - 3.8, "body", rust))
    for o in objs:
        pass
    # 玻璃底座红柱
    n = len(poly)
    per = sum(math.hypot(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1])
              for i in range(n))
    step = max(per / 26, 6)
    acc = step / 2
    i = 0
    while acc < per and i < 300:
        a = 0.0
        for j in range(n):
            px, py = poly[j]; qx, qy = poly[(j + 1) % n]
            Lj = math.hypot(qx - px, qy - py)
            if a <= acc <= a + Lj:
                t = (acc - a) / Lj
                bx = px + (qx - px) * t
                by = py + (qy - py) * t
                rz = math.atan2(qy - py, qx - px)
                objs.append(box("rc", 0.9, 0.9, 3.8, bx, by, 1.9, rust_dk, rz))
                break
            a += Lj
        acc += step
        i += 1
    # 深窗洞（横排深色内嵌观感：深色体块微凸）
    floors = max(2, int((body_h - 3.8) / 3.6))
    for f in range(floors):
        z0 = 3.8 + f * ((body_h - 3.8) / floors)
        for i in range(n):
            px, py = poly[i]
            qx, qy = poly[(i + 1) % n]
            Lm = math.hypot(qx - px, qy - py)
            cnt = max(1, int(Lm / 4.5))
            for s in range(cnt):
                t = (s + 0.5) / cnt
                bx = px + (qx - px) * t
                by = py + (qy - py) * t
                rz = math.atan2(qy - py, qx - px)
                objs.append(box("op", Lm / cnt * 0.5, 0.24, 1.9, bx, by,
                                z0 + (body_h - 3.8) / floors * 0.5,
                                mat("opdk", C("#33231c"), 0.7), rz))
    # 白色收边冠带（顶部浅色压顶）
    objs.append(extrude_polygon(_offset(poly, 0.15), 0.7, "crown",
                                mat("crownw", C("#e8e2d6")), _offset_rings(holes, 0.15)))
    # 抬升冠带到底部
    for o in objs[-1:]:
        o.location.z += body_h
    recenter(objs)
    return objs, "activity"


def asset_gate_east(D):
    """东门：门柱广场——四座锥形石砌门柱 + 旗杆 + 广场铺装。照片：虎溪东大门/门柱广场。"""
    objs = []
    stone = mat("stone", C("#a8a49c"), 0.95)
    stone_dk = mat("stone_dk", C("#8c887f"), 0.95)
    steel = mat("steel", C("#c9cdd2"), 0.4, 0.5)
    # 广场铺装
    objs.append(box("plaza", 34, 20, 0.12, 0, 0, 0.06, mat("plaza", C("#c9c6be"), 0.95)))
    # 四门柱：三段收分 + 顶帽
    xs = [-9.0, -3.0, 3.0, 9.0]
    for i, x in enumerate(xs):
        objs.append(box("p0", 3.4, 3.4, 0.9, x, 0, 0.75, stone_dk))
        objs.append(box("p1", 2.6, 2.6, 3.2, x, 0, 2.8, stone))
        objs.append(box("p2", 2.2, 2.2, 2.4, x, 0, 5.6, stone))
        objs.append(box("p3", 2.5, 2.5, 0.6, x, 0, 7.1, stone_dk))
    # 中间两柱内侧红色竖排"重庆大学"
    for i, x in enumerate(xs[1:3], start=1):
        for k, ch in enumerate("重庆大学"):
            objs.append(text_mesh("g", ch, 0.62, mat("gred", C("#b8322c"), 0.6),
                                  x + 1.13, 0, 6.4 - k * 0.95,
                                  rx=math.pi / 2, rz=math.pi / 2, extrude=0.05))
    # 旗杆一排
    for k in range(8):
        x = -12 + k * 3.4
        objs.append(cyl("flag", 0.06, 11, x, 7.5, 5.5, steel, verts=8))
    join = objs
    recenter(join)
    return join, "gate_east"


def asset_gate_north(D):
    """北门：复刻老校门——白色穿孔板墙 + 红字校名 + 圆形徽标。照片：虎溪复刻校门广场。"""
    objs = []
    panel = mat("panel", C("#e8e5de"), 0.9)
    panel_dk = mat("panel_dk", C("#c9c5bc"), 0.9)
    # 两翼穿孔板墙（中央开口 10m）
    for side in [1, -1]:
        objs.append(box("wing", 16, 1.0, 6.5, side * 13, 0, 3.25, panel))
        # 穿孔点阵（深色小方块）
        for r in range(6):
            for c in range(14):
                objs.append(box("hole", 0.18, 0.18, 0.18,
                                side * (6.5 + c * 0.95), side * 0.52, 1.4 + r * 0.85,
                                mat("holedk", C("#8f8b82"))))
    # 中央横梁 + 校名
    objs.append(box("beam", 11, 1.2, 2.4, 0, 0, 5.2, panel))
    objs.append(text_mesh("nm", "重庆大学", 1.5, mat("nred", C("#b8322c"), 0.55),
                          0, 0.65, 5.2, rz=0))
    objs.append(text_mesh("nm2", "重庆大学", 1.5, mat("nred", C("#b8322c"), 0.55),
                          0, -0.65, 5.2, rz=math.pi))
    # 徽标圆盘
    objs.append(cyl("emb", 1.0, 0.18, 6.2, 0, 5.2, mat("embm", C("#2a4d7f"), 0.5),
                    rx=math.pi / 2, verts=24))
    # 门柱
    for side in [1, -1]:
        objs.append(box("pil", 1.4, 1.6, 7, side * 5.4, 0, 3.5, panel_dk))
    recenter(objs)
    return objs, "gate_north"


def asset_gate_west(D):
    """西门（无实拍，简约现代门：双砼柱 + 白横梁 + 校名 + 侧人行口）。待用户实拍校准。"""
    objs = []
    concrete = mat("concrete", C("#b8b4ac"), 0.95)
    white = mat("sw", C("#efece6"), 0.9)
    for side in [1, -1]:
        objs.append(box("c", 1.8, 1.8, 6.5, side * 7.0, 0, 3.25, concrete))
    objs.append(box("b", 16.5, 1.5, 2.0, 0, 0, 5.6, white))
    objs.append(text_mesh("nm", "重庆大学", 1.3, mat("sred", C("#b8322c"), 0.55),
                          0, 0.78, 5.6, rz=0))
    objs.append(text_mesh("nm2", "重庆大学", 1.3, mat("sred", C("#b8322c"), 0.55),
                          0, -0.78, 5.6, rz=math.pi))
    for side in [1, -1]:
        objs.append(box("w", 5, 0.8, 1.5, side * 11.2, 0, 0.75, concrete))
    recenter(objs)
    return objs, "gate_west"


# ---------------------------------------------------------------- render/export

def setup_render(output_png):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.render.resolution_x = 800
    sc.render.resolution_y = 500
    sc.world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.85, 0.88, 0.92, 1.0)
    bg.inputs[1].default_value = 1.0
    sun = bpy.data.lights.new("sun", type="SUN")
    sun.energy = 3.0
    sun_ob = bpy.data.objects.new("sun", sun)
    bpy.context.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = (math.radians(50), 0, math.radians(35))
    cam = bpy.data.cameras.new("cam")
    cam.lens = 32
    cam_ob = bpy.data.objects.new("cam", cam)
    bpy.context.collection.objects.link(cam_ob)
    sc.camera = cam_ob
    x0, y0, z0, x1, y1, z1 = bbox_of([o for o in sc.objects if o.type == "MESH"])
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    size = max(x1 - x0, y1 - y0, z1 - z0)
    d = size * 1.35 + 10
    cam_ob.location = (cx + d * 0.75, cy - d * 0.85, z1 * 0.75 + size * 0.35)
    direc = Vector((cx, cy, size * 0.35)) - cam_ob.location
    cam_ob.rotation_euler = direc.to_track_quat("-Z", "Y").to_euler()
    print("DEBUG bbox:", [round(v, 1) for v in (x0, y0, z0, x1, y1, z1)],
          "cam:", [round(v, 1) for v in cam_ob.location])
    sc.render.filepath = output_png
    bpy.ops.render.render(write_still=True)


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              export_apply=True, export_yup=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    asset = "all"
    if "--asset" in argv:
        asset = argv[argv.index("--asset") + 1]
    with open(SCENE_JSON, encoding="utf-8") as f:
        data = json.load(f)
    bmap = {}
    for b in data["buildings"]:
        if b.get("landmark"):
            bmap[b["landmark"]] = b
    # 工科大楼/信息大楼按名字取（它们不是 landmark 标记）
    for b in data["buildings"]:
        if b.get("name") == "工科大楼":
            bmap["gongke"] = b
        if b.get("name") == "信息技术科研楼":
            bmap["info"] = b
    D = {"buildings": bmap, "gates": {g["name"]: g for g in data["gates"]}}
    BUILDERS = {
        "library": lambda: asset_library(D),
        "info": lambda: asset_info(D),
        "gym": lambda: asset_gym(D),
        "gongke": lambda: asset_gongke(D),
        "activity": lambda: asset_activity(D),
        "gate_east": lambda: asset_gate_east(D),
        "gate_north": lambda: asset_gate_north(D),
        "gate_west": lambda: asset_gate_west(D),
    }
    os.makedirs(OUT_GLB, exist_ok=True)
    os.makedirs(OUT_RENDER, exist_ok=True)
    names = list(BUILDERS) if asset == "all" else [asset]
    for name in names:
        clear_scene()
        MATS.clear()
        objs, out_name = BUILDERS[name]()
        joined = join_objects(objs, out_name)
        print("BUILD OK", out_name, "verts:", len(joined.data.vertices))
        setup_render(os.path.join(OUT_RENDER, out_name + ".png"))
        export_glb(os.path.join(OUT_GLB, out_name + ".glb"))
        print("EXPORT OK", out_name)


main()
