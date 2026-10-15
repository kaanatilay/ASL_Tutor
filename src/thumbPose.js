import { MathUtils, Quaternion, Vector3 } from 'three'
import { getNeutralTip } from './indexFingerPose.js'

const UP = new Vector3(0, 1, 0)

// Locate the CMC (thumb root) relative to the wrist, in palm-local coordinates.
// Dividing by knuckle width removes hand size and camera-distance scale changes.
// Missing palm anchors disable translation only; thumb rotation can still work.
export function getThumbRootMeasurement(sample, palmRotation) {
  const points = sample?.worldLandmarks
  if (!palmRotation || !['Left', 'Right'].includes(sample?.handedness) ||
      ![0, 1, 5, 17].every(i => points?.[i] &&
        [points[i].x, points[i].y, points[i].z].every(Number.isFinite))) return null
  const point = i => new Vector3(-points[i].x, -points[i].y, -points[i].z)
  const width = point(5).distanceTo(point(17))
  if (width < 1e-5) return null
  const root = point(1).sub(point(0)).applyQuaternion(palmRotation.clone().invert()).divideScalar(width)
  root.x *= sample.handedness === 'Left' ? -1 : 1
  return root.toArray()
}

// A small damped displacement supplements rotations, never moves the palm,
// and never changes finger lengths. Caps are fractions of the model palm width;
// depth is deliberately weaker because monocular depth estimates are noisy.
export function getThumbRootOffset(measurement, neutral, modelPalmWidth) {
  const root = measurement?.root
  if (!Array.isArray(root) || root.length !== 3 || !root.every(Number.isFinite) ||
      !Number.isFinite(modelPalmWidth) || modelPalmWidth <= 0) return null
  if (!neutral) return new Vector3()
  if (!Array.isArray(neutral.root) || neutral.root.length !== 3 || !neutral.root.every(Number.isFinite)) return null
  const offset = new Vector3().fromArray(root).sub(new Vector3().fromArray(neutral.root))
  const caps = [0.12, 0.08, 0.06]
  offset.set(...offset.toArray().map((value, i) => MathUtils.clamp(value * (i === 2 ? 0.35 : 0.65), -caps[i], caps[i])))
  offset.clampLength(0, 0.14).multiplyScalar(modelPalmWidth)
  return offset
}

// Express the three thumb segments in the palm's frame, undoing the viewer's
// left-hand reflection. Wrist motion then cannot masquerade as thumb motion.
export function getThumbMeasurement(sample, palmRotation) {
  const points = sample?.worldLandmarks
  if (!palmRotation || !['Left', 'Right'].includes(sample?.handedness) ||
      ![1, 2, 3, 4].every(i => points?.[i] &&
        [points[i].x, points[i].y, points[i].z].every(Number.isFinite))) return null
  const inverse = palmRotation.clone().invert()
  const side = sample.handedness === 'Left' ? -1 : 1
  const segments = [1, 2, 3].map(i => {
    const a = points[i], b = points[i + 1]
    const direction = new Vector3(a.x - b.x, a.y - b.y, a.z - b.z).applyQuaternion(inverse)
    direction.x *= side
    return direction
  })
  if (segments.some(segment => segment.lengthSq() < 1e-10)) return null
  segments.forEach(segment => segment.normalize())
  return {
    root: getThumbRootMeasurement(sample, palmRotation),
    direction: segments[0].toArray(),
    segments: segments.map(segment => segment.toArray()),
    bends: [segments[0].angleTo(segments[1]), segments[1].angleTo(segments[2])],
  }
}

export function createThumbCalibration() {
  return { neutral: null, request: null, retryUntil: 0, retryReason: 'hold-still' }
}

// Require a comfortably open thumb and stable measurements. These are startup
// heuristics, not proof of an anatomical pose or per-joint tracking confidence.
export function canCalibrateThumb(measurement) {
  return validMeasurement(measurement) && measurement.direction[0] < -0.15 &&
    measurement.direction[1] > -0.4 && Math.abs(measurement.direction[2]) < 0.65 &&
    measurement.bends[0] < MathUtils.degToRad(40) && measurement.bends[1] < MathUtils.degToRad(50)
}

function validMeasurement(measurement) {
  return measurement?.direction?.length === 3 && measurement.direction.every(Number.isFinite) &&
    new Vector3().fromArray(measurement.direction).lengthSq() > 1e-10 &&
    measurement?.bends?.length === 2 && measurement.bends.every(Number.isFinite) &&
    measurement?.segments?.length === 3 && measurement.segments.every(segment =>
      segment.length === 3 && segment.every(Number.isFinite) && new Vector3().fromArray(segment).lengthSq() > 1e-10)
}

// Check all bend and base-direction components, so a moving thumb cannot
// finish calibration merely because its two hinge angles happened to be steady.
export function getThumbNeutral(values) {
  if (values.length < 10 || !values.every(validMeasurement)) return null
  const bends = [0, 1].map(i => getNeutralTip(values.map(value => value.bends[i])))
  const direction = new Vector3()
  for (const value of values) direction.add(new Vector3().fromArray(value.direction))
  if (direction.lengthSq() < 1e-10 || bends.some(value => value === null)) return null
  direction.normalize()
  const deviations = values.map(value => direction.angleTo(new Vector3().fromArray(value.direction))).sort((a, b) => a - b)
  if (deviations[Math.ceil(values.length * 0.9) - 1] > MathUtils.degToRad(8)) return null
  const segments = [0, 1, 2].map(i => {
    const average = values.reduce((sum, value) => sum.add(new Vector3().fromArray(value.segments[i])), new Vector3()).normalize()
    const deviations = values.map(value => average.angleTo(new Vector3().fromArray(value.segments[i]))).sort((a, b) => a - b)
    return deviations[Math.ceil(values.length * 0.9) - 1] <= MathUtils.degToRad(8) ? average.toArray() : null
  })
  if (segments.some(segment => segment === null)) return null
  // Accept a root reference only when all collected frames have valid anchors.
  // An unstable root blocks this collection rather than saving a moving base.
  const roots = values.map(value => value.root)
  let root = null
  if (roots.some(value => value != null)) {
    if (!roots.every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))) return null
    root = [0, 1, 2].map(i => {
      const sorted = roots.map(value => value[i]).sort((a, b) => a - b)
      if (sorted[Math.ceil(sorted.length * 0.9) - 1] - sorted[Math.floor(sorted.length * 0.1)] > 0.04) return null
      const middle = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
    })
    if (root.some(value => value === null)) return null
  }
  return { direction: direction.toArray(), bends, segments, root }
}

