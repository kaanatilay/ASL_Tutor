# ASL Tutor data collection

## Persistent A/S/B guides and experimental live matching

Guides now support all three experimental letters. **Save and use outline in
Practice** stores a validated contour per target in browser localStorage under
`asl-tutor.guides.v1`. A newly saved/imported guide replaces only that letter.
Guides survive page refresh and internal navigation on the same browser origin;
localhost and 127.0.0.1 (or different ports/browser profiles) have separate storage.
Clearing site data removes guides. Keep exported guide.json files as backups.
Storage failure leaves the in-memory guide usable with an explicit session-only
warning. Practice can remove only the selected letter's guide. No source pixels or
videos are stored in browser persistence. Older A guide JSON remains compatible.

Practice selects the saved guide corresponding to the selected letter. A top-left
webcam button toggles it independently of tracking and live score calculations;
the camera-off button stays at top-right. The existing Show dotted outline checkbox
controls the same state. S/B extraction still uses the color heuristic below and
requires preview review; extending the label support does not establish mask quality.

Live matching is a separate module (`src/liveMatching.js`) and panel, independent of
the contour. Expand **Reference feature files** in Practice and load one or more
features.json files for A/S/B. Additional imports accumulate by recording ID;
matching IDs replace previous references. Load files from different recording folders
in successive selections if the file picker cannot select across folders. The bank
stays in memory while switching letters or turning the camera off/on on Practice;
leaving Practice or refreshing discards the bank. Feature references are not saved
in localStorage. No server endpoint or public data asset is required.

Each imported feature file is validated using the offline comparison checks and
converted to the same pose-vector-v001 hold descriptor. Only left-hand references
are supported initially. Only the selected letter's references are compared, with
the best cosine and best Euclidean candidates selected independently and their IDs
displayed. Palm orientation of the latest sample is reported separately against the
Euclidean-best reference's mean orientation. This is selected-target matching, not
unknown-letter recognition or a calibrated correctness test.

The live path buffers unique, trusted left-hand samples within a rolling 1000 ms
window, requiring at least 10 samples spanning 750 ms before displaying scores.
It samples the latest tracker observation at a 100 ms readout interval, so it may
use fewer observations than the 20-Hz tracker. A second live hand, tracking loss,
handedness below 0.80, invalid geometry, or a gap of 250 ms clears the window.
Live normalization and measurement aggregation reuse pipeline-v001 and pose-vector-v001;
no interpolation, different normalization, or viewer calibration is introduced.
Target, reference bank, hand selection, camera changes, and leaving Practice reset
the rolling readout. Scores intentionally lag pose changes by the window duration.

Two matching cards share the same style but retain honest raw units: cosine
similarity (higher/1 is closer), scaled Euclidean distance (lower/0 is closer).
No percentage mapping, success threshold, three-second success bar, or corrective
feedback has been implemented. Reference review status and excluded-sample warnings
remain visible. The first recordings are learner examples pending ASL review.

Manual review: save/build or import A/S/B guides, refresh to verify persistence,
replace one and check the others remain, toggle the contour from the webcam corner,
then load feature references and compare attempts for each selected letter. Check
that scores clear when the hand leaves, the camera stops, or the target changes.
Automated tests cover storage replacement/failure and live window timing/reset and
identity against offline features. Actual camera behavior still requires review.

## Left-hand A outer silhouette experiment

The first outline guide is built from a locally loaded source recording, not from
the 3D model or a hull around joint points. It requires manual visual review and
does not score attempts or drive the planned three-second success interaction.

1. In Data preparation, select rec-000001/source.mp4, enter rec-000001, load its
   landmarks.json, then annotation.json. No re-extraction/normalization is needed.
2. Below the annotation/normalization controls, choose **Build A outline from held
   frame**. The builder chooses the confident single-left-hand sample nearest the
   middle of the annotated hold and seeks the local video to that sampling time.
3. Inspect the cropped hand preview with its dotted contour. Check that the outline
   includes the thumb and fingers, excludes background, and ends near the wrist.
4. Choose **Use outline in Practice**, switch to Practice, select A, and turn on
   the webcam. The guide is retained in app memory across internal page navigation.
   Expand **Outer silhouette guide — A experiment** to hide the live skeleton if
   it distracts from contour review, hide the guide, or remove it.
