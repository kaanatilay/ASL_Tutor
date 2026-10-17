// Color-based reference segmentation for a clear-background A recording. This is
// deliberately a reviewable prototype, not a general hand segmentation model.
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const chroma = (r, g, b) => [128 - .168736 * r - .331264 * g + .5 * b, 128 + .5 * r - .418688 * g - .081312 * b]

// Extract a connected color mask near the tracked hand, with a wrist-plane cut
// that prevents a bare forearm from becoming part of the target contour.
export function extractSilhouette({ data, width, height }, landmarks) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4 ||
      !Array.isArray(landmarks) || landmarks.length !== 21 || !landmarks.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
    throw new Error('A decoded frame and 21 valid image landmarks are required.')
  }
  const points = landmarks.map(p => ({ x: p.x * width, y: p.y * height }))
  const wrist = points[0]
  const palmWidth = Math.hypot(points[5].x - points[17].x, points[5].y - points[17].y)
  if (palmWidth < 12) throw new Error('Reference palm is too small or edge-on for contour extraction.')
  const center = [5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + points[i].x / 4, y: sum.y + points[i].y / 4 }), { x: 0, y: 0 })
  const length = Math.hypot(center.x - wrist.x, center.y - wrist.y)
  if (length < 8) throw new Error('Reference palm direction is degenerate.')
  const up = { x: (center.x - wrist.x) / length, y: (center.y - wrist.y) / length }
  // Sample palm interiors instead of landmark edges, which can lie on the background.
  const seeds = [5, 9, 13, 17].map(i => ({ x: Math.round(wrist.x * .45 + points[i].x * .55), y: Math.round(wrist.y * .45 + points[i].y * .55) }))
  const samples = []
  for (const seed of seeds) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = seed.x + dx, y = seed.y + dy
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const i = (y * width + x) * 4
      samples.push(chroma(data[i], data[i + 1], data[i + 2]))
    }
  }
  if (!samples.length) throw new Error('Reference hand is outside the image.')
  const color = [median(samples.map(p => p[0])), median(samples.map(p => p[1]))]
  const padding = palmWidth * .22
  const minX = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - padding))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map(p => p.x)) + padding))
  const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) - padding))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map(p => p.y)) + padding))
  const candidates = new Uint8Array(width * height)
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if ((x - wrist.x) * up.x + (y - wrist.y) * up.y < -.06 * palmWidth) continue
    const index = (y * width + x) * 4
    const r = data[index], g = data[index + 1], b = data[index + 2]
    const c = chroma(r, g, b)
    // Reject near-neutral white/gray background and very dark pixels. Chroma makes
    // matching less sensitive to brightness, but colored backgrounds may still leak.
    if (Math.max(r, g, b) - Math.min(r, g, b) >= 18 && Math.max(r, g, b) > 35 &&
        Math.hypot(c[0] - color[0], c[1] - color[1]) <= 27) candidates[y * width + x] = 1
  }
  const mask = new Uint8Array(width * height)
  const queue = []
  for (const { x, y } of seeds) if (x >= 0 && x < width && y >= 0 && y < height && candidates[y * width + x]) {
    const i = y * width + x
    if (!mask[i]) { mask[i] = 1; queue.push(i) }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % width, y = Math.floor(i / width)
    for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
      if (next >= 0 && candidates[next] && !mask[next]) { mask[next] = 1; queue.push(next) }
    }
  }
  if (queue.length < palmWidth * palmWidth * .15) throw new Error('Too little connected hand area. Try another held frame or a clearer background.')
  const contour = traceOuterContour(mask, width, height)
  if (contour.length < 12) throw new Error('Could not extract a usable closed outer contour.')
  // Store wrist-relative coordinates in palm-width units, never source image pixels.
  return { points: contour.filter((_, i) => i % 2 === 0).map(p => ({ x: (p.x - wrist.x) / palmWidth, y: (p.y - wrist.y) / palmWidth })),
    sourcePalmWidthPixels: palmWidth, maskPixelCount: queue.length,
    warnings: ['Color-based mask: inspect for missing fingers, background leakage, and wrist cutoff.', 'Learner reference: technique review pending.'] }
}

// Walk pixel-boundary edges and retain the loop with the greatest area. Internal
// mask holes are excluded; no convex hull is used, so finger concavities survive.
export function traceOuterContour(mask, width, height) {
  const edges = new Map()
  const key = (x, y) => `${x},${y}`
  const add = (x, y, nx, ny) => {
    const start = key(x, y)
    if (!edges.has(start)) edges.set(start, [])
    edges.get(start).push({ x: nx, y: ny })
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(x, y)) {
    if (!inside(x, y - 1)) add(x, y, x + 1, y)
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1)
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1)
    if (!inside(x - 1, y)) add(x, y + 1, x, y)
  }
  let largest = [], largestArea = 0
  while (edges.size) {
    const start = edges.keys().next().value
    let current = start
    const loop = []
    do {
      const nextEdges = edges.get(current)
      if (!nextEdges?.length) break
      const [x, y] = current.split(',').map(Number)
      loop.push({ x, y })
      const next = nextEdges.pop()
      if (!nextEdges.length) edges.delete(current)
      current = key(next.x, next.y)
    } while (current !== start)
    if (current !== start) continue
    const area = Math.abs(loop.reduce((sum, p, i) => { const q = loop[(i + 1) % loop.length]; return sum + p.x * q.y - q.x * p.y }, 0))
    if (area > largestArea) { largest = loop; largestArea = area }
  }
  return largest
}

// Map normalized image coordinates through object-fit:contain. The canvas receives
// the same CSS mirror as the webcam; do not reflect coordinates a second time.
export function guidePlacement(landmarks, videoWidth, videoHeight, canvasWidth, canvasHeight) {
  if (!landmarks || ![0, 5, 17].every(i => landmarks[i] && Number.isFinite(landmarks[i].x) && Number.isFinite(landmarks[i].y)) ||
      ![videoWidth, videoHeight, canvasWidth, canvasHeight].every(n => Number.isFinite(n) && n > 0)) return null
  const scale = Math.min(canvasWidth / videoWidth, canvasHeight / videoHeight)
  const width = videoWidth * scale, height = videoHeight * scale
  const palmWidth = Math.hypot((landmarks[5].x - landmarks[17].x) * width, (landmarks[5].y - landmarks[17].y) * height)
  if (palmWidth < 8) return null
  return { x: (canvasWidth - width) / 2 + landmarks[0].x * width,
    y: (canvasHeight - height) / 2 + landmarks[0].y * height, scale: palmWidth }
}

export function validateGuide(guide) {
  if (!guide || guide.schemaVersion !== 1 || !['asl.alphabet.a', 'asl.alphabet.s', 'asl.alphabet.b'].includes(guide.targetId) || guide.handedness !== 'Left' ||
      guide.coordinateSystem !== 'image-xy-wrist-relative-palm-width' || !Array.isArray(guide.points) || guide.points.length < 12 || guide.points.length > 20000 ||
      !guide.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 10 && Math.abs(p.y) < 10)) {
    throw new Error('Expected a saved left-hand A, S, or B silhouette guide with valid contour coordinates.')
  }
  return guide
}
