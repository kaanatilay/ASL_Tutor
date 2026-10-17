import { validateGuide } from './silhouette.js'
export const GUIDE_STORAGE_KEY = 'asl-tutor.guides.v1'

// Treat browser data as untrusted input. A damaged entry need not discard other letters.
export function loadGuides(storage) {
  try {
    const saved = storage.getItem(GUIDE_STORAGE_KEY)
    if (!saved) return { guides: {}, message: '' }
    const parsed = JSON.parse(saved)
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.guides || typeof parsed.guides !== 'object' || Array.isArray(parsed.guides)) throw new Error('Invalid guide collection.')
    const guides = {}
    let rejected = 0
    for (const [id, guide] of Object.entries(parsed.guides)) {
      try { validateGuide(guide); if (id !== guide.targetId) throw new Error('Wrong target key.'); guides[id] = guide }
      catch { rejected++ }
    }
    return { guides, message: rejected ? `${rejected} invalid saved guide(s) skipped. Reimport their JSON backups.` : '' }
  } catch { return { guides: {}, message: 'Saved guides could not be read. Import a guide JSON backup if needed.' } }
}

// Persist one collection atomically. Failure leaves the in-memory collection usable
// and reports that it will not survive refresh. No source image pixels are stored.
export function persistGuides(storage, guides) {
  try {
    for (const [id, guide] of Object.entries(guides)) {
      validateGuide(guide)
      if (id !== guide.targetId) throw new Error('Wrong target key.')
    }
    storage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, guides }))
    return { persisted: true, message: 'Guides saved in this browser. A new guide replaces only the same letter.' }
  } catch { return { persisted: false, message: 'Browser storage unavailable or full. Guides work for this session only; export guide.json as a backup.' } }
}
