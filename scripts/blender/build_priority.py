"""Priority landmarks: real openings, metre-scale materials, explicit OSM anchor.

blender -b --python scripts/blender/build_priority.py -- --asset all
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from landmark_geometry import local_rings, contains, in_ring, signed_area


class Model:
    def __init__(self):
        self.parts = {}

    def face(self, part, points):
        verts, faces = self.parts.setdefault(part, ([], []))
        n=len(verts)
        verts.extend(points)
        faces.append(tuple(range(n,n+len(points))))

    def box(self, part, x,y,z,w,d,h,angle=0):
        if min(w,d,h)<=0: return
        c,s=math.cos(angle),math.sin(angle)
        v=[]
        for xx,yy,zz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
            xx*=w/2; yy*=d/2
            v.append((x+c*xx-s*yy,y+s*xx+c*yy,z+zz*h/2))
        for f in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]:
            self.face(part,[v[i] for i in f])

    def surface(self, part, outer, holes, z):
        verts=[]; edges=[]
        for ring in [outer]+holes:
            off=len(verts); verts.extend(Vector(p) for p in ring)
            edges.extend((off+i,off+(i+1)%len(ring)) for i in range(len(ring)))
        out,_,faces,_,_,_=delaunay_2d_cdt(verts,edges,[],0,1e-6)
        for face in faces:
            p=[out[i] for i in face]
            center=(sum(v.x for v in p)/len(p),sum(v.y for v in p)/len(p))
            if contains(center,outer,holes):
                if signed_area([(v.x,v.y) for v in p])<0: p.reverse()
                self.face(part,[(v.x,v.y,z) for v in p])

    def ring(self, part,x,y,z,r,width,h,segments=48):
        for i in range(segments):
            a=(i+.5)*math.tau/segments
            self.box(part,x+math.cos(a)*r,y+math.sin(a)*r,z,r*math.tau/segments+.03,width,h,a+math.pi/2)


def material(name,color,rough=.8,metal=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=rough
    bs.inputs['Metallic'].default_value=metal
    return m


def palette(style,detail):
    colors={
        'wall': ((.57,.53,.43) if style=='stone' else (.76,.75,.68)),
        'trim': ((.66,.62,.52) if style=='stone' else (.87,.86,.79)),
        'glass': (.12,.24,.29), 'metal': (.22,.28,.29),
        'roof': (.61,.63,.59), 'paving': (.63,.62,.54),
        'stone': (.59,.57,.48), 'water': (.10,.30,.32),
        'plant': (.17,.29,.12), 'screen': (.72,.73,.68)
    }
    mats={k:material(k,v,.24 if k=='glass' else .85,.12 if k in ('glass','metal','screen') else 0) for k,v in colors.items()}
    if style in ('library','rust','brick'):
        mats['wall'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.42,.15,.095,1)
        mats['trim'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.59,.27,.17,1)
    if style=='gym':
        mats['wall'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.46,.19,.12,1)
        mats['roof'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.63,.67,.68,1)
        mats['roof'].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.35
    mats['water'].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.15
    if style=='frame' and detail:
        pixels=np.ones((128,128,4),dtype=np.float32)
        pixels[:,:,:3]=(.72,.73,.68)
        for y in range(2,128,8):
            for x in range(2,128,8):pixels[y:y+3,x:x+3,3]=0
        im=bpy.data.images.new('perforated_aluminium',128,128);im.pixels.foreach_set(pixels.ravel());im.pack()
        mat=mats['screen'];mat.surface_render_method='DITHERED'
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
        bs=mat.node_tree.nodes['Principled BSDF']
        mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
        mat.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    # Procedural stone is baked into a small embedded bitmap; coordinates are metres.
    if style=='stone':
        rng=np.random.default_rng(81)
        pixels=np.ones((512,512,4),dtype=np.float32)
        for row in range(32):
            shift=(row%2)*8
            for col in range(-1,33):
                x0=max(0,col*16+shift); x1=min(512,col*16+shift+15)
                y0=row*16; y1=y0+15
                if x1>x0:
                    tone=rng.uniform(-.08,.09)
                    pixels[y0:y1,x0:x1,:3]=np.array([.61,.57,.47])+tone+rng.uniform(-.025,.025,(y1-y0,x1-x0,1))
            pixels[row*16+15,:,:3]=(.43,.42,.36)
        im=bpy.data.images.new('stone_4m_tile',512,512)
        im.pixels.foreach_set(pixels.ravel()); im.pack()
        tex=mats['wall'].node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
        mats['wall'].node_tree.links.new(tex.outputs['Color'],mats['wall'].node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return mats


def edges(rings):
    for ri,ring in enumerate(rings):
        for a,b in zip(ring,ring[1:]+ring[:1]):
            length=math.dist(a,b)
            if length<.2:continue
            dx=(b[0]-a[0])/length;dy=(b[1]-a[1])/length
            yield ri,a,b,length,dx,dy,dy,-dx,math.atan2(dy,dx)


def facades(m,rings,H,levels,style,detail):
    body=H-.6 if style!='frame' else H-1.8
    base=3.3 if style=='stone' else 0
    rows=levels-1 if base else levels
    fh=(body-base)/rows
    for ri,a,b,L,dx,dy,nx,ny,angle in edges(rings):
        def box(part,t,out,z,w,d,h):
            m.box(part,a[0]+dx*t+nx*out,a[1]+dy*t+ny*out,z,w,d,h,angle)
        step=3.1 if style=='stone' else 3.8
        count=max(1,round(L/step));bay=L/count
        thickness=.65 if style=='stone' else .38
        if style=='stone' and ri==0 and abs(a[0]+71.9)<3 and 20<L<25 and abs(dy)>.9:
            # Photo-supported glazed end; its orientation remains an estimated parameter.
            box('glass',L/2,-.48,body/2,L-1.4,.10,body-1)
            for t in [.35,L-.35]:box('wall',t,-.25,body/2,.7,.65,body)
            for f in range(levels+1):box('metal',L/2,-.36,min(body-.2,f*body/levels+.2),L-.8,.12,.08)
            for j in range(max(2,round(L/1.5))):box('metal',(j+.5)*L/round(L/1.5),-.36,body/2,.075,.12,body-.5)
            box('wall',L/2,-.2,body-.25,L,.8,.5)
            continue
        if base:
            if ri:
                # Open columns with recessed glazing; no dark solid stand-in.
                box('glass',L/2,-1.1,base/2,L,.12,base-.3)
                for j in range(count+1):box('wall',j*bay,-.08,base/2,.55,.65,base)
                box('trim',L/2,-.12,base-.12,L,.85,.24)
            else:
                box('wall',L/2,-.2,.55,L,.65,1.1)
                box('glass',L/2,-.38,2.0,L,.10,1.7)
                for j in range(count+1):box('wall',j*bay,-.16,2,.48,.65,2.9)
        for f in range(rows):
            z=base+f*fh
            wb=.65 if style!='frame' else .42
            wh=fh-1.05 if style=='stone' else fh-1.0
            win=.30*bay if style=='stone' else .76*bay
            pier=(bay-win)/2
            box('wall',L/2,-thickness/2,z+wb/2,L,thickness,wb)
            top=fh-wb-wh
            box('wall',L/2,-thickness/2,z+wb+wh+top/2,L,thickness,top)
            for j in range(count):
                t=(j+.5)*bay
                for sign in (-1,1):box('wall',t+sign*(win/2+pier/2),-thickness/2,z+wb+wh/2,pier,thickness,wh)
                box('glass',t,-thickness+.06,z+wb+wh/2,win,.075,wh)
                if detail:
                    box('trim',t,.025,z+wb-.04,win+.12,.17,.09)
                    if style!='stone':
                        box('metal',t,-thickness+.10,z+wb+wh/2,.055,.085,wh)
                        box('metal',t,-thickness+.10,z+wb+wh*.48,win,.085,.055)
                if style=='frame':
                    box('trim',j*bay,.14,z+fh/2,.17,.55,fh)
                    # Screens vary by bay; distribution on unseen elevations is estimated.
                    if ri==0 and (j+2*f)%7 in (0,1):
                        box('screen',t,.33,z+wb+wh/2,win*.70,.12,wh)
                        if detail:
                            for k in range(6):box('metal',t-win*.30+k*win*.12,.405,z+wb+wh/2,.022,.025,wh*.9)
            if style=='frame':box('trim',L/2,.12,z+.09,L,.65,.18)
        box('trim',L/2,-.08,body+.22,L,.50,.44)
        if style=='frame':
            box('trim',L/2,.02,H-.12,L,.32,.24)
            for j in range(count+1):box('trim',j*bay,.02,H-.9,.18,.32,1.8)
    m.surface('roof',rings[0],rings[1:],body+.04)


def interior_point(ring):
    xs=[p[0] for p in ring];ys=[p[1] for p in ring]
    best=None
    for i in range(1,20):
        for j in range(1,20):
            x=min(xs)+(max(xs)-min(xs))*i/20;y=min(ys)+(max(ys)-min(ys))*j/20
            if not in_ring((x,y),ring):continue
            distance=min(point_segment(x,y,a,b) for a,b in zip(ring,ring[1:]+ring[:1]))
            if best is None or distance>best[2]:best=(x,y,distance)
    return best


def point_segment(x,y,a,b):
    dx=b[0]-a[0];dy=b[1]-a[1]
    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)


def courtyard(m,ring,style,detail,index):
    m.surface('paving',ring,[],.10)
    p=interior_point(ring)
    if not p:return
    x,y,r=p
    if r<2.5:return
    # Ground remains at z=0; raised terraces create the visible sunken datum.
    if style=='stone' and index==0:
        radius=min(4.2,r*.68)
        n=48 if detail else 24
        m.surface('water',[(x+math.cos(i*math.tau/n)*radius,y+math.sin(i*math.tau/n)*radius) for i in range(n)],[],.18)
        m.ring('stone',x,y,.43,radius+.2,.35,.60,n)
        m.box('paving',x,y,.52,2*radius+.6,.8,.18)
    elif style=='frame':
        w=min(14,r*1.5);d=min(9,r)
        for i in range(9):
            m.box('stone',x,y+(i-4)*.38,.1+(9-i)*.15,w,.40,(9-i)*.30)
        m.box('plant',x,y+2.5,1.3,w*.55,.8,.6)
        if detail:
            for s in (-1,1):m.box('metal',x+s*w/2,y,2.0,.06,3.8,.06)
    else:
        m.box('plant',x,y,.3,min(6,r),min(4,r),.4)
        if detail:
            for s in (-1,1):m.box('stone',x+s*min(4,r*.75),y,.38,.55,min(5,r),.55)


def library_model(m,rings,H,detail):
    facades(m,rings,10,3,'library',detail)
    # Slender landmark wall above the mapped podium; fin depth is real geometry.
    L=74;D=15;bottom=10;body=H-bottom-.7
    m.box('wall',0,9,bottom+body/2,L,D,body)
    for y in (9-D/2-.15,9+D/2+.15):
        for i in range(56 if detail else 28):
            count=56 if detail else 28
            m.box('trim',-L/2+(i+.5)*L/count,y,bottom+body/2,.16,.65,body)
    m.box('trim',0,9,H-.35,L+.3,D+.3,.7)
    # Ground forecourt and distinct recessed glass entrance.
    m.box('paving',0,-44,.12,36,5,.2)
    m.box('glass',0,-42.1,3.2,23,.12,5.5)
    for i in range(8):m.box('trim',-11.5+i*3.3,-42.2,3.2,.16,.25,5.5)


def gym_model(m,rings,H,detail):
    facades(m,rings,10.8,3,'gym',detail)
    outer=rings[0];xs=[p[0] for p in outer];ys=[p[1] for p in outer]
    w=max(xs)-min(xs);d=max(ys)-min(ys)
    low=[(-w*.39,-d*.38),(w*.39,-d*.38),(w*.39,d*.38),(-w*.39,d*.38)]
    top=[(-w*.49,-d*.48),(w*.49,-d*.48),(w*.49,d*.48),(-w*.49,d*.48)]
    for i in range(4):
        j=(i+1)%4
        m.face('roof',[(low[i][0],low[i][1],11.6),(low[j][0],low[j][1],11.6),(top[j][0],top[j][1],H-.6),(top[i][0],top[i][1],H-.6)])
    m.face('roof',[(x,y,H-.6) for x,y in top])
    m.box('roof',0,0,H-.3,w*.65,d*.65,.6)
    if detail:
        for i in range(42):
            x=-w*.48+i*w*.96/41
            for sign in (-1,1):m.box('trim',x,sign*d*.475,H-6,.10,.18,10.4)
    for i in range(12):m.box('paving',0,-d/2-2.5+i*.35,.1+(i+1)*.13,17,.38,(i+1)*.26)


def export_asset(asset, config, building, detail):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    _,rings=local_rings(building['polygon'],building['holes'])
    model=Model();H=config['height'];style=config['style']
    if asset=='library':library_model(model,rings,H,detail)
    elif asset=='gym':gym_model(model,rings,H,detail)
    else:facades(model,rings,H,config['levels'],style,detail)
    # Largest court first; all other OSM courts remain genuinely open.
    holes=sorted(rings[1:],key=lambda r:abs(signed_area(r)),reverse=True)
    for i,hole in enumerate(holes):courtyard(model,hole,style,detail,i)
    if asset=='info':
        # North courtyard bridge, at the 35m OSM opening. Elevation estimated.
        cx,cy=(669.27-(587.01+752.61)/2,452.6-(385.35+471.05)/2)
        for z in [H-9.0,H-5.9,H-2.8]:
            model.box('glass',cx,cy,z,35.8,6.0,2.8)
            for j in range(10):model.box('trim',cx-18+j*4,cy,z,.20,6.4,3.0)
            model.box('trim',cx,cy,z-1.45,36.4,6.6,.22)
        model.box('trim',cx,cy,H-1.25,36.4,6.6,.3)
    mats=palette(style,detail)
    root=bpy.data.objects.new(asset,None);bpy.context.collection.objects.link(root)
    root['buildingId']=str(config['id']);root['heightEstimated']=not config['heightConfidence'].startswith('Official')
    root['sourceUrl']=config['reference']
    if holes:
        point=interior_point(holes[0])
        if point:root['courtX']=point[0];root['courtNorth']=point[1]
    for name,(verts,faces) in model.parts.items():
        if not faces:continue
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.parent=root
        obj.data.materials.append(mats.get(name,mats['trim']))
        uv=mesh.uv_layers.new(name='metres')
        for poly in mesh.polygons:
            ax=max(range(3),key=lambda i:abs(poly.normal[i]))
            for li in poly.loop_indices:
                p=mesh.vertices[mesh.loops[li].vertex_index].co
                uv.data[li].uv=((p.x if ax!=0 else p.y)/4,(p.z if ax!=2 else p.y)/4)
    if asset=='library':
        text=bpy.data.curves.new('重庆大学','FONT');text.body='重庆大学';text.size=2.5;text.align_x='CENTER';text.extrude=.035
        try:text.font=bpy.data.fonts.load('C:/Windows/Fonts/msyh.ttc')
        except RuntimeError:pass
        obj=bpy.data.objects.new('重庆大学',text);bpy.context.collection.objects.link(obj);obj.parent=root
        obj.location=(0,1.30,H-3.2);obj.rotation_euler=(math.pi/2,0,0);text.materials.append(material('校名',(.55,.025,.02)))
    out=ROOT/'public'/'models';out.mkdir(parents=True,exist_ok=True)
    path=out/(asset+('' if detail else '.far')+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_extras=True,export_cameras=False,export_lights=False,
        export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
        export_draco_position_quantization=16,export_draco_normal_quantization=10,export_draco_texcoord_quantization=12)
    # Validate the actual Blender geometry before handing it to the web exporter.
    roof_v,roof_f=model.parts['roof']
    for face in roof_f if asset not in ('library','gym') else []:
        p=[roof_v[i] for i in face]
        assert contains((sum(v[0] for v in p)/len(p),sum(v[1] for v in p)/len(p)),rings[0],rings[1:]),'courtyard roof covered'
    all_v=[v for vertices,_ in model.parts.values() for v in vertices]
    for vertices,faces in model.parts.values():
        for f in faces:
            a,b,c=(Vector(vertices[i]) for i in f[:3])
            assert (b-a).cross(c-a).length>1e-8,'degenerate face'
    report={
        'asset':asset,'buildingId':config['id'],'detail':'near' if detail else 'far',
        'courtyards':len(rings)-1,'roofCourtyardsOpen':True,
        'bounds':[[min(v[k] for v in all_v) for k in range(3)],[max(v[k] for v in all_v) for k in range(3)]],
        'triangles':sum(sum(len(f)-2 for f in faces) for _,faces in model.parts.values()),
        'bytes':path.stat().st_size,'materials':len(model.parts),'heightConfidence':config['heightConfidence']
    }
    (out/(asset+('' if detail else '.far')+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    render=ROOT/'work'/'render';render.mkdir(parents=True,exist_ok=True)
    if detail:
        bpy.ops.wm.save_as_mainfile(filepath=str(render/(asset+'.blend')))
        # EEVEE preview is for shape QA; browser GLB remains the final authority.
        scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12
        scene.render.resolution_x=1100;scene.render.resolution_y=760;scene.render.resolution_percentage=100
        scene.world.color=(.35,.35,.35)
        light=bpy.data.lights.new('sun','SUN');light.energy=3
        ob=bpy.data.objects.new('sun',light);bpy.context.collection.objects.link(ob);ob.rotation_euler=(.5,-.35,-.5)
        camera=bpy.data.cameras.new('camera');ob=bpy.data.objects.new('camera',camera);bpy.context.collection.objects.link(ob)
        xs=[p[0] for p in rings[0]];ys=[p[1] for p in rings[0]]
        size=max(max(xs)-min(xs),max(ys)-min(ys))
        ob.location=(size*.65,-size*.80,size*.80)
        ob.rotation_euler=(Vector((0,0,H*.25))-ob.location).to_track_quat('-Z','Y').to_euler();camera.type='ORTHO';camera.ortho_scale=size*1.32
        scene.camera=ob;scene.render.filepath=str(render/(asset+'.png'))
        bpy.ops.render.render(write_still=True)
        if holes:
            x,y,r=interior_point(holes[0])
            ob.location=(x+3,y-4,H*2.5)
            ob.rotation_euler=(Vector((x,y,3))-ob.location).to_track_quat('-Z','Y').to_euler()
            camera.ortho_scale=max(25,r*5)
            scene.render.filepath=str(render/(asset+'-courtyard.png'));bpy.ops.render.render(write_still=True)
    print('PRIORITY_EXPORT',asset,'near' if detail else 'far',path.stat().st_size)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--asset',default='all');parser.add_argument('--far-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    configs=json.loads((ROOT/'data'/'landmark_details.json').read_text(encoding='utf8'))
    buildings=json.loads((ROOT/'public'/'data'/'scene.json').read_text(encoding='utf8'))['buildings']
    for asset in ([key for key in configs if not key.startswith('_')] if args.asset=='all' else [args.asset]):
        cfg=configs[asset];b=next(b for b in buildings if str(b['id'])==str(cfg['id']))
        export_asset(asset,cfg,b,False)
        if not args.far_only:export_asset(asset,cfg,b,True)


if __name__=='__main__':main()
