import assert from 'node:assert/strict'
import test from 'node:test'
import { Quaternion, Vector3 } from 'three'
import { getPalmPose } from '../src/palmPose.js'

// Synthetic palms isolate mapping errors from webcam/model-estimation noise.
function sample(side = 'Right') {
  const worldLandmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  const sign = side === 'Right' ? 1 : -1
  worldLandmarks[5] = { x: 0.04 * sign, y: -0.06, z: 0 }
  worldLandmarks[17] = { x: -0.04 * sign, y: -0.06, z: 0 }
  worldLandmarks[9] = { x: 0, y: -0.08, z: 0 }
  worldLandmarks[13] = { x: 0, y: -0.07, z: 0 }
  return { handedness: side, worldLandmarks,
    landmarks: worldLandmarks.map(() => ({ x: 0.5, y: 0.5 })) }
}

test('neutral palms share an upright frame with opposite mesh reflections', () => {
  for (const side of ['Right', 'Left']) {
    const pose = getPalmPose(sample(side))
    assert(Math.abs(pose.rotation.w - 1) < 1e-9)
    assert.equal(pose.side, side === 'Right' ? 1 : -1)
  }
})

test('translation follows mirrored video and stays bounded with fixed depth', () => {
  const shifted = sample()
  shifted.landmarks.forEach(point => { point.x = 0.8; point.y = 0.2 })
  const pose = getPalmPose(shifted)
  assert(pose.position.x < -1.65)
  assert(pose.position.y > 2.35)
  assert.equal(pose.position.z, 0)
  shifted.landmarks.forEach(point => { point.x = -9; point.y = 9 })
  const extreme = getPalmPose(shifted)
  assert(extreme.position.x <= -1.05 + 1e-9)
  assert(extreme.position.y >= 1.90 - 1e-9)
})

test('wrist roll and palm/back turning rotate the entire palm frame', () => {
  const rolled = sample()
  rolled.worldLandmarks = rolled.worldLandmarks.map(p => ({ x: -p.y, y: p.x, z: p.z }))
  assert(new Vector3(0, 1, 0).applyQuaternion(getPalmPose(rolled).rotation).x < -0.99)
  const back = sample()
  back.worldLandmarks = back.worldLandmarks.map(p => ({ x: -p.x, y: p.y, z: -p.z }))
  assert(new Vector3(0, 0, 1).applyQuaternion(getPalmPose(back).rotation).z < -0.99)
})

test('finger-tip movement cannot change the palm orientation', () => {
  const changed = sample()
  for (const i of [4, 8, 12, 16, 20]) changed.worldLandmarks[i] = { x: 1, y: 2, z: 3 }
  assert.deepEqual(getPalmPose(changed).rotation, getPalmPose(sample()).rotation)
})

test('a valid depth-supported edge-on palm keeps its side-on frame', () => {
  const turned = sample()
  const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  turned.worldLandmarks = turned.worldLandmarks.map(point => {
    const v = new Vector3(point.x, point.y, point.z).applyQuaternion(quarterTurn)
    return { x: v.x, y: v.y, z: v.z }
  })
  // Projected width is now zero, but the world points still define a valid palm.
  const pose = getPalmPose(turned)
  assert(pose)
  const normal = new Vector3(0, 0, 1).applyQuaternion(pose.rotation)
  assert(normal.x > 0.99)
  assert(Math.abs(normal.z) < 1e-9)
})

test('a nearly collinear 3D palm is held rather than assigned an unstable normal', () => {
  const collapsed = sample()
  for (const i of [5, 9, 13, 17]) collapsed.worldLandmarks[i] = { x: 0, y: -i / 100, z: 0 }
  assert.equal(getPalmPose(collapsed), null)
})

test('lost, malformed, and degenerate tracking samples are ignored', () => {
  assert.equal(getPalmPose(null), null)
  const malformed = sample()
  malformed.worldLandmarks[9] = undefined
  assert.equal(getPalmPose(malformed), null)
  const invalid = sample()
  invalid.worldLandmarks[9].x = NaN
  assert.equal(getPalmPose(invalid), null)
  assert.equal(getPalmPose({ ...sample(), worldLandmarks: Array(21).fill({ x: 0, y: 0, z: 0 }) }), null)
})
