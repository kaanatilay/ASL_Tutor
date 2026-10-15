import assert from 'node:assert/strict'
import test from 'node:test'
import { MathUtils, Quaternion, Vector3 } from 'three'
import { getIndexFingerBends, getIndexFingerAngles, mapIndexFingerBends, getNeutralTip, canAutoCalibrateIndex } from '../src/indexFingerPose.js'

// Build known finger angles in viewer coordinates, then invert the tracker
// coordinate conversion. Rotation tests keep wrist pose separate from curl.
function finger(degrees, palm = new Quaternion()) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  const joints = [new Vector3(0, -0.05, 0), new Vector3()]
  let accumulated = 0
  for (const degree of degrees) {
    accumulated += MathUtils.degToRad(degree)
    const step = new Vector3(0, 0.03, 0).applyAxisAngle(new Vector3(1, 0, 0), accumulated)
    joints.push(joints.at(-1).clone().add(step))
  }
  for (const [i, joint] of joints.entries()) {
    joint.applyQuaternion(palm)
    points[[0, 5, 6, 7, 8][i]] = { x: -joint.x, y: -joint.y, z: -joint.z }
  }
  return { worldLandmarks: points }
}

test('straight and partially curled joints map independently', () => {
  assert.deepEqual(getIndexFingerBends(finger([0, 0, 0]), new Quaternion()), [0, 0, 0])
  const bends = getIndexFingerBends(finger([25, 60, 35]), new Quaternion())
  bends.forEach((value, i) => assert(Math.abs(value - MathUtils.degToRad([25, 60, 35][i])) < 1e-9))
})

test('turning the palm does not change measured finger curl', () => {
  for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
    const rotation = new Quaternion().setFromAxisAngle(axis, Math.PI / 2)
    const bends = getIndexFingerBends(finger([30, 70, 40], rotation), rotation)
    bends.forEach((value, i) => assert(Math.abs(value - MathUtils.degToRad([30, 70, 40][i])) < 1e-9))
  }
})

test('a 90-degree middle hinge survives an inaccurate estimated palm plane', () => {
  // Previously projection could collapse these perpendicular segments into
  // the same direction. Full 3D hinge magnitudes must preserve their angle.
  const hand = finger([0, 90, 0])
  const inaccurateAxis = new Vector3(0, 1, -1).normalize()
  const inaccuratePalm = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), inaccurateAxis)
  const oldIn = new Vector3(0, 1, 0).addScaledVector(inaccurateAxis, -inaccurateAxis.y).normalize()
  const oldOut = new Vector3(0, 0, 1).addScaledVector(inaccurateAxis, -inaccurateAxis.z).normalize()
  assert(oldIn.angleTo(oldOut) < 1e-7)
  const angles = getIndexFingerAngles(hand, inaccuratePalm)
  assert(Math.abs(angles[1] - Math.PI / 2) < 1e-9)
  assert(Math.abs(mapIndexFingerBends(angles)[1] - Math.PI / 2) < 1e-9)
})

test('hyperextension and tiny noise do not curl backwards; excessive bends clamp', () => {
  assert.deepEqual(getIndexFingerBends(finger([-10, -20, -5]), new Quaternion()), [0, 0, 0])
  assert.deepEqual(getIndexFingerBends(finger([1, 1, 1]), new Quaternion()), [0, 0, 0])
  const limited = getIndexFingerBends(finger([100, 120, 100]), new Quaternion())
  limited.forEach((value, i) => assert(Math.abs(value - MathUtils.degToRad([90, 110, 85][i])) < 1e-9))
})

test('lost or collapsed finger joints are ignored', () => {
  assert.equal(getIndexFingerBends(null, new Quaternion()), null)
  const bad = finger([0, 0, 0])
  bad.worldLandmarks[7] = undefined
  assert.equal(getIndexFingerBends(bad, new Quaternion()), null)
  const collapsed = finger([0, 0, 0])
  collapsed.worldLandmarks[6] = collapsed.worldLandmarks[5]
  assert.equal(getIndexFingerBends(collapsed, new Quaternion()), null)
})

test('small tip estimates straighten without altering the base or middle joint', () => {
  for (const tip of [0, 3, 6, 9, 10]) {
    const bends = getIndexFingerBends(finger([25, 60, tip]), new Quaternion())
    assert(Math.abs(bends[0] - MathUtils.degToRad(25)) < 1e-9)
    assert(Math.abs(bends[1] - MathUtils.degToRad(60)) < 1e-9)
    assert(bends[2] < 1e-9)
  }
})

test('tip bend returns smoothly and retains deliberate larger curls', () => {
  let previous = 0
  for (let tip = 10; tip <= 30; tip += 0.25) {
    const bend = getIndexFingerBends(finger([0, 0, tip]), new Quaternion())[2]
    assert(bend >= previous - 1e-9)
    assert(bend - previous < MathUtils.degToRad(1.5))
    if (tip >= 25) assert(Math.abs(bend - MathUtils.degToRad(tip)) < 1e-9)
    previous = bend
  }
})

test('tip calibration removes the neutral offset without changing other joints', () => {
  const neutral = MathUtils.degToRad(35)
  const resting = finger([25, 60, 35])
  assert(Math.abs(getIndexFingerAngles(resting, new Quaternion())[2] - neutral) < 1e-9)
  const calibrated = getIndexFingerBends(resting, new Quaternion(), neutral)
  assert(calibrated[2] < 1e-9)
  assert(Math.abs(calibrated[0] - MathUtils.degToRad(25)) < 1e-9)
  assert(Math.abs(calibrated[1] - MathUtils.degToRad(60)) < 1e-9)
  const curled = getIndexFingerBends(finger([25, 60, 65]), new Quaternion(), neutral)
  assert(Math.abs(curled[2] - MathUtils.degToRad(30)) < 1e-9)
  assert.equal(mapIndexFingerBends([0, 0, 0], NaN), null)
})

test('calibration requires enough stable samples and tolerates isolated spikes', () => {
  assert.equal(getNeutralTip(Array(9).fill(0.4)), null)
  assert.equal(getNeutralTip([NaN, ...Array(10).fill(0.4)]), null)
  assert(Math.abs(getNeutralTip([...Array(18).fill(0.4), 0.01, 1.2]) - 0.4) < 1e-9)
  assert.equal(getNeutralTip(Array.from({ length: 20 }, (_, i) => i / 10)), null)
})

test('automatic calibration waits for open base/middle joints and valid tip data', () => {
  assert.equal(canAutoCalibrateIndex([0, 0, MathUtils.degToRad(35)]), true)
  assert.equal(canAutoCalibrateIndex([MathUtils.degToRad(30), 0, 0]), false)
  assert.equal(canAutoCalibrateIndex([0, MathUtils.degToRad(40), 0]), false)
  assert.equal(canAutoCalibrateIndex([0, 0, MathUtils.degToRad(90)]), false)
  assert.equal(canAutoCalibrateIndex(null), false)
  assert.equal(canAutoCalibrateIndex([0, NaN, 0]), false)
  assert.equal(getNeutralTip(Array(12).fill(0)), 0)
})
