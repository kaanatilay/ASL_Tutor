import { useEffect, useMemo, useState } from 'react'
import { getHandDisplay } from './handPresence'
import { advanceLiveWindow, LIVE_TARGETS, matchLiveWindow, prepareLiveReference } from './liveMatching'
import { targetLabel } from './vocabulary'

// The readout remounts when target/camera/reference context changes; references stay
// loaded in the parent while rolling live samples and stale results are discarded.
function LiveReadout({ targetId, references, handSampleRef, cameraOn, selectedHand }) {
  const [output, setOutput] = useState({ match: null, message: 'Waiting for a live hand.' })
  useEffect(() => {
    let samples = []
    const interval = setInterval(() => {
      if (!cameraOn || selectedHand === 'Right' || !LIVE_TARGETS.includes(targetId) || !references.length) return
      const now = performance.now()
      const left = getHandDisplay(handSampleRef.current, 'Left', now)
      const right = getHandDisplay(handSampleRef.current, 'Right', now)
      const updated = advanceLiveWindow(samples, left.live && !right.live ? left.sample : null, now)
      samples = updated.samples
      if (!updated.ready) { setOutput({ match: null, message: updated.message }); return }
      try { setOutput({ match: matchLiveWindow(samples, references), message: updated.message }) }
      catch (error) { setOutput({ match: null, message: `Comparison unavailable: ${error.message}` }) }
    }, 100)
    return () => clearInterval(interval)
  }, [targetId, references, handSampleRef, cameraOn, selectedHand])
  const available = cameraOn && selectedHand !== 'Right' && LIVE_TARGETS.includes(targetId) && references.length
  const match = available ? output.match : null
  const message = !LIVE_TARGETS.includes(targetId) ? 'Live matching currently supports A, S, and B.'
    : !references.length ? 'Load reference features for this letter.' : !cameraOn ? 'Enable the camera to compare.'
      : selectedHand === 'Right' ? 'Switch to Auto or Left; this experiment supports the left hand.' : output.message
  return <>
    <div className="live-match-cards">
      <div><span>Cosine similarity ↑</span><strong>{match ? match.cosine.value.toFixed(6) : '—'}</strong><small>{match ? `Reference: ${match.cosine.referenceId}` : 'Higher means more similar'}</small></div>
      <div><span>Scaled Euclidean distance ↓</span><strong>{match ? match.euclidean.value.toFixed(6) : '—'}</strong><small>{match ? `Reference: ${match.euclidean.referenceId}` : 'Lower means closer'}</small></div>
    </div>
    <p role="status">{message}</p>
    {match && <p>Current palm orientation differs by {match.orientationDegrees.toFixed(2)}° from the Euclidean-best reference (separate from both scores).</p>}
  </>
}

export default function LiveMatchingPanel({ targetId, handSampleRef, cameraOn, selectedHand }) {
  const [bank, setBank] = useState([])
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Load one or more A/S/B features.json files. References remain in memory while you stay on Practice.')
  // Practice refreshes hand status frequently. Keep this array stable so those
  // renders do not restart the readout's rolling window.
  const references = useMemo(() => bank.filter(reference => reference.targetId === targetId), [bank, targetId])
  async function load(event) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      if (files.length > 32) throw new Error('Load at most 32 feature files at once.')
      const imported = []
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error('Each feature file must be under 20 MB.')
        imported.push(prepareLiveReference(JSON.parse(await file.text())))
      }
      const next = new Map(bank.map(reference => [reference.recordingId, reference]))
      for (const reference of imported) next.set(reference.recordingId, reference)
      setBank([...next.values()]); setRevision(value => value + 1)
      setMessage(`${imported.length} reference(s) loaded. Matching recording IDs replace their prior reference.`)
    } catch (error) { setMessage(`Reference import failed: ${error.message}. Previously loaded references are unchanged.`) }
    finally { setBusy(false) }
  }
  return <section className="live-matching" aria-labelledby="live-matching-title">
    <h2 id="live-matching-title">Experimental live matching — {targetLabel(targetId)}</h2>
    <details className="guide-controls"><summary>Reference feature files ({bank.length} loaded)</summary>
      <label>Load features.json files (multiple allowed)<input type="file" accept=".json,application/json" multiple disabled={busy} onChange={load} /></label>
      {!!bank.length && <button disabled={busy} onClick={() => { setBank([]); setRevision(value => value + 1) }}>Clear references</button>}
      <p>{message}</p>
      <p>Loaded: {bank.map(reference => `${targetLabel(reference.targetId)} (${reference.recordingId})`).join(', ') || 'none'}.</p>
    </details>
    <p>{references.length} reference(s) for this letter. Show only your left hand and hold the pose briefly. Values summarize approximately one second; they can lag when you change poses.</p>
    <LiveReadout key={`${targetId}:${cameraOn}:${selectedHand}:${revision}`} targetId={targetId} references={references}
      handSampleRef={handSampleRef} cameraOn={cameraOn} selectedHand={selectedHand} />
    {references.some(reference => reference.reviewStatus !== 'accepted') && <p>Warning: selected references include learner examples pending review or rejected examples. Scores are for pipeline testing.</p>}
    {references.some(reference => reference.excludedCount) && <p>Some reference samples were excluded due to tracking quality.</p>}
    <p>These raw similarity measures are not percentages of correctness. No success threshold or three-second test is applied. Imported features are checked for compatibility, not independently verified against source videos here.</p>
  </section>
}