5. Optionally export guide.json into data/derived/pipeline-v001/rec-000001/. Reload
   it through Practice's guide file input after a browser refresh. It stores only
   contour coordinates and provenance, not image pixels. The cropped preview stays
   in browser memory. Do not put source recordings or generated artifacts in public/.

Extraction method `palm-seeded-chroma-v001` samples palm-interior chroma colors,
grows a connected color mask inside a landmark-derived region, and cuts off the
forearm using the wrist-to-knuckle direction. It rejects small/degenerate reference
palms and insufficient mask area. Boundary tracing keeps the largest-area closed
loop, preserving outer concavities rather than applying a convex hull. Interior
mask holes are omitted. Coordinates are image-X/Y relative to the wrist, divided
by image palm width (landmarks 5-to-17). The 2D contour is not palm-rotation-normalized.

This color heuristic is intended for the clear-background recording 1. It can fail
on neutral/low-saturation skin pixels, colored backgrounds, shadows, disconnected
fingers, and occlusions. It is not a general segmentation model or verified on the
actual video by automated tests. A failed or poor-looking contour should be reviewed
before changing extraction or switching to the skeleton fallback.

Practice uses a separate mirrored canvas aligned through object-fit:contain, just
like the video. Only overall translation/scale follow the live left wrist and image
palm width, smoothed with a 120-ms time constant. The target finger contour does not
deform or rotate with the learner's hand. It requires fresh left-hand tracking and
handedness score at least 0.80, hides when these fail, and resets smoothing after
tracking loss or resize. It is disabled for other selected letters and explicit
Right-only view. Exact silhouette overlap is not required and does not establish
correctness; different proportions and viewing angles will affect the fit.

Automated verification covers synthetic segmentation/wrist cutoff, background
failure, concavity tracing, contain mapping/resizing, and guide import validation.
Manual camera review remains necessary: move/resize the hand, leave/reenter view,
switch letters/hands, resize the window, and turn the camera off/on. Scoring,
colored finger regions, target rotation, and other letter guides remain future work.

## Current target support: A, S, B, and non-target examples

The earlier A-only examples below describe the initial pipeline. Target selection
now uses `data/vocabulary.json` for A/S/B and `src/vocabulary.js` for the explicit
experimental `example.non-target` category. Non-target is not an ASL vocabulary
entry or proof that a pose is absent from every signed language.

Confirmed input layout: rec-000004 through rec-000011 each contain source.mp4.
User-provided labels are 4–6 = S, 7–9 = B, and 10–11 = non-target/relaxed examples.
These labels have not been visually or independently verified.

To process each new clip:

1. Select source.mp4 and enter its matching recording ID **before** extraction.
2. Extract/export landmarks and metadata into that recording folder as before.
3. Select the target in the annotation editor (no default is chosen for a new
   recording), mark demonstration and hold, leave review pending, and export
   annotation.json beside the video. Loading an existing annotation restores its
   label. Changing a label invalidates the saved-annotation match and any features
   until the annotation is exported again.
4. Normalize the saved hold and export features.json into
   data/derived/pipeline-v001/<recording-id>/. The target is preserved in its
   embedded annotation and top-level targetId. Tracking metadata remains label-free.
5. Load any two feature files on Comparison, including across different letters.
   Recording A/B identifies UI slots, not letter labels. The selected targets are
   shown explicitly. Handedness and recipe compatibility checks remain enforced.

For non-target clips, select one stable pose interval, choose Non-target example,
and describe it in Notes (required). A continuously changing interval cannot be
meaningfully represented as one static pose. Keep distinct poses in separate
recordings for now rather than assigning several labels to one clip. Non-target
comparisons remain numeric diagnostics, with no learned unknown-gesture rejection.

Existing A annotations/features remain compatible without regeneration. No schema,
normalization recipe, vector recipe, or similarity formula changed. Labels do not
alter similarity calculations. Source video content and technique correctness still
require human review; matching measurements alone does not establish correct ASL.

This README explains the collection for project maintainers. The first target is
letter A: retain the movement into the letter for demonstrations, but primarily
evaluate the held result. No reference recordings have been selected or verified.
The Data preparation page now supports local video extraction and saved-landmark
playback, manual time-range annotation, and target-hold normalization. Training and
gesture evaluation are not implemented.

