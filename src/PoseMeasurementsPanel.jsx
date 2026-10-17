// Formatting stays in the interface; exported feature inputs and their recipe are unchanged.
const scalar = (value, digits) => value === null ? 'Unavailable' : value.toFixed(digits)
const direction = value => value === null ? 'Unavailable' : `(${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)})`

function MeasurementTable({ rows, directions = false, digits = 2 }) {
  const format = value => directions ? direction(value) : scalar(value, digits)
  return <div className="comparison-table"><table>
    <thead><tr><th>Measurement</th><th>A center</th><th>B center</th><th>Difference</th><th>A spread</th><th>B spread</th><th>Usable A / B</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <th scope="row">{row.label}</th><td>{format(row.a.center)}</td><td>{format(row.b.center)}</td>
      <td>{scalar(row.difference, digits)}</td><td>{scalar(row.a.spread, digits)}</td><td>{scalar(row.b.spread, digits)}</td>
      <td>{row.a.validCount} / {row.b.validCount}
        {(row.a.invalidCount > 0 || row.b.invalidCount > 0) && <span> · excluded: {row.a.invalidCount} / {row.b.invalidCount}</span>}
        {(row.a.reason || row.b.reason) && <span> · {row.a.reason || row.b.reason}</span>}
      </td>
    </tr>)}</tbody>
  </table></div>
}

export default function PoseMeasurementsPanel({ measurements }) {
  const flagged = Object.values(measurements).flat().filter(row => row.a.invalidCount || row.b.invalidCount || row.a.reason || row.b.reason).length
  return <section className="annotation-panel" aria-labelledby="pose-measurements-title">
    <h2 id="pose-measurements-title">Pose measurements</h2>
    <p>Each measurement is calculated on actual usable samples, then summarized across the hold. Centers are medians except segment directions, which use a normalized mean. Spread is the 90th percentile of deviations from that measurement’s center.</p>
    {flagged > 0 && <p role="status">Warning: {flagged} measurement rows include degenerate segments or an undefined direction center. Unavailable values do not count as zero differences.</p>}
    <h3>Finger bends — degrees</h3>
    <p>0° means adjacent segments are straight; 90° means a right-angle bend. These unsigned angles do not distinguish bending forward from backward. Finger-base bend/spread is represented by segment directions below.</p>
    <MeasurementTable rows={measurements.bends} />
    <details>
      <summary>Finger segment directions — palm-relative unit vectors</summary>
      <p>Segments 1–3 run from each digit’s base toward its tip. Centers show (X, Y, Z) directions in palm coordinates; difference and spread use degrees. These describe pointing direction, not rotation around a finger’s own axis.</p>
      <MeasurementTable rows={measurements.directions} directions />
    </details>
    <h3>Relationships — palm-width units</h3>
    <p>These distances capture relationships between digits. Proximity does not establish physical contact, and distance alone does not say which side of another finger the thumb occupies.</p>
    <MeasurementTable rows={measurements.relationships} digits={4} />
    <p>Whole-hand orientation and its variation remain in the held-pose measurements above. These groups are separate descriptors; no matching score, acceptable tolerance, or correctness judgment is applied.</p>
  </section>
}
