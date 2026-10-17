import test from 'node:test'
import assert from 'node:assert/strict'
import { compareFeatures, inspectFeatures } from '../src/comparison.js'
import { NORMALIZATION_SETTINGS } from '../src/normalization.js'

// Minimal feature fixtures isolate comparison behavior from normalization/tracking.
function fixture() {
  const hand = { valid: true, handedness: [{ categoryName: 'Left', score: .95 }],
    normalizedLandmarks: Array.from({ length: 21 }, (_, i) => ({ x: i * .02, y: i * .03, z: i * .01 })),
    palmOrientation: { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: 0, y: 0, z: 1 } } }
  return { schemaVersion: 1, pipelineVersion: 'pipeline-v001', settings: { ...NORMALIZATION_SETTINGS },
    targetId: 'asl.alphabet.a', recordingId: 'rec-000001', inputs: { videoSha256: 'hash' },
    annotation: { schemaVersion: 1, recordingId: 'rec-000001', inputSha256: 'hash', reviewStatus: 'pending',
      segments: [{ targetId: 'asl.alphabet.a', targetHold: { startMs: 0, endMs: 200 } }] },
    frames: [0, 50, 100].map(timestampMs => ({ timestampMs, valid: true, hands: [structuredClone(hand)] })) }
}

test('self comparison is zero and comparing holds is symmetric without mutating inputs', () => {
  const a = fixture()
  const before = structuredClone(a)
  const self = compareFeatures(a, a)
  assert.equal(self.shapeDifference, 0)
  assert.equal(self.orientationDegrees, 0)
  assert.deepEqual(a, before)
  const b = fixture()
  for (const frame of b.frames) frame.hands[0].normalizedLandmarks[4].x += .2
  const ab = compareFeatures(a, b), ba = compareFeatures(b, a)
  assert.equal(ab.shapeDifference, ba.shapeDifference)
  assert.ok(Math.abs(ab.perFinger[0].difference - .05) < 1e-10)
  assert.equal(ab.perFinger[1].difference, 0)
  assert.equal(ab.orientationDegrees, 0)
})

test('palm rotation is separate from shape and orientation spread uses the whole hold', () => {
  const a = fixture(), b = fixture()
  for (const frame of b.frames) frame.hands[0].palmOrientation = {
    xAxis: { x: 0, y: 1, z: 0 }, yAxis: { x: -1, y: 0, z: 0 }, zAxis: { x: 0, y: 0, z: 1 } }
  const result = compareFeatures(a, b)
  assert.ok(Math.abs(result.orientationDegrees - 90) < 1e-10)
  assert.equal(result.shapeDifference, 0)
  assert.equal(result.b.orientationSpread, 0)
})

test('hold center resists an outlier, spread exposes it, and displayed sample is real', () => {
  const a = fixture(), b = fixture()
  b.frames[2].hands[0].normalizedLandmarks[4].x += 1
  const result = compareFeatures(a, b)
  assert.equal(result.shapeDifference, 0)
  assert.ok(result.b.shapeSpread > 0)
  assert.ok(b.frames.some(frame => frame.timestampMs === result.b.representative.timestampMs))
  b.frames.push({ timestampMs: 150, valid: false, hands: [] })
  assert.equal(inspectFeatures(b).excludedCount, 1)
})

test('invalid geometry, incompatible settings, timing, target, and handedness are rejected', () => {
  const mutations = [
    b => { b.pipelineVersion = 'pipeline-v002' }, b => { b.settings.smoothing = 'changed' },
    b => { b.targetId = 'asl.alphabet.b' }, b => { b.frames[0].timestampMs = -1 },
    b => { b.frames[0].hands[0].normalizedLandmarks[0].x = NaN },
    b => { b.frames[0].hands[0].palmOrientation.xAxis.x = 2 },
    b => { b.frames.forEach(f => { f.hands[0].handedness[0].score = .5 }) },
    b => { b.frames[0].hands[0].handedness[0].categoryName = 'Right' },
  ]
  for (const mutate of mutations) { const b = fixture(); mutate(b); assert.throws(() => inspectFeatures(b)) }
  const right = fixture()
  right.frames.forEach(f => { f.hands[0].handedness[0].categoryName = 'Right' })
  assert.throws(() => compareFeatures(fixture(), right), /Different handedness/)
  const reordered = fixture()
  reordered.settings = Object.fromEntries(Object.entries(reordered.settings).reverse())
  assert.doesNotThrow(() => inspectFeatures(reordered))
})

test('cross-letter and non-target comparisons retain labels and use the same vector recipe', () => {
  for (const targetId of ['asl.alphabet.s', 'asl.alphabet.b', 'example.non-target']) {
    const a = fixture(), b = fixture()
    b.targetId = targetId
    b.annotation.segments[0].targetId = targetId
    b.annotation.notes = 'Relaxed hand example.'
    const result = compareFeatures(a, b)
    assert.equal(result.a.data.targetId, 'asl.alphabet.a')
    assert.equal(result.b.data.targetId, targetId)
    // Labels never change calculated similarity; identical geometry is still identical.
    assert.equal(result.vectorMatch.cosineSimilarity, 1)
    assert.equal(result.vectorMatch.scaledEuclideanDistance, 0)
  }
})
