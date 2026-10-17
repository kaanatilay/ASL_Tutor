import { useEffect, useRef } from 'react'
import { getHandDisplay } from './handPresence'
import { guidePlacement } from './silhouette'

// A separate canvas avoids changing the existing tracking/3D rendering pipeline.
// Match the webcam's CSS reflection once; retain the reference contour orientation.
export default function SilhouetteOverlay({ guide, videoRef, handSampleRef }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    let animation, smooth = null, previousTime = null
    const render = now => {
      const canvas = canvasRef.current, video = videoRef.current
      if (!canvas || !video) return
      const width = canvas.clientWidth, height = canvas.clientHeight
      const ratio = window.devicePixelRatio || 1
      const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio)
      const resized = canvas.width !== pixelWidth || canvas.height !== pixelHeight
      if (resized) { canvas.width = pixelWidth; canvas.height = pixelHeight; smooth = null }
      const context = canvas.getContext('2d')
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height)
      const hand = getHandDisplay(handSampleRef.current, 'Left', now)
      const placement = hand.live && hand.sample?.score >= .8
        ? guidePlacement(hand.sample.landmarks, video.videoWidth, video.videoHeight, width, height) : null
      if (!placement) smooth = null
      else {
        const blend = previousTime === null ? 1 : 1 - Math.exp(-Math.min(now - previousTime, 100) / 120)
        smooth = smooth ? Object.fromEntries(['x', 'y', 'scale'].map(k => [k, smooth[k] + (placement[k] - smooth[k]) * blend])) : placement
        context.lineJoin = 'round'; context.lineCap = 'round'; context.lineWidth = 2
        context.strokeStyle = '#91f3ec'; context.setLineDash([1, 6]); context.beginPath()
        guide.points.forEach((p, i) => {
          const x = smooth.x + p.x * smooth.scale, y = smooth.y + p.y * smooth.scale
          if (i) context.lineTo(x, y); else context.moveTo(x, y)
        })
        context.closePath(); context.stroke()
      }
      previousTime = now
      animation = requestAnimationFrame(render)
    }
    animation = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animation)
  }, [guide, videoRef, handSampleRef])
  return <canvas ref={canvasRef} className="hand-overlay silhouette-overlay" aria-hidden="true" />
}
