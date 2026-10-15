import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandPresence, updateHandPresence, getHandDisplay } from '../src/handPresence.js'

function result(entries) {
  const points = () => Array.from({ length: 21 }, (_, i) => ({ x: i / 30, y: 0.4, z: 0.01 }))
  return { handedness: entries.map(([categoryName, score]) => [{ categoryName, score }]),
    landmarks: entries.map(points), worldLandmarks: entries.map(points) }
}

test('one then two hands appear independently after three reliable frames', () => {
  const state = createHandPresence()
  for (const now of [0, 50]) {
    const snapshot = updateHandPresence(state, result([['Left', 0.95]]), now)
    assert.equal(getHandDisplay(snapshot, 'Left', now).visible, false)
  }
  let snapshot = updateHandPresence(state, result([['Left', 0.95]]), 100)
  assert(getHandDisplay(snapshot, 'Left', 100).live)
  assert.equal(getHandDisplay(snapshot, 'Right', 100).visible, false)
  for (const now of [150, 200, 250]) snapshot = updateHandPresence(state, result([['Right', 0.96], ['Left', 0.94]]), now)
  assert(getHandDisplay(snapshot, 'Right', 250).live)
  assert(getHandDisplay(snapshot, 'Left', 250).live)
  assert.equal(snapshot.Right.sample.handedness, 'Right')
  assert.notEqual(snapshot.Left.sample, snapshot.Right.sample)
})

test('low identification confidence holds the last pose then hides without replacing it', () => {
  const state = createHandPresence()
  for (const now of [0, 50, 100]) updateHandPresence(state, result([['Left', 0.95]]), now)
  const last = state.Left.sample
  let snapshot = updateHandPresence(state, result([['Left', 0.55]]), 150)
  const holding = getHandDisplay(snapshot, 'Left', 150)
  assert.equal(holding.state, 'holding')
  assert.equal(holding.sample, null)
  assert(holding.warning)
  assert.equal(state.Left.sample, last)
  snapshot = updateHandPresence(state, result([]), 850)
  assert.equal(getHandDisplay(snapshot, 'Left', 850).visible, false)
})

test('hysteresis and grace avoid flicker; prolonged absence needs reliable reacquisition', () => {
  const state = createHandPresence()
  for (const now of [0, 50, 100]) updateHandPresence(state, result([['Right', 0.9]]), now)
  let snapshot = updateHandPresence(state, result([['Right', 0.7]]), 150)
  assert(getHandDisplay(snapshot, 'Right', 150).live)
  updateHandPresence(state, result([]), 200)
  snapshot = updateHandPresence(state, result([['Right', 0.85]]), 300)
  assert(getHandDisplay(snapshot, 'Right', 300).live)
  updateHandPresence(state, result([]), 1100)
  snapshot = updateHandPresence(state, result([['Right', 0.7]]), 1150)
  assert.equal(getHandDisplay(snapshot, 'Right', 1150).visible, false)
  for (const now of [1200, 1250, 1300]) snapshot = updateHandPresence(state, result([['Right', 0.9]]), now)
  assert(getHandDisplay(snapshot, 'Right', 1300).live)
})

test('duplicate labels and invalid joints are rejected without affecting the other hand', () => {
  const state = createHandPresence()
  for (const now of [0, 50, 100]) updateHandPresence(state, result([['Left', 0.9], ['Right', 0.95]]), now)
  let snapshot = updateHandPresence(state, result([['Left', 0.99], ['Left', 0.99]]), 150)
  assert.equal(snapshot.Left.reason, 'ambiguous')
  assert.equal(getHandDisplay(snapshot, 'Left', 150).sample, null)
  const invalid = result([['Left', 0.99], ['Right', 0.99]])
  invalid.worldLandmarks[0][8].x = NaN
  snapshot = updateHandPresence(state, invalid, 200)
  assert.equal(snapshot.Left.reason, 'landmarks')
  assert(getHandDisplay(snapshot, 'Right', 200).live)
})

test('camera off and stale inference cannot leave a model actively mirroring', () => {
  const state = createHandPresence()
  let snapshot
  for (const now of [0, 50, 100]) snapshot = updateHandPresence(state, result([['Left', 0.95]]), now)
  assert.equal(getHandDisplay(snapshot, 'Left', 110, false).visible, false)
  assert.equal(getHandDisplay(snapshot, 'Left', 400).state, 'holding')
  assert.equal(getHandDisplay(snapshot, 'Left', 900).state, 'hidden')
  assert.equal(getHandDisplay(null, 'Right', 100).visible, false)
})
