import assert from 'node:assert/strict'
import test from 'node:test'
import { MathUtils } from 'three'
import { getCalibrationFeedback } from '../src/calibrationFeedback.js'

// Feedback must explain the unchanged gates instead of relaxing acceptance.
const baseline = { cameraOn: true, angles: [0, 0, 0.4], request: null, calibrated: false, now: 500 }
test('feedback separates camera, missing data, straightening, and bad tip estimates', () => {
  assert.equal(getCalibrationFeedback({ ...baseline, cameraOn: false }).state, 'waiting')
  assert.equal(getCalibrationFeedback({ ...baseline, angles: null }).state, 'unclear')
  assert.equal(getCalibrationFeedback({ ...baseline, angles: [0, MathUtils.degToRad(50), 0] }).state, 'straighten')
  assert.equal(getCalibrationFeedback({ ...baseline, angles: [0, 0, MathUtils.degToRad(80)] }).state, 'unclear')
})

test('progress needs both distinct samples and elapsed time; only success reaches 100', () => {
  const request = { start: 0, values: Array(10).fill([0, 0, 0.4]) }
  assert.equal(getCalibrationFeedback({ ...baseline, request }).progress, 50)
  assert.equal(getCalibrationFeedback({ ...baseline, now: 1500, request: { start: 0, values: Array(4).fill([0, 0, 0.4]) } }).progress, 40)
  assert.equal(getCalibrationFeedback({ ...baseline, now: 1500, request }).progress, 99)
  assert.equal(getCalibrationFeedback({ ...baseline, calibrated: true }).progress, 100)
})

test('unstable estimates and retry pauses explain why progress has stopped', () => {
  const request = { start: 0, values: Array.from({ length: 20 }, (_, i) => [0, i / 10, 0]) }
  assert.equal(getCalibrationFeedback({ ...baseline, request }).state, 'hold-still')
  assert.equal(getCalibrationFeedback({ ...baseline, request }).progress, 0)
  assert.equal(getCalibrationFeedback({ ...baseline, retryUntil: 1000, retryReason: 'unclear' }).state, 'unclear')
})
