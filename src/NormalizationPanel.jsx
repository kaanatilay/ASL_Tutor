import { useState } from 'react'
import { NORMALIZATION_SETTINGS, normalizeTargetHold } from './normalization'
import { targetLabel } from './vocabulary.js'

// Hash JSON content, not the original file's whitespace; both exact input snapshots
// are recoverable from the stored measurements and embedded annotation.
async function contentHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

// The editor remounts this panel when saved inputs change, invalidating stale results.
export default function NormalizationPanel({ recording, annotation, durationMs, onExport, disabled }) {
  const [output, setOutput] = useState(null)
  // Replacing the loaded extraction invalidates features even for the same video.
  const features = output?.recording === recording ? output.data : null
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Normalize the saved target hold to inspect its measurements.')

  async function normalize() {
    setBusy(true)
    setOutput(null)
    try {
      const result = normalizeTargetHold(recording, annotation, durationMs)
      const [landmarksHash, annotationHash] = await Promise.all([contentHash(recording), contentHash(annotation)])
      const data = { schemaVersion: 1, recordingId: recording.recordingId, pipelineVersion: 'pipeline-v001',
        generatedAt: new Date().toISOString(), settings: NORMALIZATION_SETTINGS,
        targetId: annotation.segments[0].targetId,
        inputs: { videoSha256: recording.inputSha256, hashConvention: 'SHA-256 of UTF-8 JSON.stringify(parsed input)',
          landmarks: { path: `recordings/${recording.recordingId}/landmarks.json`, sha256: landmarksHash },
          annotation: { path: `recordings/${recording.recordingId}/annotation.json`, sha256: annotationHash } },
        annotation, ...result }
      setOutput({ recording, data })
      setMessage('Normalization complete. These measurements are not a gesture correctness score.')
    } catch (error) { setMessage(`Normalization failed: ${error.message}`) }
    finally { setBusy(false) }
  }

  return <section className="annotation-panel" aria-labelledby="normalization-title">
    <h2 id="normalization-title">Normalize the target hold</h2>
    <p>Selected target: <strong>{targetLabel(annotation.segments[0].targetId)}</strong></p>
    <p>Each sample uses its wrist as the origin and palm width as the scale. Palm-relative shape and source-space orientation are saved separately. Left and right hands remain distinct.</p>
    <div className="data-actions">
      <button type="button" disabled={disabled || busy} onClick={normalize}>Normalize target hold</button>
      <button type="button" disabled={disabled || busy || !features} onClick={() => onExport('features.json', features)}>Export features.json</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {features && <>
      <p>{features.summary.validSampleCount} / {features.summary.sampleCount} samples have usable geometry.
        {' '}{features.summary.missingSampleCount} missing-hand samples; {features.summary.invalidHandCount} invalid hands.</p>
      <p>Handedness labels: {Object.entries(features.summary.handednessCounts).map(([label, count]) => `${label}: ${count}`).join(', ') || 'none'}.</p>
      {features.summary.palmWidthMeters && <p>Estimated palm width before scaling: {(features.summary.palmWidthMeters.min * 100).toFixed(2)}–{(features.summary.palmWidthMeters.max * 100).toFixed(2)} cm. Tracker estimates are not physical measurements.</p>}
      {!!features.summary.warnings.length && <p>Warnings: {features.summary.warnings.join(', ')}. Pending learner examples are for pipeline testing.</p>}
      <p>Save as data/derived/pipeline-v001/{recording.recordingId}/features.json. Original files remain unchanged.</p>
    </>}
  </section>
}
