import { useMemo, useState } from 'react'
import { compareFeatures, inspectFeatures } from './comparison.js'
import PoseMeasurementsPanel from './PoseMeasurementsPanel'
import VectorMatchPanel from './VectorMatchPanel'
import { targetLabel, NON_TARGET_ID } from './vocabulary.js'

const chains = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [17, 0]]
const colors = ['#087e8b', '#b14b08']

// Orthographic SVG views share bounds and scale. Front/side/top expose depth
// without changing the coordinates used by the numerical comparison.
function Skeleton({ samples, bounds, view, title }) {
  const axes = view === 'front' ? ['x', 'y'] : view === 'side' ? ['z', 'y'] : ['x', 'z']
  const [horizontal, vertical] = axes
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, .1)
  const project = p => [180 + (p[horizontal] - (bounds.minX + bounds.maxX) / 2) * 300 / span,
    180 - (p[vertical] - (bounds.minY + bounds.maxY) / 2) * 300 / span]
  return <svg viewBox="0 0 360 360" role="img" aria-label={title} className="comparison-skeleton">
    <title>{title}</title>
    <path d="M180 10V350M10 180H350" stroke="#dce8ee" />
    {samples.map(({ points, color, label }) => <g key={label} fill={color} stroke={color}>
      {chains.map((chain, i) => <polyline key={i} points={chain.map(index => project(points[index]).join(',')).join(' ')} fill="none" strokeWidth="2" />)}
      {points.map((point, i) => <circle key={i} cx={project(point)[0]} cy={project(point)[1]} r="3"><title>{label} joint {i}</title></circle>)}
    </g>)}
  </svg>
}

