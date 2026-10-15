import { useEffect, useRef, useState } from 'react'
import './App.css'
import useHandTracking from './useHandTracking'

// A small vector camera icon stays crisp without loading an external image.
function CameraIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="3" /><path d="m16 10 5-3v10l-5-3" /></svg>
}

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const mountedRef = useRef(false)
  const [cameraState, setCameraState] = useState('off')
  const [cameraError, setCameraError] = useState('')
  const [selectedLetter, setSelectedLetter] = useState('A')
  const trackingFeedback = useHandTracking(cameraState, videoRef, canvasRef)

  // Release every camera track when the page component leaves the screen.
  // The mounted flag also handles permission requests resolved after leaving.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      streamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  // Attach the live stream directly to the video: no recording or upload occurs.
  useEffect(() => {
    if (cameraState === 'on' && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [cameraState])

  // Request video only after an explicit click; microphone access is never requested.
  async function enableCamera() {
    setCameraError('')
    setCameraState('requesting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('unsupported')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }, audio: false,
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream
      setCameraState('on')
    } catch (error) {
      if (!mountedRef.current) return
      const messages = {
        NotAllowedError: 'Camera access was not allowed. Check your browser camera permissions, then try again.',
        NotFoundError: 'No camera was found. Connect a webcam and try again.',
        NotReadableError: 'Your camera could not start. Close other apps using it, then try again.',
      }
      setCameraError(messages[error.name] || 'Camera access is unavailable. Use localhost or a secure HTTPS address and check your camera connection.')
      setCameraState('off')
    }
  }

  // Stopping tracks releases the physical camera, rather than just hiding its image.
  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraState('off')
  }

  return (
    <main className="homepage">
      <header className="page-header">
        <a className="brand" href="./">ASL<span>_Tutor</span><span className="brand-dot" /></a>
        {/* Pair the hook with illustrated steps to leave more room for practice. */}
        <div className="header-content">
          <div className="header-hook">
            <p className="eyebrow">A little practice. A new way to connect.</p>
            <h1>Small gestures. <span>New connections.</span></h1>
          </div>
          <div className="journey-guide">
            <p className="intro">Make room for a little discovery.</p>
            <ol className="journey-steps">
              <li><span className="step-icon letter-icon" aria-hidden="true">A</span><span>Pick a letter</span></li>
              <li><span className="step-icon" aria-hidden="true"><CameraIcon /></span><span>Find your frame</span></li>
              <li><span className="step-icon" aria-hidden="true">✧</span><span>Start your ASL journey</span></li>
            </ol>
          </div>
        </div>
      </header>

      <div className="practice-layout">
        <section className="practice-card" aria-labelledby="practice-title">
          <div className="section-heading"><h2 id="practice-title">Your practice space</h2><span className="status"><i className={cameraState === 'on' ? 'live-dot' : ''} />{cameraState === 'on' ? 'Camera on' : 'Camera off'}</span></div>
          <div className={`camera-stage ${cameraState === 'on' ? 'camera-active' : ''}`}>
            {cameraState === 'on' ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted aria-label="Live mirrored webcam preview" />
                <canvas ref={canvasRef} className="hand-overlay" aria-hidden="true" />
                <button className="stop-button" onClick={stopCamera}>Turn off camera</button>
              </>
            ) : (
              <div className="camera-prompt">
                <div className="camera-icon"><CameraIcon /></div>
                <span className="prompt-kicker">YOUR NEXT CHAPTER STARTS WITH A HELLO</span>
                <h3>Ready to wave hello?</h3>
                <p>We need your permission to turn on the camera.<br />Get comfortable. This space is yours.</p>
                <button className="primary-button" onClick={enableCamera} disabled={cameraState === 'requesting'}><CameraIcon />{cameraState === 'requesting' ? 'Waiting for permission…' : 'Enable camera'}</button>
                {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
              </div>
            )}
            <div className="feedback-panel" role="status"><span className="feedback-spark" aria-hidden="true">✧</span><div><strong>Your hand tracking</strong><p>{trackingFeedback}</p></div></div>
          </div>
          <p className="privacy-note"><span aria-hidden="true">◉</span> Live preview only. Nothing is recorded, saved, or uploaded. No microphone access.</p>
        </section>

        <aside className="alphabet-card" aria-labelledby="alphabet-title">
          <span className="panel-kicker">ONE LETTER AT A TIME</span>
          <h2 id="alphabet-title">Meet the alphabet</h2>
          <p>Choose a character to explore.</p>
          <div className="selected-letter" aria-label={`Selected letter: ${selectedLetter}`}><span>{selectedLetter}</span><small>Your selected letter</small></div>
          <div className="alphabet-grid" aria-label="Choose a letter">
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => <button key={letter} className={selectedLetter === letter ? 'letter selected' : 'letter'} aria-pressed={selectedLetter === letter} onClick={() => setSelectedLetter(letter)}>{letter}</button>)}
          </div>
          <p className="alphabet-note">Every connection starts somewhere.<br />Let's start here.</p>
        </aside>
      </div>
      <footer>Take your time. Make it your own.</footer>
    </main>
  )
}



