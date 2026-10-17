import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFrame, frameAtTime, validateRecording } from '../src/recordingData.js'

// Empty detections must survive export/import and clear the overlay instead of holding a pose.
test('capture preserves empty samples and copies tracker coordinates', () => {
  assert.deepEqual(captureFrame({ landmarks: [] }, 50), { timestampMs: 50, hands: [] })
  const points = Array.from({ length: 21 }, () => ({ x: .1, y: .2, z: -.3 }))
  const frame = captureFrame({ landmarks: [points], worldLandmarks: [points], handedness: [[{ categoryName: 'Left', score: .9 }]] }, 0)
  points[0].x = 99
  assert.equal(frame.hands[0].landmarks[0].x, .1)
  assert.equal(frame.hands[0].handedness[0].categoryName, 'Left')
})

test('saved samples round trip and reject wrong videos, IDs, timing, and coordinates', () => {
  const frame = captureFrame({ landmarks: [] }, 0)
  const data = { schemaVersion: 1, recordingId: 'rec-000001', inputSha256: 'abc', frames: [frame] }
  const restored = JSON.parse(JSON.stringify(data))
  assert.deepEqual(validateRecording(restored, 'rec-000001', 'abc'), data)
  assert.throws(() => validateRecording(restored, 'rec-000002', 'abc'))
  assert.throws(() => validateRecording(restored, 'rec-000001', 'different'))
  assert.throws(() => validateRecording({ ...data, frames: [frame, frame] }, data.recordingId, 'abc'))
  assert.throws(() => validateRecording({ ...data, frames: [{ timestampMs: 0, hands: [{ landmarks: [] }] }] }, data.recordingId, 'abc'))
})

test('playback does not carry detections across long gaps or past missing samples', () => {
  const frames = [{ timestampMs: 0, hands: ['visible'] }, { timestampMs: 50, hands: [] }, { timestampMs: 500, hands: ['visible'] }]
  assert.equal(frameAtTime(frames, -1), null)
  assert.deepEqual(frameAtTime(frames, 30).hands, ['visible'])
  assert.deepEqual(frameAtTime(frames, 50).hands, [])
  assert.equal(frameAtTime(frames, 200), null)
  assert.equal(frameAtTime(frames, 1000), null)
})
