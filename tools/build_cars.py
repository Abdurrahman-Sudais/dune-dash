# Converts the Sketchfab cars (CC-BY, Daniel Zhabotinsky) into game-ready models.
#
#   blender -b --factory-startup --python tools/build_cars.py
#
# Per car: flatten the FBX-style hierarchy, face +Z (three.js forward), sit the tyres on y=0,
# merge each corner's wheel/tyre/rim into one spinnable object centred on its axle, merge the rest
# of the body by material (few draw calls), tag the paint material "Paint", and record wheel
# positions, size and steering-wheel position (where the driver sits) in the manifest.
# Output: public/models/cars/<id>.glb + public/models/cars/manifest.json

import bpy
import json
import math
import os
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets-src', 'sketchfab')
OUT = os.path.join(ROOT, 'public', 'models', 'cars')
CARS = ['saba', 'exterminator', 'kiri', 'tiara', 'phoenix', 'duke', 'sanremo', 'asti', 'lightbody', 'cop']
WHEEL_WORDS = ('wheel', 'tire', 'tyre', 'rim')

manifest = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build(car):
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, car + '.glb'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']

    # Flatten: bake world transforms into mesh data, drop all empties.
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Work out the long axis and which end is the front (headlights).
    def bbox(objs):
        pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
        lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return lo, hi

    lo, hi = bbox(meshes)
    size = hi - lo
    long_x = size.x > size.y
    heads = [o for o in meshes if 'headlight' in o.name.lower()] or [o for o in meshes if 'bumper_front' in o.name.lower()]
    hlo, hhi = bbox(heads) if heads else (hi, hi)
    hc = (hlo + hhi) / 2
    center = (lo + hi) / 2
    # Rotate so the front points to Blender -Y (→ three.js +Z).
    if long_x:
        angle = -math.pi / 2 if hc.x > center.x else math.pi / 2
    else:
        angle = 0 if hc.y < center.y else math.pi
    rot = mathutils.Matrix.Rotation(angle, 4, 'Z')
    for o in meshes:
        o.data.transform(rot @ mathutils.Matrix.Translation(-mathutils.Vector((center.x, center.y, 0))))

    for o in meshes:
        o.data.update()
    bpy.context.view_layer.update()
    lo, hi = bbox(meshes)
    half_w = (hi.x - lo.x) / 2

    # Wheels: wheel/tyre/rim parts sitting low and out at a corner (skips steering & spare wheels).
    wheels = {'fl': [], 'fr': [], 'bl': [], 'br': []}
    body = []
    for o in meshes:
        n = o.name.lower()
        c = sum((o.matrix_world @ mathutils.Vector(v) for v in o.bound_box), mathutils.Vector()) / 8
        is_wheel = any(w in n for w in WHEEL_WORDS) and 'steering' not in n and 'spare' not in n
        if is_wheel and abs(c.x) > half_w * 0.45 and c.z - lo.z < 0.75:
            wheels[('f' if c.y < 0 else 'b') + ('l' if c.x > 0 else 'r')].append(o)
        else:
            body.append(o)

    lo, hi = bbox(meshes)
    wheel_lo, _ = bbox([o for v in wheels.values() for o in v] or meshes)
    ground = wheel_lo.z
    for o in meshes:
        o.data.transform(mathutils.Matrix.Translation((0, 0, -ground)))

    info = {'wheels': {}, 'credit': 'Daniel Zhabotinsky (CC-BY 4.0, Sketchfab)'}
    bpy.ops.object.select_all(action='DESELECT')
    for tag, parts in wheels.items():
        if not parts:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1:
            bpy.ops.object.join()
        w = bpy.context.view_layer.objects.active
        w.name = f'{car}_wheel_{tag}'
        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
        loc = w.location
        info['wheels'][tag] = [round(loc.x, 3), round(loc.z, 3), round(-loc.y, 3)]
        info['wheelRadius'] = round(w.dimensions.z / 2, 3)

    # Steering wheel → driver seat reference.
    steer = [o for o in body if 'steering' in o.name.lower()]
    if steer:
        s_lo, s_hi = bbox(steer)
        sc = (s_lo + s_hi) / 2
        info['steering'] = [round(sc.x, 3), round(sc.z, 3), round(-sc.y, 3)]

    # Paint material.
    for m in bpy.data.materials:
        if 'bodymat' in m.name.lower() or m.name.lower().endswith('_body') or 'paint' in m.name.lower():
            m.name = 'Paint'

    # Merge body meshes by material.
    by_mat = {}
    for o in body:
        key = o.data.materials[0].name if o.data.materials else 'none'
        by_mat.setdefault(key, []).append(o)
    for i, (mat, objs) in enumerate(by_mat.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        bpy.context.view_layer.objects.active.name = f'{car}_body_{i}'

    root = bpy.data.objects.new('car_' + car, None)
    bpy.context.scene.collection.objects.link(root)
    for o in bpy.data.objects:
        if o.type == 'MESH':
            mw = o.matrix_world.copy()
            o.parent = root
            o.matrix_world = mw

    lo, hi = bbox([o for o in bpy.data.objects if o.type == 'MESH'])
    size = hi - lo
    info['size'] = [round(size.x, 3), round(size.z, 3), round(size.y, 3)]
    info['tris'] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    info['materials'] = sorted(m.name for m in bpy.data.materials if m.users)
    manifest[car] = info

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, car + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_image_format='JPEG', export_jpeg_quality=85, export_extras=False)
    print('EXPORTED', car, os.path.getsize(path), info['tris'])


for car in CARS:
    if os.path.exists(os.path.join(SRC, car + '.glb')):
        try:
            build(car)
        except Exception as e:  # keep going so one odd model doesn't block the rest
            print('FAILED', car, repr(e))
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('CARS', json.dumps({k: {kk: v[kk] for kk in ('size', 'wheels', 'steering', 'materials') if kk in v} for k, v in manifest.items()}))
