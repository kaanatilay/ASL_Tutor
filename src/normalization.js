import { Vector3 } from 'three'
import { validateAnnotation } from './annotationData.js'

// Recipe changes require a new pipeline version; thresholds are included in exports.
export const NORMALIZATION_SETTINGS = {
  coordinateSource: 'worldLandmarks', origin: 'wrist-0',
  scale: 'distance-between-index-base-5-and-pinky-base-17',
  palmUp: 'wrist-to-mean-of-bases-5-9-13-17',
  palmAcross: 'index-base-to-pinky-base-projected-perpendicular-to-up',
  handednessConversion: 'none', smoothing: 'none', interpolation: 'none',
  minimumPalmWidthMeters: 0.00001, minimumPalmSine: 0.12,
  handednessWarningThreshold: 0.8, holdInterval: 'start-inclusive-end-exclusive',
}

// Keep estimated geometry separate from tracker handedness confidence. A usable
// palm is not proof of an accurate pose, and low handedness confidence is a warning.
export function normalizeHand(hand) {
  const warnings = []
  const handedness = hand?.handedness ?? []
  const side = handedness[0]
  if (!side || !['Left', 'Right'].includes(side.categoryName) || !Number.isFinite(side.score) ||
      side.score < NORMALIZATION_SETTINGS.handednessWarningThreshold) warnings.push('uncertain-handedness')
  const invalid = reason => ({ valid: false, reason, handedness, warnings })
  const points = hand?.worldLandmarks
  if (!Array.isArray(points) || points.length !== 21 ||
      !points.every(p => p && ['x', 'y', 'z'].every(axis => Number.isFinite(p[axis])))) return invalid('missing-or-invalid-world-landmarks')
  const vectors = points.map(p => new Vector3(p.x, p.y, p.z))
  const wrist = vectors[0]
  const across = vectors[17].clone().sub(vectors[5])
  const scaleMeters = across.length()
  if (scaleMeters < NORMALIZATION_SETTINGS.minimumPalmWidthMeters) return invalid('collapsed-palm-width')
  const up = [5, 9, 13, 17].reduce((sum, i) => sum.add(vectors[i]), new Vector3()).multiplyScalar(0.25).sub(wrist)
  if (up.length() < NORMALIZATION_SETTINGS.minimumPalmWidthMeters) return invalid('collapsed-palm-length')
  const sine = across.clone().cross(up).length() / (scaleMeters * up.length())
  if (sine < NORMALIZATION_SETTINGS.minimumPalmSine) return invalid('degenerate-palm-plane')
  const yAxis = up.normalize()
  const xAxis = across.addScaledVector(yAxis, -across.dot(yAxis)).normalize()
  const zAxis = xAxis.clone().cross(yAxis).normalize()
  const coordinates = vectors.map(point => {
    const relative = point.clone().sub(wrist).divideScalar(scaleMeters)
    return { x: relative.dot(xAxis), y: relative.dot(yAxis), z: relative.dot(zAxis) }
  })
  // Axes retain orientation in the unmirrored, unconverted source world convention.
  const object = vector => ({ x: vector.x, y: vector.y, z: vector.z })
  return { valid: true, reason: null, handedness, warnings, scaleMeters,
    normalizedLandmarks: coordinates,
    palmOrientation: { xAxis: object(xAxis), yAxis: object(yAxis), zAxis: object(zAxis) },
    imageWrist: hand.landmarks?.[0] ? { ...hand.landmarks[0] } : null }
}

// Only select annotated hold samples. Preserve missing/invalid observations without
// smoothing, inventing frames, averaging recordings, or choosing one of two hands.
export function normalizeTargetHold(recording, annotation, durationMs) {
  validateAnnotation(annotation, { recordingId: recording.recordingId, inputSha256: recording.inputSha256, durationMs })
  const hold = annotation.segments[0].targetHold
  const frames = recording.frames.filter(frame => frame.timestampMs >= hold.startMs && frame.timestampMs < hold.endMs)
    .map(frame => {
      const hands = frame.hands.map(normalizeHand)
      return { timestampMs: frame.timestampMs,
      warnings: frame.hands.length > 1 ? ['multiple-hands-review-needed'] : [],
      valid: hands.length > 0 && hands.every(hand => hand.valid),
      reason: frame.hands.length ? null : 'no-hands-detected',
      hands }
    })
  if (!frames.length) throw new Error('No extracted samples fall inside this target hold.')
  const hands = frames.flatMap(frame => frame.hands)
  const validHands = hands.filter(hand => hand.valid)
  const scales = validHands.map(hand => hand.scaleMeters)
  const labels = {}
  for (const hand of hands) {
    const label = hand.handedness[0]?.categoryName ?? 'Unknown'
    labels[label] = (labels[label] ?? 0) + 1
  }
  const warnings = []
  if (annotation.reviewStatus !== 'accepted') warnings.push('reference-not-accepted-for-use')
  if (frames.some(frame => !frame.valid)) warnings.push('missing-or-invalid-samples')
  if (frames.some(frame => frame.warnings.length)) warnings.push('multiple-hands-review-needed')
  if (hands.some(hand => hand.warnings.length)) warnings.push('uncertain-handedness')
  if (Object.keys(labels).length > 1) warnings.push('mixed-handedness-labels')
  return { frames, summary: { sampleCount: frames.length, validSampleCount: frames.filter(frame => frame.valid).length,
    missingSampleCount: frames.filter(frame => !frame.hands.length).length,
    invalidHandCount: hands.length - validHands.length, handednessCounts: labels,
    palmWidthMeters: scales.length ? { min: Math.min(...scales), max: Math.max(...scales) } : null,
    warnings } }
}
