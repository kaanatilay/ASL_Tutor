import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getPalmPose } from './palmPose'
import { getFingerAngles, getFingerReference, TRACKED_FINGERS, mapFingerBends } from './indexFingerPose'
import { getCalibrationFeedback } from './calibrationFeedback'
import { createFingerCalibration, advanceFingerCalibration, cancelFingerCollections } from './fingerCalibration'
import { createThumbCalibration, getThumbMeasurement, advanceThumbCalibration, getThumbTargets, getThumbRootOffset, getThumbFeedback } from './thumbPose'

// Replace this asset to refine the hand while preserving its rig and animation.
const MODEL_URL = `${import.meta.env.BASE_URL}models/ASLTutor_hand_model_clean.glb`

// Release model and room resources, including late loads after leaving the page.
function disposeObjects(root) {
  const materials = new Set()
  root.traverse(object => {
    object.geometry?.dispose()
    if (object.skeleton) object.skeleton.dispose()
    if (object.material) {
      for (const material of [object.material].flat()) materials.add(material)
    }
  })
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
    material.dispose()
  }
}

// A floor, back wall, and side wall establish depth without enclosing the camera.
function addRoom(scene) {
  const material = new THREE.LineBasicMaterial({ color: 0xd5e5fa, transparent: true, opacity: 0.16 })
  const vertices = []
  const line = (a, b) => vertices.push(...a, ...b)
  for (let i = -6; i <= 6; i++) {
    line([i, 0, -4], [i, 0, 4])
    line([-6, 0, i * 2 / 3], [6, 0, i * 2 / 3])
    line([i, 0, -4], [i, 6, -4])
  }
  for (let y = 0; y <= 6; y++) {
    line([-6, y, -4], [6, y, -4])
    line([-6, y, -4], [-6, y, 4])
  }
  for (let z = -4; z <= 4; z++) line([-6, 0, z], [-6, 6, z])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  scene.add(new THREE.LineSegments(geometry, material))
}

