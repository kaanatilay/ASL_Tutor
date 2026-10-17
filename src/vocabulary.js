import vocabulary from '../data/vocabulary.json' with { type: 'json' }

// Non-target is an experimental annotation category, not an ASL vocabulary entry
// or a claim that a pose cannot represent any sign. Keep its meaning explicit.
export const NON_TARGET_ID = 'example.non-target'
export const ANNOTATION_TARGETS = [...vocabulary.entries, {
  id: NON_TARGET_ID, label: 'Non-target example', category: 'non-target', targetType: 'static',
}]
export const isSupportedTarget = id => ANNOTATION_TARGETS.some(target => target.id === id)
export const targetLabel = id => ANNOTATION_TARGETS.find(target => target.id === id)?.label ?? 'Unknown target'
