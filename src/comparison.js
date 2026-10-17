import { Matrix4, Quaternion, Vector3 } from 'three'
import { NORMALIZATION_SETTINGS } from './normalization.js'
import { compareMeasurements } from './poseMeasurements.js'
import { comparePoseVectors } from './poseVector.js'
import { isSupportedTarget, NON_TARGET_ID } from './vocabulary.js'

export const FINGER_GROUPS = {
  Thumb: [1, 2, 3, 4], Index: [5, 6, 7, 8], Middle: [9, 10, 11, 12],
  Ring: [13, 14, 15, 16], Pinky: [17, 18, 19, 20],
}
const vector = p => new Vector3(p.x, p.y, p.z)
const finitePoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]))
// Object key order has no semantic meaning in a JSON settings record.
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))))
export function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const low = Math.floor(position)
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const shapeDistance = (a, b, indices = Object.values(FINGER_GROUPS).flat()) =>
  indices.reduce((sum, i) => sum + distance(a[i], b[i]), 0) / indices.length

// Unit, perpendicular, right-handed axes are required for meaningful rotation angles.
function rotation(orientation) {
  if (!orientation || !['xAxis', 'yAxis', 'zAxis'].every(k => finitePoint(orientation[k]))) throw new Error('Missing palm orientation axes.')
  const [x, y, z] = ['xAxis', 'yAxis', 'zAxis'].map(k => vector(orientation[k]))
  if ([x, y, z].some(v => Math.abs(v.length() - 1) > .0001) ||
      [x.dot(y), y.dot(z), z.dot(x)].some(v => Math.abs(v) > .0001) || x.clone().cross(y).dot(z) < .9999) {
    throw new Error('Palm orientation axes must form an orthonormal, right-handed basis.')
  }
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).normalize()
}
// Clamp tiny floating-point discrepancies so identical orientations report zero.
export function orientationDifference(a, b) {
  const dot = Math.min(1, Math.abs(a.dot(b)))
  return dot > 1 - 1e-14 ? 0 : 2 * Math.acos(dot) * 180 / Math.PI
}

// Validate imports before computing. This inspector supports one confidently labeled
// hand per sample; ambiguous samples are counted as exclusions rather than guessed.
export function inspectFeatures(data) {
  if (!data || data.schemaVersion !== 1 || data.pipelineVersion !== 'pipeline-v001' ||
      canonical(data.settings) !== canonical(NORMALIZATION_SETTINGS) || !isSupportedTarget(data.targetId) ||
      !/^rec-\d{6}$/.test(data.recordingId ?? '') || !Array.isArray(data.frames) ||
      !data.frames.length || data.frames.length > 5000) throw new Error('Expected pipeline-v001 features for A, S, B, or a non-target example, with 1–5000 samples and matching settings.')
  const annotation = data.annotation
  const hold = annotation?.segments?.[0]?.targetHold
  if (annotation?.recordingId !== data.recordingId || annotation?.inputSha256 !== data.inputs?.videoSha256 ||
      typeof data.inputs?.videoSha256 !== 'string' || !data.inputs.videoSha256.length ||
      annotation.schemaVersion !== 1 || annotation.segments?.length !== 1 || annotation.segments[0].targetId !== data.targetId ||
      !['pending', 'accepted', 'rejected'].includes(annotation.reviewStatus) ||
      !hold || !Number.isFinite(hold.startMs) || !Number.isFinite(hold.endMs) || hold.startMs >= hold.endMs) {
    throw new Error('Features have inconsistent annotation or video identity.')
  }
  const samples = []
  if (data.targetId === NON_TARGET_ID && (typeof annotation.notes !== 'string' || !annotation.notes.trim())) {
    throw new Error('Non-target examples require a description of the selected pose.')
  }
  const labels = new Set()
  let previous = -1
  for (const frame of data.frames) {
    if (typeof frame.valid !== 'boolean' || !Number.isFinite(frame.timestampMs) || frame.timestampMs <= previous || frame.timestampMs < hold.startMs ||
        frame.timestampMs >= hold.endMs || !Array.isArray(frame.hands) || frame.hands.length > 2) throw new Error('Invalid sample timing or hand list.')
    previous = frame.timestampMs
    for (const hand of frame.hands) {
      if (hand.valid !== true && hand.valid !== false) throw new Error('Missing hand validity flag.')
      if (!hand.valid) continue
      if (!Array.isArray(hand.normalizedLandmarks) || hand.normalizedLandmarks.length !== 21 ||
          !hand.normalizedLandmarks.every(finitePoint)) throw new Error('Expected 21 finite normalized joint positions.')
      const q = rotation(hand.palmOrientation)
      const label = hand.handedness?.[0]
      if (frame.valid && frame.hands.length === 1 && ['Left', 'Right'].includes(label?.categoryName) &&
          Number.isFinite(label.score) && label.score >= .8 && label.score <= 1) {
        labels.add(label.categoryName)
        samples.push({ timestampMs: frame.timestampMs, points: hand.normalizedLandmarks, q })
      }
    }
  }
  if (!samples.length) throw new Error('No usable single-hand samples with handedness confidence of at least 0.80.')
  if (labels.size !== 1) throw new Error('Mixed handedness labels: inspect tracking before comparison.')
  // Coordinate medians summarize the complete hold, but are not asserted to be a
  // physically realizable hand. Display the nearest actual sample instead.
  const center = Array.from({ length: 21 }, (_, i) => Object.fromEntries(['x', 'y', 'z'].map(axis =>
    [axis, quantile(samples.map(s => s.points[i][axis]), .5)])))
  const representative = samples.reduce((best, sample) => shapeDistance(sample.points, center) < shapeDistance(best.points, center) ? sample : best)
  // Hemisphere-align quaternion signs before an arithmetic mean. This first
  // orientation summary assumes a held pose; report spread to expose broad motion.
  const reference = samples[0].q
  const sum = [0, 0, 0, 0]
  for (const sample of samples) {
    const sign = sample.q.dot(reference) < 0 ? -1 : 1
    sample.q.toArray().forEach((v, i) => { sum[i] += sign * v })
  }
  const meanRotation = new Quaternion(...sum).normalize()
  return { data, samples, center, representative, meanRotation, handedness: [...labels][0],
    excludedCount: data.frames.length - samples.length,
    shapeSpread: quantile(samples.map(s => shapeDistance(s.points, center)), .9),
    orientationSpread: quantile(samples.map(s => orientationDifference(s.q, meanRotation)), .9) }
}

// Difference metrics are symmetric descriptions, not probabilities or correctness scores.
export function compareFeatures(first, second) {
  const a = inspectFeatures(first)
  const b = inspectFeatures(second)
  if (a.handedness !== b.handedness) throw new Error('Different handedness is not supported; no automatic reflection is applied.')
  const perFinger = Object.entries(FINGER_GROUPS).map(([finger, indices]) => ({ finger,
    difference: shapeDistance(a.center, b.center, indices),
    spreadA: quantile(a.samples.map(s => shapeDistance(s.points, a.center, indices)), .9),
    spreadB: quantile(b.samples.map(s => shapeDistance(s.points, b.center, indices)), .9) }))
  const measurements = compareMeasurements(a.samples, b.samples)
  return { a, b, perFinger, shapeDifference: shapeDistance(a.center, b.center),
    measurements, vectorMatch: comparePoseVectors(measurements),
    orientationDegrees: orientationDifference(a.meanRotation, b.meanRotation) }
}
