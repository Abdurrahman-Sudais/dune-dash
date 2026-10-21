# Builds the game's human drivers from Quaternius' CC0 Universal Base Characters + Animation Library.
#
#   blender -b --factory-startup --python tools/build_people.py
#
# For each body (male / female) this fits racing gear in Blender: a two-tone suit, gloves and
# boots shrink-wrapped from the body itself (so they deform with the same skin weights), and a
# full-face helmet with visor bound to the head bone. All hairstyles are attached so the game can
# toggle them. Output (public/models/people/):
#   <body>.glb        full detail (garage, podium, the player's driver)
#   <body>-lite.glb   decimated (rival drivers and the crowd)
#   anims.glb         selected mocap clips on the shared 65-bone rig
#   skin-*.jpg        alternate skin tones (swapped at runtime)

import bpy
import bmesh
import json
import os
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
UBC = os.path.join(ROOT, 'assets-src', 'ubc', 'Universal Base Characters[Standard]')
UAL = os.path.join(ROOT, 'assets-src', 'ual', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb')
OUT = os.path.join(ROOT, 'public', 'models', 'people')
BODIES = {
    'male': ('Superhero_Male_FullBody.gltf', 'T_Superhero_Male_Dark.png', 'T_Superhero_Male_Ligh.png'),
    'female': ('Superhero_Female_FullBody.gltf', 'T_Superhero_Female_Dark_BaseColor.png', 'T_Superhero_Female_Light_BaseColor.png'),
}
HAIRS = ['Hair_Long', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Beard']
CLIPS = ['Driving_Loop', 'Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop', 'Death01', 'Hit_Chest', 'Hit_Head',
         'Punch_Cross', 'Punch_Jab', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Walk_Loop', 'Jog_Fwd_Loop',
         'Sitting_Idle_Loop', 'Interact', 'Roll', 'Crouch_Idle_Loop', 'Spell_Simple_Shoot', 'Sprint_Loop']
TEX_SIZE = 1024

HEAD = {'Head', 'neck_01'}
HANDS = {'hand_l', 'hand_r'} | {f'{f}_{i:02d}_{s}' for f in ('index', 'middle', 'pinky', 'ring', 'thumb') for i in (1, 2, 3) for s in 'lr'}
FEET = {'foot_l', 'foot_r', 'ball_l', 'ball_r'}

manifest = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in list(new):
        if o.name.startswith('Icosphere'):
            new.remove(o)
            bpy.data.objects.remove(o)
    return new


def material(name, color, rough=0.55, metal=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    return m


def group_weight(obj, v, names):
    total = 0.0
    for g in v.groups:
        if obj.vertex_groups[g.group].name in names:
            total += g.weight
    return total


def carve(body, name, keep, offset, mat):
    """Copy the body, keep only vertices where keep(vertex) is true, push them out along normals."""
    dup = body.copy()
    dup.data = body.data.copy()
    dup.name = name
    bpy.context.scene.collection.objects.link(dup)
    me = dup.data
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    names = {i: g.name for i, g in enumerate(dup.vertex_groups)}
    doomed = []
    for v in bm.verts:
        weights = {names[k]: w for k, w in v[deform].items()} if deform else {}
        if not keep(v.co, weights):
            doomed.append(v)
    bmesh.ops.delete(bm, geom=doomed, context='VERTS')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(mat)
    return dup


def weight_of(weights, names):
    return sum(w for n, w in weights.items() if n in names)


def build_gear(arm, body):
    """One watertight garment copied from the body: suit, side stripes/sleeves, gloves and boots are
    material slots on the same surface, so there are no seams. Feet are inflated and smoothed into boots."""
    mats = [material('Suit', (0.95, 0.95, 0.95), rough=0.5),
            material('Gloves', (0.08, 0.08, 0.09), rough=0.6), material('Boots', (0.06, 0.06, 0.07), rough=0.35)]
    gear = body.copy()
    gear.data = body.data.copy()
    gear.name = 'Gear'
    bpy.context.scene.collection.objects.link(gear)
    me = gear.data
    for attr in list(me.color_attributes):  # leave our stripe field as the only colour layer (COLOR_0)
        me.color_attributes.remove(attr)
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    names = {i: g.name for i, g in enumerate(gear.vertex_groups)}
    W = {v: ({names[k]: w for k, w in v[deform].items()} if deform else {}) for v in bm.verts}
    head = {v: weight_of(W[v], {'Head'}) for v in bm.verts}
    hand = {v: weight_of(W[v], HANDS) for v in bm.verts}
    foot = {v: weight_of(W[v], FEET) for v in bm.verts}

    bmesh.ops.delete(bm, geom=[f for f in bm.faces if sum(head[v] for v in f.verts) / len(f.verts) > 0.45], context='FACES')
    bm.verts.ensure_lookup_table()
    # Boots: smooth away the toes, then inflate.
    feet = [v for v in bm.verts if v.is_valid and foot.get(v, 0) > 0.3]
    for _ in range(8):
        bmesh.ops.smooth_vert(bm, verts=feet, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (0.007 + 0.016 * foot.get(v, 0) + 0.002 * hand.get(v, 0))
    bm.normal_update()
    # Accent pattern as a smooth signed field in vertex colour R (0.5 = edge). The game's shader
    # thresholds the interpolated value, so stripe edges come out straight, not triangle-jagged.
    col = bm.loops.layers.color.new('Col')
    for f in bm.faces:
        for loop in f.loops:
            p = loop.vert.co
            sleeve = min(abs(p.x) - 0.2, p.z - 1.15)
            chest = 0.04 - abs(p.z - 1.31)
            belt = 0.03 - abs(p.z - 0.96)
            stripe = 0.012 - abs(abs(p.x) - 0.115) if p.z < 0.9 else -1  # thin stripes down the legs
            field = max(sleeve, chest, belt, stripe)
            r = max(0.0, min(1.0, 0.5 + field * 12))
            loop[col] = (r, 0, 0, 1)
        fh = sum(hand[v] for v in f.verts) / len(f.verts)
        ff = sum(foot[v] for v in f.verts) / len(f.verts)
        f.material_index = 2 if ff > 0.5 else 1 if fh > 0.5 else 0
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    bm.to_mesh(me)
    bm.free()
    bpy.context.view_layer.objects.active = gear
    bpy.ops.object.shade_smooth()

    # Hide the body under the suit: keep only head (+ a little neck) so nothing pokes through.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    deform = bm.verts.layers.deform.active
    bnames = {i: g.name for i, g in enumerate(body.vertex_groups)}
    def hw(v):
        return sum(w for k, w in v[deform].items() if bnames[k] in HEAD) if deform else 0
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(hw(v) < 0.2 for v in f.verts)], context='FACES')
    bm.to_mesh(body.data)
    bm.free()

    # Full-face helmet + visor, rigidly bound to the head bone.
    head_bone = arm.data.bones['Head']
    head_pos = arm.matrix_world @ head_bone.head_local
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=0.155, location=head_pos + mathutils.Vector((0, 0.005, 0.085)))
    helmet = bpy.context.active_object
    helmet.name = 'Helmet'
    helmet.scale = (0.92, 1.05, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bm = bmesh.new()
    bm.from_mesh(helmet.data)
    cut = [v for v in bm.verts if v.co.z < -0.1]  # open at the neck
    bmesh.ops.delete(bm, geom=cut, context='VERTS')
    bm.to_mesh(helmet.data)
    bm.free()
    helmet.data.materials.append(material('Helmet', (1, 1, 1), rough=0.2, metal=0.1))
    bpy.ops.object.shade_smooth()

    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=0.162, location=helmet.location)
    visor = bpy.context.active_object
    visor.name = 'Visor'
    visor.scale = (0.93, 1.06, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bm = bmesh.new()
    bm.from_mesh(visor.data)
    # Keep a band across the face (front = -Y in Blender for these characters).
    cut = [v for v in bm.verts if not (v.co.y < -0.06 and -0.055 < v.co.z < 0.045)]
    bmesh.ops.delete(bm, geom=cut, context='VERTS')
    bm.to_mesh(visor.data)
    bm.free()
    visor.data.materials.append(material('Visor', (0.02, 0.03, 0.05), rough=0.05, metal=0.9))
    bpy.ops.object.shade_smooth()

    for obj in (helmet, visor):
        obj.parent = arm
        vg = obj.vertex_groups.new(name='Head')
        vg.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
        mod = obj.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm


def attach_hairs(arm):
    hair_dir = os.path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')
    for h in HAIRS:
        objs = import_gltf(os.path.join(hair_dir, h + '.gltf'))
        for o in objs:
            if o.type == 'MESH':
                mw = o.matrix_world.copy()
                o.parent = arm
                o.matrix_world = mw
                for m in o.modifiers:
                    if m.type == 'ARMATURE':
                        m.object = arm
                o.name = h
        for o in objs:
            if o.type == 'ARMATURE':
                bpy.data.objects.remove(o)


def shrink_images():
    for img in bpy.data.images:
        if img.size[0] > TEX_SIZE:
            img.scale(TEX_SIZE, TEX_SIZE)


def export(path, animations=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_skins=True, export_morph=False,
        export_animations=animations, export_animation_mode='ACTIONS', export_cameras=False, export_lights=False,
        export_image_format='JPEG', export_jpeg_quality=85, export_extras=False, export_vertex_color='ACTIVE')
    print('EXPORTED', path, os.path.getsize(path))


def decimate(ratio):
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.name in ('Eyes', 'Eyebrows', 'Visor', 'Helmet'):
            continue
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = ratio
        # Decimate must sit before the armature modifier to apply cleanly.
        while o.modifiers.find('Decimate') > 0:
            bpy.ops.object.modifier_move_up(modifier='Decimate')
        bpy.ops.object.modifier_apply(modifier='Decimate')


def tri_count():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')


def build_body(key, file, dark_tex, light_tex):
    for lite in (False, True):
        reset()
        objs = import_gltf(os.path.join(UBC, 'Base Characters', 'Godot - UE', file))
        arm = next(o for o in objs if o.type == 'ARMATURE')
        arm.name = 'Rig'
        body = next(o for o in objs if o.type == 'MESH' and o.name.lower().startswith('superhero'))
        body.name = 'Body'
        attach_hairs(arm)
        build_gear(arm, body)
        if lite:
            decimate(0.1)
        shrink_images()
        manifest[key + ('-lite' if lite else '')] = {'tris': tri_count()}
        export(os.path.join(OUT, f'{key}{"-lite" if lite else ""}.glb'))

    # Alternate skin tones as standalone textures.
    for tone, name in (('dark', dark_tex), ('light', light_tex)):
        img = bpy.data.images.load(os.path.join(UBC, 'Base Characters', 'Textures', name))
        if img.size[0] > TEX_SIZE:
            img.scale(TEX_SIZE, TEX_SIZE)
        img.filepath_raw = os.path.join(OUT, f'skin-{key}-{tone}.jpg')
        img.file_format = 'JPEG'
        img.save()


def build_anims():
    reset()
    objs = import_gltf(UAL)
    for a in list(bpy.data.actions):
        if a.name not in CLIPS:
            bpy.data.actions.remove(a)
    for a in bpy.data.actions:
        a.use_fake_user = True
    for o in objs:
        if o.type == 'MESH':
            bpy.context.view_layer.objects.active = o
            mod = o.modifiers.new('Decimate', 'DECIMATE')
            mod.ratio = 0.02
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)
    manifest['clips'] = sorted(a.name for a in bpy.data.actions)
    export(os.path.join(OUT, 'anims.glb'), animations=True)


for key, (file, dark, light) in BODIES.items():
    build_body(key, file, dark, light)
build_anims()
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('PEOPLE', json.dumps(manifest))
