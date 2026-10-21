# Usage: blender -b --factory-startup --python tools/inspect.py -- file1.glb file2.glb ...
import bpy, sys, json
files = sys.argv[sys.argv.index('--') + 1:]
out = {}
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    objs = []
    for o in bpy.data.objects:
        d = [round(x, 2) for x in o.dimensions]
        objs.append(f"{o.name}:{o.type}:parent={o.parent.name if o.parent else '-'}:loc={[round(x,2) for x in o.location]}:dim={d}")
    tris = sum(len(p.vertices) - 2 for m in bpy.data.meshes for p in m.polygons)
    out[f.split('/')[-1]] = {'objects': objs, 'tris': tris, 'actions': [a.name for a in bpy.data.actions], 'materials': [m.name for m in bpy.data.materials], 'images': [i.name for i in bpy.data.images]}
print('INSPECT' + json.dumps(out, indent=1))
