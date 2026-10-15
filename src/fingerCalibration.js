import { TRACKED_FINGERS, getNeutralTip } from './indexFingerPose.js'
import { MathUtils } from 'three'

// Allow modest tracker/resting offsets rather than demanding every finger
// already read as straight. Deliberately curled joints still defer sampling.
export function canCalibrateFinger(angles) {
  return Array.isArray(angles) && angles.length === 3 && angles.every(Number.isFinite) &&
    Math.abs(angles[0]) <= MathUtils.degToRad(45) &&
    Math.abs(angles[1]) <= MathUtils.degToRad(40) &&
    angles[2] >= MathUtils.degToRad(-20) && angles[2] <= MathUtils.degToRad(70)
}

// The same robust median/stability test must pass for all three joints.
export function getFingerNeutral(samples) {
  if (!samples.every(row => Array.isArray(row) && row.length === 3)) return null
  const neutral = [0, 1, 2].map(i => getNeutralTip(samples.map(row => row[i])))
  return neutral.every(value => value !== null) ? neutral : null
}

// Separate state for every hand and finger prevents one occluded finger from
// clearing another's accepted neutral. Nothing is stored beyond this page.
export function createFingerCalibration() {
  return Object.fromEntries(['Left', 'Right'].map(hand => [hand,
    Object.fromEntries(TRACKED_FINGERS.map(finger => [finger,
      { neutral: null, reference: null, request: null, retryUntil: 0, retryReason: 'hold-still' }]))]))
}

// Advance at most once per distinct tracker sample. One second, ten samples,
// and stable estimates at every joint are required independently per finger.
export function advanceFingerCalibration(state, { angles, reference = null, timestamp, now }) {
  if (state.request && now - state.request.start > 2500) {
    state.request = null
    state.retryUntil = now + 1000
    state.retryReason = 'unclear'
  }
  if (state.request && !canCalibrateFinger(angles)) {
    state.request = null
    state.retryUntil = now + 750
    state.retryReason = angles ? 'hold-still' : 'unclear'
  }
  if (state.neutral == null && !state.request && now >= state.retryUntil && canCalibrateFinger(angles)) {
    state.request = { start: now, values: [], directions: [], lastSample: null }
  }
  const request = state.request
  if (!request || !angles || timestamp === request.lastSample) return
  request.values.push([...angles])
  if (reference) request.directions.push(Math.atan2(reference[0], reference[1]))
  request.lastSample = timestamp
  if (now - request.start >= 1000 && request.values.length >= 10) {
    const neutral = getFingerNeutral(request.values)
    const direction = request.directions.length ? getNeutralTip(request.directions) : null
    if (neutral !== null && (!request.directions.length || direction !== null)) {
      state.neutral = neutral
      state.reference = direction === null ? null : [Math.sin(direction), Math.cos(direction), 0]
    }
    state.request = null
    state.retryUntil = now + 1000
    state.retryReason = 'hold-still'
  }
}

// Mode/hand changes cancel unfinished collections, preserving accepted offsets.
export function cancelFingerCollections(store) {
  for (const hand of Object.values(store)) for (const state of Object.values(hand)) state.request = null
}
