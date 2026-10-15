import { MathUtils } from 'three'
import { getFingerNeutral } from './fingerCalibration.js'

// Describe the existing acceptance rules; progress is sample collection, not
// model confidence. Both elapsed time and distinct samples must reach the goal.
export function getCalibrationFeedback({ cameraOn, angles, request, calibrated, now, retryUntil = 0, retryReason = 'hold-still', finger = 'index' }) {
  if (!cameraOn) return { state: 'waiting', progress: 0, message: 'Enable the camera to begin.' }
  if (calibrated && !request) return { state: 'ready', progress: 100, message: `Calibrated. Curl and reopen your ${finger}.` }
  if (!angles || angles.length !== 3 || !angles.every(Number.isFinite)) return { state: 'unclear', progress: 0, message: `Tracking unclear. Show the whole ${finger} and palm.` }
  if (Math.abs(angles[0]) > MathUtils.degToRad(45) || Math.abs(angles[1]) > MathUtils.degToRad(40)) {
    return { state: 'straighten', progress: 0, message: `Extend your ${finger} comfortably; sideways spacing is fine.` }
  }
  if (angles[2] < MathUtils.degToRad(-20) || angles[2] > MathUtils.degToRad(70)) {
    return { state: 'unclear', progress: 0, message: 'Tip tracking unclear. Face your open palm toward the camera.' }
  }
  if (request) {
    if (request.values.length >= 10 && getFingerNeutral(request.values) === null) {
      return { state: 'hold-still', progress: 0, message: `Hold still. The ${finger} joint estimates are varying too much.` }
    }
    const fraction = Math.min(Math.max(0, now - request.start) / 1000, request.values.length / 10)
    return { state: 'sampling', progress: Math.min(99, Math.floor(fraction * 100)), message: `Keep your ${finger} comfortably extended and still. Collecting samples…` }
  }
  if (now < retryUntil) return { state: retryReason, progress: 0, message: retryReason === 'unclear' ? 'Tracking was interrupted. Keep your whole hand in view; retrying shortly.' : 'Hold still. Retrying calibration shortly.' }
  return { state: 'waiting', progress: 0, message: `Open your hand comfortably to calibrate your ${finger}. Natural spacing is fine.` }
}
