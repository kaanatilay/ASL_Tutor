// Both methods remain visible for experimentation; there is no preferred method or threshold.
export default function VectorMatchPanel({ match }) {
  return <section className="annotation-panel" aria-labelledby="vector-match-title">
    <h2 id="vector-match-title">Vector matching experiment</h2>
    <p>Recipe: {match.version} · 63 values: 10 bends, 45 direction coordinates, 8 relationships. Palm orientation remains separate.</p>
    {match.available ? <div className="comparison-table"><table>
      <thead><tr><th>Method</th><th>Result</th><th>Interpretation</th></tr></thead>
      <tbody>
        <tr><th scope="row">Cosine similarity</th><td>{match.cosineSimilarity.toFixed(6)}</td><td>Higher means more similar vector direction. Range −1 to 1; self-match is 1.</td></tr>
        <tr><th scope="row">Scaled Euclidean distance</th><td>{match.scaledEuclideanDistance.toFixed(6)}</td><td>Lower means closer scaled values. Self-match is 0; no fixed maximum.</td></tr>
      </tbody>
    </table></div> : <p role="status">Vector comparison unavailable: {match.reason} Detailed measurements remain available below.</p>}
    <details><summary>Scaling and limitations</summary>
      <p>Bends are divided by 180. Directions retain unit-vector coordinates; relationships remain in palm widths. Each group is multiplied by 1 / √(its number of values): √10, √45, and √8 are the respective divisors.</p>
      <p>This adjusts for group size, but does not guarantee equal practical influence. Distances have no fixed maximum; descriptors overlap. Cosine ignores overall vector magnitude. Neither method incorporates within-hold spread or palm orientation, and neither reports correctness or probability.</p>
      <p>Vectors use available hold centers. Missing centers disable the vector comparison instead of being replaced with zeros. Review status, exclusions, and variation remain important in the detailed results.</p>
    </details>
  </section>
}
