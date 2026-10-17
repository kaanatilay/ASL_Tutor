import test from 'node:test'
import assert from 'node:assert/strict'
import { loadGuides, persistGuides, GUIDE_STORAGE_KEY } from '../src/guideStorage.js'
import { validateGuide } from '../src/silhouette.js'

const guide = targetId => ({ schemaVersion: 1, targetId, handedness: 'Left', coordinateSystem: 'image-xy-wrist-relative-palm-width',
  points: Array.from({ length: 12 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) })) })
function storage() {
  const entries = new Map()
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}

test('per-letter guides survive storage reload and replacement leaves other letters intact', () => {
  const store = storage()
  const a = guide('asl.alphabet.a'), b = guide('asl.alphabet.b'), s = guide('asl.alphabet.s')
  for (const g of [a, b, s]) assert.equal(validateGuide(g), g)
  const guides = { [a.targetId]: a, [b.targetId]: b, [s.targetId]: s }
  assert.equal(persistGuides(store, guides).persisted, true)
  assert.deepEqual(loadGuides(store).guides, guides)
  const replacement = { ...a, points: a.points.map(p => ({ x: p.x * .9, y: p.y })) }
  persistGuides(store, { ...guides, [a.targetId]: replacement })
  assert.deepEqual(loadGuides(store).guides[b.targetId], b)
  assert.deepEqual(loadGuides(store).guides[a.targetId], replacement)
  delete guides[a.targetId]
  persistGuides(store, guides)
  assert.equal(loadGuides(store).guides[a.targetId], undefined)
})

test('corrupt or unavailable storage is reported; valid remaining letters can still load', () => {
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
  assert.ok(loadGuides(broken).message)
  assert.equal(persistGuides(broken, {}).persisted, false)
  const store = storage(), a = guide('asl.alphabet.a')
  store.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, guides: { [a.targetId]: a, bad: {} } }))
  assert.deepEqual(loadGuides(store).guides, { [a.targetId]: a })
  assert.ok(loadGuides(store).message.includes('1 invalid'))
  store.setItem(GUIDE_STORAGE_KEY, 'not-json')
  assert.deepEqual(loadGuides(store).guides, {})
})
