import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeMeasurements, compareMeasurements } from '../src/poseMeasurements.js'
import { buildPoseVector, comparePoseVectors, vectorMetrics } from '../src/poseVector.js'

const points = () => Array.from({ length: 21 }, (_, i) => ({ x: i * .1, y: 0, z: 0 }))
const summary = () => summarizeMeasurements([{ points: points() }])
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`)

test('recipe has exactly 63 fixed ordered dimensions independent of input row order', () => {
  const data = summary(), before = structuredClone(data)
  const vector = buildPoseVector(data)
  assert.equal(vector.version, 'pose-vector-v001')
  assert.equal(vector.values.length, 63)
  assert.equal(new Set(vector.dimensions).size, 63)
  assert.equal(vector.dimensions[0], 'Thumb-bend-1')
  assert.equal(vector.dimensions[10], 'Thumb-segment-1.x')
  assert.equal(vector.dimensions[55], 'distance-8-12')
  assert.equal(vector.dimensions[62], 'distance-4-5')
  assert.deepEqual(data, before)
  for (const rows of Object.values(data)) rows.reverse()
  assert.deepEqual(buildPoseVector(data), vector)
})

test('angles, unit directions, and distances receive documented scaling and dimension balance', () => {
  const data = summary()
  data.bends[0].center = 90
  const vector = buildPoseVector(data)
  close(vector.values[0], .5 / Math.sqrt(10))
  close(vector.values[10], 1 / Math.sqrt(45))
  close(vector.values[11], 0)
  close(vector.values[55], .4 / Math.sqrt(8))
})

test('both metrics are symmetric; cosine ignores proportional magnitude but Euclidean does not', () => {
  assert.deepEqual(vectorMetrics([1, 2], [1, 2]), { cosineSimilarity: 1, scaledEuclideanDistance: 0 })
  const proportional = vectorMetrics([1, 2], [2, 4])
  close(proportional.cosineSimilarity, 1)
  close(proportional.scaledEuclideanDistance, Math.sqrt(5))
  close(vectorMetrics([1, 0], [0, 1]).cosineSimilarity, 0)
  close(vectorMetrics([1, 0], [-1, 0]).cosineSimilarity, -1)
  assert.deepEqual(vectorMetrics([1, 2], [2, 4]), vectorMetrics([2, 4], [1, 2]))
  assert.throws(() => vectorMetrics([0, 0], [1, 0]))
  assert.throws(() => vectorMetrics([1], [1, 2]))
  assert.throws(() => vectorMetrics([NaN], [1]))
})

test('missing centers, malformed descriptors, and invalid values do not become zero-filled vectors', () => {
  for (const mutate of [
    s => { s.bends[0].center = null }, s => { s.bends[0].center = NaN },
    s => { s.bends[0].center = 181 }, s => { s.directions[0].center = { x: 2, y: 0, z: 0 } },
    s => { s.relationships[0].center = -1 }, s => { s.bends.pop() },
    s => { s.bends[1].id = s.bends[0].id },
  ]) { const data = summary(); mutate(data); assert.throws(() => buildPoseVector(data)) }
  const collapsed = points()
  collapsed[2] = { ...collapsed[1] }
  const result = comparePoseVectors(compareMeasurements([{ points: collapsed }], [{ points: points() }]))
  assert.equal(result.available, false)
  assert.match(result.reason, /Unavailable required measurement/)
})

test('controlled finger changes affect vector match while identical poses give identity values', () => {
  const a = [{ points: points() }], changed = points()
  changed[4].z += .3
  const self = comparePoseVectors(compareMeasurements(a, a))
  assert.equal(self.available, true)
  assert.equal(self.cosineSimilarity, 1)
  assert.equal(self.scaledEuclideanDistance, 0)
  const different = comparePoseVectors(compareMeasurements(a, [{ points: changed }]))
  assert.equal(different.available, true)
  assert.ok(different.cosineSimilarity < 1)
  assert.ok(different.scaledEuclideanDistance > 0)
})
