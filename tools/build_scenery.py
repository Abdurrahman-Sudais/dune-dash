# Turns the downloaded Sketchfab scenery (CC-BY, see credits in index.html) into game props.
#
#   blender -b --factory-startup --python tools/build_scenery.py            # build
#   blender -b --factory-startup --python tools/build_scenery.py -- inspect # list parts only
#
# Each source file becomes one or more props: packs are split into their separate pieces.
# Every prop is flattened, centred on its footprint, stood on y=0 and scaled to a real-world
# size. Props are grouped per map theme into public/models/scenery-<theme>.glb with textures
# shrunk and de-duplicated; public/models/scenery.json records each prop's size.

import bpy
import hashlib
import json
import os
import sys
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets-src', 'scenery')
OUT = os.path.join(ROOT, 'public', 'models')
MAX_TEX = 512
INSPECT = 'inspect' in sys.argv

# key: (theme, target height in metres for the tallest piece, split pack into pieces?)
SOURCES = {
    'coconut_palm': ('beach', 10, False),
    'palm_trees': ('beach', 9, True),
    'beach_umbrella': ('beach', 2.6, False),
    'beach_hut': ('beach', 4.2, False),
    'beachhouse': ('beach', 7, False),
    'pier': ('beach', 3, False),
    'fishing_boat': ('beach', 4.5, False),
    'sailboat': ('beach', 11, False),
    'lighthouse': ('beach', 24, False),
    'desert_rocks': ('canyon', 7, True),
    'desert_rocks2': ('canyon', 9, True),
    'cactus': ('canyon', 4.5, True),
    'concrete_fences': ('common', 2.4, True),
    'suburban_house': ('town', 8.5, False),
    'suburbian_house': ('town', 8, False),
    'nyc_dwellings': ('town', 12, True),
    'nyc_homes': ('town', 12, True),
    'forest_trees': ('town', 11, True),
    'vegetation': ('common', 3, True),
    'oak': ('town', 12, False),
    'street_lamp': ('common', 6, False),
    'stadium_seats': ('common', 6, False),
    'starting_line': ('common', 9, False),
    'road_billboard': ('common', 7, False),
}

# Triangle budget per prop (Blender collapse-decimate above this), so repeated props stay cheap.
BUDGET = {
    'beach_umbrella': 700, 'vegetation': 1500, 'street_lamp': 900, 'pier': 2500, 'coconut_palm': 3000,
    'beachhouse': 5000, 'lighthouse': 8000, 'fishing_boat': 3500, 'desert_rocks': 2200, 'oak': 3500,
    'suburban_house': 2800, 'nyc_homes': 3500, 'suburbian_house': 2400, 'forest_trees': 1800, 'beach_hut': 2500, 'starting_line': 3000,
}

manifest = {}


