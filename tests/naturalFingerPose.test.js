import test from 'node:test'
import assert from 'node:assert/strict'
import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import { getFingerAngles, getFingerReference, mapFingerBends, TRACKED_FINGERS } from '../src/indexFingerPose.js'
import { advanceFingerCalibration, createFingerCalibration } from '../src/fingerCalibration.js'

// Fan each finger sideways, then curl around its own hinge. Apply a whole-hand
// rotation last, so these fixtures can distinguish spread, curl, and palm turn.
function hand(finger, spread, bends, rotation = new Quaternion(), side = 1) {
  const points = Array(21).fill(null)
  const start = 5 + TRACKED_FINGERS.indexOf(finger) * 4
  const fan = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), MathUtils.degToRad(spread))
  const position = new Vector3()
  const write = (index, vector) => {
    const v = vector.clone().applyQuaternion(fan)
    v.x *= side
    v.applyQuaternion(rotation).negate()
    points[index] = { x: v.x, y: v.y, z: v.z }
  }
  write(0, new Vector3(0, -0.05, 0))
  write(start, position)
  let curl = 0
  bends.forEach((bend, i) => {
    curl += MathUtils.degToRad(bend)
    position.add(new Vector3(0, 0.03, 0).applyAxisAngle(new Vector3(1, 0, 0), curl))
    write(start + i + 1, position)
  })
  return { worldLandmarks: points }
}

test('naturally spread fingers retain their curl through palm turns on either side', () => {
  for (const finger of TRACKED_FINGERS) for (const spread of [-30, 0, 30]) {
    for (const side of [-1, 1]) for (const rotation of [new Quaternion(), new Quaternion().setFromEuler(new Euler(0.4, 1.2, -0.6))]) {
      const open = hand(finger, spread, [0, 0, 0], rotation, side)
      const reference = getFingerReference(open, rotation, finger)
      const angles = getFingerAngles(hand(finger, spread, [35, 65, 30], rotation, side), rotation, finger, reference)
      angles.forEach((value, i) => assert(Math.abs(value - MathUtils.degToRad([35, 65, 30][i])) < 1e-8))
    }
  }
})

test('all three stable resting offsets calibrate despite exceeding the old 15-degree gate', () => {
  const state = createFingerCalibration().Left.Ring
  const neutral = [22, 25, 30].map(MathUtils.degToRad)
  const reference = [Math.sin(0.3), Math.cos(0.3), 0]
  for (let i = 0; i <= 10; i++) advanceFingerCalibration(state, { angles: neutral, reference, timestamp: i, now: i * 100 })
  assert.deepEqual(state.neutral, neutral)
  state.reference.forEach((value, i) => assert(Math.abs(value - reference[i]) < 1e-9))
  assert.deepEqual(mapFingerBends(neutral, state.neutral), [0, 0, 0])
  const ninety = mapFingerBends([90, 90, 90].map(MathUtils.degToRad), state.neutral)
  assert(Math.abs(ninety[0] - Math.PI / 2) < 1e-9)
  assert(Math.abs(ninety[1] - Math.PI / 2) < 1e-9)
})

test('rest correction is continuous and monotonic, with no loss at a deep bend', () => {
  const neutral = [20, 25, 30].map(MathUtils.degToRad)
  let previous = [0, 0, 0]
  for (let degree = 0; degree <= 120; degree += 0.25) {
    const values = mapFingerBends(Array(3).fill(MathUtils.degToRad(degree)), neutral)
    values.forEach((value, i) => {
      assert(value >= previous[i] - 1e-9)
      assert(value - previous[i] < MathUtils.degToRad(1))
    })
    previous = values
  }
})

test('moving any joint rejects calibration; an obviously curled finger never starts', () => {
  const state = createFingerCalibration().Right.Pinky
  for (let i = 0; i <= 10; i++) advanceFingerCalibration(state, { angles: [i % 2 ? 0.5 : 0, 0, 0], timestamp: i, now: i * 100 })
  assert.equal(state.neutral, null)
  advanceFingerCalibration(state, { angles: [0, Math.PI / 2, 0], timestamp: 12, now: 2200 })
  assert.equal(state.request, null)
})
