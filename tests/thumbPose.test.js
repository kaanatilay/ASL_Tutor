import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import { advanceThumbCalibration, canCalibrateThumb, createThumbCalibration, getThumbFeedback,
  getThumbMeasurement, getThumbNeutral, getThumbTargets, getThumbDirections } from '../src/thumbPose.js'
import { getThumbRootMeasurement, getThumbRootOffset } from '../src/thumbPose.js'

const rad = MathUtils.degToRad
const openDirection = new Vector3(-0.75, 0.66, 0).normalize()
const open = { direction: openDirection.toArray(), bends: [0, 0], segments: Array.from({ length: 3 }, () => openDirection.toArray()) }

// Build canonical thumb segments, then apply handedness and a whole-palm turn
// before converting back into tracker coordinates. No browser/camera is needed.
function sample(handedness, rotation, degrees = [35, 55]) {
  const points = Array(21).fill(null)
  const directions = [openDirection.clone()]
  const axis = new Vector3(openDirection.y, -openDirection.x, 0)
  for (const degree of degrees) directions.push(directions.at(-1).clone().applyAxisAngle(axis, rad(degree)))
  const position = new Vector3(-0.02, -0.02, 0)
  for (let i = 1; i <= 4; i++) {
    const point = position.clone()
    point.x *= handedness === 'Left' ? -1 : 1
    point.applyQuaternion(rotation).negate()
    points[i] = { x: point.x, y: point.y, z: point.z }
    if (i < 4) position.addScaledVector(directions[i - 1], 0.025)
  }
  for (const [i, position] of [[0, [0, -0.07, 0]], [5, [-0.035, 0.02, 0]], [17, [0.035, 0.02, 0]]]) {
    const point = new Vector3().fromArray(position)
    point.x *= handedness === 'Left' ? -1 : 1
    point.applyQuaternion(rotation).negate()
    points[i] = { x: point.x, y: point.y, z: point.z }
  }
  return { worldLandmarks: points, handedness }
}

// Read the real exported rest rotations so retargeting checks cover the rig
// actually shipped to users, including its diagonal thumb base and bone roll.
const glb = readFileSync(new URL('../public/models/ASLTutor_hand_model_clean.glb', import.meta.url))
const document = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
const nodes = [1, 2, 3].map(i => document.nodes.find(node => node.name === `Thumb_${i}`))
const rest = nodes.map(node => new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]))

test('both hands and rotated palms produce identical thumb direction and hinge angles', () => {
  for (const handedness of ['Left', 'Right']) for (const rotation of [new Quaternion(), new Quaternion().setFromEuler(new Euler(0.6, 1.4, -0.8))]) {
    const measured = getThumbMeasurement(sample(handedness, rotation), rotation)
    measured.direction.forEach((value, i) => assert(Math.abs(value - open.direction[i]) < 1e-9))
    measured.bends.forEach((value, i) => assert(Math.abs(value - rad([35, 55][i])) < 1e-9))
  }
})

test('missing, nonfinite, or collapsed thumb data holds instead of inventing a pose', () => {
  assert.equal(getThumbMeasurement(null, new Quaternion()), null)
  const input = sample('Right', new Quaternion())
  input.worldLandmarks[3] = input.worldLandmarks[2]
  assert.equal(getThumbMeasurement(input, new Quaternion()), null)
  input.worldLandmarks[3] = { x: NaN, y: 0, z: 0 }
  assert.equal(getThumbMeasurement(input, new Quaternion()), null)
  assert.equal(getThumbTargets(null, null, rest), null)
})

test('neutral thumb maps to the real exported rest pose, without changing authored roll', () => {
  const neutral = { ...open, bends: [rad(15), rad(20)] }
  const targets = getThumbTargets(neutral, neutral, rest)
  targets.forEach((target, i) => assert(target.angleTo(rest[i]) < 1e-7))
  assert(nodes[0].children.includes(document.nodes.indexOf(nodes[1])))
  assert(nodes[1].children.includes(document.nodes.indexOf(nodes[2])))
})

