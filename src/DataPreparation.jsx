import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { drawHands } from './useHandTracking'
import { captureFrame, frameAtTime, validateRecording, TRACKER, WASM_URL, MODEL_URL } from './recordingData'
import AnnotationEditor from './AnnotationEditor'

// Browser exports are explicit downloads; selecting a file never uploads its content.
function downloadJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Await a decoded seek, with a timeout so broken videos cannot leave extraction stuck.
function seekVideo(video, seconds, signal) {
  if (signal.aborted) return Promise.reject(new Error('Extraction cancelled.'))
  if (Math.abs(video.currentTime - seconds) < 0.000001 && video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout)
      video.removeEventListener('seeked', onSeek)
      video.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onSeek = () => finish()
    const onError = () => finish(new Error('Could not decode the selected video.'))
    const onAbort = () => finish(new Error('Extraction cancelled.'))
    const timeout = setTimeout(() => finish(new Error('Video seek timed out.')), 10000)
    video.addEventListener('seeked', onSeek, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
    video.currentTime = seconds
  })
}

export default function DataPreparation({ onGuide }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const jobRef = useRef(null)
  const [source, setSource] = useState(null)
  const [recordingId, setRecordingId] = useState('rec-000001')
  const [signerId, setSignerId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [mirrored, setMirrored] = useState('unknown')
  const [videoInfo, setVideoInfo] = useState(null)
  const [recording, setRecording] = useState(null)
  const [metadata, setMetadata] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Select a local recording to begin.')
  const [handSummary, setHandSummary] = useState('')
  const validId = /^rec-\d{6}$/.test(recordingId)

  // Release local file URLs and cancel pending work on source changes or navigation.
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url) }, [source])
  useEffect(() => () => { jobRef.current?.abort() }, [])

  // Render saved samples during playback, seeking, and resizing; no new inference occurs.
  useEffect(() => {
    let animation
    const render = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.videoWidth) {
        const frame = recording && frameAtTime(recording.frames, video.currentTime * 1000)
        drawHands(canvas, video, frame?.hands.map(hand => hand.landmarks) ?? [])
      }
      animation = requestAnimationFrame(render)
    }
    animation = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animation)
  }, [recording, source])

  function selectVideo(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setSource({ file, url: URL.createObjectURL(file) })
    setVideoInfo(null)
    setRecording(null)
    setMetadata(null)
    setHandSummary('')
    setMessage('Loading video properties…')
  }

  // Sample the actual decoded video at requested media times, independent of playback speed.
  async function extract() {
    const controller = new AbortController()
    jobRef.current = controller
    const video = videoRef.current
    const originalTime = video.currentTime
    video.pause()
    setBusy(true)
    setRecording(null)
    setMetadata(null)
    let tracker
    try {
      setMessage('Fingerprinting video and loading tracker…')
      const buffer = await source.file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (controller.signal.aborted) return
      const files = await FilesetResolver.forVisionTasks(WASM_URL)
      if (controller.signal.aborted) return
      tracker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'VIDEO', numHands: 2,
      })
      if (controller.signal.aborted) return
      const frames = []
      const step = 1000 / TRACKER.settings.sampleRateHz
      const durationMs = videoInfo.durationMs
      for (let time = 0; time < durationMs; time += step) {
        await seekVideo(video, time / 1000, controller.signal)
        if (controller.signal.aborted) throw new Error('Extraction cancelled.')
        frames.push(captureFrame(tracker.detectForVideo(video, time), time))
        if (frames.length % 10 === 0) {
          setMessage(`Extracting: ${Math.round(time / durationMs * 100)}% (${frames.length} samples)`)
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
      await seekVideo(video, originalTime, controller.signal)
      const extractedAt = new Date().toISOString()
      const extraction = { ...TRACKER, extractedAt, inputSha256: sha256,
        outputPath: `recordings/${recordingId}/landmarks.json` }
      setRecording({ schemaVersion: 1, recordingId, inputSha256: sha256, extraction,
        coordinateSystems: {
          landmarks: 'MediaPipe normalized image x/y; wrist-relative z in approximately x scale; original video orientation',
          worldLandmarks: 'MediaPipe hand-centered world coordinates in meters; not global hand placement',
        }, frames })
      setMetadata({ schemaVersion: 1, recordingId, createdAt: extractedAt,
        signerId: signerId.trim() || null, sessionId: sessionId.trim() || null,
        source: { url: null, title: source.file.name, creator: 'User-provided recording', retrievedAt: null,
          license: null, permissionEvidence: 'User supplied their own recording for local pipeline testing.',
          reuseStatus: 'allowed', redistributionStatus: 'unknown' },
        video: { path: `recordings/${recordingId}/source.${source.file.name.split('.').pop()}`,
          originalFilename: source.file.name, sha256, bytes: source.file.size, ...videoInfo,
          frameRate: null, mirrored: mirrored === 'unknown' ? null : mirrored === 'yes' }, extraction })
      const empty = frames.filter(frame => !frame.hands.length).length
      setMessage(`Complete: ${frames.length} samples; ${empty} with no detected hands. Gesture review pending.`)
    } catch (error) {
      if (!controller.signal.aborted) setMessage(`Extraction failed: ${error.message}. No partial extraction exported.`)
      else setMessage('Extraction cancelled. No partial extraction retained.')
    } finally {
      tracker?.close()
      if (controller.signal.aborted) setMessage('Extraction cancelled. No partial extraction retained.')
      if (jobRef.current === controller) { jobRef.current = null; setBusy(false) }
    }
  }

  // Pair imports with the selected video by fingerprint rather than filename alone.
  async function importLandmarks(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('Landmark import limit is 100 MB.')
      const digest = await crypto.subtle.digest('SHA-256', await source.file.arrayBuffer())
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const data = validateRecording(JSON.parse(await file.text()), recordingId, hash)
      if (data.frames.at(-1).timestampMs > videoInfo.durationMs) throw new Error('Samples extend beyond this video.')
      setRecording(data)
      setMetadata(null)
      setMessage(`Loaded ${data.frames.length} saved samples. Play or seek the video to inspect.`)
    } catch (error) { setMessage(`Import failed: ${error.message}`) }
    finally { setBusy(false) }
  }

  return <main className="homepage data-page">
    <h1>Data preparation</h1>
    <p>Inspect learner recordings before using them as reference examples. Files stay on this device; tracker assets require internet access.</p>
    <section className="data-controls" aria-label="Recording details">
      <label>Video file<input type="file" accept="video/*" disabled={busy} onChange={selectVideo} /></label>
      <label>Recording ID<input value={recordingId} disabled={busy || !!recording} onChange={event => setRecordingId(event.target.value)} placeholder="rec-000001" /></label>
      <label>Signer ID (optional)<input value={signerId} disabled={busy || !!recording} onChange={event => setSignerId(event.target.value)} placeholder="signer-001" /></label>
      <label>Session ID (optional)<input value={sessionId} disabled={busy || !!recording} onChange={event => setSessionId(event.target.value)} placeholder="session-001" /></label>
      <label>Source video mirrored?<select value={mirrored} disabled={busy || !!recording} onChange={event => setMirrored(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
    </section>
    <p>For your own recordings authorized for local pipeline testing. Gesture review is pending; exports do not grant redistribution permission.</p>
    <p>Select A, S, B, or a non-target label in the annotation editor after extracting or loading landmarks. Tracking itself is independent of the label. Left/right labels may be wrong; video and overlay retain the file’s original orientation.</p>
    {!validId && <p role="alert">Use a recording ID such as rec-000001 (six digits).</p>}
    {source && <div className="inspection-stage">
      <video key={source.url} ref={videoRef} src={source.url} controls={!busy} playsInline muted
        onTimeUpdate={event => {
          if (busy || !recording) return
          const frame = frameAtTime(recording.frames, event.currentTarget.currentTime * 1000)
          setHandSummary(frame ? frame.hands.map(hand => {
            const side = hand.handedness?.[0]
            return side ? `${side.categoryName}: ${Math.round(side.score * 100)}% handedness score` : 'Unlabeled hand'
          }).join(' · ') || 'No hands detected in this sample.' : 'No sample near this time.')
        }}
        aria-label="Recorded video inspection" onLoadedMetadata={event => {
          const video = event.currentTarget
          if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 120) {
            setMessage('Choose a video between 0 and 120 seconds for this initial tool.'); return
          }
          setVideoInfo({ width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 })
          setMessage('Video ready. Extract landmarks or load a matching saved extraction.')
        }} onError={() => setMessage('This video could not be decoded by your browser.')} />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>}
    {videoInfo && <p>{videoInfo.width} × {videoInfo.height} · {(videoInfo.durationMs / 1000).toFixed(2)} seconds · sampling at 20 Hz</p>}
    {handSummary && <p>{handSummary}</p>}
    <div className="data-actions">
      <button disabled={busy || !videoInfo || !validId} onClick={extract}>Extract landmarks</button>
      {busy && <button onClick={() => jobRef.current?.abort()}>Cancel extraction</button>}
      <label>Load landmarks.json<input type="file" accept=".json,application/json" disabled={busy || !videoInfo || !validId} onChange={importLandmarks} /></label>
      <button disabled={busy || !metadata} onClick={() => downloadJson('metadata.json', metadata)}>Export metadata.json</button>
      <button disabled={busy || !recording} onClick={() => downloadJson('landmarks.json', recording)}>Export landmarks.json</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {recording && videoInfo && <AnnotationEditor key={`${source.url}:${recording.recordingId}:${recording.inputSha256}`}
      videoRef={videoRef} recording={recording} durationMs={videoInfo.durationMs} disabled={busy} onExport={downloadJson} onGuide={onGuide} />}
    <p>Place exported files beside the corresponding source video in data/recordings/{recordingId}/. Your browser may rename duplicate downloads; check their names. Switching pages discards unsaved preparation work.</p>
  </main>
}
