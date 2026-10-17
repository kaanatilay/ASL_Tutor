import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceLiveWindow, prepareLiveReference, matchLiveWindow } from '../src/liveMatching.js'
import { normalizeTargetHold, NORMALIZATION_SETTINGS } from '../src/normalization.js'
import { captureFrame } from '../src/recordingData.js'

// Synthetic palm geometry gives an independent repeatable live/reference fixture.
function raw(timestamp) {
  const points = Array.from({ length: 21 }, (_, i) => ({ x: i * .002, y: .03 + i * .003, z: i * .001 }))
  points[0] = { x: 0, y: 0, z: 0 }
  points[5] = { x: -.03, y: .06, z: 0 }
  points[9] = { x: -.01, y: .065, z: 0 }
  points[13] = { x: .01, y: .06, z: 0 }
  points[17] = { x: .03, y: .05, z: 0 }
  return { timestamp, score: .99, handedness: 'Left', landmarks: points, worldLandmarks: points }
}

function reference(targetId = 'asl.alphabet.a', recordingId = 'rec-000001') {
  const sample = raw(0)
  const recording = { recordingId, inputSha256: 'video-hash', frames: Array.from({ length: 20 }, (_, i) =>
    captureFrame({ landmarks: [sample.landmarks], worldLandmarks: [sample.worldLandmarks], handedness: [[{ categoryName: 'Left', score: .99 }]] }, i * 50)) }
  const annotation = { schemaVersion: 1, recordingId, inputSha256: recording.inputSha256, reviewStatus: 'pending',
    reviewerId: null, reviewedAt: null, notes: '', segments: [{ targetId, startMs: 0, endMs: 1000, targetHold: { startMs: 0, endMs: 1000 } }] }
  return { schemaVersion: 1, pipelineVersion: 'pipeline-v001', settings: NORMALIZATION_SETTINGS,
    recordingId, targetId, inputs: { videoSha256: recording.inputSha256 }, annotation, ...normalizeTargetHold(recording, annotation, 1000) }
}

test('live windows need elapsed time and unique samples, and clear after tracking loss or gaps', () => {
  let samples = [], result
  for (let t = 0; t <= 900; t += 100) { result = advanceLiveWindow(samples, raw(t), t); samples = result.samples }
  assert.equal(result.ready, true)
  assert.equal(advanceLiveWindow(samples, raw(900), 901).samples.length, samples.length)
  assert.equal(advanceLiveWindow(samples, null, 1000).samples.length, 0)
  assert.equal(advanceLiveWindow(samples, raw(900), 1150).ready, false)
  assert.equal(advanceLiveWindow(samples, raw(1300), 1300).samples.length, 1)
  assert.equal(advanceLiveWindow(samples, { ...raw(1000), score: .5 }, 1000).samples.length, 0)
  assert.equal(advanceLiveWindow(samples, { ...raw(1000), worldLandmarks: [] }, 1000).samples.length, 0)
})

test('live matching uses the offline recipe and yields identity for identical held geometry', () => {
  let samples = []
  for (let t = 0; t <= 900; t += 100) samples = advanceLiveWindow(samples, raw(t), t).samples
  const prepared = prepareLiveReference(reference())
  const result = matchLiveWindow(samples, [prepared])
  assert.equal(result.cosine.value, 1)
  // Repeated-vector means over different sample counts can differ at floating-point precision.
  assert.ok(result.euclidean.value < 1e-12)
  assert.equal(result.orientationDegrees, 0)
  assert.equal(result.cosine.referenceId, 'rec-000001')
  assert.equal(prepareLiveReference(reference('asl.alphabet.s')).targetId, 'asl.alphabet.s')
  assert.throws(() => matchLiveWindow(samples, []))
})
