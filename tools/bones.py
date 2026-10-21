import bpy, sys
files = sys.argv[sys.argv.index('--') + 1:]
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    bones = [b.name for b in arm[0].data.bones] if arm else []
    meshes = [(o.name, [round(x,2) for x in o.dimensions]) for o in bpy.data.objects if o.type=='MESH']
    import mathutils
    # world-space height of character
    zs = [ (o.matrix_world @ mathutils.Vector(c)).z for o in bpy.data.objects if o.type=='MESH' and o.name!='Icosphere' for c in o.bound_box]
    print('BONES', f.split('/')[-1], len(bones), bones, 'height', round(max(zs)-min(zs),3), 'arm scale', [round(x,3) for x in arm[0].scale] if arm else None, meshes, [m.name for m in bpy.data.materials])