## Layout

```text
data/
  vocabulary.json
  recordings/
    rec-000001/
      metadata.json
      source.mp4
      landmarks.json
      annotation.json
  derived/
    pipeline-v001/
      rec-000001/
        features.json
  datasets/
    alphabet-v001.json
```

Only the vocabulary and empty folder markers currently exist. `.gitkeep` is an
empty placeholder that lets Git retain a folder. The recording, features, and
dataset paths above illustrate future files, not existing samples.

## Ownership and storage

- Commit documentation, vocabulary definitions, future format definitions, and
  small synthetic test fixtures. Keep fixtures outside the ignored data folders.
- Videos, extracted measurements, derived features, and experiment manifests are
  initially local and ignored by Git. Ignoring files is not access control or a
  backup. Back up the collection separately when real recordings are added.
- A publicly watchable video is not automatically available for reuse. Before
  downloading, check the source's download/reuse terms and document the evidence.
  Publication requires a separate review of redistribution permissions.
- Use paths relative to the data root and permanent recording IDs. Do not embed
  a developer's absolute PC paths in records. A future configurable data root or
  storage adapter can relocate the collection to another disk or cloud storage.
  Cloud access is not implemented; cloud processing is a separate decision.

## Naming and versions

- Vocabulary IDs describe targets, such as `asl.alphabet.a`; display labels may
  change without changing the ID. `language: "ase"` identifies American Sign
  Language using its ISO 639-3 code.
- Assign each recording a unique ID (`rec-000001`, `rec-000002`, ...). Do not reuse
  IDs or rename recordings when a label is corrected. Check for collisions when
  importing another collection; automatic ID allocation is future work.
- Give every JSON record a numeric `schemaVersion`, starting at `1`. This records
  its file layout: changing where a field lives may require a new schema version.
- `pipeline-v001` identifies a reproducible feature-processing recipe. A change
  to normalization or feature calculations creates a new recipe even if the JSON
  layout stays the same. Store its actual settings/version in each feature file;
  a folder name alone is not enough to reproduce processing.
- A dataset name such as `alphabet-v001` identifies a selected experiment list.
  It does not identify the feature recipe. Each experiment must name its recipe.

## Recording files: agreed field plan

These fields describe the collection plan. The current exporter implements metadata
and landmarks, the annotation editor saves annotations, and normalization exports features. Landmark imports validate
version, video fingerprint, recording ID, timestamps, and image landmark positions.
All times below are milliseconds relative to video start,
not wall-clock dates or frame numbers. Use null for unknown optional facts rather
than inventing values.

### metadata.json

Describes the source and extraction, independently of the gesture annotation:

- `schemaVersion`, `recordingId`, `createdAt` (UTC ISO date/time).
- `signerId`, `sessionId`: anonymous IDs when known. Unknown signer identity must
  remain explicit; separate unknown clips cannot be assumed to be different people.
- `source`: `url`, `title`, `creator`, `retrievedAt`, `license`,
  `permissionEvidence`, `reuseStatus`, and `redistributionStatus`. Permission
  evidence should identify the terms URL and relevant permission details.
- `video`: `path`, `sha256`, `width`, `height`, `durationMs`, `frameRate`, and
  `mirrored`. The path is relative to the data root. Retain the source encoding
  and extension when it is not MP4; do not merely rename it to `source.mp4`.
- `extraction`: initially null; later `tool`, `toolVersion`, `modelVersion`,
  `settings`, `extractedAt`, `inputSha256`, and `outputPath`.

Use explicit `unknown`, `allowed`, or `disallowed` permission statuses. Recording
source facts does not itself establish permission. Track any future conversion
or trimming as a derived operation; preserve the original video.

### landmarks.json

Stores tracker output before our smoothing, normalization, or animation mapping:

- `schemaVersion`, `recordingId`, `extraction`, and `coordinateSystems`.
- `frames`: timestamped samples, each containing `timestampMs` and `hands`.
- Each detected hand retains its tracker-provided landmark coordinates,
  handedness label and score. Preserve image and world coordinates when available,
  with their units and coordinate conventions documented.
- Store samples with no detections as `hands: []`. Record processing errors or
  skipped samples separately; they are not equivalent to a successful empty result.
