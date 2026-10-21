# Renders a quick preview of a built person: blender -b --python tools/preview_person.py -- in.glb out.png [hide-helmet]
import bpy, sys, math
args = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args[0])
hide_helmet = len(args) > 2
for o in bpy.data.objects:
    if o.type == 'MESH':
        if o.name.startswith('Hair_') and o.name not in ('Hair_SimpleParted', 'Hair_Beard'):
            o.hide_render = True
        if hide_helmet and o.name in ('Helmet', 'Visor'):
            o.hide_render = True
        if not hide_helmet and o.name.startswith('Hair_'):
            o.hide_render = True
for m in bpy.data.materials:
    if m.name.startswith('Suit') and m.node_tree and 'Principled BSDF' in m.node_tree.nodes and m.name == 'Suit':
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.25, 0.05, 1)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 600, 800
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.location = (1.1, -3.2, 1.4)
cam.rotation_euler = (math.radians(84), 0, math.radians(19))
scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 4
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.4, 0.5, 1)
scene.render.filepath = args[1]
bpy.ops.render.render(write_still=True)
