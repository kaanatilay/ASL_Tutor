import test from 'node:test'
import assert from 'node:assert/strict'
import { Quaternion, Vector3 } from 'three'
import { measurePose, summarizeMeasurements, compareMeasurements } from '../src/poseMeasurements.js'
import { normalizeHand } from '../src/normalization.js'

const straight = () => Array.from({ length: 21 }, (_, i) => ({ x: i * .1, y: 0, z: 0 }))
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`)

test('known straight and right-angle segments give interpretable bends and directions', () => {
  const points = straight()
  assert.ok(measurePose(points).bends.every(row => row.value === 0))
  points[5] = { x: 0, y: 0, z: 0 }
  points[6] = { x: 1, y: 0, z: 0 }
  points[7] = { x: 1, y: 1, z: 0 }
  points[8] = { x: 1, y: 2, z: 0 }
  const measured = measurePose(points)
  close(measured.bends.find(row => row.id === 'Index-bend-1').value, 90)
  close(measured.bends.find(row => row.id === 'Index-bend-2').value, 0)
  assert.deepEqual(measured.directions.find(row => row.id === 'Index-segment-2').value, { x: 0, y: 1, z: 0 })
})

test('relationship distances include thumb-to-base and use normalized coordinate units', () => {
  const points = straight()
  const measured = measurePose(points)
  close(measured.relationships.find(row => row.id === 'distance-4-8').value, .4)
  close(measured.relationships.find(row => row.id === 'distance-4-5').value, .1)
  assert.equal(measured.relationships.length, 8)
  const result = compareMeasurements([{ points }], [{ points }])
  assert.ok(Object.values(result).flat().every(row => row.difference === 0))
})

test('measurements summarize observed frames and remain symmetric with unequal hold lengths', () => {
  const a = straight(), b = straight()
  b[4].z = .3
  const samplesA = [{ points: a }], samplesB = [{ points: b }, { points: b }]
  const ab = compareMeasurements(samplesA, samplesB), ba = compareMeasurements(samplesB, samplesA)
  for (const group of Object.keys(ab)) ab[group].forEach((row, i) => close(row.difference, ba[group][i].difference))
  assert.ok(ab.relationships.some(row => row.difference > 0))
  const outlier = straight()
  outlier[4].z = 1
  const summaries = summarizeMeasurements([{ points: a }, { points: a }, { points: outlier }])
  const relationship = summaries.relationships.find(row => row.id === 'distance-4-8')
  close(relationship.center, .4)
  assert.ok(relationship.spread > 0)
})

test('collapsed segments flag only dependent angles/directions, without inventing zero angles', () => {
  const points = straight()
  points[2] = { ...points[1] }
  const measured = measurePose(points)
  assert.equal(measured.bends[0].value, null)
  assert.equal(measured.directions[0].value, null)
  const summary = summarizeMeasurements([{ points }])
  assert.equal(summary.bends[0].invalidCount, 1)
  assert.equal(summary.bends[0].center, null)
  assert.equal(summary.bends[0].spread, null)
  assert.ok(summary.bends[0].reason)
  assert.equal(compareMeasurements([{ points }], [{ points }]).bends[0].difference, null)
  assert.throws(() => measurePose([]))
  assert.throws(() => summarizeMeasurements([]))
})

test('opposing segment directions have no invented representative direction', () => {
  const points = straight(), opposite = straight().map(p => ({ x: -p.x, y: p.y, z: p.z }))
  const summary = summarizeMeasurements([{ points }, { points: opposite }])
  assert.equal(summary.directions[0].center, null)
  assert.equal(summary.directions[0].validCount, 2)
  assert.ok(summary.directions[0].reason)
})

test('whole-hand rotation and uniform scale preserve all palm-relative measurements after normalization', () => {
  const points = straight().map((p, i) => ({ x: p.x * .04, y: .03 + i * .003, z: i * .001 }))
  points[0] = { x: 0, y: 0, z: 0 }
  points[5] = { x: -.03, y: .06, z: 0 }
  points[9] = { x: -.01, y: .065, z: 0 }
  points[13] = { x: .01, y: .06, z: 0 }
  points[17] = { x: .03, y: .05, z: 0 }
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), .8)
  const transformed = points.map(p => {
    const v = new Vector3(p.x, p.y, p.z).multiplyScalar(2).applyQuaternion(q).add(new Vector3(.1, .2, .3))
    return { x: v.x, y: v.y, z: v.z }
  })
  const normalize = worldLandmarks => normalizeHand({ worldLandmarks, handedness: [{ categoryName: 'Left', score: .99 }] }).normalizedLandmarks
  const result = compareMeasurements([{ points: normalize(points) }], [{ points: normalize(transformed) }])
  Object.values(result).flat().forEach(row => close(row.difference, 0))
})