- Handedness scores describe left/right classification, not joint accuracy.
  Detector order must not be treated as a persistent hand identity.

Do not save the rendered model's bone positions as source hand measurements.
Keep extraction provenance with the output, including the source video hash.

### annotation.json

Describes what a reviewer identifies in the recording:

- `schemaVersion`, `recordingId`, `reviewStatus`, `reviewerId`, `reviewedAt`, `notes`.
- `inputSha256`: original video fingerprint, checked along with the recording ID
  when reloading an annotation. This pairs intervals with the correct source file.
- `segments`: each has `targetId`, `startMs`, `endMs`, `targetHold`, and `notes`.
- `targetHold`: `startMs` and `endMs` for a static target; null if not identified
  or not applicable. A hold must fall within its enclosing demonstration segment.
  The current editor requires a complete non-null hold and exactly one A segment;
  incomplete or moving-target annotation is reserved for a later milestone.
- Review statuses: `pending`, `accepted`, or `rejected`. Only accepted examples
  should become reference demonstrations or experiment inputs.

For A, the segment includes its approach movement and hold. The hold identifies
the main evaluation target; it does not require learners to copy the exact approach.
Other letters can later use moving targets. Review should check gesture accuracy,
tracking usability, and source suitability; fluent ASL review remains a goal.

## Derived features

`derived/pipeline-v001/rec-000001/features.json` contains:

- `schemaVersion`, `recordingId`, `pipelineVersion`, `settings`, `generatedAt`.
- `inputs`: paths and hashes for the extraction and any annotations used.
- Timestamped normalized measurements and validity/missing-data flags.

The approved first recipe exports palm-relative joint coordinates, source-space
palm orientation axes, estimated palm width, handedness, and source image wrist
position. Finger angles, explicit motion features, and gesture scores are future
work. Missing/invalid samples remain explicit; no gaps are filled.

Features are regenerable. Keep the source extraction and create a new pipeline
version when comparing processing changes. Changes to extraction itself must also
be recorded and must not silently overwrite measurements used by an experiment.

## Dataset manifests

A future `datasets/alphabet-v001.json` selects recordings without copying videos:

- `schemaVersion`, `datasetId`, `createdAt`, `pipelineVersion`, `notes`.
- `training`, `validation`, `testing`: recording ID lists.

Training fits a model; validation helps choose improvements; testing assesses the
result using held-aside examples. Keep a signer in only one group, and check source
duplicates across groups. Unknown signer identity limits claims about performance
on new people. Pin input hashes or record revisions when creating an experiment
so later annotation edits cannot silently change its meaning.

No dataset manifest is needed until an experiment has suitable recordings. A single
A example can verify the data pipeline, but cannot establish recognition accuracy.

## Planned workflow and review

### Current extraction tool

1. Run `npm run dev`, open the app, and choose **Data preparation** in the top bar.
2. Select a video (up to two minutes), enter its `rec-000001`-style ID, and optionally
   supply anonymous signer/session IDs. Use the same signer ID for all your clips;
   do not assume different recordings mean different people. Leave mirroring unknown
   unless you know whether the source file is mirrored.
3. Choose **Extract landmarks**. MediaPipe assets download, but video contents stay
   in the browser. Extraction seeks through the file at 20 requested samples/second;
   timestamps identify media sampling times, not every encoded frame. Frame rate
   is exported as null because browser metadata does not reliably expose source FPS.
4. Play and seek the completed video. The overlay uses saved samples without new
   inference, clears empty samples, and does not bridge gaps longer than 75 ms.
   Handedness scores are shown during playback; they are not joint confidence.
5. Export both JSON files and place them beside the matching source video. Browser
   downloads may add suffixes; the final names should be `metadata.json` and
   `landmarks.json`. The video path in metadata assumes the planned `source` filename
   with the selected file's extension. Check that this matches the actual stored file.
6. Reselect the video and enter its ID, then load its saved `landmarks.json` to verify
   playback. Import checks a SHA-256 fingerprint against the selected video's bytes.
   Imported landmarks do not recreate metadata; the original metadata export remains
   the source record. Imported JSON is limited to 100 MB for this initial tool.

