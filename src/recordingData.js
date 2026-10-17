// These versions describe our saved layout and the exact tracker assets used.
export const TRACKER = {
  tool: 'MediaPipe HandLandmarker', toolVersion: '1.1.0',
  modelVersion: 'hand_landmarker/float16/1',
  settings: { runningMode: 'VIDEO', numHands: 2, sampleRateHz: 20 },
}
export const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Preserve every sampled timestamp, including successful samples with no hands.
export function captureFrame(result, timestampMs) {
  return {
    timestampMs,
    hands: result.landmarks.map((points, index) => ({
      landmarks: points.map(({ x, y, z }) => ({ x, y, z })),
      worldLandmarks: (result.worldLandmarks?.[index] ?? []).map(({ x, y, z }) => ({ x, y, z })),
      handedness: (result.handedness?.[index] ?? []).map(({ categoryName, score }) => ({ categoryName, score })),
    })),
  }
}

// Reject incompatible or malformed imports before they reach the overlay renderer.
export function validateRecording(data, recordingId, sha256) {
  if (data.schemaVersion !== 1 || data.recordingId !== recordingId || data.inputSha256 !== sha256 ||
      !Array.isArray(data.frames) || !data.frames.length || data.frames.length > 100000) {
    throw new Error('Landmarks must match this recording ID and video fingerprint, with schema version 1.')
  }
  let previous = -1
  for (const frame of data.frames) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= previous ||
        !Array.isArray(frame.hands) || frame.hands.length > 2) throw new Error('Invalid frame timing or hand list.')
    previous = frame.timestampMs
    for (const hand of frame.hands) {
      if (!Array.isArray(hand.landmarks) || hand.landmarks.length !== 21 ||
          !hand.landmarks.every(point => point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis])))) {
        throw new Error('Each detected hand must contain 21 finite landmark positions.')
      }
    }
  }
  return data
}

// Show the preceding sample only within one sampling interval; never bridge long gaps.
export function frameAtTime(frames, timestampMs) {
  let low = 0
  let high = frames.length - 1
  let match = null
  while (low <= high) {
    const mid = (low + high) >> 1
    if (frames[mid].timestampMs <= timestampMs) { match = frames[mid]; low = mid + 1 }
    else high = mid - 1
  }
  return match && timestampMs - match.timestampMs <= 75 ? match : null
}
