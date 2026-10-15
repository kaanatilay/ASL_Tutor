"""Run in Blender 4.5's Text Editor. Creates an isolated, unsaved prototype scene.

Units below describe a stylized hand rather than anatomical measurements.
No files are saved or exported automatically; existing scenes are preserved.
"""
import math
from array import array
import bpy
from mathutils import Vector


def sphere(name, center, scale):
    """Make overlapping volumes that will be fused into a single hand surface."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def finger_surface(name, points, radii):
    """Build a tapered tube along joint positions, including a rounded fingertip."""
    vertices, faces = [], []
    # Extra rings round the tip without requiring a separate intersecting sphere.
    direction = (points[-1] - points[-2]).normalized()
    # Extra shaft rings preserve fullness between the base and first knuckle.
    shaft = points[1] - points[0]
    centers = [points[0], points[0] + shaft * 0.28, points[0] + shaft * 0.65] + points[1:] + [points[-1] + direction * radii[-1] * 0.65,
                        points[-1] + direction * radii[-1] * 0.95]
    widths = [radii[0], radii[0] * 1.03, radii[0] * 0.98] + radii[1:] + [radii[-1] * 0.65, radii[-1] * 0.15]
    sides = 16
    for index, (center, radius) in enumerate(zip(centers, widths)):
        tangent = (centers[min(index + 1, len(centers) - 1)] -
                   centers[max(0, index - 1)]).normalized()
        across = tangent.cross(Vector((0, 0, 1))).normalized()
        normal = across.cross(tangent).normalized()
        for side in range(sides):
            angle = side * math.tau / sides
            vertices.append(center + radius * (math.cos(angle) * across +
                                               math.sin(angle) * normal))
    for ring in range(len(centers) - 1):
        for side in range(sides):
            a = ring * sides + side
            b = ring * sides + (side + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))),
                  tuple((len(centers) - 1) * sides + i for i in range(sides))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def segment_distance(point, start, end):
    """Distance to a bone segment, used to generate approximate skin weights."""
    delta = end - start
    fraction = max(0, min(1, (point - start).dot(delta) / delta.length_squared))
    return (point - (start + fraction * delta)).length


def smooth_transition(value, start, end):
    """Return a gradual 0-to-1 blend with no abrupt change at either edge."""
    fraction = max(0.0, min(1.0, (value - start) / (end - start)))
    return fraction * fraction * (3.0 - 2.0 * fraction)


def skin_weights(point, chains, protect_thumb_web=True):
    """Anchor the palm and blend finger weights along each finger's length.

    Distance alone lets a finger capture nearby palm vertices. A separate root
    transition prevents this, while joint blends avoid switching bones sharply.
    """
    distances = {
        name: min(segment_distance(point, a, b)
                  for a, b in zip(points, points[1:]))
        for name, points in chains.items()
    }
    nearest = min(distances.values())
    # Blend ownership near finger boundaries instead of abruptly choosing one
    # chain. A compact transition excludes distant fingers from the webbing.
    ownership = {}
    for name, distance in distances.items():
        points = chains[name]
        axis = (points[1] - points[0]).normalized()
        along = (point - points[0]).dot(axis)
        # Share the web, but avoid having the shaft follow a neighboring finger.
        blend_width = 0.22 - 0.17 * smooth_transition(along, 0.10, 0.50)
        ownership[name] = 1.0 - smooth_transition(distance - nearest, 0.0, blend_width)
    total = sum(ownership.values())
    result = {'Palm': 0.0}
    for name, share in ownership.items():
        if share == 0.0:
            continue
        share /= total
        points = chains[name]
        axis = (points[1] - points[0]).normalized()
        along = (point - points[0]).dot(axis)
        if name == 'Thumb':
            # Use the same root interval around the thumb circumference. The
            # separately defined medial web mask below protects the fixed patch.
            root_start, root_end = 0.15, 0.95
        else:
            # Use one short attachment zone for the entire circumference.
            # The per-vertex palm outline left inner and outer skin anchored
            # differently, stretching a flap when the finger rotated.
            root_start, root_end = -0.22, 0.32
        finger_amount = smooth_transition(along, root_start, root_end)
        if name in ('Index', 'Middle'):
            # Near these roots, keep skin outside the finger's width on the
            # palm. Measure sideways in the palm plane only: including Z would
            # give the palm/back circumference different attachment behavior.
            base_radius = {'Index': 0.36, 'Middle': 0.37}[name]
            sideways = point - points[0] - axis * along
            lateral_distance = math.sqrt(sideways.x ** 2 + sideways.y ** 2)
            root_envelope = 1.0 - smooth_transition(
                lateral_distance, base_radius * 0.75, base_radius * 1.50)
            # Release the restriction along the shaft, so this affects webbing
            # rather than making a stationary strip beside a bent finger.
            shaft_release = smooth_transition(along, 0.25, 0.85)
            finger_amount *= root_envelope + (1.0 - root_envelope) * shaft_release
        # The oblique thumb uses its axial root interval, not a horizontal Y
        # cutoff: that cutoff held one side behind and pinched the attachment.
        # Keep the existing lower-palm protection for the other four fingers.
        if name != 'Thumb':
            finger_amount *= smooth_transition(point.y, -0.55, 0.10)
        result['Palm'] += share * (1.0 - finger_amount)

        # Blend only adjacent joints along each candidate finger.
        first_length = (points[1] - points[0]).length
        second_length = (points[2] - points[1]).length
        first_bend = smooth_transition(along, first_length - 0.30, first_length + 0.30)
        second_bend = smooth_transition(
            along, first_length + second_length - 0.25,
            first_length + second_length + 0.25)
        amount = share * finger_amount
        result[f'{name}_1'] = amount * (1.0 - first_bend)
        result[f'{name}_2'] = amount * first_bend * (1.0 - second_bend)
        result[f'{name}_3'] = amount * first_bend * second_bend
    if protect_thumb_web:
        # Reassign thumb influence on the palm-facing web patch to the palm.
        # This mask is planar, so both sides of the surface get the same anchor.
        # Release it toward the thumb shaft to avoid leaving a fixed skin strip.
        thumb = chains['Thumb']
        axis = (thumb[1] - thumb[0]).normalized()
        offset = point - thumb[0]
        along = offset.dot(axis)
        medial = offset.dot(Vector((axis.y, -axis.x, 0)))
        # Include more of the medial web and keep its anchor farther along the
        # root. The previous map left this raised patch partly thumb-controlled.
        # Keep the outer half of the thumb free and fade out before the distal
        # shaft, so this does not freeze the entire thumb attachment.
        palm_patch = smooth_transition(medial, 0.00, 0.28)
        shaft_release = smooth_transition(along, 0.95, 1.75)
        anchor = palm_patch * (1.0 - shaft_release)
        # Pin just the small medial web patch identified in the screenshot.
        # Thumb-local coordinates make this independent of viewport orientation.
        # The center stays fully palm-controlled (blue); a soft oval boundary
        # avoids a hard weight seam. Thumb-axis skin is outside this patch.
        patch_radius = math.sqrt(((along - 1.10) / 0.50) ** 2 +
                                 ((medial - 0.60) / 0.38) ** 2)
        patch_anchor = 1.0 - smooth_transition(patch_radius, 0.55, 1.0)
        anchor = 1.0 - (1.0 - anchor) * (1.0 - patch_anchor)
        transferred = 0.0
        for bone in ('Thumb_1', 'Thumb_2', 'Thumb_3'):
            removed = result.get(bone, 0.0) * anchor
            result[bone] = result.get(bone, 0.0) - removed
            transferred += removed
        result['Palm'] += transferred
    return {bone: weight for bone, weight in result.items() if weight > 0.0}


def thumb_weight_color(weights):
    """Blue means zero total thumb influence; yellow is half, red is full."""
    amount = sum(weights.get(f'Thumb_{joint}', 0.0) for joint in (1, 2, 3))
    blue, yellow, red = (0.03, 0.12, 1.0), (1.0, 0.8, 0.04), (1.0, 0.03, 0.02)
    start, end = (blue, yellow) if amount <= 0.5 else (yellow, red)
    blend = amount * 2 if amount <= 0.5 else (amount - 0.5) * 2
    return tuple(a + (b - a) * blend for a, b in zip(start, end)) + (1.0,)


def write_thumb_maps(mesh, before_values, after_values):
    """Allocate every layer before fetching references into Blender's memory.

    Creating another attribute can invalidate an earlier layer reference. Bulk
    writes use fresh name lookups after allocation and after weight assignment.
    """
    expected = len(mesh.vertices) * 4
    if len(before_values) != expected or len(after_values) != expected:
        raise ValueError('Each thumb color map needs four values per vertex.')
    mesh.color_attributes.new(name='Thumb_Before', type='FLOAT_COLOR', domain='POINT')
    mesh.color_attributes.new(name='Thumb_After', type='FLOAT_COLOR', domain='POINT')
    mesh.color_attributes['Thumb_Before'].data.foreach_set('color', before_values)
    mesh.color_attributes['Thumb_After'].data.foreach_set('color', after_values)
    mesh.color_attributes.active_color_index = 1
    mesh.update()


def set_pose(rig, pose):
    """Apply repeatable test poses; positive local X bends toward the palm."""
    for bone in rig.pose.bones:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0, 0, 0)
    for finger in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
        bending = pose in ('Fist', f'{finger} bend')
        angles = (65, 85, 55) if bending else (0, 0, 0)
        if finger == 'Thumb' and bending:
            # Curl test only: thumb opposition still needs anatomical refinement.
            angles = (45, 65, 50)
        for joint, angle in enumerate(angles, 1):
            rig.pose.bones[f'{finger}_{joint}'].rotation_euler.x = math.radians(angle)
    bpy.context.view_layer.update()


def build():
    """Construct a separate scene, fused surface, rig, and sequential pose tests."""
    print('[ASL Hand] Starting geometry', flush=True)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    scene = bpy.data.scenes.new('ASL Hand Prototype')
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    parts = [sphere('Palm volume', (0, 0, 0), (1.55, 1.85, 0.48)),
             sphere('Wrist volume', (0, -1.65, 0), (0.85, 0.9, 0.40)),
             sphere('Thumb pad', (-1.05, -0.65, 0), (0.65, 1.0, 0.48))]
    # Fingers point along +Y; positive local-X curls toward +Z (the palm).
    # Knuckle bumps belong on -Z, the back of the hand. Thumb is on the left.
    definitions = {
        'Index': ([(-1.02, 1.00, 0), (-1.07, 2.45, 0), (-1.09, 3.35, 0), (-1.09, 4.00, 0)], [0.36, 0.32, 0.27, 0.24]),
        'Middle': ([(-0.28, 1.25, 0), (-0.28, 2.85, 0), (-0.28, 3.85, 0), (-0.28, 4.55, 0)], [0.37, 0.33, 0.28, 0.25]),
        'Ring': ([(0.48, 1.16, 0), (0.52, 2.65, 0), (0.56, 3.60, 0), (0.58, 4.25, 0)], [0.35, 0.31, 0.26, 0.23]),
        'Pinky': ([(1.15, 0.83, 0), (1.29, 2.00, 0), (1.38, 2.72, 0), (1.44, 3.25, 0)], [0.29, 0.26, 0.22, 0.20]),
        'Thumb': ([(-1.00, -0.85, 0), (-1.85, -0.05, 0), (-2.45, 0.60, 0), (-2.85, 1.10, 0)], [0.46, 0.39, 0.32, 0.27]),
    }
    chains = {name: [Vector(p) for p in values[0]] for name, values in definitions.items()}
    # Bring the four base pivots toward the palm edge, under the visible
    # knuckles. Keep fingertip and intermediate-joint positions unchanged.
    for name, root_y in {'Index': 1.42, 'Middle': 1.76,
                         'Ring': 1.68, 'Pinky': 1.16}.items():
        chains[name][0].y = root_y
    # A modest rounded collar bridges the thumb tube into its pad. Fuse this
    # volume with the hand rather than leaving a separate visible joint piece.
    thumb_axis = (chains['Thumb'][1] - chains['Thumb'][0]).normalized()
    thumb_collar = chains['Thumb'][0] + thumb_axis * 0.55
    parts.append(sphere('Thumb base fullness', tuple(thumb_collar),
                        (0.52, 0.55, 0.46)))
    for name, (_, radii) in definitions.items():
        parts.append(finger_surface(name, chains[name], radii))
        if name != 'Thumb':
            # Keep the bump opposite the curl direction. A lower, longer volume
            # blends into the shaft more gently than the earlier rounded dome.
            root = chains[name][0]
            radius = radii[0]
            parts.append(sphere(f'{name} base knuckle',
                                (root.x, root.y, -0.10),
                                (radius * 0.98, 0.44, radius * 0.98)))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    hand = bpy.context.object
    hand.name = 'ASL_Hand_Surface'
    # Fuse intersections into a continuous surface before adding deformation.
    remesh = hand.modifiers.new('Fuse hand volumes', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.065
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    # Rounded cutters lower the index-middle web and trim the raised edge of
    # the thumb-index web. Cut only after fusing the overlapping source volumes
    # so the boolean operates on one closed surface. These are local shape
    # adjustments; the rig, knuckles, finger lengths, and animation stay intact.
    for name, center, scale in (
        ('Index-middle gap', (-0.66, 3.85, 0), (0.13, 2.00, 1.00)),
        # Smaller, outward-shifted trim retains a broader thumb attachment.
        ('Thumb-index web trim', (-1.83, 0.88, 0), (0.26, 0.62, 1.00)),
    ):
        cutter = sphere(name, center, scale)
        bpy.context.view_layer.objects.active = hand
        cut = hand.modifiers.new(name, 'BOOLEAN')
        cut.operation = 'DIFFERENCE'
        cut.solver = 'EXACT'
        cut.object = cutter
        bpy.ops.object.modifier_apply(modifier=cut.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    # Rebuild uniform surface spacing at the new rounded gaps before smoothing
    # and skinning. This also removes narrow boolean-generated triangles.
    remesh = hand.modifiers.new('Resample webbing cuts', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.065
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = hand.modifiers.new('Soften surface', 'SMOOTH')
    smooth.factor, smooth.iterations = 0.8, 5
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    for polygon in hand.data.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new('Warm white')
    material.diffuse_color = (0.92, 0.94, 0.97, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Roughness'].default_value = 0.48
    hand.data.materials.append(material)

    print('[ASL Hand] Geometry complete; building rig', flush=True)
    armature = bpy.data.armatures.new('ASL Hand Skeleton')
    rig = bpy.data.objects.new('ASL_Hand_Rig', armature)
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    hand.select_set(False)
    bpy.ops.object.mode_set(mode='EDIT')
    palm = armature.edit_bones.new('Palm')
    palm.head, palm.tail = (0, -2, 0), (0, 1, 0)
    segments = [('Palm', Vector(palm.head), Vector(palm.tail))]
    for name, points in chains.items():
        parent = palm
        for index in range(3):
            bone = armature.edit_bones.new(f'{name}_{index + 1}')
            bone.head, bone.tail = points[index], points[index + 1]
            bone.parent = parent
            bone.use_connect = index > 0
            # Keep local X perpendicular to the finger in the palm plane.
            bone.align_roll(Vector((0, 0, 1)))
            parent = bone
            segments.append((bone.name, points[index], points[index + 1]))
    bpy.ops.object.mode_set(mode='OBJECT')
    groups = {name: hand.vertex_groups.new(name=name) for name, _, _ in segments}
    print('[ASL Hand] Assigning weights and calculating color buffers', flush=True)
    # Keep colors in ordinary Python memory until all vertex-group writes finish.
    before_values, after_values = array('f'), array('f')
    # Snapshot coordinates before assigning groups, which can allocate deform
    # data. No mesh vertex reference is carried across those modifying calls.
    points = [hand.matrix_world @ vertex.co.copy() for vertex in hand.data.vertices]
    # Keep the palm stable; only the finger attachment region gradually follows
    # its root bone. Joint weights then blend along that finger, not across palm.
    for index, point in enumerate(points):
        weights = skin_weights(point, chains)
        before_weights = skin_weights(point, chains, protect_thumb_web=False)
        before_values.extend(thumb_weight_color(before_weights))
        after_values.extend(thumb_weight_color(weights))
        if abs(sum(weights.values()) - 1.0) > 1e-6:
            raise ValueError('Skin weights must sum to one.')
        for name, weight in weights.items():
            groups[name].add([index], weight, 'REPLACE')
    print('[ASL Hand] Weights complete; allocating and writing color maps', flush=True)
    write_thumb_maps(hand.data, before_values, after_values)
    print('[ASL Hand] Color maps complete; setting up animation and display', flush=True)
    modifier = hand.modifiers.new('Finger deformation', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    subdivision = hand.modifiers.new('Surface finish', 'SUBSURF')
    subdivision.levels = 1
    hand.parent = rig
    rig.show_in_front = True
    # Each finger curls and returns before the next starts. A final collective
    # curl holds briefly, then opens so the playback loop has matching endpoints.
    # Every pose keys every bone to prevent movement leaking into other tests.
    test_poses = [(1, 'Open')]
    for index, finger in enumerate(('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')):
        start = 1 + index * 48
        test_poses.extend(((start + 20, f'{finger} bend'),
                           (start + 28, f'{finger} bend'), (start + 48, 'Open')))
    test_poses.extend(((265, 'Fist'), (289, 'Fist'), (313, 'Open')))
    for frame, pose in test_poses:
        set_pose(rig, pose)
        for bone in rig.pose.bones:
            bone.keyframe_insert(data_path='rotation_euler', frame=frame)
        scene.timeline_markers.new(pose, frame=frame)
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1, 313
    scene.frame_set(1)
    scene.world = bpy.data.worlds.new('Hand preview background')
    scene.world.color = (0.045, 0.065, 0.10)
    # Frame the selected surface in existing 3D viewports; use studio lighting.
    bpy.ops.object.select_all(action='DESELECT')
    hand.select_set(True)
    bpy.context.view_layer.objects.active = hand
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.shading.type = 'SOLID'
                space.shading.light = 'STUDIO'
                # Default to the after-weight map for this diagnostic revision.
                # Switch Color to Material in the shading popover for white.
                space.shading.color_type = 'VERTEX'
                space.shading.background_type = 'WORLD'
                space.overlay.show_floor = False
                space.region_3d.view_location = Vector((0, 1, 0))
                space.region_3d.view_distance = 12
    print('Hand created. Curl tests: Thumb 21, Index 69, Middle 117, Ring 165, '
          'Pinky 213, All 265. Playback: frames 1–313 at 24 fps.', flush=True)


build()
