export const REVIEW_STATUSES = ['pending', 'accepted', 'rejected']

// Validate saved annotations against the video, not just its potentially repeated filename.
// Support one selected static segment; unsupported formats fail explicitly.
export function validateAnnotation(data, { recordingId, inputSha256, durationMs }) {
  if (!data || data.schemaVersion !== 1 || data.recordingId !== recordingId ||
      data.inputSha256 !== inputSha256) {
    throw new Error('Annotation version, recording ID, or video fingerprint does not match.')
  }
  if (!REVIEW_STATUSES.includes(data.reviewStatus) || typeof data.notes !== 'string' ||
      !(data.reviewerId === null || typeof data.reviewerId === 'string') ||
      !(data.reviewedAt === null || (typeof data.reviewedAt === 'string' && Number.isFinite(Date.parse(data.reviewedAt))))) {
    throw new Error('Invalid review status, reviewer, date, or notes.')
  }
  if (!Array.isArray(data.segments) || data.segments.length !== 1 ||
      !isSupportedTarget(data.segments[0]?.targetId)) {
    throw new Error('Select one supported target: A, S, B, or a non-target example.')
  }
  const segment = data.segments[0]
  if (segment.targetId === NON_TARGET_ID && !data.notes.trim()) {
    throw new Error('Describe the selected non-target pose in Notes (for example, relaxed hand).')
  }
  const hold = segment.targetHold
  const validRange = range => range && Number.isFinite(range.startMs) && Number.isFinite(range.endMs) &&
    range.startMs >= 0 && range.startMs < range.endMs && range.endMs <= durationMs
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !validRange(segment) || !validRange(hold)) {
    throw new Error('Set all four times: each start must precede its end, within the video.')
  }
  if (hold.startMs < segment.startMs || hold.endMs > segment.endMs) {
    throw new Error('The target hold must be entirely inside the demonstration interval.')
  }
  return data
}

// Empty numeric inputs must remain unset; Number('') would incorrectly turn them into zero.
export function secondsToMs(value) {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) * 1000 : NaN
}
import { isSupportedTarget, NON_TARGET_ID } from './vocabulary.js'

