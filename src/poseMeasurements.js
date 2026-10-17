// Measurements use palm-relative normalized coordinates, independently of the UI.
// These anatomical descriptors do not define acceptable ASL or a matching score.
export const FINGERS = { Thumb: [1, 2, 3, 4], Index: [5, 6, 7, 8], Middle: [9, 10, 11, 12], Ring: [13, 14, 15, 16], Pinky: [17, 18, 19, 20] }
const MIN_LENGTH = 1e-6
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const length = p => Math.hypot(p.x, p.y, p.z)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const unit = p => {
  const size = length(p)
  return Number.isFinite(size) && size >= MIN_LENGTH ? { x: p.x / size, y: p.y / size, z: p.z / size } : null
}
const finitePoint = p => p && ['x', 'y', 'z'].every(axis => Number.isFinite(p[axis]))

// Forward segment vectors yield 0 degrees for straight, 90 for a right-angle bend.
// This unsigned geometric angle does not distinguish flexion from hyperextension.
export function directionAngle(a, b) {
  if (!a || !b) return null
  const cosine = Math.max(-1, Math.min(1, dot(a, b)))
  if (cosine > 1 - 1e-14) return 0
  return Math.acos(cosine) * 180 / Math.PI
}

// Measure actual samples before summarizing; angles from median joint coordinates
// would describe a synthetic pose rather than the observed hold.
export function measurePose(points) {
  if (!Array.isArray(points) || points.length !== 21 || !points.every(finitePoint)) throw new Error('Pose measurements require 21 finite points.')
  const bends = [], directions = [], relationships = []
  for (const [finger, indices] of Object.entries(FINGERS)) {
    const segments = indices.slice(0, 3).map((index, i) => unit(subtract(points[indices[i + 1]], points[index])))
    segments.forEach((value, i) => directions.push({ id: `${finger}-segment-${i + 1}`, label: `${finger} segment ${i + 1} (${indices[i]}→${indices[i + 1]})`, value }))
    for (let i = 0; i < 2; i++) bends.push({ id: `${finger}-bend-${i + 1}`,
      label: `${finger} bend at joint ${indices[i + 1]}`, value: directionAngle(segments[i], segments[i + 1]) })
  }
  const pairs = [
    ['Index–middle tips', 8, 12], ['Middle–ring tips', 12, 16], ['Ring–pinky tips', 16, 20],
    ['Thumb–index tips', 4, 8], ['Thumb–middle tips', 4, 12], ['Thumb–ring tips', 4, 16],
    ['Thumb–pinky tips', 4, 20], ['Thumb tip–index base', 4, 5],
  ]
  for (const [label, a, b] of pairs) relationships.push({ id: `distance-${a}-${b}`, label, value: length(subtract(points[a], points[b])) })
  return { bends, directions, relationships }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  return sorted[Math.floor(position)] + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1)
}

// Scalar centers are medians; directions use a normalized mean of unit vectors.
// Opposing directions can cancel: flag an undefined center instead of inventing one.
export function summarizeMeasurements(samples) {
  if (!samples.length) throw new Error('No usable samples for pose measurements.')
  const measurements = samples.map(sample => measurePose(sample.points))
  const result = {}
  for (const group of ['bends', 'directions', 'relationships']) {
    result[group] = measurements[0][group].map((descriptor, index) => {
      const values = measurements.map(sample => sample[group][index].value).filter(value => value !== null)
      let center = null, spread = null, reason = null
      if (!values.length) reason = 'No usable segments for this measurement.'
      else if (group === 'directions') {
        const mean = values.reduce((sum, value) => ({ x: sum.x + value.x / values.length,
          y: sum.y + value.y / values.length, z: sum.z + value.z / values.length }), { x: 0, y: 0, z: 0 })
        center = unit(mean)
        if (center) spread = percentile(values.map(value => directionAngle(value, center)), .9)
        else reason = 'Segment directions cancel; no representative direction.'
      } else {
        center = percentile(values, .5)
        spread = percentile(values.map(value => Math.abs(value - center)), .9)
      }
      return { id: descriptor.id, label: descriptor.label, center, spread, reason,
        validCount: values.length, invalidCount: samples.length - values.length }
    })
  }
  return result
}

// Keep groups distinct. There is intentionally no weighting or combined score.
export function compareMeasurements(samplesA, samplesB) {
  const a = summarizeMeasurements(samplesA), b = summarizeMeasurements(samplesB)
  return Object.fromEntries(['bends', 'directions', 'relationships'].map(group => [group, a[group].map((row, i) => {
    const other = b[group][i]
    return { id: row.id, label: row.label, a: row, b: other,
      difference: row.center === null || other.center === null ? null : group === 'directions'
        ? directionAngle(row.center, other.center) : Math.abs(row.center - other.center) }
  })]))
}
