import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSilhouette, traceOuterContour, guidePlacement, validateGuide } from '../src/silhouette.js'

// Synthetic skin-colored hand/forearm against white isolates color-mask behavior
// without pretending the test validates segmentation of the user's real video.
function reference() {
  const width = 100, height = 100
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 20; y < 95; y++) for (let x = 20; x <= 60; x++) {
    if (y >= 66 && (x < 33 || x > 47)) continue
    const i = (y * width + x) * 4
    data[i] = 190; data[i + 1] = 130; data[i + 2] = 100
  }
  const landmarks = Array.from({ length: 21 }, () => ({ x: .4, y: .3 }))
  landmarks[0] = { x: .4, y: .65 }
  landmarks[5] = { x: .24, y: .4 }
  landmarks[9] = { x: .34, y: .35 }
  landmarks[13] = { x: .46, y: .35 }
  landmarks[17] = { x: .56, y: .4 }
  landmarks[4] = { x: .6, y: .2 }
  landmarks[8] = { x: .2, y: .2 }
  return { frame: { data, width, height }, landmarks }
}

test('segmentation keeps the hand, excludes white background, and cuts the forearm at the wrist', () => {
  const { frame, landmarks } = reference()
  const result = extractSilhouette(frame, landmarks)
  assert.ok(result.points.length >= 12)
  assert.ok(result.maskPixelCount > 1000)
  assert.ok(result.maskPixelCount < 2200)
  assert.ok(Math.max(...result.points.map(p => p.y)) < .1)
  assert.ok(Math.min(...result.points.map(p => p.y)) < -1)
  assert.ok(Math.abs(result.sourcePalmWidthPixels - 32) < 1e-10)
})

test('unsegmentable backgrounds and tiny reference palms fail rather than inventing an outline', () => {
  const { frame, landmarks } = reference()
  frame.data.fill(255)
  assert.throws(() => extractSilhouette(frame, landmarks), /Too little/)
  landmarks[17] = { ...landmarks[5] }
  assert.throws(() => extractSilhouette(frame, landmarks), /too small/)
})

test('boundary tracing retains concavity and ignores interior holes', () => {
  const width = 12, height = 12, mask = new Uint8Array(width * height)
  for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) mask[y * width + x] = 1
  // An open notch must remain; a closed one-pixel hole must not replace the outline.
  for (let y = 1; y <= 4; y++) for (let x = 4; x <= 6; x++) mask[y * width + x] = 0
  mask[8 * width + 8] = 0
  const loop = traceOuterContour(mask, width, height)
  assert.ok(loop.some(p => p.y === 5 && p.x >= 4 && p.x <= 7))
  assert.ok(loop.some(p => p.x === 1))
  assert.ok(loop.length > 40)
})

test('placement handles contain margins and scaling without reflecting source coordinates twice', () => {
  const { landmarks } = reference()
  const fit = guidePlacement(landmarks, 1280, 720, 640, 600)
  assert.ok(Math.abs(fit.x - .4 * 640) < 1e-10)
  assert.ok(Math.abs(fit.y - (120 + .65 * 360)) < 1e-10)
  assert.ok(Math.abs(fit.scale - .32 * 640) < 1e-10)
  const large = guidePlacement(landmarks, 1280, 720, 1280, 1200)
  assert.equal(large.x, fit.x * 2)
  assert.equal(large.scale, fit.scale * 2)
  assert.equal(guidePlacement(landmarks, 0, 720, 640, 600), null)
  assert.equal(guidePlacement(null, 1280, 720, 640, 600), null)
})

test('guide round trips validate left-hand A and reject malformed contours', () => {
  const { frame, landmarks } = reference()
  const guide = { schemaVersion: 1, targetId: 'asl.alphabet.a', handedness: 'Left',
    coordinateSystem: 'image-xy-wrist-relative-palm-width', ...extractSilhouette(frame, landmarks) }
  assert.deepEqual(validateGuide(JSON.parse(JSON.stringify(guide))), guide)
  for (const patch of [{ targetId: 'asl.alphabet.z' }, { handedness: 'Right' }, { points: [] },
    { points: [...guide.points, { x: NaN, y: 0 }] }]) assert.throws(() => validateGuide({ ...guide, ...patch }))
})
