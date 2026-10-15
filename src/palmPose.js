import { Matrix4, Quaternion, Vector3 } from 'three'

// Palm landmarks exclude fingertips so finger curling does not rotate the palm.
// MediaPipe coordinates are converted into the mirrored viewer's X/right,
// Y/up, Z/toward-camera axes. Depth drives rotation only, never translation.
export function getPalmPose(sample) {
  const points = sample?.worldLandmarks
  const image = sample?.landmarks
  if (!points || !image || points.length < 21 || image.length < 21) return null
  if (![0, 5, 9, 13, 17].every(i => points[i] && image[i] &&
    [points[i].x, points[i].y, points[i].z, image[i].x, image[i].y].every(Number.isFinite))) return null
  const point = i => new Vector3(-points[i].x, -points[i].y, -points[i].z)
  const wrist = point(0)
  // Reflect the displayed model for the other hand, rather than interpreting
  // its reversed finger ordering as a palm/back flip.
  const side = sample.handedness === 'Left' ? -1 : 1
  const rays = [5, 9, 13, 17].map(i => point(i).sub(wrist))
  const up = rays.reduce((sum, ray) => sum.add(ray), new Vector3()).multiplyScalar(0.25)
  const width = point(17).sub(point(5)).length()
  if (up.lengthSq() < 1e-10 || width < 1e-5) return null
  // Average the three palm triangles instead of relying on one middle-knuckle
  // depth. A noisy single joint should not tilt the whole hand toward the viewer.
  const normal = new Vector3()
  for (let i = 0; i < rays.length - 1; i++) normal.add(rays[i + 1].clone().cross(rays[i]))
  // Reject a collapsed *3D* palm; a valid edge-on palm still has area in depth.
  // Holding the previous orientation is safer than inventing a plane from noise.
  if (normal.length() / (width * up.length()) < 0.12) return null
  normal.normalize().multiplyScalar(side)
  up.addScaledVector(normal, -up.dot(normal))
  if (up.lengthSq() < 1e-10) return null
  up.normalize()
  const right = up.clone().cross(normal).normalize()
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal))
  const center = [0, 5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + image[i].x / 5, y: sum.y + image[i].y / 5 }), { x: 0, y: 0 })
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
  return {
    rotation,
    side,
    // Small absolute offsets, with fixed scale and depth, in the left-hand slot.
    position: new Vector3(-1.65 + clamp((0.5 - center.x) * 1.8, -0.60, 0.60),
      2.35 + clamp((0.5 - center.y) * 1.4, -0.45, 0.45), 0),
  }
}
