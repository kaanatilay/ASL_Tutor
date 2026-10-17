import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3, Quaternion } from 'three'
import { normalizeHand, normalizeTargetHold } from '../src/normalization.js'

// Synthetic nondegenerate geometry exercises math independently of tracker errors.
function hand() {
  const worldLandmarks = Array.from({ length: 21 }, (_, i) => ({ x: i * .002, y: .03 + i * .003, z: i * .001 }))
  worldLandmarks[0] = { x: 0, y: 0, z: 0 }
  worldLandmarks[5] = { x: -.03, y: .06, z: 0 }
  worldLandmarks[9] = { x: -.01, y: .065, z: 0 }
  worldLandmarks[13] = { x: .01, y: .06, z: 0 }
  worldLandmarks[17] = { x: .03, y: .05, z: 0 }
  return { worldLandmarks, landmarks: [{ x: .4, y: .6, z: 0 }], handedness: [{ categoryName: 'Left', score: .95 }] }
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`) }

test('shape is invariant to translation, uniform scale, and proper 3D rotation; orientation is retained', () => {
  const source = hand()
  const before = structuredClone(source)
  const original = normalizeHand(source)
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.2)
  const transformed = structuredClone(source)
  transformed.worldLandmarks = source.worldLandmarks.map(p => {
    const v = new Vector3(p.x, p.y, p.z).multiplyScalar(2.5).applyQuaternion(rotation).add(new Vector3(.2, -.3, .8))
    return { x: v.x, y: v.y, z: v.z }
  })
  const result = normalizeHand(transformed)
  assert.equal(result.valid, true)
  original.normalizedLandmarks.forEach((p, i) => ['x', 'y', 'z'].forEach(axis => close(p[axis], result.normalizedLandmarks[i][axis])))
  close(result.scaleMeters, original.scaleMeters * 2.5)
  for (const axis of ['xAxis', 'yAxis', 'zAxis']) {
    const p = original.palmOrientation[axis]
    const expected = new Vector3(p.x, p.y, p.z).applyQuaternion(rotation)
    for (const coord of ['x', 'y', 'z']) close(result.palmOrientation[axis][coord], expected[coord])
  }
  assert.deepEqual(original.normalizedLandmarks[0], { x: 0, y: 0, z: 0 })
  assert.deepEqual(source, before)
})

test('finger differences survive normalization and handedness is never silently converted', () => {
  const source = hand()
  const changed = structuredClone(source)
  changed.worldLandmarks[4].z += .02
  changed.handedness[0] = { categoryName: 'Right', score: .6 }
  const result = normalizeHand(changed)
  assert.notDeepEqual(result.normalizedLandmarks[4], normalizeHand(source).normalizedLandmarks[4])
  assert.equal(result.handedness[0].categoryName, 'Right')
  assert.ok(result.warnings.includes('uncertain-handedness'))
})

test('missing world data, nonfinite points, collapsed palms, and collinear planes are rejected', () => {
  for (const mutate of [h => { h.worldLandmarks = [] }, h => { h.worldLandmarks[1].z = NaN },
    h => { h.worldLandmarks[17] = { ...h.worldLandmarks[5] } },
    h => { h.worldLandmarks = h.worldLandmarks.map((_, i) => ({ x: i * .01, y: 0, z: 0 })) }]) {
    const source = hand()
    mutate(source)
    const result = normalizeHand(source)
    assert.equal(result.valid, false)
    assert.equal(typeof result.reason, 'string')
    assert.equal(result.normalizedLandmarks, undefined)
  }
})

test('hold boundaries select samples without filling gaps and preserve review warnings', () => {
  const recording = { recordingId: 'rec-000001', inputSha256: 'hash', frames: [
    { timestampMs: 0, hands: [hand()] }, { timestampMs: 50, hands: [] },
    { timestampMs: 100, hands: [hand()] }, { timestampMs: 150, hands: [hand()] },
  ] }
  const annotation = { schemaVersion: 1, recordingId: recording.recordingId, inputSha256: 'hash',
    reviewStatus: 'pending', reviewerId: null, reviewedAt: null, notes: '',
    segments: [{ targetId: 'asl.alphabet.a', startMs: 0, endMs: 200, targetHold: { startMs: 50, endMs: 150 } }] }
  const output = normalizeTargetHold(recording, annotation, 200)
  assert.deepEqual(output.frames.map(frame => frame.timestampMs), [50, 100])
  assert.equal(output.frames[0].reason, 'no-hands-detected')
  assert.equal(output.summary.validSampleCount, 1)
  assert.ok(output.summary.warnings.includes('reference-not-accepted-for-use'))
  assert.throws(() => normalizeTargetHold(recording, { ...annotation, inputSha256: 'wrong' }, 200))
  const empty = structuredClone(annotation)
  empty.segments[0].targetHold = { startMs: 160, endMs: 190 }
  assert.throws(() => normalizeTargetHold(recording, empty, 200), /No extracted samples/)
})
