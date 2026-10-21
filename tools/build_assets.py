# Builds the game's optimized models from the Kenney CC0 packs in assets-src/.
#
#   blender -b --factory-startup --python tools/build_assets.py
#
# Output (public/models/):
#   cars.glb            every car, wheel style, spoiler and crash-debris piece, one shared texture
#   chars/<id>.glb      each driver mesh + skeleton, no animations
#   anims.glb           the hand-made animation clips (shared rig, retargeted at runtime)
#   props-<theme>.glb   scenery for each map theme
#   manifest.json       sizes, wheel positions etc. measured in game units (metres, Y up)

import bpy
import json
import os
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets-src')
OUT = os.path.join(ROOT, 'public', 'models')
CAR_DIR = os.path.join(SRC, 'car-kit', 'Models', 'GLB format')
CHAR_DIR = os.path.join(SRC, 'mini-characters', 'Models', 'GLB format')
KITS = {
    'pirate': os.path.join(SRC, 'pirate-kit', 'Models', 'GLB format'),
    'racing': os.path.join(SRC, 'racing-kit', 'Models', 'GLTF format'),
    'nature': os.path.join(SRC, 'nature-kit', 'Models', 'GLTF format'),
    'suburban': os.path.join(SRC, 'suburban-kit', 'Models', 'GLB format'),
}
# Blender units → metres for each kit.
KIT_SCALE = {'pirate': 3.0, 'racing': 4.0, 'nature': 6.0, 'suburban': 5.0}
CAR_SCALE = 1.8
CHAR_SCALE = 1.9

CARS = ['race', 'race-future', 'sedan-sports', 'hatchback-sports', 'sedan', 'suv-luxury',
        'suv', 'police', 'taxi', 'van', 'truck', 'firetruck']
WHEELS = ['wheel-default', 'wheel-racing', 'wheel-dark', 'wheel-truck']
PARTS = ['debris-spoiler-a', 'debris-spoiler-b']
DEBRIS = ['debris-tire', 'debris-door', 'debris-bumper', 'debris-plate-a', 'debris-plate-small-a', 'debris-bolt']
CHARACTERS = [f'character-{g}-{v}' for g in ('male', 'female') for v in 'abcdef']
ACCESSORIES = ['aid-sunglasses', 'aid-glasses', 'aid-mask']
ANIMS = ['drive', 'idle', 'emote-yes', 'emote-no', 'jump', 'die', 'fall', 'sprint', 'walk',
         'sit', 'interact-right', 'attack-melee-right', 'holding-right']

