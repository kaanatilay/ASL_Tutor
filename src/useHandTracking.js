import { useEffect, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

import { createHandPresence, updateHandPresence, getHandDisplay, HAND_SIDES } from './handPresence'
import { WASM_URL, MODEL_URL } from './recordingData'


// Convert normalized landmarks into the full, centered video's pixel coordinates.
// Matching object-fit: contain accounts for empty margins without cropping the image.
export function drawHands(canvas, video, hands) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  canvas.width = Math.round(width * window.devicePixelRatio)
  canvas.height = Math.round(height * window.devicePixelRatio)
  const context = canvas.getContext('2d')
  context.scale(window.devicePixelRatio, window.devicePixelRatio)
  context.clearRect(0, 0, width, height)
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight)
  const imageWidth = video.videoWidth * scale
  const imageHeight = video.videoHeight * scale
  const offsetX = (width - imageWidth) / 2
  const offsetY = (height - imageHeight) / 2

  for (const hand of hands) {
    const points = hand.map(point => ({ x: offsetX + point.x * imageWidth, y: offsetY + point.y * imageHeight }))
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const right = Math.max(...xs)
    const bottom = Math.max(...ys)
    const side = Math.max(right - left, bottom - top) + 24
    context.strokeStyle = '#22c55e'
    context.lineWidth = 3
    context.strokeRect((left + right - side) / 2, (top + bottom - side) / 2, side, side)

    context.strokeStyle = '#123873'
    context.lineWidth = 3
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      context.beginPath()
      context.moveTo(points[start].x, points[start].y)
      context.lineTo(points[end].x, points[end].y)
      context.stroke()
    }
    context.fillStyle = '#ef3340'
    for (const point of points) {
      context.beginPath()
      context.arc(point.x, point.y, 4, 0, Math.PI * 2)
      context.fill()
    }
  }
}

// Own the model and animation loop for one camera session. All processing is local;
// network requests download runtime/model assets only, never camera frames.
export default function useHandTracking(cameraState, videoRef, canvasRef, handSampleRef) {
  const [feedback, setFeedback] = useState('Loading hand tracker… This may take a moment on first use.')
  const [handStatus, setHandStatus] = useState([])
  useEffect(() => {
    if (cameraState !== 'on') return
    let disposed = false
    let model
    let animationId
    let lastVideoTime = -1
    let lastInference = -Infinity
    const presence = createHandPresence()
    let lastStatusTime = -Infinity
    let lastFeedback = ''
    // Defer loading feedback so the effect does not synchronously trigger a render.
    Promise.resolve().then(() => {
      if (!disposed) setFeedback('Loading hand tracker… This may take a moment on first use.')
    })

    // Limit inference to roughly 20 frames per second and skip duplicate frames.
    // Model execution is synchronous; a worker can be added if device testing shows lag.
    function tick(timestamp) {
      if (disposed) return
      try {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (video && canvas && video.readyState >= 2 && video.videoWidth > 0 &&
            video.currentTime !== lastVideoTime && timestamp - lastInference >= 50) {
          const result = model.detectForVideo(video, timestamp)
          lastVideoTime = video.currentTime
          lastInference = timestamp
          drawHands(canvas, video, result.landmarks)
          const now = performance.now()
          const snapshot = updateHandPresence(presence, result, now)
          handSampleRef.current = snapshot

        }
        // Refresh freshness warnings even if the video stops delivering frames.
        const now = performance.now()
        if (now - lastStatusTime >= 100) {
          lastStatusTime = now
          const status = HAND_SIDES.map(side => getHandDisplay(handSampleRef.current, side, now))
          setHandStatus(status)
          const count = status.filter(hand => hand.live).length
          const message = status.some(hand => hand.warning)
            ? 'Hand identification uncertain. Keep your hands clearly visible and separated; holding the last reliable pose briefly.'
            : count ? `Mirroring ${count} ${count === 1 ? 'hand' : 'hands'}. Scores indicate left/right identification, not joint accuracy.`
              : 'Tracker ready. Bring one or two hands clearly into view.'
          if (message !== lastFeedback) { lastFeedback = message; setFeedback(message) }
        }
        animationId = requestAnimationFrame(tick)
      } catch {
        handSampleRef.current = null
        setHandStatus([])
        setFeedback('Tracking stopped unexpectedly. Turn the camera off and on to retry.')
        canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      }
    }

    // Initialize only after camera permission, and close late-loading models on cleanup.
    async function start() {
      try {
        const files = await FilesetResolver.forVisionTasks(WASM_URL)
        if (disposed) return
        model = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'VIDEO', numHands: 2,
        })
        if (disposed) { model.close(); return }
        setFeedback('Tracker ready. Bring one or two hands into view.')
        animationId = requestAnimationFrame(tick)
      } catch {
        if (!disposed) setFeedback('The tracker could not load. Check your internet connection, then turn the camera off and on to retry.')
      }
    }
    start()
    return () => {
      disposed = true
      handSampleRef.current = null
      cancelAnimationFrame(animationId)
      model?.close()
    }
  }, [cameraState, videoRef, canvasRef, handSampleRef])
  return { feedback: cameraState === 'on' ? feedback : 'Enable the camera to start hand tracking.', handStatus: cameraState === 'on' ? handStatus : [] }
}



