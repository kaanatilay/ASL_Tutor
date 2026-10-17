import { useState } from 'react'
import { extractSilhouette, validateGuide } from './silhouette.js'
import { targetLabel } from './vocabulary.js'

// Build only from a loaded, fingerprint-matched letter annotation. Pixels are read from
// the local video element; only contour geometry is exported or sent to Practice.
export default function SilhouetteBuilder({ videoRef, recording, annotation, disabled, onExport, onGuide }) {
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Build an outline from the middle of the annotated hold, then inspect it before using it.')
  const targetId = annotation.segments[0].targetId
  const label = targetLabel(targetId)
  const eligible = ['asl.alphabet.a', 'asl.alphabet.s', 'asl.alphabet.b'].includes(targetId)

  async function build() {
    setBusy(true)
    setResult(null)
    const video = videoRef.current
    try {
      const hold = annotation.segments[0].targetHold
      const frames = recording.frames.filter(f => f.timestampMs >= hold.startMs && f.timestampMs < hold.endMs &&
        f.hands.length === 1 && f.hands[0].handedness?.[0]?.categoryName === 'Left' && f.hands[0].handedness[0].score >= .8)
      if (!frames.length) throw new Error('No confident single left-hand samples in this hold.')
      const midpoint = (hold.startMs + hold.endMs) / 2
      const frame = frames.reduce((best, f) => Math.abs(f.timestampMs - midpoint) < Math.abs(best.timestampMs - midpoint) ? f : best)
      video.pause()
      if (Math.abs(video.currentTime - frame.timestampMs / 1000) > .000001 || video.readyState < 2) {
        await new Promise((resolve, reject) => {
          const finish = error => {
            clearTimeout(timer)
            video.removeEventListener('seeked', success)
            video.removeEventListener('error', failure)
            if (error) reject(error); else resolve()
          }
          const success = () => finish()
          const failure = () => finish(new Error('Could not decode reference frame.'))
          const timer = setTimeout(() => finish(new Error('Reference frame seek timed out.')), 10000)
          video.addEventListener('seeked', success, { once: true })
          video.addEventListener('error', failure, { once: true })
          video.currentTime = frame.timestampMs / 1000
        })
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(640, video.videoWidth)
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const extracted = extractSilhouette(context.getImageData(0, 0, canvas.width, canvas.height), frame.hands[0].landmarks)
      const guide = validateGuide({ schemaVersion: 1, targetId, handedness: 'Left',
        coordinateSystem: 'image-xy-wrist-relative-palm-width',
        source: { recordingId: recording.recordingId, inputSha256: recording.inputSha256, timestampMs: frame.timestampMs,
          reviewStatus: annotation.reviewStatus }, extractionMethod: 'palm-seeded-chroma-v001', ...extracted })
      // Preview is cropped to the outline bounds and stays in memory; no face or
      // full recording frame is included in the guide artifact.
      const wrist = frame.hands[0].landmarks[0]
      const coords = guide.points.map(p => ({ x: wrist.x * canvas.width + p.x * guide.sourcePalmWidthPixels,
        y: wrist.y * canvas.height + p.y * guide.sourcePalmWidthPixels }))
      const minX = Math.max(0, Math.floor(Math.min(...coords.map(p => p.x)) - 12))
      const minY = Math.max(0, Math.floor(Math.min(...coords.map(p => p.y)) - 12))
      const width = Math.min(canvas.width - minX, Math.ceil(Math.max(...coords.map(p => p.x)) - minX + 12))
      const height = Math.min(canvas.height - minY, Math.ceil(Math.max(...coords.map(p => p.y)) - minY + 12))
      context.strokeStyle = '#00e4f2'; context.lineWidth = 2; context.setLineDash([2, 3]); context.beginPath()
      coords.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y))
      context.closePath(); context.stroke()
      const crop = document.createElement('canvas'); crop.width = width; crop.height = height
      crop.getContext('2d').drawImage(canvas, minX, minY, width, height, 0, 0, width, height)
      setResult({ guide, preview: crop.toDataURL() })
      setMessage(`Outline extracted at ${(frame.timestampMs / 1000).toFixed(2)} seconds. Check fingers, background leakage, and the wrist cut before using it.`)
    } catch (error) { setMessage(`Outline extraction failed: ${error.message}`) }
    finally { setBusy(false) }
  }
  return <section className="annotation-panel">
    <h2>Outer silhouette experiment — left-hand {label}</h2>
    <p>Supports A, S, and B. Choose a clear-background recording where possible and review the result. The contour follows only wrist position and palm size, not live finger shape or rotation.</p>
    <button type="button" disabled={disabled || busy || !eligible} onClick={build}>Build {label} outline from held frame</button>
    <p role="status">{message}</p>
    {result && <>
      <img src={result.preview} className="silhouette-preview" alt="Cropped reference hand with extracted dotted outer contour for visual review" />
      <div className="data-actions">
        <button disabled={disabled || busy} onClick={() => { const saved = onGuide(result.guide); setMessage(`${saved?.message ?? 'Guide enabled.'} Switch to Practice, select ${label}, and turn on the camera to review it.`) }}>Save and use outline in Practice</button>
        <button disabled={disabled || busy} onClick={() => onExport('guide.json', result.guide)}>Export guide.json</button>
      </div>
      <p>Only outline coordinates are transferred/exported. Saving replaces the browser’s guide for this letter only. Export guide.json beside the reference’s features as a backup; browser storage can be cleared. This learner reference is not an approved teaching example.</p>
    </>}
  </section>
}
