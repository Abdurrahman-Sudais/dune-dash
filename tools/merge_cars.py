# Packs every built car (public/models/cars/<id>.glb) into one cars.glb where identical
# textures/materials are stored once and detail textures are shrunk, to keep RAM/VRAM low.
#
#   blender -b --factory-startup --python tools/merge_cars.py

import bpy
import hashlib
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIR = os.path.join(ROOT, 'public', 'models', 'cars')
CARS = ['saba', 'exterminator', 'kiri', 'tiara', 'phoenix', 'duke', 'sanremo', 'asti', 'lightbody', 'cop']
MAX_TEX = 512

bpy.ops.wm.read_factory_settings(use_empty=True)
for car in CARS:
    before = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=os.path.join(DIR, car + '.glb'))
    for m in set(bpy.data.materials) - before:
        if m.name.split('.')[0] == 'Paint':
            m.name = 'Paint_' + car  # each car keeps its own paint

# Shrink, then dedupe images by pixel content.
by_hash = {}
for img in list(bpy.data.images):
    if img.size[0] > MAX_TEX:
        img.scale(MAX_TEX, MAX_TEX * img.size[1] // img.size[0])
    h = hashlib.md5(bytes(memoryview(img.pixels[:]).cast('B')) if False else str(tuple(round(p, 2) for p in img.pixels[::97])).encode()).hexdigest()
    key = (h, img.size[0], img.size[1])
    if key in by_hash:
        img.user_remap(by_hash[key])
        bpy.data.images.remove(img)
    else:
        by_hash[key] = img


def signature(m):
    if not m.node_tree:
        return m.name
    parts = []
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            parts.append(n.image.name)
        if n.type == 'BSDF_PRINCIPLED':
            for k in ('Base Color', 'Metallic', 'Roughness', 'Alpha'):
                v = n.inputs[k].default_value
                parts.append(str([round(x, 3) for x in v] if hasattr(v, '__len__') else round(v, 3)))
    return m.name.split('.')[0] + '|' + '|'.join(sorted(parts))


seen = {}
for m in list(bpy.data.materials):
    if m.name.startswith('Paint_'):
        continue
    sig = signature(m)
    if sig in seen:
        m.user_remap(seen[sig])
        bpy.data.materials.remove(m)
    else:
        seen[sig] = m

path = os.path.join(DIR, 'cars.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_image_format='JPEG',
                          export_jpeg_quality=82, export_extras=False)
print('MERGED', os.path.getsize(path), 'images', len(bpy.data.images), 'materials', len(bpy.data.materials))