export default function HandViewer({ handSampleRef, cameraState, selectedHand, onSelectHand }) {
  const hostRef = useRef(null)
  const apiRef = useRef(null)
  const playingRef = useRef(false)
  const modeRef = useRef('test')
  const cameraOnRef = useRef(false)
  const fingerCalibrationRef = useRef(createFingerCalibration())
  const thumbCalibrationRef = useRef({ Left: createThumbCalibration(), Right: createThumbCalibration() })
  const thumbSkeletonRef = useRef(false)
  const [showThumbSkeleton, setShowThumbSkeleton] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [tipInfo, setTipInfo] = useState(null)
  const [calibrationFeedback, setCalibrationFeedback] = useState({ state: 'waiting', progress: 0, message: 'Enable the camera to begin.' })
  const [mode, setMode] = useState('test')
  const [view, setView] = useState('room')
  const [liveMessage, setLiveMessage] = useState('Enable the camera to mirror your palm.')
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('Loading your hand model…')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => { cameraOnRef.current = cameraState === 'on' }, [cameraState])

  // Keep the Three.js lifecycle inside this component; camera tracking is separate.
  useEffect(() => {
    const host = hostRef.current
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      let active = true
      Promise.resolve().then(() => {
        if (!active) return
        setFailed(true)
        setStatus('3D preview is unavailable. Try a browser with WebGL enabled.')
      })
      return () => { active = false }
    }
    let disposed = false
    let mixer
    let model
    let placement
    let openSize
    let appliedMode = 'test'
    let previousLiveMessage = ''
    let fingerJoints = {}
    let thumbJoints = []
    let thumbTargets = null
    let thumbRootTarget = null
    let thumbRawSegments = null
    let modelPalmWidth = 0
    let activeHand = 'Left'
    const bendAxis = new THREE.Vector3(1, 0, 0)
    let currentView = 'room'
    let lastTime
    let lastTipReadout = -Infinity
    let lastFeedbackTime = -Infinity
    let lastFeedbackKey = ''
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#142943')
    // Draw bone centers through the skin only when requested. Cyan is the
    // animated skeleton; amber is its target; magenta is raw tracked direction.
    const makeThumbLine = color => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false }))
      line.frustumCulled = false
      line.renderOrder = 10
      scene.add(line)
      return line
    }
    const thumbBonesLine = makeThumbLine('#58edff')
    const thumbTargetLine = makeThumbLine('#ffbf57')
    const thumbRawLine = makeThumbLine('#f48cfa')
    thumbRawLine.renderOrder = 12
    const thumbDots = new THREE.Points(thumbBonesLine.geometry,
      new THREE.PointsMaterial({ color: '#58edff', size: 6, sizeAttenuation: false, depthTest: false, depthWrite: false }))
    thumbDots.frustumCulled = false
    thumbDots.renderOrder = 11
    scene.add(thumbDots)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80)
    camera.position.set(0, 3.7, 8.5)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-label', '3D hand. Drag to rotate the view; scroll or pinch to zoom.')
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 2, 0)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 5
    controls.maxDistance = 19
    controls.update()
    controls.saveState()
    scene.add(new THREE.HemisphereLight(0xe9f3ff, 0x526884, 2.5))
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(-3, 6, 7)
    scene.add(key)
    addRoom(scene)

    // Resize only the render surface; the CSS grid owns the panel dimensions.
    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      camera.aspect = Math.max(width, 1) / Math.max(height, 1)
      // Off-axis framing keeps the hand in its left slot while the straight-on
      // camera faces the hand directly, removing the previous downward bias.
      camera.clearViewOffset()
      if (currentView === 'straight') camera.setViewOffset(Math.max(width, 1), Math.max(height, 1), width * 0.22, 0, Math.max(width, 1), Math.max(height, 1))
      camera.updateProjectionMatrix()
      renderer.setSize(Math.max(width, 1), Math.max(height, 1))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    const applyView = next => {
      currentView = next
      controls.target.set(next === 'straight' ? -1.65 : 0, next === 'straight' ? 2.35 : 2, 0)
      camera.position.set(next === 'straight' ? -1.65 : 0, next === 'straight' ? 2.35 : 3.7, 8.5)
      controls.update()
      resize()
    }
    apiRef.current = {
      reset: () => applyView(currentView),
      view: applyView,
      zoom: factor => {
        const offset = camera.position.clone().sub(controls.target)
        offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 5, 19))
        camera.position.copy(controls.target).add(offset)
        controls.update()
      },
      restart: () => { mixer?.setTime(0) },
      // Stop the clip at its first frame before live tracking takes control.
      open: () => { mixer?.setTime(0) },
    }

    new GLTFLoader().load(MODEL_URL, gltf => {
      if (disposed) { disposeObjects(gltf.scene); return }
      try {
        model = gltf.scene
        const white = new THREE.MeshStandardMaterial({ color: '#f1f3f6', roughness: 0.55, vertexColors: false })
        const oldMaterials = new Set()
        model.traverse(object => {
          if (!object.isMesh) return
          for (const material of [object.material].flat()) oldMaterials.add(material)
          object.material = white
          object.frustumCulled = false
        })
        for (const material of oldMaterials) material.dispose()
        // Blender's XY hand plane is exported into glTF's XZ plane. Stand it
        // upright in a wrapper so animation tracks retain their original axes.
        const orientation = new THREE.Group()
        orientation.rotation.x = Math.PI / 2
        orientation.add(model)
        orientation.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(orientation)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const scale = 4.1 / Math.max(size.y, 0.001)
        openSize = size.clone().multiplyScalar(scale)
        placement = new THREE.Group()
        placement.scale.setScalar(scale)
        orientation.position.copy(center).multiplyScalar(-1)
        placement.add(orientation)
        placement.position.set(-1.65, 2.35, 0)
        scene.add(placement)
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(gltf.animations[0]).play()
          mixer.setTime(0)
        }
        // Store the authored rest rotations. Apply curl relative to each bone's
        // local X axis, matching the Blender rig, without overwriting its roll.
        fingerJoints = Object.fromEntries(TRACKED_FINGERS.map(finger => [finger,
          [1, 2, 3].map(joint => {
            const bone = model.getObjectByName(`${finger}_${joint}`)
            return bone?.isBone ? { bone, rest: bone.quaternion.clone() } : null
          })]))
        thumbJoints = [1, 2, 3].map(joint => {
          const bone = model.getObjectByName(`Thumb_${joint}`)
          // The exported terminal bone has no child marker. Its authored tip
          // length is sqrt(0.4² + 0.5²); the first two lengths come from the rig.
          const length = joint < 3 ? model.getObjectByName(`Thumb_${joint + 1}`)?.position.length() : Math.hypot(0.4, 0.5)
          return bone?.isBone && length ? { bone, rest: bone.quaternion.clone(), restPosition: bone.position.clone(), length } : null
        })
        const indexBase = model.getObjectByName('Index_1')
        const pinkyBase = model.getObjectByName('Pinky_1')
        if (indexBase && pinkyBase) modelPalmWidth = indexBase.position.distanceTo(pinkyBase.position)
        setReady(true)
        setStatus(gltf.animations.length ? 'Model ready. Play the finger test.' : 'Model ready. No test animation was included.')
      } catch {
        setFailed(true)
        setStatus('The hand model could not be displayed. Check the exported GLB and reload.')
      }
    }, undefined, () => {
      if (!disposed) {
        setFailed(true)
        setStatus('The hand model could not load. Check the model file and reload.')
      }
    })

    renderer.setAnimationLoop(time => {
      const delta = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, 0.05)
      lastTime = time
      const live = modeRef.current === 'live'
      if (placement && appliedMode !== modeRef.current) {
        mixer?.setTime(0)
        placement.quaternion.identity()
        placement.scale.set(Math.abs(placement.scale.x), placement.scale.y, placement.scale.z)
        placement.position.set(-1.65, 2.35, 0)
        appliedMode = modeRef.current
        thumbTargets = null
        thumbRootTarget = null
        thumbRawSegments = null
        if (thumbJoints[0]) thumbJoints[0].bone.position.copy(thumbJoints[0].restPosition)
      }
      if (!live && playingRef.current) mixer?.update(delta)
      if (live && placement) {
        const sample = handSampleRef.current
        const fresh = cameraOnRef.current && sample && performance.now() - sample.timestamp < 400
        const pose = fresh ? getPalmPose(sample) : null
        const feedbackAngles = {}
        let thumbMeasurement = null
        let message = cameraOnRef.current ? 'Waiting for a clear selected palm. Holding the last pose.' : 'Enable the camera to mirror your palm.'
        if (!pose && performance.now() - lastTipReadout >= 250) {
          lastTipReadout = performance.now()
          setTipInfo(null)
        }
        if (pose) {
          const blend = 1 - Math.exp(-delta * 10)
          placement.quaternion.slerp(pose.rotation, blend)
          const scale = Math.abs(placement.scale.x)
          placement.scale.x = pose.side * scale
          // Keep the rotated open hand inside its left slot. Estimate horizontal
          // extent from the rest bounds without rescanning every mesh vertex.
          const matrix = new THREE.Matrix4().makeRotationFromQuaternion(placement.quaternion).elements
          const extent = (Math.abs(matrix[0]) * openSize.x + Math.abs(matrix[4]) * openSize.y + Math.abs(matrix[8]) * openSize.z) / 2
          pose.position.x = THREE.MathUtils.clamp(pose.position.x, -5.5 + extent, -0.15 - extent)
          placement.position.lerp(pose.position, blend)
          // An unfinished collection belongs to one continuously visible hand.
          // Switching sides preserves saved references but never mixes samples.
          if (activeHand !== sample.handedness) {
            cancelFingerCollections(fingerCalibrationRef.current)
            for (const state of Object.values(thumbCalibrationRef.current)) state.request = null
          }
          activeHand = sample.handedness
          const now = performance.now()
          const fingerBlend = 1 - Math.exp(-delta * 14)
          const tracked = []
          // Each finger owns its calibration and bone targets. An unclear
          // finger holds its pose without blocking the other three fingers.
          for (const finger of TRACKED_FINGERS) {
            const joints = fingerJoints[finger]
            const calibration = fingerCalibrationRef.current[activeHand][finger]
            const reference = getFingerReference(sample, pose.rotation, finger)
            const angles = joints?.every(Boolean) ? getFingerAngles(sample, pose.rotation, finger, calibration.reference ?? reference) : null
            feedbackAngles[finger] = angles
            advanceFingerCalibration(calibration, { angles, reference, timestamp: sample.timestamp, now })
            const bends = mapFingerBends(angles, calibration.neutral)
            if (bends) {
              tracked.push(finger)
              joints.forEach(({ bone, rest }, i) => {
                const target = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(bendAxis, bends[i]))
                bone.quaternion.slerp(target, fingerBlend)
              })
            }
            if (finger === 'Index' && now - lastTipReadout >= 250) {
              lastTipReadout = now
              setTipInfo(bends ? {
                estimated: Math.round(THREE.MathUtils.radToDeg(angles[2])), corrected: Math.round(THREE.MathUtils.radToDeg(bends[2])),
                base: Math.round(THREE.MathUtils.radToDeg(angles[0])), baseTarget: Math.round(THREE.MathUtils.radToDeg(bends[0])),
                middle3D: Math.round(Math.abs(THREE.MathUtils.radToDeg(angles[1]))), middleTarget: Math.round(THREE.MathUtils.radToDeg(bends[1])),
              } : null)
            }
          }
          // Keep folded thumb directions in the palm frame. Calibration only
          // removes small resting differences near the open pose.
          const thumbAvailable = thumbJoints.length === 3 && thumbJoints.every(Boolean)
          thumbMeasurement = thumbAvailable ? getThumbMeasurement(sample, pose.rotation) : null
          if (thumbMeasurement) thumbRawSegments = thumbMeasurement.segments
          const thumbCalibration = thumbCalibrationRef.current[activeHand]
          advanceThumbCalibration(thumbCalibration, { measurement: thumbMeasurement, timestamp: sample.timestamp, now })
          const nextThumbTargets = thumbAvailable ? getThumbTargets(thumbMeasurement, thumbCalibration.neutral, thumbJoints.map(joint => joint.rest)) : null
          if (nextThumbTargets) thumbTargets = nextThumbTargets
          if (nextThumbTargets) thumbJoints.forEach(({ bone }, i) => bone.quaternion.slerp(nextThumbTargets[i], fingerBlend))
          // Move only the thumb root. Child bones inherit its translation while
          // the palm and other fingers keep their existing positions/rotations.
          const rootOffset = thumbAvailable ? getThumbRootOffset(thumbMeasurement, thumbCalibration.neutral, modelPalmWidth) : null
          if (rootOffset) {
            thumbRootTarget = thumbJoints[0].restPosition.clone().add(rootOffset)
            thumbJoints[0].bone.position.lerp(thumbRootTarget, 1 - Math.exp(-delta * 7))
          }
          message = `Live ${activeHand.toLowerCase()} palm + ${tracked.length}/4 fingers · ${!thumbAvailable ? 'Thumb bones missing' : nextThumbTargets ? 'Thumb tracking' : 'Thumb unclear; holding pose'}`

        }
        // Lost or stale tracking freezes the model; update text only on change.
        if (message !== previousLiveMessage) {
          previousLiveMessage = message
          setLiveMessage(message)
        }
        // Throttle visual feedback independently of 3D rendering and announce
        // instructions only when they change, not for every tracking sample.
        if (performance.now() - lastFeedbackTime >= 100) {
          lastFeedbackTime = performance.now()
          const fingers = TRACKED_FINGERS.map(finger => {
            const state = fingerCalibrationRef.current[activeHand][finger]
            // Cancel unfinished samples on tracking loss, retaining accepted neutrals.
            if (!pose) advanceFingerCalibration(state, { angles: null, now: lastFeedbackTime })
            return { finger, ...getCalibrationFeedback({
              cameraOn: cameraOnRef.current, angles: feedbackAngles[finger],
              request: state.request, calibrated: state.neutral != null,
              now: lastFeedbackTime, retryUntil: state.retryUntil, retryReason: state.retryReason,
              finger: finger.toLowerCase(),
            }) }
          })
          const thumbState = thumbCalibrationRef.current[activeHand]
          if (!pose) advanceThumbCalibration(thumbState, { measurement: null, now: lastFeedbackTime })
          fingers.push({ finger: 'Thumb', ...getThumbFeedback({
            cameraOn: cameraOnRef.current, measurement: thumbMeasurement, state: thumbState, now: lastFeedbackTime,
          }) })
          const pending = fingers.find(finger => finger.state !== 'ready')
          const feedback = { state: pending?.state ?? 'ready',
            message: pending?.message ?? 'All five digits calibrated. Try curling and reopening.', fingers }
          setCalibrating(Boolean(thumbState.request) || Object.values(fingerCalibrationRef.current[activeHand]).some(state => state.request))
          const key = JSON.stringify(feedback)
          if (key !== lastFeedbackKey) { lastFeedbackKey = key; setCalibrationFeedback(feedback) }
        }
      }
      controls.update()
      const showSkeleton = thumbSkeletonRef.current && thumbJoints.length === 3 && thumbJoints.every(Boolean)
      thumbBonesLine.visible = thumbDots.visible = showSkeleton
      thumbTargetLine.visible = showSkeleton && live && Boolean(thumbTargets)
      thumbRawLine.visible = showSkeleton && live && Boolean(thumbRawSegments)
      if (showSkeleton) {
        scene.updateMatrixWorld(true)
        const points = thumbJoints.map(({ bone }) => bone.getWorldPosition(new THREE.Vector3()))
        points.push(thumbJoints[2].bone.localToWorld(new THREE.Vector3(0, thumbJoints[2].length, 0)))
        const writePoints = (line, vertices) => {
          vertices.forEach((point, i) => line.geometry.attributes.position.setXYZ(i, point.x, point.y, point.z))
          line.geometry.attributes.position.needsUpdate = true
        }
        writePoints(thumbBonesLine, points)
        if (thumbTargetLine.visible) {
          const parent = thumbJoints[0].bone.parent
          const point = (thumbRootTarget ?? thumbJoints[0].bone.position).clone()
          const orientation = new THREE.Quaternion()
          const targets = [parent.localToWorld(point.clone())]
          thumbJoints.forEach(({ length }, i) => {
            orientation.multiply(thumbTargets[i])
            point.add(new THREE.Vector3(0, length, 0).applyQuaternion(orientation))
            targets.push(parent.localToWorld(point.clone()))
          })
          writePoints(thumbTargetLine, targets)
        }
        if (thumbRawLine.visible) {
          // Anchor both comparisons at the model's target root and use the
          // same lengths. This compares directions without size differences.
          const parent = thumbJoints[0].bone.parent
          const point = (thumbRootTarget ?? thumbJoints[0].bone.position).clone()
          const raw = [parent.localToWorld(point.clone())]
          thumbJoints.forEach(({ length }, i) => {
            point.addScaledVector(new THREE.Vector3().fromArray(thumbRawSegments[i]).normalize(), length)
            raw.push(parent.localToWorld(point.clone()))
          })
          writePoints(thumbRawLine, raw)
        }
      }
      renderer.render(scene, camera)
    })
    return () => {
      disposed = true
      apiRef.current = null
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      mixer?.stopAllAction()
      if (model) mixer?.uncacheRoot(model)
      disposeObjects(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [handSampleRef])

  function changeMode(nextMode) {
    cancelFingerCollections(fingerCalibrationRef.current)
    for (const state of Object.values(thumbCalibrationRef.current)) state.request = null
    setCalibrating(false)
    playingRef.current = false
    setPlaying(false)
    modeRef.current = nextMode
    setMode(nextMode)
    apiRef.current?.open()
    if (nextMode === 'live') {
      setView('straight')
      apiRef.current?.view('straight')
    }
  }

  function togglePlayback() {
    playingRef.current = !playingRef.current
    setPlaying(playingRef.current)
  }

  // Recalibrate only the currently tracked hand; the other hand keeps its reference.
  function calibrateFingers() {
    const sample = handSampleRef.current
    if (!sample || performance.now() - sample.timestamp > 400) return
    fingerCalibrationRef.current[sample.handedness] = createFingerCalibration()[sample.handedness]
    thumbCalibrationRef.current[sample.handedness] = createThumbCalibration()
  }

  return <section className="hand-viewer-card" aria-labelledby="hand-viewer-title">
    <div className="viewer-heading"><h2 id="hand-viewer-title">Your hand in 3D</h2><span>{mode === 'live' ? 'Live palm' : 'Model preview'}</span></div>
    <div className="hand-room">
      <div className="hand-render" ref={hostRef} />
      {!ready && <p className="viewer-message" role={failed ? 'alert' : 'status'}>{status}</p>}
      {ready && <span className="second-hand-space">Room for hand two</span>}
      <span className="orbit-hint">Drag to orbit · Scroll to zoom</span>
    <div className="viewer-controls" aria-label="3D preview controls">
      <button disabled={!ready || failed} aria-pressed={mode === 'live'} onClick={() => changeMode(mode === 'live' ? 'test' : 'live')}>{mode === 'live' ? 'Test mode' : 'Live mirror'}</button>
      {mode === 'test' && <button disabled={!ready || failed} aria-pressed={playing} onClick={togglePlayback}>{playing ? 'Pause' : 'Play test'}</button>}
      {mode === 'test' && <button disabled={!ready || failed} onClick={() => apiRef.current?.restart()}>Restart</button>}
      <button aria-label="Zoom in" disabled={!ready || failed} onClick={() => apiRef.current?.zoom(0.85)}>+</button>
      <button aria-label="Zoom out" disabled={!ready || failed} onClick={() => apiRef.current?.zoom(1.15)}>−</button>
      <button onClick={() => apiRef.current?.reset()} disabled={!ready || failed}>Reset view</button>
      <button disabled={!ready || failed} aria-pressed={showThumbSkeleton} onClick={() => {
        thumbSkeletonRef.current = !thumbSkeletonRef.current
        setShowThumbSkeleton(thumbSkeletonRef.current)
      }}>Thumb skeleton</button>
      <label className="viewer-select">View <select value={view} disabled={!ready || failed} onChange={event => {
        setView(event.target.value)
        apiRef.current?.view(event.target.value)
      }}><option value="straight">Straight-on</option><option value="room">Room angle</option></select></label>
      {mode === 'live' && <label className="viewer-select">Hand <select value={selectedHand} onChange={event => {
        cancelFingerCollections(fingerCalibrationRef.current)
        for (const state of Object.values(thumbCalibrationRef.current)) state.request = null
        setCalibrating(false)
        setTipInfo(null)
        onSelectHand(event.target.value)
      }}>
        <option value="auto">Auto (first hand)</option><option value="Left">Left</option><option value="Right">Right</option>
      </select></label>}
      {mode === 'live' && <button disabled={!ready || cameraState !== 'on' || calibrating} onClick={calibrateFingers}>{calibrating ? 'Sampling…' : 'Recalibrate hand'}</button>}
      {mode === 'live' && <button disabled={!ready || cameraState !== 'on'} onClick={() => {
        const sample = handSampleRef.current
        if (sample && performance.now() - sample.timestamp < 400) thumbCalibrationRef.current[sample.handedness] = createThumbCalibration()
      }}>Recalibrate thumb</button>}
      {mode === 'live' && <button onClick={() => {
        fingerCalibrationRef.current = createFingerCalibration()
        thumbCalibrationRef.current = { Left: createThumbCalibration(), Right: createThumbCalibration() }
        setCalibrating(false)
      }}>Clear calibration</button>}
    </div>
    <p className="viewer-caption" role="status">{mode === 'live' ? liveMessage : 'Finger test · Switch to Live mirror to follow your palm'}</p>
    {mode === 'live' && <div className="tip-diagnostics">
      <span>Open your hand comfortably with natural finger spacing and your thumb extended away from the palm.</span>
      {showThumbSkeleton && <span>Cyan: model bones · Amber: corrected targets · Magenta: raw tracked directions</span>}
      {cameraState === 'on' && tipInfo && <span>Index base: measured {tipInfo.base}° → target {tipInfo.baseTarget}°</span>}
      {cameraState === 'on' && tipInfo && <span>Index middle: 3D {tipInfo.middle3D}° → target {tipInfo.middleTarget}°</span>}
      <span>{cameraState === 'on' && tipInfo ? `Index tip: measured ${tipInfo.estimated}° → target ${tipInfo.corrected}°` : 'Index tip: waiting for tracking'}</span>
      <div className={`calibration-progress calibration-${calibrationFeedback.state}`}>
        <span role="status">{calibrationFeedback.message}</span>
        {calibrationFeedback.fingers?.map(finger => <div className="calibration-progress-row" key={finger.finger}>
          <span>{finger.finger}</span>
          <progress aria-label={`${finger.finger} calibration sample progress`} max="100" value={finger.progress} />
          <span>{finger.progress}%</span>
        </div>)}
      </div>
    </div>}
    </div>
  </section>
}