PROPS = {
    'beach': [
        ('pirate', ['palm-bend', 'palm-straight', 'palm-detailed-bend', 'palm-detailed-straight', 'barrel', 'crate',
                    'crate-bottles', 'chest', 'boat-row-large', 'boat-row-small', 'ship-pirate-large', 'ship-pirate-medium',
                    'ship-wreck', 'ship-large', 'ship-small', 'structure-platform-dock', 'structure-platform-dock-small',
                    'structure', 'structure-roof', 'structure-fence', 'tower-complete-large', 'tower-watch',
                    'flag-pirate-high', 'flag-high', 'cannon', 'rocks-sand-a', 'rocks-sand-b', 'rocks-sand-c',
                    'rocks-a', 'rocks-b', 'patch-sand-foliage', 'grass-plant', 'mast-ropes']),
        ('nature', ['grass_large', 'grass_leafsLarge', 'grass_leafs', 'plant_bushLarge', 'plant_bush', 'plant_flatTall',
                    'flower_yellowA', 'flower_redA', 'flower_purpleB', 'tree_palmTall', 'tree_palmDetailedTall',
                    'tree_palmBend', 'tree_palmDetailedShort', 'rock_smallA', 'rock_smallFlatB', 'log', 'stump_round',
                    'lily_large', 'mushroom_tanGroup']),
    ],
    'canyon': [
        ('nature', ['cliff_large_rock', 'cliff_block_rock', 'cliff_blockSlope_rock', 'cliff_rock', 'cliff_top_rock',
                    'cliff_large_stone', 'cliff_blockHalf_rock', 'rock_largeA', 'rock_largeB', 'rock_largeC',
                    'rock_largeD', 'rock_largeE', 'rock_tallA', 'rock_tallB', 'rock_tallC', 'rock_tallE', 'rock_tallG',
                    'rock_tallI', 'cactus_short', 'cactus_tall', 'tent_detailedOpen', 'tent_smallClosed',
                    'campfire_logs', 'log_stack', 'log_large', 'statue_obelisk', 'statue_column', 'statue_columnDamaged',
                    'statue_head', 'statue_ring', 'statue_block', 'tree_palmTall', 'tree_palmDetailedTall',
                    'plant_bushLarge', 'stump_old', 'sign', 'fence_planks', 'bridge_wood', 'pot_large', 'canoe',
                    'grass_leafs', 'grass', 'plant_flatShort', 'plant_bushTriangle', 'rock_smallB', 'rock_smallC',
                    'rock_smallFlatA', 'rock_smallTopA', 'stone_smallA', 'log', 'cliff_cornerLarge_rock', 'cliff_half_rock']),
    ],
    'town': [
        ('suburban', [f'building-type-{c}' for c in 'abcdefghijklmnopqrstu'] +
                     ['fence-1x3', 'fence-low', 'fence-2x2', 'planter', 'tree-large', 'tree-small']),
        ('nature', ['grass_large', 'grass_leafsLarge', 'grass', 'plant_flatTall', 'flower_redB', 'flower_yellowB', 'flower_purpleC',
                    'tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_pineRoundC', 'plant_bush',
                    'plant_bushDetailed', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'rock_largeB',
                    'statue_column', 'pot_large', 'fence_simple']),
    ],
    'race': [
        ('racing', ['grandStandCovered', 'grandStand', 'grandStandRound', 'grandStandCoveredRound', 'bannerTowerRed',
                    'bannerTowerGreen', 'billboard', 'billboardLow', 'billboardDouble_exclusive', 'overheadLights',
                    'flagCheckers', 'flagRed', 'flagGreen', 'flagTankco', 'tent', 'tentLong', 'tentClosed',
                    'tentRoofDouble', 'pitsGarage', 'pitsOffice', 'barrierRed', 'barrierWhite', 'barrierWall',
                    'fenceStraight', 'lightPostLarge', 'lightPostModern', 'pylon', 'radarEquipment', 'camera_exclusive',
                    'ramp', 'rail', 'lightRedDouble']),
    ],
}

manifest = {'props': {}}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def dedupe_materials():
    """Imports create colormap.001, .002 …; point everything back at one material/image."""
    for img in list(bpy.data.images):
        base = img.name.rsplit('.', 1)[0] if img.name[-4:-3] == '.' and img.name[-3:].isdigit() else None
        if base and base in bpy.data.images:
            img.user_remap(bpy.data.images[base])
            bpy.data.images.remove(img)
    for mat in list(bpy.data.materials):
        base = mat.name.rsplit('.', 1)[0] if mat.name[-4:-3] == '.' and mat.name[-3:].isdigit() else None
        if base and base in bpy.data.materials:
            mat.user_remap(bpy.data.materials[base])
            bpy.data.materials.remove(mat)


def group(objs, name, scale, apply=True):
    # Some kits import under a hidden 'tmpParent' helper; lift children out and drop it.
    for o in list(objs):
        if o.parent and o.parent.name.startswith('tmpParent'):
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    for o in list(objs):
        if o.name.startswith('tmpParent'):
            objs.remove(o)
            bpy.data.objects.remove(o)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    root.scale = (scale, scale, scale)
    if apply:
        bpy.ops.object.select_all(action='DESELECT')
        for o in [root] + list(root.children_recursive):
            o.select_set(True)
        bpy.context.view_layer.objects.active = root
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return root


def to_game(v):
    """Blender (Z up, -Y forward in Kenney files) → glTF/three (Y up)."""
    return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]


def bounds(root):
    pts = [o.matrix_world @ mathutils.Vector(c)
           for o in [root] + list(root.children_recursive) if o.type == 'MESH' for c in o.bound_box]
    if not pts:
        return {'size': [0, 0, 0], 'min': [0, 0, 0]}
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = hi - lo
    return {'size': [round(size.x, 3), round(size.z, 3), round(size.y, 3)], 'min': to_game(mathutils.Vector((lo.x, hi.y, lo.z)))}


