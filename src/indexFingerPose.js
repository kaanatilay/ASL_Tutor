import { MathUtils, Vector3 } from 'three'

// Base flexion excludes sideways spread. Middle/tip hinge magnitudes use full
// 3D segments so an imperfect estimated palm plane cannot flatten a real curl.
export const TRACKED_FINGERS = ['Index', 'Middle', 'Ring', 'Pinky']
const FINGER_POINTS = { Index: [5, 6, 7, 8], Middle: [9, 10, 11, 12], Ring: [13, 14, 15, 16], Pinky: [17, 18, 19, 20] }

// Save a finger's natural sideways direction in palm-local coordinates. Only
// its direction along the palm plane is captured here; curl is measured below.
export function getFingerReference(sample, palmRotation, finger = 'Index') {
  const indices = FINGER_POINTS[finger]
  const points = sample?.worldLandmarks
  if (!indices || !palmRotation || ![indices[0], indices[1]].every(i =>
    points?.[i] && [points[i].x, points[i].y, points[i].z].every(Number.isFinite))) return null
  const a = points[indices[0]], b = points[indices[1]]
  const direction = new Vector3(a.x - b.x, a.y - b.y, a.z - b.z)
    .applyQuaternion(palmRotation.clone().invert())
  direction.z = 0
  if (direction.lengthSq() < 1e-10 || direction.y <= 0) return null
  return direction.normalize().toArray()
}

export function getFingerAngles(sample, palmRotation, finger = 'Index', reference = null) {
  const points = sample?.worldLandmarks
  const indices = FINGER_POINTS[finger]
  if (!indices || !palmRotation || !points || ![0, ...indices].every(i => points[i] &&
    [points[i].x, points[i].y, points[i].z].every(Number.isFinite))) return null
  const normal = new Vector3(0, 0, 1).applyQuaternion(palmRotation)
  const toViewer = i => new Vector3(-points[i].x, -points[i].y, -points[i].z)
  const joints = [0, ...indices].map(toViewer)
  const segments = joints.slice(1).map((joint, i) => joint.clone().sub(joints[i]))
  if (segments.some(direction => direction.lengthSq() < 1e-10)) return null
  segments.forEach(direction => direction.normalize())
  // Each finger has its own hinge plane. Natural fan-shaped spacing must not
  // be interpreted as curl, even when the palm is rotated in the camera view.
  const forward = reference ? new Vector3().fromArray(reference).applyQuaternion(palmRotation) : segments[0].clone()
  forward.addScaledVector(normal, -forward.dot(normal))
  if (forward.lengthSq() < 1e-10) return null
  forward.normalize()
  const right = forward.clone().cross(normal).normalize()
  return [0, 1, 2].map(i => {
    const incoming = segments[i]
    const outgoing = segments[i + 1]
    if (i > 0) {
      const cosine = MathUtils.clamp(incoming.dot(outgoing), -1, 1)
      const magnitude = Math.acos(cosine)
      const cross = incoming.clone().cross(outgoing)
      // Use the palm only for the bend direction, never its magnitude. When
      // the direction is nearly perpendicular to the estimated hinge axis,
      // prefer inward flexion instead of zeroing an otherwise valid 3D bend.
      const direction = cross.lengthSq() > 1e-10 ? cross.normalize().dot(right) : 0
      return direction < -0.25 ? -magnitude : magnitude
    }
    const projectedIn = forward.clone()
    const projectedOut = outgoing.clone().addScaledVector(right, -outgoing.dot(right))
    if (projectedIn.lengthSq() < 1e-10 || projectedOut.lengthSq() < 1e-10) return 0
    projectedIn.normalize()
    projectedOut.normalize()
    const sine = projectedIn.clone().cross(projectedOut).dot(right)
    return Math.atan2(sine, MathUtils.clamp(projectedIn.dot(projectedOut), -1, 1))
  })
}

// Preserve the tested index API while all four fingers share the same mapping.
export function getIndexFingerAngles(sample, palmRotation) {
  return getFingerAngles(sample, palmRotation, 'Index')
}

// Subtract a user-recorded neutral angle before applying tip noise suppression.
// Retain raw angles separately so diagnostics show what the tracker estimated.
export function mapIndexFingerBends(angles, neutralTip = 0) {
  if (!angles || angles.length !== 3 || !angles.every(Number.isFinite) || !Number.isFinite(neutralTip)) return null
  const limits = [90, 110, 85].map(MathUtils.degToRad)
  return limits.map((limit, i) => {
    const angle = angles[i] - (i === 2 ? neutralTip : 0)
    if (i === 2) {
      // Fingertip depth is particularly noisy near a straight finger. Treat
      // estimates through 10 degrees as straight, then smoothly restore the
      // measured bend by 25 degrees so crossing the threshold cannot snap.
      // These initial tolerances need webcam review; other joints are unchanged.
      const blend = MathUtils.smoothstep(angle, MathUtils.degToRad(10), MathUtils.degToRad(25))
      return MathUtils.clamp(angle, 0, limit) * blend
    }
    return angle < MathUtils.degToRad(2) ? 0 : Math.min(angle, limit)
  })
}

// A comfortable open pose supplies one offset per joint. Remap the remaining
// range continuously so the reference is zero yet a measured 90-degree bend
// still reaches 90 degrees. There is no extra tip dead zone after calibration.
export function mapFingerBends(angles, neutral = null) {
  if (neutral == null) return mapIndexFingerBends(angles)
  if (!angles || angles.length !== 3 || !angles.every(Number.isFinite) ||
      !Array.isArray(neutral) || neutral.length !== 3 || !neutral.every(Number.isFinite)) return null
  return angles.map((angle, i) => {
    const anchor = Math.PI / 2
    const corrected = angle <= anchor ? (angle - neutral[i]) * anchor / (anchor - neutral[i]) : angle
    const limit = MathUtils.degToRad([90, 110, 85][i])
    const blend = MathUtils.smoothstep(corrected, 0, MathUtils.degToRad(4))
    return MathUtils.clamp(corrected, 0, limit) * blend
  })
}

export function getIndexFingerBends(sample, palmRotation, neutralTip = 0) {
  return mapIndexFingerBends(getIndexFingerAngles(sample, palmRotation), neutralTip)
}

// Median resists occasional depth spikes. Reject a moving hand rather than
// silently treating a mixture of straight and bent frames as the neutral pose.
export function getNeutralTip(samples) {
  if (samples.length < 10 || !samples.every(Number.isFinite)) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const low = sorted[Math.floor(sorted.length * 0.1)]
  const high = sorted[Math.ceil(sorted.length * 0.9) - 1]
  if (high - low > MathUtils.degToRad(15)) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// A startup hint, not proof of a straight fingertip: require the other index
// joints near extension before sampling. The user is prompted to hold it open.
export function canAutoCalibrateIndex(angles) {
  return Array.isArray(angles) && angles.length === 3 && angles.every(Number.isFinite) &&
    Math.abs(angles[0]) <= MathUtils.degToRad(15) &&
    Math.abs(angles[1]) <= MathUtils.degToRad(15) &&
    angles[2] >= MathUtils.degToRad(-20) && angles[2] <= MathUtils.degToRad(70)
}