Selecting another file or leaving this page discards unsaved work. Navigation to
Data preparation unmounts Practice and releases its camera resources. Processing
errors abort the extraction rather than exporting partial samples. Successful
empty detections are stored as empty hand lists. Extraction uses source tracker
output, not practice-page calibration, smoothing, or model bone transformations.
The current metadata exporter is for user-owned learner recordings authorized for
local processing; third-party import permissions need a future metadata workflow.

### Marking intervals in the current tool

1. Select the video with its matching recording ID and load `landmarks.json` (or
   extract it). The annotation editor appears after measurements are available.
2. Pause/seek to the beginning of forming A and choose **Set from video** for
   Demonstration start. Repeat for Demonstration end, including the held pose.
3. Mark Target-hold start/end around only the steady held A. Times can also be
   typed in seconds with millisecond precision. Stored annotation times use ms.
4. Use each boundary's **Jump** button to return to it for inspection. These
   buttons pause and seek; they do not trim the video or automatically loop a range.
5. Leave review status **pending** for learner examples awaiting technique review;
   enter notes and optionally an anonymous reviewer ID. Accepted/rejected are human
   decisions, not automatic scores. Non-pending exports receive the export-time
   `reviewedAt`; pending exports have null. Exporting a loaded annotation records a
   new review time for a non-pending status.
6. Export `annotation.json` beside the video's other files. Reload it using **Load
   annotation.json** to verify restored times, notes, and status. The importer checks
   format version, video hash, recording ID, ranges, review fields, and target label.

The editor rejects missing, reversed, nonfinite, and out-of-video boundaries; the
hold must fit inside the demonstration. Equal segment/hold boundaries are allowed.
Inputs remain drafts until exported. Selecting another source or leaving the page
discards unsaved changes. Imports larger than 1 MB are rejected. Failed imports
leave the current draft intact. Annotation does not change source videos or tracking
measurements and does not itself verify ASL correctness or drive the 3D model.

### Remaining pipeline work

### Normalizing the saved target hold

1. Load the source video, matching `landmarks.json`, and `annotation.json`. The
   normalization panel appears below the annotation editor. If you edit annotation
   fields, export the annotation again before generating features. This keeps its
   saved intervals consistent with the features' embedded annotation snapshot.
2. Choose **Normalize target hold** and inspect sample counts, source palm-width
   range, handedness labels, and warnings. Pending/rejected examples can be used for
   pipeline diagnostics but remain flagged as not accepted reference material.
3. Choose **Export features.json**. Create the corresponding folder, for example
   `data/derived/pipeline-v001/rec-000001/`, and save the file there. Repeat for each
   recording. Source videos, landmarks, and annotations are not overwritten.

Recipe `pipeline-v001` operates independently on every sample whose timestamp is
at or after hold start and before hold end:

- Use the original MediaPipe world landmarks in meters. No viewer reflection,
  calibration, smoothing, handedness conversion, or averaging is applied.
- Subtract wrist landmark 0 and divide lengths by distance between bases 5 and 17.
- Palm Y points from the wrist toward the mean of bases 5, 9, 13, and 17. Palm X is
  the index-base-to-pinky-base direction projected perpendicular to Y. Z = X cross Y.
  Dot products against these orthonormal axes produce normalized joint coordinates.
- Save all three axes in the original world-coordinate convention as orientation,
  retaining the original handedness separately. These axes are hand-relative;
  cross-handed comparisons require a future explicit convention.
- Reject absent/nonfinite world landmarks, palm widths/lengths under 0.00001 m,
  and nearly collinear palms (across/up sine under 0.12). Store the reason per hand.
  Empty detections remain empty frames. Multiple hands are preserved with a review
  warning, rather than silently selecting a hand or assuming persistent identities.
- Warn for missing/invalid samples, multiple hands, mixed handedness labels,
  handedness scores below 0.80 or unknown labels, and non-accepted review status.
  These flags do not establish pose accuracy or correct ASL.

Exports include recipe settings, generated UTC time, source video fingerprint,
paths and SHA-256 hashes of the parsed landmark/annotation JSON serialized with
`JSON.stringify`, and the full annotation snapshot. These content hashes are not
byte hashes of the original pretty-printed JSON files. Original source video SHA-256
remains a byte hash. Changes to the loaded extraction or saved annotation invalidate
the displayed features. Results must be regenerated and exported after input changes.