test('every segment follows its measured direction, including a fold across the palm', () => {
  const neutral = open
  for (const segments of [
    [[0, 1, 0], [1, 0, 0], [1, 0, 0]],
    [[-0.3, 0.65, 0.7], [-0.1, 0.7, 0.7], [0.8, 0.4, 0.2]],
  ]) {
    const measurement = { ...open, direction: segments[0], segments }
    const targets = getThumbTargets(measurement, neutral, rest)
    const parent = new Quaternion()
    targets.forEach((target, i) => {
      parent.multiply(target)
      const actual = new Vector3(0, 1, 0).applyQuaternion(parent)
      const expected = new Vector3().fromArray(segments[i]).normalize()
      assert(actual.angleTo(expected) < 1e-7)
    })
  }
})

test('a different open calibration cannot tilt a horizontal folded thumb upward', () => {
  const reference = new Vector3(-0.35, 0.93, 0.1).normalize().toArray()
  const neutral = { ...open, direction: reference, segments: [reference, reference, reference] }
  const folded = { ...open, segments: [[0, 1, 0], [1, 0, 0], [1, 0, 0]] }
  const targets = getThumbTargets(folded, neutral, rest)
  const parent = new Quaternion()
  targets.forEach((rotation, i) => {
    parent.multiply(rotation)
    if (i > 0) {
      const direction = new Vector3(0, 1, 0).applyQuaternion(parent)
      assert(Math.abs(direction.y) < 1e-7)
      assert(direction.x > 0.999)
    }
  })
})

test('open-pose corrections are small and fade continuously into uncorrected motion', () => {
  const reference = new Vector3(-0.2, 0.98, 0).normalize()
  const neutral = { ...open, segments: Array.from({ length: 3 }, () => reference.toArray()) }
  let previous = null
  for (let degree = 0; degree <= 65; degree += 0.25) {
    const raw = reference.clone().applyAxisAngle(new Vector3(0, 0, 1), -rad(degree))
    const measured = { ...open, segments: Array.from({ length: 3 }, () => raw.toArray()) }
    const corrected = getThumbDirections(measured, neutral, rest)
    corrected.forEach((direction, i) => {
      assert(direction.angleTo(raw) <= rad(12) + 1e-8)
      if (degree >= 40) assert(direction.angleTo(raw) < 1e-7)
      if (previous) assert(direction.angleTo(previous[i]) < rad(1))
    })
    previous = corrected
  }
})

test('thumb calibration requires elapsed time and distinct stable frames, once per hand', () => {
  const left = createThumbCalibration(), right = createThumbCalibration()
  for (let i = 0; i <= 10; i++) advanceThumbCalibration(left, { measurement: open, timestamp: i, now: i * 100 })
  assert(left.neutral)
  assert.equal(right.neutral, null)
  const saved = left.neutral
  advanceThumbCalibration(left, { measurement: null, now: 3000 })
  assert.equal(left.neutral, saved)
  for (let i = 0; i <= 10; i++) advanceThumbCalibration(right, { measurement: open, timestamp: 1, now: i * 100 })
  assert.equal(right.request.values.length, 1)
  assert.equal(right.neutral, null)
  advanceThumbCalibration(right, { measurement: null, now: 1200 })
  assert.equal(right.request, null)
})

test('curling and moving base directions do not silently become an open calibration', () => {
  assert.equal(canCalibrateThumb({ ...open, bends: [rad(65), 0] }), false)
  assert.equal(canCalibrateThumb({ direction: [0.1, 0.9, 0.2], bends: [0, 0] }), false)
  const moving = Array.from({ length: 20 }, (_, i) => ({
    ...open, direction: new Vector3(-0.75, 0.66, i % 2 ? 0.5 : -0.5).normalize().toArray(),
  }))
  assert.equal(getThumbNeutral(moving), null)
  const state = createThumbCalibration()
  state.request = { start: 0, values: moving }
  assert.equal(getThumbFeedback({ cameraOn: true, measurement: open, state, now: 1000 }).state, 'hold-still')
  assert.equal(getThumbFeedback({ cameraOn: false, measurement: open, state, now: 1000 }).progress, 0)
})

