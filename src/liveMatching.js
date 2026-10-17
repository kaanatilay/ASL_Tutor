import { Matrix4, Quaternion, Vector3 } from 'three'
import { normalizeHand } from './normalization.js'
import { inspectFeatures, orientationDifference } from './comparison.js'
import { summarizeMeasurements } from './poseMeasurements.js'
import { buildPoseVector, vectorMetrics } from './poseVector.js'

export const LIVE_WINDOW = { durationMs: 1000, minimumSpanMs: 750, minimumSamples: 10, maximumGapMs: 250 }
export const LIVE_TARGETS = ['asl.alphabet.a', 'asl.alphabet.s', 'asl.alphabet.b']

// Reference preparation reuses the same import checks and hold-vector recipe as
// offline Comparison. Left-only is explicit until a handedness conversion is designed.
export function prepareLiveReference(data) {
  if (!LIVE_TARGETS.includes(data.targetId)) throw new Error('Live references must be A, S, or B letter features.')
  const inspected = inspectFeatures(data)
  if (inspected.handedness !== 'Left') throw new Error('This live experiment supports left-hand references only.')
  return { recordingId: data.recordingId, targetId: data.targetId,
    reviewStatus: data.annotation.reviewStatus, excludedCount: inspected.excludedCount,
    vector: buildPoseVector(summarizeMeasurements(inspected.samples)).values,
    meanRotation: inspected.meanRotation }
}

// Retain unique, consecutive trustworthy samples only. Loss of tracking/geometry
// clears the window, preventing old good poses from producing current live scores.
export function advanceLiveWindow(buffer, sample, now) {
  if (!sample || sample.handedness !== 'Left' || sample.score < .8 || !Number.isFinite(sample.score) ||
      !Number.isFinite(sample.timestamp) || now - sample.timestamp >= LIVE_WINDOW.maximumGapMs || sample.timestamp > now) {
    return { samples: [], ready: false, message: 'Show one confidently tracked left hand.' }
  }
  const normalized = normalizeHand({ ...sample, handedness: [{ categoryName: 'Left', score: sample.score }] })
  if (!normalized.valid) return { samples: [], ready: false, message: `Hand geometry unavailable: ${normalized.reason}.` }
  const last = buffer.at(-1)
  let samples = last && (sample.timestamp < last.timestampMs || sample.timestamp - last.timestampMs > LIVE_WINDOW.maximumGapMs) ? [] : buffer
  samples = samples.filter(s => now - s.timestampMs <= LIVE_WINDOW.durationMs)
  if (samples.at(-1)?.timestampMs !== sample.timestamp) {
    const axes = normalized.palmOrientation
    const v = key => new Vector3(axes[key].x, axes[key].y, axes[key].z)
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(v('xAxis'), v('yAxis'), v('zAxis'))).normalize()
    samples = [...samples, { timestampMs: sample.timestamp, points: normalized.normalizedLandmarks, q }]
  }
  const span = samples.length ? samples.at(-1).timestampMs - samples[0].timestampMs : 0
  const ready = samples.length >= LIVE_WINDOW.minimumSamples && span >= LIVE_WINDOW.minimumSpanMs
  return { samples, ready, message: ready ? 'Live rolling-hold comparison.' : 'Hold your pose briefly to collect a fresh comparison window.' }
}

// Rank the selected letter's references independently for both methods. Report
// reference IDs so differing best candidates do not masquerade as one comparison.
export function matchLiveWindow(samples, references) {
  if (!references.length) throw new Error('Load reference features for the selected letter.')
  const vector = buildPoseVector(summarizeMeasurements(samples)).values
  const matches = references.map(reference => ({ reference, ...vectorMetrics(vector, reference.vector) }))
  const cosine = matches.reduce((best, candidate) => candidate.cosineSimilarity > best.cosineSimilarity ? candidate : best)
  const euclidean = matches.reduce((best, candidate) => candidate.scaledEuclideanDistance < best.scaledEuclideanDistance ? candidate : best)
  return { cosine: { value: cosine.cosineSimilarity, referenceId: cosine.reference.recordingId },
    euclidean: { value: euclidean.scaledEuclideanDistance, referenceId: euclidean.reference.recordingId },
    // Current orientation is reported separately, against the Euclidean-best reference.
    orientationDegrees: orientationDifference(samples.at(-1).q, euclidean.reference.meanRotation) }
}