def decimate_to(objs, budget):
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    if tris <= budget:
        return tris
    ratio = max(0.05, budget / tris)
    for o in objs:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier='Decimate')
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def bbox(objs):
    pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def import_flat(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return meshes


def pieces(meshes, split):
    """Group meshes into props. Packs: cluster objects whose footprints overlap."""
    if not split:
        return [meshes]
    if len(meshes) == 1:
        # A single mesh holding many pieces: separate loose parts, then cluster.
        bpy.ops.object.select_all(action='DESELECT')
        meshes[0].select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.mesh.separate(type='LOOSE')
        meshes = [o for o in bpy.context.selected_objects]
    boxes = {o: bbox([o]) for o in meshes}
    groups = []
    for o in sorted(meshes, key=lambda m: -(boxes[m][1] - boxes[m][0]).length):
        lo, hi = boxes[o]
        for g in groups:
            glo, ghi = g['box']
            pad = 0.02 * max((ghi - glo).length, 1e-3)
            if lo.x < ghi.x + pad and hi.x > glo.x - pad and lo.y < ghi.y + pad and hi.y > glo.y - pad:
                g['objs'].append(o)
                g['box'] = (mathutils.Vector(map(min, glo, lo)), mathutils.Vector(map(max, ghi, hi)))
                break
        else:
            groups.append({'objs': [o], 'box': (lo, hi)})
    # Drop crumbs (tiny bits that are just leftovers of the separation).
    big = max((g['box'][1] - g['box'][0]).length for g in groups)
    return [g['objs'] for g in groups if (g['box'][1] - g['box'][0]).length > big * 0.08]


def solid_material(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def make_track_furniture():
    """Modelled here: real-size concrete Jersey barriers (3 m long, 0.81 m tall) and tyre stacks."""
    import bmesh
    roots = []
    profile = [(-0.3, 0), (0.3, 0), (0.3, 0.08), (0.12, 0.33), (0.08, 0.81), (-0.08, 0.81), (-0.12, 0.33), (-0.3, 0.08)]
    for name, color in (('barrier_concrete', (0.62, 0.62, 0.6)), ('barrier_red', (0.72, 0.1, 0.08)), ('barrier_white', (0.86, 0.86, 0.83))):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        front = [bm.verts.new((x, -1.5, z)) for x, z in profile]
        back = [bm.verts.new((x, 1.5, z)) for x, z in profile]
        bm.faces.new(front[::-1])
        bm.faces.new(back)
        n = len(profile)
        for i in range(n):
            bm.faces.new([front[i], front[(i + 1) % n], back[(i + 1) % n], back[i]])
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges], offset=0.015, segments=1)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(solid_material(name, color, 0.85))
        obj = bpy.data.objects.new(name + '_0', me)
        bpy.context.scene.collection.objects.link(obj)
        root = bpy.data.objects.new('prop_' + name, None)
        bpy.context.scene.collection.objects.link(root)
        obj.parent = root
        manifest[name] = {'size': [0.6, 0.81, 3.0], 'theme': 'common', 'source': 'modelled'}
        roots.append(root)

    rubber = solid_material('tyre_rubber', (0.04, 0.04, 0.045), 0.9)
    root = bpy.data.objects.new('prop_tyre_stack', None)
    bpy.context.scene.collection.objects.link(root)
    for k in range(4):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.3, minor_radius=0.13, major_segments=14, minor_segments=6, location=(0, 0, 0.13 + k * 0.25))
        t = bpy.context.active_object
        t.name = f'tyre_stack_{k}'
        t.data.materials.append(rubber)
        bpy.ops.object.shade_smooth()
        t.parent = root
    manifest['tyre_stack'] = {'size': [0.86, 1.0, 0.86], 'theme': 'common', 'source': 'modelled'}
    roots.append(root)
    return roots


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    themes = {}
    for key, (theme, height, split) in SOURCES.items():
        path = os.path.join(SRC, key + '.glb')
        if not os.path.exists(path):
            print('MISSING', key)
            continue
        meshes = import_flat(path)
        groups = pieces(meshes, split)
        tallest = max(bbox(g)[1].z - bbox(g)[0].z for g in groups) or 1
        scale = height / tallest
        for n, objs in enumerate(groups):
            lo, hi = bbox(objs)
            centre = mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
            name = key if len(groups) == 1 else f'{key}_{n}'
            if INSPECT:
                print('PART', name, [round(v, 2) for v in ((hi - lo) * scale)], len(objs))
            m = mathutils.Matrix.Scale(scale, 4) @ mathutils.Matrix.Translation(-centre)
            for o in objs:
                o.data.transform(m)
                o.matrix_world = mathutils.Matrix.Identity(4)
            tris = decimate_to(objs, BUDGET[key]) if key in BUDGET and not INSPECT else None
            root = bpy.data.objects.new('prop_' + name, None)
            bpy.context.scene.collection.objects.link(root)
            for i, o in enumerate(objs):
                o.parent = root
                o.name = f'{name}_{i}'
            size = (hi - lo) * scale
            manifest[name] = {'size': [round(size.x, 2), round(size.z, 2), round(size.y, 2)], 'theme': theme, 'source': key, 'tris': tris}
            themes.setdefault(theme, []).append(root)
    if INSPECT:
        return
    themes.setdefault('common', []).extend(make_track_furniture())

    # Shrink + de-duplicate textures.
    seen = {}
    for img in list(bpy.data.images):
        if img.size[0] > MAX_TEX:
            img.scale(MAX_TEX, max(1, MAX_TEX * img.size[1] // img.size[0]))
        key = (hashlib.md5(str(tuple(round(p, 2) for p in img.pixels[::97])).encode()).hexdigest(), img.size[0], img.size[1])
        if key in seen:
            img.user_remap(seen[key])
            bpy.data.images.remove(img)
        else:
            seen[key] = img

    for theme, roots in themes.items():
        bpy.ops.object.select_all(action='DESELECT')
        for r in roots:
            r.select_set(True)
            for c in r.children_recursive:
                c.select_set(True)
        path = os.path.join(OUT, f'scenery-{theme}.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  export_image_format='JPEG', export_jpeg_quality=82, export_extras=False)
        print('EXPORTED', theme, os.path.getsize(path))
    with open(os.path.join(OUT, 'scenery.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


build()
print('SCENERY', json.dumps({k: v['size'] for k, v in manifest.items()}))