Synthetic tests verify translation/scale/rotation invariance of normalized shape,
separate orientation changes, preservation of finger differences, and invalid-data
handling. Direct checks on the three initial learner recordings produced 31, 44,
and 29 usable hold samples, respectively; all remain pending ASL review. Browser
normalization/export controls still require manual review. This is measurement
preparation, not a trained recognizer, validated reference vocabulary, or score.

### Future stages

### Comparison inspector

Use the **Comparison** navigation button and select two exported `features.json`
files. The inspector supports pipeline-v001 A features with matching settings and
the same handedness. It limits each import to 20 MB and 5000 samples. It validates
sample ordering, hold membership, joint coordinates, and orthonormal palm axes.
It does not independently check source-video hashes against videos on this page.

Only valid single-hand samples with Left/Right confidence at least 0.80 are used.
Excluded samples are counted; mixed retained labels and no usable samples prevent
comparison. Pending/rejected review status remains visible rather than blocking
development diagnostics. Accepted is a human label, not a correctness guarantee.

- Compute each joint coordinate's median over the usable hold. Compare these
  centers with Euclidean distance per joint, averaged over each finger's four
  landmarks. The overall value averages joints 1–20, excluding the fixed wrist.
  Units are palm widths. Medians summarize all usable samples; they are not
  asserted to form a realizable pose.
- Show the actual sample nearest that median center as a representative skeleton.
  Both SVG views use shared projection bounds, scale, and palm-relative axes.
  Front X/Y, side Z/Y, top X/Z, and colored overlay views expose positional
  differences. Source-space palm orientation is intentionally separate.
- Calculate within-hold shape spread as the 90th percentile of each sample's
  mean joint distance from its hold center. Per-finger spreads use the same rule.
  It describes variation, not a confidence interval or a pass/fail threshold.
- Summarize orientations with a normalized quaternion mean after aligning signs
  to the first sample. Compare rotations using the shortest relative angle in
  degrees. Report the 90th-percentile angular deviation from each hold's mean.
  This summary assumes a held pose; orientation spread over 30 degrees triggers
  an inspection warning, not an ASL correctness decision.

No frame-to-frame alignment is assumed between different-duration holds. Comparing
a recording to itself produces zero difference but can still show nonzero spread.
The page does not select a correct reference, calculate correctness percentages,
apply anatomical tolerances, or produce corrective feedback. Finger proportions
and tracking errors can affect normalized joint distances. Numerical calculations
live in `src/comparison.js`, independently of the page's import and drawing code.

Manual review: load recording 1 into both slots to check zero differences; then
compare 1/2 and 1/3, switch views, enable overlay, and inspect review warnings.
Direct calculation on the first exports gives approximately 0.0379 palm widths /
1.15 degrees for 1/2 and 0.0765 palm widths / 17.07 degrees for 1/3. These are
diagnostic measurements, not rankings of gesture correctness.

### Additional pose measurements

The inspector calculates these at comparison time from the existing feature files;
no extraction, normalization rerun, or pipeline-v001 file changes are needed.
`src/poseMeasurements.js` owns calculation and aggregation; the separate
`PoseMeasurementsPanel.jsx` renders results. It does not combine them into a score.

- **Bends:** two unsigned angles per digit, at thumb landmarks 2/3 and corresponding
  internal joints 6/7, 10/11, 14/15, 18/19. Compare forward segment vectors so straight
  is 0 degrees. These are geometric bend magnitudes, not signed flexion angles.
- **Directions:** three segments per digit (base to next joint, next joint to final
  joint, final joint to tip). Each is a palm-relative unit vector; the thumb begins
  at landmark 1, other digits at 5/9/13/17. Directions describe pointing and include
  base movement, but do not reconstruct axial twist or separately label base
  flexion versus spreading. Thumb root movement 0-to-1 is not a segment descriptor.
- **Relationships:** index/middle, middle/ring, and ring/pinky fingertip distances;
  thumb tip to each of the four fingertips; thumb tip to index base. Thumb/index
  fingertip adjacency appears only once. Distances use palm-width units; proximity
  does not establish contact or which side of a finger the thumb occupies.
- **Orientation:** existing whole-palm rotation difference and within-hold spread
  remain separate above these tables.

