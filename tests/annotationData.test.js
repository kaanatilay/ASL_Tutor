import test from 'node:test'
import assert from 'node:assert/strict'
import { secondsToMs, validateAnnotation } from '../src/annotationData.js'

const context = { recordingId: 'rec-000001', inputSha256: 'video-fingerprint', durationMs: 5000 }
// A segment covers forming and holding A; the hold is a smaller interval within it.
function example() {
  return { schemaVersion: 1, recordingId: context.recordingId, inputSha256: context.inputSha256,
    reviewStatus: 'pending', reviewerId: null, reviewedAt: null, notes: 'Learner example.',
    segments: [{ targetId: 'asl.alphabet.a', startMs: 1000, endMs: 4000,
      targetHold: { startMs: 2000, endMs: 3500 } }] }
}

test('annotations round trip without changing times, notes, or review status', () => {
  const data = example()
  assert.deepEqual(validateAnnotation(JSON.parse(JSON.stringify(data)), context), data)
  data.reviewStatus = 'accepted'
  data.reviewerId = 'reviewer-001'
  data.reviewedAt = '2026-10-15T12:00:00.000Z'
  assert.equal(validateAnnotation(data, context).reviewStatus, 'accepted')
  data.segments[0].targetHold = { startMs: 1000, endMs: 4000 }
  assert.doesNotThrow(() => validateAnnotation(data, context))
})

test('annotations reject incompatible versions, recording identities, and malformed reviews', () => {
  for (const patch of [{ schemaVersion: 2 }, { recordingId: 'rec-000002' }, { inputSha256: 'wrong-video' },
    { reviewStatus: 'automatic-pass' }, { notes: 42 }, { reviewerId: {} }, { reviewedAt: 'invalid' },
    { segments: [] }, { segments: [example().segments[0], example().segments[0]] }]) {
    assert.throws(() => validateAnnotation({ ...example(), ...patch }, context))
  }
  assert.throws(() => validateAnnotation(null, context))
  const unsupported = example()
  unsupported.segments[0].targetId = 'asl.alphabet.z'
  assert.throws(() => validateAnnotation(unsupported, context))
})

test('all boundaries must be finite, ordered, inside the video, and the hold inside its segment', () => {
  const invalidSegments = [
    { startMs: -1 }, { startMs: NaN }, { startMs: '1000' }, { endMs: 5001 }, { endMs: 1000 },
    { targetHold: null }, { targetHold: { startMs: 0, endMs: 3000 } },
    { targetHold: { startMs: 2000, endMs: 4500 } },
    { targetHold: { startMs: 2500, endMs: 2500 } },
    { targetHold: { startMs: 3500, endMs: 2000 } },
    { targetHold: { startMs: 2000, endMs: Infinity } },
  ]
  for (const patch of invalidSegments) {
    const data = example()
    Object.assign(data.segments[0], patch)
    assert.throws(() => validateAnnotation(data, context))
  }
})

test('seconds conversion preserves milliseconds and does not treat empty input as zero', () => {
  assert.equal(secondsToMs('1.234'), 1234)
  assert.equal(secondsToMs('0'), 0)
  for (const value of ['', ' ', 'not-a-number', null, undefined]) {
    assert.ok(Number.isNaN(secondsToMs(value)))
  }
})

test('A, S, B annotations round trip without relabeling; non-target requires a description', () => {
  for (const targetId of ['asl.alphabet.a', 'asl.alphabet.s', 'asl.alphabet.b', 'example.non-target']) {
    const data = example()
    data.segments[0].targetId = targetId
    assert.equal(validateAnnotation(JSON.parse(JSON.stringify(data)), context).segments[0].targetId, targetId)
  }
  const data = example()
  data.segments[0].targetId = 'example.non-target'
  data.notes = '   '
  assert.throws(() => validateAnnotation(data, context), /Describe/)
})
