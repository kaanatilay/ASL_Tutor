import { FINGERS } from './poseMeasurements.js'

// Fixed descriptor ordering is part of the recipe, independent of table row order.
// Change the version whenever dimensions, scaling, or group balance changes.
export const POSE_VECTOR_VERSION = 'pose-vector-v001'
const bendIds = Object.keys(FINGERS).flatMap(finger => [1, 2].map(i => `${finger}-bend-${i}`))
const directionIds = Object.keys(FINGERS).flatMap(finger => [1, 2, 3].map(i => `${finger}-segment-${i}`))
const relationshipIds = ['distance-8-12', 'distance-12-16', 'distance-16-20', 'distance-4-8',
  'distance-4-12', 'distance-4-16', 'distance-4-20', 'distance-4-5']
export const POSE_VECTOR_SETTINGS = {
  bends: { valueCount: 10, divisor: 180, groupMultiplier: 1 / Math.sqrt(10) },
  directions: { valueCount: 45, divisor: 1, groupMultiplier: 1 / Math.sqrt(45) },
  relationships: { valueCount: 8, divisor: 1, groupMultiplier: 1 / Math.sqrt(8) },
  palmOrientationIncluded: false,
}

// Reject missing/duplicate descriptors instead of padding or silently shifting dimensions.
function centers(rows, ids, group) {
  if (!Array.isArray(rows) || rows.length !== ids.length || new Set(rows.map(row => row.id)).size !== ids.length) {
    throw new Error(`Incomplete or duplicate ${group} descriptors.`)
  }
  return ids.map(id => {
    const row = rows.find(item => item.id === id)
    if (!row || row.center === null || row.center === undefined || row.validCount < 1) {
      throw new Error(`Unavailable required measurement: ${id}.`)
    }
    return row.center
  })
}

// Build one vector from hold summaries, never from between-recording differences.
// Initial equal group multipliers compensate for dimension count, not ASL importance.
export function buildPoseVector(summary) {
  const bends = centers(summary.bends, bendIds, 'bend')
  const directions = centers(summary.directions, directionIds, 'direction')
  const relationships = centers(summary.relationships, relationshipIds, 'relationship')
  if (!bends.every(value => Number.isFinite(value) && value >= 0 && value <= 180)) throw new Error('Bends must be finite angles between 0 and 180 degrees.')
  if (!relationships.every(value => Number.isFinite(value) && value >= 0)) throw new Error('Relationships must be finite nonnegative palm-width distances.')
  if (!directions.every(p => p && ['x', 'y', 'z'].every(axis => Number.isFinite(p[axis])) &&
      Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-6)) throw new Error('Segment direction centers must be finite unit vectors.')
  const raw = [...bends.map(value => value / 180), ...directions.flatMap(p => [p.x, p.y, p.z]), ...relationships]
  const dimensions = [...bendIds, ...directionIds.flatMap(id => ['x', 'y', 'z'].map(axis => `${id}.${axis}`)), ...relationshipIds]
  const values = raw.map((value, i) => value / Math.sqrt(i < 10 ? 10 : i < 55 ? 45 : 8))
  return { version: POSE_VECTOR_VERSION, settings: POSE_VECTOR_SETTINGS, dimensions, values }
}

// Cosine normalizes vector lengths for this calculation only. Euclidean retains
// scaled magnitudes. Neither metric is calibrated as a probability of correctness.
export function vectorMetrics(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length ||
      !a.every(Number.isFinite) || !b.every(Number.isFinite)) throw new Error('Vector inputs must be finite arrays with the same length.')
  const normA = Math.hypot(...a), normB = Math.hypot(...b)
  if (!Number.isFinite(normA) || !Number.isFinite(normB) || normA === 0 || normB === 0) throw new Error('Cosine requires nonzero finite vector lengths.')
  const dot = a.reduce((sum, value, i) => sum + value / normA * (b[i] / normB), 0)
  const cosine = Math.max(-1, Math.min(1, dot))
  return { cosineSimilarity: Math.abs(cosine - 1) < 1e-14 ? 1 : cosine,
    scaledEuclideanDistance: Math.hypot(...a.map((value, i) => value - b[i])) }
}

// A missing vector leaves the existing detailed comparison usable and explains why.
export function comparePoseVectors(measurements) {
  try {
    const summary = side => Object.fromEntries(['bends', 'directions', 'relationships'].map(group =>
      [group, measurements[group].map(row => row[side])]))
    const a = buildPoseVector(summary('a')), b = buildPoseVector(summary('b'))
    return { available: true, version: POSE_VECTOR_VERSION, dimensionCount: a.values.length,
      ...vectorMetrics(a.values, b.values) }
  } catch (error) { return { available: false, version: POSE_VECTOR_VERSION, reason: error.message } }
}