def export(path, animations=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_animations=animations, export_animation_mode='ACTIONS',
        export_skins=True, export_morph=False, export_cameras=False, export_lights=False,
        export_extras=False, export_image_format='AUTO')
    print('EXPORTED', path, os.path.getsize(path))


def build_cars():
    reset()
    for car in CARS:
        objs = import_glb(os.path.join(CAR_DIR, car + '.glb'))
        root = group(objs, 'car_' + car, CAR_SCALE)
        wheels = {}
        for o in root.children_recursive:
            short = o.name.split('.')[0]
            if short.startswith('wheel-'):
                tag = ''.join(w[0] for w in short.split('-')[1:])  # front-left → fl
                o.name = f'{car}_wheel_{tag}'
                wheels[tag] = to_game(o.matrix_world.translation)
                radius = o.dimensions.z / 2
            else:
                o.name = f'{car}_{short}'
        info = bounds(root)
        info['wheels'] = wheels
        info['wheelRadius'] = round(radius, 3)
        manifest['cars'][car] = info
    for kind, names in (('wheels', WHEELS), ('parts', PARTS), ('debris', DEBRIS)):
        for n in names:
            objs = import_glb(os.path.join(CAR_DIR, n + '.glb'))
            for o in objs:
                o.location = (0, 0, 0) if o.parent is None else o.location
            root = group(objs, f'{kind[:-1] if kind != "debris" else "debris"}_{n}', CAR_SCALE)
            for i, o in enumerate(root.children_recursive):
                o.name = f'{n}_{i}'
            manifest[kind][n] = bounds(root)
    dedupe_materials()
    export(os.path.join(OUT, 'cars.glb'))


def build_chars():
    for c in CHARACTERS:
        reset()
        objs = import_glb(os.path.join(CHAR_DIR, c + '.glb'))
        for o in objs:
            if o.name.startswith('Icosphere'):
                bpy.data.objects.remove(o)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        arm.name = 'driver'
        heights = [(o.matrix_world @ mathutils.Vector(b)).z for o in bpy.data.objects if o.type == 'MESH' for b in o.bound_box]
        manifest['chars'][c] = {'height': round((max(heights) - min(heights)) * CHAR_SCALE, 3)}
        export(os.path.join(OUT, 'chars', c + '.glb'))

    # Shared animation clips, taken from one character (all use the same 7-bone rig).
    reset()
    objs = import_glb(os.path.join(CHAR_DIR, CHARACTERS[0] + '.glb'))
    for o in objs:
        if o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        if a.name.split('.')[0] not in ANIMS:
            bpy.data.actions.remove(a)
    for a in bpy.data.actions:
        a.use_fake_user = True
    manifest['anims'] = sorted(a.name for a in bpy.data.actions)
    export(os.path.join(OUT, 'anims.glb'), animations=True)

    reset()
    for n in ACCESSORIES:
        objs = import_glb(os.path.join(CHAR_DIR, n + '.glb'))
        root = group(objs, 'acc_' + n, 1)
        for i, o in enumerate(root.children_recursive):
            o.name = f'{n}_{i}'
        manifest['accessories'][n] = bounds(root)
    dedupe_materials()
    export(os.path.join(OUT, 'accessories.glb'))


def build_props():
    for theme, groups in PROPS.items():
        reset()
        for kit, names in groups:
            for n in names:
                path = os.path.join(KITS[kit], n + '.glb')
                if not os.path.exists(path):
                    print('MISSING', path)
                    continue
                objs = import_glb(path)
                for o in objs:
                    if o.parent is None:
                        o.location = (0, 0, 0)
                root = group(objs, 'prop_' + n, KIT_SCALE[kit])
                for i, o in enumerate(root.children_recursive):
                    o.name = f'{n}_{i}'
                manifest['props'][n] = bounds(root) | {'theme': theme}
        dedupe_materials()
        export(os.path.join(OUT, f'props-{theme}.glb'))


# Cars and people now come from tools/build_cars.py + merge_cars.py and tools/build_people.py.
build_props()
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('MANIFEST written')
