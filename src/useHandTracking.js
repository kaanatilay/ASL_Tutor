import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

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
export default function useHandTracking(cameraState, videoRef, canvasRef, handSampleRef, selectedHand) {
  const [feedback, setFeedback] = useState('Loading hand tracker… This may take a moment on first use.')
  const selectionRef = useRef(selectedHand)
  // Selection changes do not reload the model or restart camera permission.
  useEffect(() => {
    selectionRef.current = selectedHand
    handSampleRef.current = null
  }, [selectedHand, handSampleRef])
  useEffect(() => {
    if (cameraState !== 'on') return
    let disposed = false
    let model
    let animationId
    let lastVideoTime = -1
    let lastInference = -Infinity
    let lastCount = -1
    let selectedSide = null
    let previousSelection = null
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
          const count = result.landmarks.length
          // Hold onto one handedness while it is present; never silently jump
          // to the other hand when the selected one leaves the camera.
          if (previousSelection !== selectionRef.current) {
            previousSelection = selectionRef.current
            selectedSide = previousSelection === 'auto' ? null : previousSelection
          }
          if (!selectedSide && count) selectedSide = result.handedness[0]?.[0]?.categoryName
          const index = result.handedness.findIndex(categories => categories[0]?.categoryName === selectedSide)
          handSampleRef.current = index >= 0 ? {
            landmarks: result.landmarks[index],
            worldLandmarks: result.worldLandmarks[index],
            handedness: selectedSide,
            timestamp: performance.now(),
          } : null
          if (count !== lastCount) {
            lastCount = count
            setFeedback(count ? `Tracking ${count} ${count === 1 ? 'hand' : 'hands'}. Letter recognition is coming later.` : 'Tracker ready. Bring one or two hands into view.')
          }
        }
        animationId = requestAnimationFrame(tick)
      } catch {
        handSampleRef.current = null
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
  return cameraState === 'on' ? feedback : 'Enable the camera to start hand tracking.'
}



