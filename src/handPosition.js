import { MathUtils, Vector3 } from 'three'

// Use absolute palm position within the video image, never accumulated travel.
// Both hands share this mapping: handedness and the number of hands cannot
// change a position or prevent a hand from crossing the center of the scene.
export function getHandPosition(sample, viewport, extent = { x: 0, y: 0 }) {
  const points = sample?.landmarks
  const anchors = [0, 5, 9, 13, 17]
  if (!anchors.every(i => points?.[i] && [points[i].x, points[i].y].every(Number.isFinite)) ||
      !viewport || ![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return null
  const center = anchors.reduce((sum, i) => ({ x: sum.x + points[i].x / 5, y: sum.y + points[i].y / 5 }), { x: 0, y: 0 })
  const maxX = Math.max(0, viewport.width / 2 - extent.x - 0.15)
  const maxY = Math.max(0, viewport.height / 2 - extent.y - 0.15)
  // Mirror horizontally like the webcam. Movement spans 65% of the scene width
  // and 35% of its height, keeping useful margins around fixed-size models.
  return new Vector3(
    MathUtils.clamp((0.5 - center.x) * viewport.width * 0.65, -maxX, maxX),
    2.35 + MathUtils.clamp((0.5 - center.y) * viewport.height * 0.35, -maxY, maxY), 0)
}