// Save one reference for each hand in the viewer. Tracking loss only cancels
// unfinished collection; accepted references remain until explicitly reset.
export function advanceThumbCalibration(state, { measurement, timestamp, now }) {
  if (state.request && (now - state.request.start > 2500 || !canCalibrateThumb(measurement))) {
    state.request = null
    state.retryUntil = now + 750
    state.retryReason = measurement ? 'hold-still' : 'unclear'
  }
  if (state.neutral || now < state.retryUntil) return
  if (!state.request && canCalibrateThumb(measurement)) {
    state.request = { start: now, values: [], lastSample: null }
  }
  const request = state.request
  if (!request || !measurement || timestamp === request.lastSample) return
  request.values.push({ direction: [...measurement.direction], bends: [...measurement.bends],
    segments: measurement.segments.map(segment => [...segment]), root: measurement.root ? [...measurement.root] : null })
  request.lastSample = timestamp
  if (now - request.start >= 1000 && request.values.length >= 10) {
    state.neutral = getThumbNeutral(request.values)
    state.request = null
    state.retryUntil = now + 1000
    state.retryReason = 'hold-still'
  }
}

// Calibration may remove a small resting discrepancy, but must not rotate all
// future poses onto the authored open pose. Limit that correction to 12 degrees
// and fade it away as each segment leaves its calibrated direction (10–40°).
// A folded segment therefore keeps its measured direction across the palm.
export function getThumbDirections(measurement, neutral, restRotations) {
  if (!validMeasurement(measurement) || restRotations?.length !== 3 || !restRotations.every(q => q?.isQuaternion)) return null
  const authored = new Quaternion()
  return restRotations.map((rest, i) => {
    authored.multiply(rest)
    const raw = new Vector3().fromArray(measurement.segments[i]).normalize()
    const saved = neutral?.segments?.[i]
    if (!saved) return raw
    const reference = new Vector3().fromArray(saved).normalize()
    const authoredDirection = UP.clone().applyQuaternion(authored)
    const correction = new Quaternion().setFromUnitVectors(reference, authoredDirection)
    const angle = correction.angleTo(new Quaternion())
    const weight = 1 - MathUtils.smoothstep(raw.angleTo(reference), MathUtils.degToRad(10), MathUtils.degToRad(40))
    const fraction = angle > 1e-10 ? Math.min(1, MathUtils.degToRad(12) / angle) * weight : 0
    return raw.applyQuaternion(new Quaternion().slerp(correction, fraction))
  })
}

// Follow all three measured segment directions, instead of reducing the last
// two to unsigned angles around fixed axes. Each target is converted into its
// moving parent's frame, so a fold across the palm keeps its actual direction.
// A minimum swing preserves authored roll as far as segment-only data allows;
// rotations around the segment itself cannot be measured from these points.
export function getThumbTargets(measurement, neutral, restRotations) {
  const directions = getThumbDirections(measurement, neutral, restRotations)
  if (!directions) return null
  const targetParent = new Quaternion()
  return restRotations.map((rest, i) => {
    const desired = directions[i].clone()
    desired.applyQuaternion(targetParent.clone().invert())
    const restLocalDirection = UP.clone().applyQuaternion(rest)
    const swing = new Quaternion().setFromUnitVectors(restLocalDirection, desired.normalize())
    const angle = swing.angleTo(new Quaternion())
    const limit = MathUtils.degToRad(i === 0 ? 110 : 120)
    if (angle > limit) swing.slerp(new Quaternion(), 1 - limit / angle)
    const target = swing.multiply(rest)
    targetParent.multiply(target)
    return target
  })
}

export function getThumbFeedback({ cameraOn, measurement, state, now }) {
  if (!cameraOn) return { state: 'waiting', progress: 0, message: 'Enable the camera to begin.' }
  if (state.neutral) return { state: 'ready', progress: 100, message: 'Thumb calibrated. Try curling and moving across your palm.' }
  if (!measurement) return { state: 'unclear', progress: 0, message: 'Show the whole thumb and palm clearly.' }
  if (!canCalibrateThumb(measurement)) return { state: 'straighten', progress: 0, message: 'Extend your thumb comfortably away from your palm to calibrate.' }
  if (state.request) {
    if (state.request.values.length >= 10 && !getThumbNeutral(state.request.values)) {
      return { state: 'hold-still', progress: 0, message: 'Keep the open thumb still; its base position or joints are varying.' }
    }
    return { state: 'sampling', progress: Math.min(99, Math.floor(100 * Math.min((now - state.request.start) / 1000, state.request.values.length / 10))),
      message: 'Keep your thumb comfortably open and still. Collecting samples…' }
  }
  return { state: now < state.retryUntil ? state.retryReason : 'waiting', progress: 0,
    message: 'Open your thumb comfortably away from the palm and hold still.' }
}