test('extreme direction flips are bounded and missing segment directions are rejected', () => {
  const opposite = openDirection.clone().negate().toArray()
  const targets = getThumbTargets({ ...open, direction: opposite, segments: [opposite, open.direction, opposite] }, open, rest)
  targets.forEach((target, i) => assert(target.angleTo(rest[i]) <= rad(i === 0 ? 110 : 120) + 1e-7))
  assert.equal(getThumbTargets({ ...open, segments: null }, open, rest), null)
})

test('equal unsigned curl angles in different planes produce different bone directions', () => {
  const a = getThumbMeasurement(sample('Right', new Quaternion(), [60, 30]), new Quaternion())
  const b = { ...a, segments: a.segments.map((segment, i) => i === 0 ? segment :
    new Vector3().fromArray(segment).applyAxisAngle(openDirection, Math.PI / 2).toArray()) }
  const first = getThumbTargets(a, open, rest)
  const second = getThumbTargets(b, open, rest)
  assert(first[1].angleTo(second[1]) > rad(30))
})

test('thumb root is invariant to whole-hand translation, scale, rotation, and handedness', () => {
  const baseline = getThumbRootMeasurement(sample('Right', new Quaternion()), new Quaternion())
  for (const handedness of ['Left', 'Right']) {
    const rotation = new Quaternion().setFromEuler(new Euler(0.6, 1.2, -0.7))
    const input = sample(handedness, rotation)
    input.worldLandmarks = input.worldLandmarks.map(point => point ? {
      x: point.x * 1.7 + 0.4, y: point.y * 1.7 - 0.2, z: point.z * 1.7 + 0.8,
    } : point)
    const root = getThumbRootMeasurement(input, rotation)
    root.forEach((value, i) => assert(Math.abs(value - baseline[i]) < 1e-9))
  }
})

test('calibrated root follows inward movement and returns to zero without changing rotations', () => {
  const rotation = new Quaternion()
  const input = sample('Right', rotation, [0, 0])
  const initial = getThumbMeasurement(input, rotation)
  const state = createThumbCalibration()
  for (let i = 0; i <= 10; i++) advanceThumbCalibration(state, { measurement: initial, timestamp: i, now: i * 100 })
  assert(state.neutral.root)
  assert(getThumbRootOffset(initial, state.neutral, 2.5).length() < 1e-9)
  // Move only the thumb chain toward the palm center in viewer coordinates.
  for (const i of [1, 2, 3, 4]) input.worldLandmarks[i].x -= 0.007
  const moved = getThumbMeasurement(input, rotation)
  const offset = getThumbRootOffset(moved, state.neutral, 2.5)
  assert(offset.x > 0)
  assert(Math.abs(offset.y) < 1e-9 && Math.abs(offset.z) < 1e-9)
  const before = getThumbTargets(initial, state.neutral, rest)
  getThumbTargets(moved, state.neutral, rest).forEach((target, i) => assert(target.angleTo(before[i]) < 1e-7))
  assert(getThumbRootOffset(initial, state.neutral, 2.5).length() < 1e-9)
})

test('root displacement stays bounded and missing anchors disable only translation', () => {
  const neutral = { root: [0, 0, 0] }
  const offset = getThumbRootOffset({ root: [100, -100, 100] }, neutral, 2)
  assert(offset.length() <= 0.28 + 1e-9)
  assert(offset.x <= 0.24 && Math.abs(offset.y) <= 0.16 && offset.z <= 0.12)
  assert.equal(getThumbRootOffset({ root: [NaN, 0, 0] }, neutral, 2), null)
  const input = sample('Right', new Quaternion())
  input.worldLandmarks[5] = null
  const measured = getThumbMeasurement(input, new Quaternion())
  assert.equal(measured.root, null)
  assert(getThumbTargets(measured, null, rest))
  assert.equal(getThumbRootOffset(measured, neutral, 2), null)
  assert.equal(getThumbRootOffset({ root: [0, 0, 0] }, neutral, 0), null)
})

test('root jitter prevents accepting a moving open-thumb reference', () => {
  const values = Array.from({ length: 20 }, (_, i) => ({ ...open, root: [i % 2 ? 0.1 : 0, 0, 0] }))
  assert.equal(getThumbNeutral(values), null)
})
