import test from 'node:test'
import assert from 'node:assert/strict'
import { getHandPosition } from '../src/handPosition.js'

const viewport = { width: 10, height: 7.28 }
function sample(x, y, handedness = 'Left') {
  return { handedness, landmarks: Array.from({ length: 21 }, () => ({ x, y, z: 0 })) }
}

test('absolute mirrored palm position follows both axes with fixed depth', () => {
  assert.deepEqual(getHandPosition(sample(0.5, 0.5), viewport).toArray(), [0, 2.35, 0])
  const a = getHandPosition(sample(0.3, 0.3), viewport)
  const b = getHandPosition(sample(0.7, 0.7), viewport)
  assert(Math.abs(a.x - 1.3) < 1e-9)
  assert(Math.abs(b.x + 1.3) < 1e-9)
  assert(a.y > 2.35 && b.y < 2.35)
  assert.equal(a.z, 0)
})

test('both sides can occupy the same position and cross without swapping identities', () => {
  const left = getHandPosition(sample(0.4, 0.5, 'Left'), viewport)
  const right = getHandPosition(sample(0.4, 0.5, 'Right'), viewport)
  assert.deepEqual(left.toArray(), right.toArray())
  assert(getHandPosition(sample(0.8, 0.5, 'Left'), viewport).x < right.x)
  assert(getHandPosition(sample(0.2, 0.5, 'Right'), viewport).x > left.x)
})

test('mapping scales to viewport dimensions, not the number of hands or travel history', () => {
  const input = sample(0.35, 0.4)
  const position = getHandPosition(input, viewport)
  getHandPosition(sample(0.9, 0.9), viewport)
  assert.deepEqual(getHandPosition(input, viewport).toArray(), position.toArray())
  const wider = getHandPosition(input, { ...viewport, width: viewport.width * 1.5 })
  assert(Math.abs(wider.x - position.x * 1.5) < 1e-9)
  assert.equal(wider.y, position.y)
})

test('shared scene margins keep rotated model bounds in frame without half-slot constraints', () => {
  const extent = { x: 2, y: 2.5 }
  const position = getHandPosition(sample(-2, 3), viewport, extent)
  assert(position.x + extent.x <= viewport.width / 2)
  assert(position.y - extent.y >= 2.35 - viewport.height / 2)
  assert(position.x > 0)
  assert.equal(getHandPosition(sample(0.2, 0.5), { width: 2, height: 2 }, extent).x, 0)
})

test('only palm anchors affect movement, not curling fingertips', () => {
  const input = sample(0.5, 0.5)
  const before = getHandPosition(input, viewport)
  for (const i of [4, 8, 12, 16, 20]) input.landmarks[i] = { x: 0, y: 0, z: 10 }
  assert.deepEqual(getHandPosition(input, viewport).toArray(), before.toArray())
})

test('bad landmarks or viewport data do not introduce an invalid translation', () => {
  assert.equal(getHandPosition(null, viewport), null)
  const input = sample(0.5, 0.5)
  input.landmarks[9].x = NaN
  assert.equal(getHandPosition(input, viewport), null)
  assert.equal(getHandPosition(sample(0.5, 0.5), { width: 0, height: 10 }), null)
})
