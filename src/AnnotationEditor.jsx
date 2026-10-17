import { useState } from 'react'
import { REVIEW_STATUSES, secondsToMs, validateAnnotation } from './annotationData'
import NormalizationPanel from './NormalizationPanel'
import { ANNOTATION_TARGETS } from './vocabulary.js'
import SilhouetteBuilder from './SilhouetteBuilder'

const BOUNDARIES = [
  ['demonstrationStart', 'Demonstration start'], ['demonstrationEnd', 'Demonstration end'],
  ['holdStart', 'Target-hold start'], ['holdEnd', 'Target-hold end'],
]

// The parent remounts this editor for each video/recording pair so intervals cannot leak
// between recordings. Saved coordinates stay untouched; annotations only describe times.
export default function AnnotationEditor({ videoRef, recording, durationMs, disabled, onExport, onGuide }) {
  const [times, setTimes] = useState({ demonstrationStart: '', demonstrationEnd: '', holdStart: '', holdEnd: '' })
  const [reviewStatus, setReviewStatus] = useState('pending')
  const [reviewerId, setReviewerId] = useState('')
  const [notes, setNotes] = useState('')
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState('Select the target and mark its demonstration and held pose.')
  const [loading, setLoading] = useState(false)
  const [savedAnnotation, setSavedAnnotation] = useState(null)
  const context = { recordingId: recording.recordingId, inputSha256: recording.inputSha256, durationMs }
  const locked = disabled || loading

  // Store milliseconds on disk but show seconds beside the video's native playback controls.
  const annotation = {
    schemaVersion: 1, recordingId: recording.recordingId, inputSha256: recording.inputSha256,
    reviewStatus, reviewerId: reviewerId.trim() || null,
    reviewedAt: null, notes,
    segments: [{ targetId,
      startMs: secondsToMs(times.demonstrationStart), endMs: secondsToMs(times.demonstrationEnd),
      targetHold: { startMs: secondsToMs(times.holdStart), endMs: secondsToMs(times.holdEnd) } }],
  }
  let validationMessage = ''
  try { validateAnnotation(annotation, context) } catch (error) { validationMessage = error.message }
  // Compare editable values explicitly: imported JSON key order is not meaningful.
  const savedSegment = savedAnnotation?.segments[0]
  const currentSegment = annotation.segments[0]
  const matchesSaved = savedAnnotation && savedAnnotation.reviewStatus === reviewStatus &&
    savedSegment.targetId === targetId &&
    savedAnnotation.reviewerId === annotation.reviewerId && savedAnnotation.notes === notes &&
    savedSegment.startMs === currentSegment.startMs && savedSegment.endMs === currentSegment.endMs &&
    savedSegment.targetHold.startMs === currentSegment.targetHold.startMs &&
    savedSegment.targetHold.endMs === currentSegment.targetHold.endMs

  // Pause before marking/jumping so a click consistently refers to the inspected frame.
  function mark(key) {
    const video = videoRef.current
    if (!video) return
    video.pause()
    setTimes(previous => ({ ...previous, [key]: (Math.round(video.currentTime * 1000) / 1000).toString() }))
    setMessage('Boundary updated. Export annotation.json when ready to save your changes.')
  }

  function jump(key) {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = secondsToMs(times[key]) / 1000
  }

  // Failed imports preserve the current draft; successful imports restore every editable field.
  async function load(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLoading(true)
    try {
      if (file.size > 1024 * 1024) throw new Error('Annotation files must be smaller than 1 MB.')
      const data = validateAnnotation(JSON.parse(await file.text()), context)
      const segment = data.segments[0]
      setTargetId(segment.targetId)
      setTimes({ demonstrationStart: String(segment.startMs / 1000), demonstrationEnd: String(segment.endMs / 1000),
        holdStart: String(segment.targetHold.startMs / 1000), holdEnd: String(segment.targetHold.endMs / 1000) })
      setReviewStatus(data.reviewStatus)
      setReviewerId(data.reviewerId ?? '')
      setNotes(data.notes)
      setSavedAnnotation(data)
      setMessage('Annotation loaded. Use Jump to inspect its boundaries; review status is a human-entered label.')
    } catch (error) { setMessage(`Annotation import failed: ${error.message}`) }
    finally { setLoading(false) }
  }

  return <section className="annotation-panel" aria-labelledby="annotation-title">
    <h2 id="annotation-title">Mark demonstration and target hold</h2>
    <p>The demonstration includes forming the selected pose and holding it. The target hold contains only that held pose. Times are in seconds. For a varied non-target clip, select one stable interval and describe it in Notes.</p>
    <fieldset disabled={locked}>
      <legend>Selected target and intervals</legend>
      <div className="annotation-review">
        <label>Target label<select value={targetId} onChange={event => setTargetId(event.target.value)}>
          <option value="">Select a target…</option>
          {ANNOTATION_TARGETS.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
        </select></label>
      </div>
      <div className="annotation-boundaries">
        {BOUNDARIES.map(([key, label]) => <div className="annotation-boundary" key={key}>
          <label htmlFor={`annotation-${key}`}>{label}</label>
          <input id={`annotation-${key}`} type="number" min="0" max={durationMs / 1000} step="0.001"
            value={times[key]} onChange={event => setTimes(previous => ({ ...previous, [key]: event.target.value }))} />
          <button type="button" onClick={() => mark(key)}>Set from video</button>
          <button type="button" disabled={!Number.isFinite(secondsToMs(times[key])) || secondsToMs(times[key]) < 0 || secondsToMs(times[key]) > durationMs}
            onClick={() => jump(key)}>Jump</button>
        </div>)}
      </div>
      <div className="annotation-review">
        <label>Review status<select value={reviewStatus} onChange={event => setReviewStatus(event.target.value)}>
          {REVIEW_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
        </select></label>
        <label>Reviewer ID (optional)<input value={reviewerId} onChange={event => setReviewerId(event.target.value)} placeholder="reviewer-001" /></label>
        <label>Notes<textarea rows="3" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Learner recording; technique review pending." /></label>
      </div>
      <p>Keep pending until the example has been reviewed. Accepted is a manual review decision, not an automatic correctness score.</p>
      {validationMessage && <p className="annotation-validation">{validationMessage}</p>}
      <div className="data-actions">
        <label>Load annotation.json<input type="file" accept=".json,application/json" onChange={load} /></label>
        <button type="button" disabled={!!validationMessage} onClick={() => {
          const saved = { ...annotation, reviewedAt: reviewStatus === 'pending' ? null : new Date().toISOString() }
          onExport('annotation.json', validateAnnotation(saved, context))
          setSavedAnnotation(saved)
          setMessage('Annotation exported. Place annotation.json beside this recording’s video and landmarks.')
        }}>Export annotation.json</button>
      </div>
    </fieldset>
    <p role="status" aria-live="polite">{message}</p>
    <p>Changes stay in memory until exported. Switching videos or pages discards unsaved annotations.</p>
    {matchesSaved
      ? <div key={JSON.stringify(savedAnnotation)}><NormalizationPanel recording={recording} annotation={savedAnnotation}
        durationMs={durationMs} disabled={locked} onExport={onExport} />
        <SilhouetteBuilder videoRef={videoRef} recording={recording} annotation={savedAnnotation} disabled={locked} onExport={onExport} onGuide={onGuide} /></div>
      : <p>Load or export the completed annotation to enable normalization. After editing, export it again so the features refer to the saved intervals.</p>}
  </section>
}
