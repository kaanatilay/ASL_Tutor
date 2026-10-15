import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

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

export default function HandViewer() {
  const hostRef = useRef(null)
  const apiRef = useRef(null)
  const playingRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('Loading your hand model…')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

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
    let lastTime
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#142943')
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
      camera.updateProjectionMatrix()
      renderer.setSize(Math.max(width, 1), Math.max(height, 1))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    apiRef.current = {
      reset: () => controls.reset(),
      zoom: factor => {
        const offset = camera.position.clone().sub(controls.target)
        offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 5, 19))
        camera.position.copy(controls.target).add(offset)
        controls.update()
      },
      restart: () => { mixer?.setTime(0) },
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
        const placement = new THREE.Group()
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
      if (playingRef.current) mixer?.update(delta)
      controls.update()
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
  }, [])

  function togglePlayback() {
    playingRef.current = !playingRef.current
    setPlaying(playingRef.current)
  }

  return <section className="hand-viewer-card" aria-labelledby="hand-viewer-title">
    <div className="viewer-heading"><h2 id="hand-viewer-title">Your hand in 3D</h2><span>Model preview</span></div>
    <div className="hand-room">
      <div className="hand-render" ref={hostRef} />
      {!ready && <p className="viewer-message" role={failed ? 'alert' : 'status'}>{status}</p>}
      {ready && <span className="second-hand-space">Room for hand two</span>}
      <span className="orbit-hint">Drag to orbit · Scroll to zoom</span>
    </div>
    <div className="viewer-controls" aria-label="3D preview controls">
      <button disabled={!ready || failed} aria-pressed={playing} onClick={togglePlayback}>{playing ? 'Pause' : 'Play test'}</button>
      <button disabled={!ready || failed} onClick={() => apiRef.current?.restart()}>Restart</button>
      <button aria-label="Zoom in" disabled={!ready || failed} onClick={() => apiRef.current?.zoom(0.85)}>+</button>
      <button aria-label="Zoom out" disabled={!ready || failed} onClick={() => apiRef.current?.zoom(1.15)}>−</button>
      <button onClick={() => apiRef.current?.reset()} disabled={!ready || failed}>Reset view</button>
    </div>
    <p className="viewer-caption">Finger test only · Live mirroring comes next</p>
  </section>
}