Calculate measurements per actual usable frame before aggregation. Scalar centers
are medians; scalar spread is the 90th percentile of absolute deviations from that
center. Direction centers are normalized means of unit vectors; their spread and
between-recording difference use angular distances in degrees. Scalars compare
with absolute center differences. There are 10 bend, 15 direction, and 8 relationship
rows. Each row shows usable counts, exclusions, and an unavailable reason when needed.

Segments shorter than 0.000001 palm widths have undefined direction; dependent bends
are undefined too. Do not replace them with zero angles or invalidate unrelated
measurements. Opposing direction vectors whose mean length is below that same
threshold have no representative direction, even if individual segments are valid.
The angle convention, descriptor set, and thresholds are documented here as the
initial comparison-time implementation; changes require revisiting comparison tests.

Manual review: reload two feature files on Comparison. Check Finger bends, expand
Finger segment directions, and inspect Relationships. Self-comparison should give
zero differences for available values; within-hold spreads may remain nonzero.
Different recordings should change relevant descriptors without a correctness score.
Automated checks cover known bend angles, distance units, symmetric comparisons,
whole-hand transform invariance after normalization, degenerate data, and opposing
direction cancellation. Real learner recordings remain pending ASL review.

### Vector matching experiment: pose-vector-v001

The Comparison page shows cosine similarity and scaled Euclidean distance side by
side, using existing feature files. No vector database, new feature exports,
trained embedding, live webcam matching, or correctness thresholds are added.
`src/poseVector.js` builds vectors and calculates metrics independently of the
display in `VectorMatchPanel.jsx`. The pose-vector version is separate from the
pipeline-v001 normalization version and schema version.

Each hold produces 63 ordered values from its measurement centers:

1. Ten bend angles: Thumb, Index, Middle, Ring, Pinky; internal bend 1 then 2.
   Divide by 180 and multiply by 1/sqrt(10).
2. Forty-five direction coordinates: same digit order; segments 1, 2, 3; X, Y, Z
   per segment. Keep unit-vector components and multiply by 1/sqrt(45).
3. Eight relationship distances: index/middle, middle/ring, ring/pinky tips;
   thumb tip to index, middle, ring, pinky tips; thumb tip to index base.
   Keep palm-width units and multiply by 1/sqrt(8).

The builder matches descriptor IDs, not input row order, and exposes dimension names
and settings with its vector. Missing/duplicate descriptors, unavailable centers,
out-of-range bends, non-unit directions, and invalid distances prevent vector
comparison; the detailed inspector remains available. Centers based on partial
sample availability remain eligible; consult per-measurement counts and spread.
Whole-palm orientation, sample spread, and review status are not vector dimensions.

Equal group multipliers compensate for dimension count, but do not guarantee equal
practical influence or ASL importance. Distances have no fixed maximum. Descriptors
are correlated, so this initial recipe can count aspects of one movement repeatedly.
Scaling, weights, or dimension changes require a new vector recipe version.

Cosine is the dot product of length-normalized vectors, clamped to [-1, 1] for
numerical safety; higher means more similar direction. Euclidean is the norm of
the difference between the scaled vectors without further length normalization;
lower means closer numbers, with no fixed maximum. Self-comparison gives 1 and 0.
Neither is a correctness percentage, calibrated probability, or a preferred method.

Manual review: load recording 1 into both slots and check 1.000000 / 0.000000 in
Vector matching experiment. Then load 2 and 3 in the other slot and compare both
methods with the finger tables and separate palm orientation. No existing data
files need regeneration. Automated tests cover ordering, group scaling, symmetry,
identity, proportional vectors, controlled finger changes, and missing data.

1. Confirm this structure and field plan together.
2. Find a permitted, suitable A video and assign its recording ID and metadata.
3. Implement extraction and inspect landmark timing, detection gaps, and coordinates.
4. Mark the demonstration and held target intervals; review the example.
5. Agree on normalization, generate features, and verify saved/loaded results.
6. Review before moving to 3D demonstration, evaluation, or additional vocabulary.

Later features consume this foundation: recorded 3D demonstrations, target
comparison, recognition across multiple letters, and supported corrective feedback.
Each remains a separate milestone requiring agreement and verification.
