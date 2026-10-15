import test from 'node:test'
import assert from 'node:assert/strict'
import { Quaternion } from 'three'
import { getFingerAngles, TRACKED_FINGERS } from '../src/indexFingerPose.js'
import { createFingerCalibration, advanceFingerCalibration, cancelFingerCollections } from '../src/fingerCalibration.js'

test('each finger reads its own landmarks and ignores another finger being missing', () => {
  const points = Array(21).fill(null)
  points[0] = { x: 0, y: 0.05, z: 0 }
  TRACKED_FINGERS.forEach((finger, i) => {
    const start = 5 + i * 4
    for (let j = 0; j < 4; j++) points[start + j] = { x: 0, y: -j * 0.03, z: 0 }
  })
  points[10] = null
  for (const finger of TRACKED_FINGERS) {
    const angles = getFingerAngles({ worldLandmarks: points }, new Quaternion(), finger)
    if (finger === 'Middle') assert.equal(angles, null)
    else assert.deepEqual(angles, [0, 0, 0])
  }
})

test('calibration retains zero neutrals and isolates hands and fingers', () => {
  const store = createFingerCalibration()
  const index = store.Left.Index
  for (let i = 0; i <= 10; i++) advanceFingerCalibration(index, { angles: [0, 0, 0], timestamp: i, now: i * 100 })
  assert.deepEqual(index.neutral, [0, 0, 0])
  assert.equal(store.Left.Middle.neutral, null)
  assert.equal(store.Right.Index.neutral, null)
  advanceFingerCalibration(index, { angles: [0, 0, 0.5], timestamp: 12, now: 2200 })
  assert.deepEqual(index.neutral, [0, 0, 0])
  assert.equal(index.request, null)
})

test('duplicate frames cannot finish calibration; losing tracking cancels only pending samples', () => {
  const store = createFingerCalibration()
  store.Left.Index.neutral = [0.1, 0.1, 0.1]
  const middle = store.Left.Middle
  for (let i = 0; i < 12; i++) advanceFingerCalibration(middle, { angles: [0, 0, 0], timestamp: 1, now: i * 100 })
  assert.equal(middle.request.values.length, 1)
  assert.equal(middle.neutral, null)
  advanceFingerCalibration(middle, { angles: null, now: 1200 })
  assert.equal(middle.request, null)
  cancelFingerCollections(store)
  assert.deepEqual(store.Left.Index.neutral, [0.1, 0.1, 0.1])
})