export default function Comparison() {
  const [files, setFiles] = useState([null, null])
  const [messages, setMessages] = useState(['', ''])
  const [loading, setLoading] = useState([false, false])
  const [view, setView] = useState('front')
  const [overlay, setOverlay] = useState(false)
  // Viewing controls do not recompute hold summaries or validation.
  const { result, error } = useMemo(() => {
    if (!files.every(Boolean)) return { result: null, error: '' }
    try { return { result: compareFeatures(files[0], files[1]), error: '' } }
    catch (problem) { return { result: null, error: problem.message } }
  }, [files])

  // Clear the affected slot before import, preventing a failed replacement from
  // leaving an old recording displayed as if the new one had loaded successfully.
  async function load(event, slot) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFiles(previous => previous.map((value, i) => i === slot ? null : value))
    setLoading(previous => previous.map((value, i) => i === slot ? true : value))
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Feature file limit is 20 MB.')
      const data = JSON.parse(await file.text())
      inspectFeatures(data)
      setFiles(previous => previous.map((value, i) => i === slot ? data : value))
      setMessages(previous => previous.map((value, i) => i === slot ? `Loaded ${data.recordingId}` : value))
    } catch (problem) {
      setMessages(previous => previous.map((value, i) => i === slot ? `Import failed: ${problem.message}` : value))
    } finally { setLoading(previous => previous.map((value, i) => i === slot ? false : value)) }
  }

  const summaries = result ? [result.a, result.b] : []
  const dimensions = view === 'front' ? ['x', 'y'] : view === 'side' ? ['z', 'y'] : ['x', 'z']
  const points = summaries.flatMap(s => s.representative.points)
  const bounds = points.length ? {
    minX: Math.min(...points.map(p => p[dimensions[0]])), maxX: Math.max(...points.map(p => p[dimensions[0]])),
    minY: Math.min(...points.map(p => p[dimensions[1]])), maxY: Math.max(...points.map(p => p[dimensions[1]])),
  } : null
  return <main className="homepage data-page">
    <h1>Comparison inspector</h1>
    <p>Compare held A, S, B, or non-target examples, including different labels. Differences describe measurements; neither recording is assumed correct. Files remain on this device.</p>
    <div className="data-controls">
      {[0, 1].map(slot => <label key={slot}>Recording {slot === 0 ? 'A (teal)' : 'B (orange)'} — features.json
        <input type="file" accept=".json,application/json" disabled={loading[slot]} onChange={event => load(event, slot)} />
        <span role="status">{loading[slot] ? 'Loading…' : messages[slot]}</span>
      </label>)}
    </div>
    {error && <p role="alert">Comparison unavailable: {error}</p>}
    {result && <>
      <p>Targets: recording A = <strong>{targetLabel(result.a.data.targetId)}</strong>; recording B = <strong>{targetLabel(result.b.data.targetId)}</strong>. A/B here name the comparison slots, not their letter labels.</p>
      {(result.a.data.targetId === NON_TARGET_ID || result.b.data.targetId === NON_TARGET_ID) &&
        <p>Non-target examples are experimental negatives, not proof of rejection of every unknown gesture. No rejection threshold is applied.</p>}
      <div className="data-controls">
        <label>Shared viewing direction<select value={view} onChange={event => setView(event.target.value)}>
          <option value="front">Palm X/Y</option><option value="side">Side Z/Y</option><option value="top">Top X/Z</option>
        </select></label>
        <label><span>Overlay both hands</span><input type="checkbox" checked={overlay} onChange={event => setOverlay(event.target.checked)} /></label>
      </div>
      <p>Skeletons show actual samples nearest each hold’s median shape. Both use the same palm-relative view and scale; palm orientation is reported separately.</p>
      <div className="comparison-views">
        {overlay ? <figure><Skeleton view={view} bounds={bounds} title="Overlaid representative hand shapes"
          samples={summaries.map((s, i) => ({ points: s.representative.points, color: colors[i], label: String(i) }))} /><figcaption>A: teal · B: orange</figcaption></figure>
          : summaries.map((s, i) => <figure key={i}><Skeleton view={view} bounds={bounds}
            title={`Recording ${i === 0 ? 'A' : 'B'} representative skeleton`} samples={[{ points: s.representative.points, color: colors[i], label: String(i) }]} />
            <figcaption>{i === 0 ? 'A' : 'B'}: {s.data.recordingId} · sample at {(s.representative.timestampMs / 1000).toFixed(3)} s</figcaption></figure>)}
      </div>
      <section className="annotation-panel">
        <h2>Held-pose measurements</h2>
        <p>Overall shape difference: <strong>{result.shapeDifference.toFixed(4)} palm widths</strong>. Palm-orientation difference: <strong>{result.orientationDegrees.toFixed(2)}°</strong>.</p>
        <p>Shape differences compare coordinate medians across each hold, not aligned frame pairs. Spread is the 90th-percentile distance from a hold’s own center: 90% of usable samples are at or below it. All distances below use palm-width units.</p>
        <div className="comparison-table"><table><thead><tr><th>Finger</th><th>Difference</th><th>A spread</th><th>B spread</th></tr></thead>
          <tbody>{result.perFinger.map(row => <tr key={row.finger}><th scope="row">{row.finger}</th><td>{row.difference.toFixed(4)}</td><td>{row.spreadA.toFixed(4)}</td><td>{row.spreadB.toFixed(4)}</td></tr>)}</tbody></table></div>
        {summaries.map((s, i) => <div key={i}>
          <h3>{i === 0 ? 'A' : 'B'}: {s.data.recordingId} · {targetLabel(s.data.targetId)}</h3>
          {s.data.targetId === NON_TARGET_ID && <p>Pose description: {s.data.annotation.notes}</p>}
          <p>{s.samples.length} usable / {s.data.frames.length} total samples; {s.excludedCount} excluded. Handedness: {s.handedness}. Review: {s.data.annotation.reviewStatus}.</p>
          <p>Whole-hand shape spread: {s.shapeSpread.toFixed(4)} palm widths. Orientation spread: {s.orientationSpread.toFixed(2)}°.</p>
          {s.data.annotation.reviewStatus !== 'accepted' && <p>Warning: this recording is not accepted reference material.</p>}
          {!!s.excludedCount && <p>Warning: ambiguous, invalid, missing, or low-handedness-confidence samples were excluded.</p>}
          {s.orientationSpread > 30 && <p>Warning: broad orientation spread; the mean may not represent a steady hold. 30° is an inspection flag, not a correctness threshold.</p>}
        </div>)}
        <p>Tracking noise, hand proportions, and genuine pose differences can all affect these values. Imported provenance is not independently verified against source videos on this page. No pass/fail threshold or corrective feedback is applied.</p>
      </section>
      <PoseMeasurementsPanel measurements={result.measurements} />
      <VectorMatchPanel match={result.vectorMatch} />
    </>}
  </main>
}
