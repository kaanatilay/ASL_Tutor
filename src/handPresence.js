export const HAND_SIDES = ['Left', 'Right']
export const HAND_GRACE_MS = 700

// Scores describe left/right classification, not joint accuracy. Require three
// good detections to appear, then use a lower threshold to avoid flickering.
export function createHandPresence() {
  return Object.fromEntries(HAND_SIDES.map(side => [side, { sample: null, score: null, streak: 0, tracked: false, reason: 'missing' }]))
}

function validPoints(points) {
  return points?.length === 21 && points.every(point => point && [point.x, point.y, point.z].every(Number.isFinite))
}

// Duplicate labels are ambiguous: never drive two models from the same side.
// Uncertain samples cannot update a model or contribute calibration samples.
export function updateHandPresence(store, result, now) {
  for (const side of HAND_SIDES) {
    const state = store[side]
    const indices = (result.handedness ?? []).flatMap((categories, i) => categories[0]?.categoryName === side ? [i] : [])
    const i = indices[0]
    const score = result.handedness?.[i]?.[0]?.score
    const valid = indices.length === 1 && validPoints(result.landmarks?.[i]) && validPoints(result.worldLandmarks?.[i])
    const continuing = state.sample && now - state.sample.timestamp <= HAND_GRACE_MS
    const accepted = valid && Number.isFinite(score) && score >= (continuing ? 0.65 : 0.8)
    state.score = indices.length === 1 && Number.isFinite(score) ? score : null
    state.streak = accepted ? state.streak + 1 : 0
    state.tracked = Boolean(accepted && (continuing || state.streak >= 3))
    state.reason = !indices.length ? 'missing' : indices.length > 1 ? 'ambiguous' : !valid ? 'landmarks' : 'identification'
    if (accepted && !state.tracked) state.reason = 'acquiring'
    if (state.tracked) {
      state.reason = 'tracked'
      state.sample = { landmarks: result.landmarks[i], worldLandmarks: result.worldLandmarks[i], handedness: side, score, timestamp: now }
    }
  }
  // Copy metadata so the renderer never observes a partially updated snapshot.
  return Object.fromEntries(HAND_SIDES.map(side => [side, { ...store[side] }]))
}

// A dead inference loop cannot keep an old hand marked as actively tracked.
// Display may hold a pose briefly, but calibration only uses fresh good data.
export function getHandDisplay(snapshot, side, now, cameraOn = true) {
  const state = snapshot?.[side]
  const age = state?.sample ? now - state.sample.timestamp : Infinity
  const visible = Boolean(cameraOn && age <= HAND_GRACE_MS)
  const live = Boolean(visible && state.tracked && age < 250)
  return { side, visible, live, sample: live ? state.sample : null,
    state: live ? 'tracked' : visible ? 'holding' : 'hidden', score: state?.score ?? null,
    warning: Boolean(cameraOn && (visible && !live || state && !['missing', 'acquiring'].includes(state.reason) && !live)) }
}
