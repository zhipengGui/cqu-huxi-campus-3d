"""Three distinct gates, anchored at their OSM gate points, using existing Blender."""
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_priority import Model, material

ROOT=Path(__file__).resolve().parents[2]


def sign(root,text,x,y,z,size):
    curve=bpy.data.curves.new('校名','FONT');curve.body=text;curve.size=size;curve.align_x='CENTER';curve.extrude=.025
    try:curve.font=bpy.data.fonts.load('C:/Windows/Fonts/msyh.ttc')
    except RuntimeError:pass
    obj=bpy.data.objects.new('校名',curve);bpy.context.collection.objects.link(obj);obj.parent=root
    obj.location=(x,y,z);obj.rotation_euler=(math.pi/2,0,0)
    obj.data.materials.append(material('校名红',(.48,.025,.025),.7))


def main():
    for asset in ['gate_north','gate_east','gate_west']:
        bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
        m=Model()
        m.box('paving',0,0,.08,50,24,.14)
        if asset=='gate_east':
            for x in [-9,-3,3,9]:
                for z,w,h in [(.5,3.4,1),(2.6,2.7,3.2),(5.2,2.15,2),(6.5,2.5,.6)]:m.box('stone',x,0,z,w,w,h)
            for i in range(8):m.box('metal',-12+i*3.4,7,5.5,.08,.08,11)
        else:
            for x in [-5.7,5.7]:m.box('stone',x,0,3.2,1.3,1.3,6.4)
            m.box('white',0,0,5.4,12.7,1.2,2.2)
            if asset=='gate_north':
                # Real openings between lattice strips; no painted black dots.
                for side in [-1,1]:
                    center=side*14
                    for i in range(15):m.box('white',center-7+i,0,3.2,.32,.65,6.4)
                    for j in range(8):m.box('white',center,0,.4+j*.8,14.3,.65,.30)
            else:
                for side in [-1,1]:m.box('stone',side*10,0,.8,7,.7,1.6)
        root=bpy.data.objects.new(asset,None);bpy.context.collection.objects.link(root)
        root['sourceUrl']='https://www.cqu.edu.cn/zjzd/gyzd/jz_db.htm'
        root['estimated']=True
        mats={'white':material('白色门体',(.86,.86,.81)), 'stone':material('灰色门柱',(.56,.56,.49)),
              'paving':material('入口铺地',(.64,.64,.58)), 'metal':material('旗杆',(.66,.69,.70),.3,.6)}
        for name,(verts,faces) in m.parts.items():
            me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
            obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj);obj.parent=root;me.materials.append(mats[name])
        if asset=='gate_east':
            for x in [-3,3]:
                for j,char in enumerate('重庆大学'):sign(root,char,x,-1.39,5.5-j*.8,.65)
        else:sign(root,'重庆大学',0,-.66,5.0,1.30)
        out=ROOT/'public/models'/(asset+'.glb')
        bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_extras=True,export_cameras=False,export_lights=False,
                                 export_draco_mesh_compression_enable=True,export_draco_position_quantization=16)
        dest=ROOT/'work/render';dest.mkdir(parents=True,exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(dest/(asset+'.blend')))
        print('GATE_EXPORT',asset,out.stat().st_size)


if __name__=='__main__':main()
