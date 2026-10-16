"""Check exported GLB identity, source alignment, paired LODs and payload budget."""
import argparse
import json
import pathlib
import struct

ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--assets',nargs='+',default=['zonghe','teaching1','info'])
args=parser.parse_args()
total=0
for asset in args.assets:
    reports=[]
    for suffix in ['', '.far']:
        path=ROOT/'public'/'models'/(asset+suffix+'.glb')
        reportpath=path.with_suffix('.json')
        assert reportpath.exists(),f'{asset}: validated export report missing'
        report=json.loads(reportpath.read_text(encoding='utf8'));reports.append(report)
        data=path.read_bytes();total+=len(data)
        assert data[:4]==b'glTF' and struct.unpack_from('<I',data,8)[0]==len(data)
        n=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+n])
        assert any(node.get('extras',{}).get('buildingId')==str(report['buildingId']) for node in gltf['nodes'])
        assert 'KHR_draco_mesh_compression' in gltf.get('extensionsRequired',[])
        triangles=sum(gltf['accessors'][p['indices']]['count']//3 for mesh in gltf['meshes'] for p in mesh['primitives'])
        assert triangles==report['triangles'],f'{asset}: exported geometry differs from report ({triangles})'
        assert len(gltf.get('materials',[]))==report['materials']
        if not suffix:
            required={'zonghe':['court_terrace','court_steps','window_reveals'],
                      'teaching1':['entry_canopy','entry_steps'],
                      'info':['court_terrace','court_steps','bridge_frames']}.get(asset,[])
            names={node['name'] for node in gltf['nodes'] if 'mesh' in node}
            assert all(name in names for name in required),f'{asset}: missing modeled architectural parts {required}'
        assert report['roofCourtyardsOpen']
        if asset in ('zonghe','teaching1','info','likelou','gongke'):assert report['courtyards']>0
        assert report['bounds'][0][2]>=0, 'below global map ground'
        assert report['materials']<=10
        assert len(data)==report['bytes']
        print(asset+suffix,report['triangles'],'triangles',len(data),'bytes',report['courtyards'],'open courts')
    for p,q in zip(reports[0]['bounds'],reports[1]['bounds']):
        assert all(abs(a-b)<.25 for a,b in zip(p,q)),f'{asset}: LOD shifts footprint'
if set(args.assets)<=set(['zonghe','teaching1','info']):assert total<=8_000_000,f'priority models exceed 8MB: {total}'
print('PASS',len(args.assets),'landmarks,',total,'bytes')
