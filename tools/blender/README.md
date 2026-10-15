# Blender hand prototype (Blender 4.5 LTS)

This generates a stylized hand in a new scene. It does not delete existing scenes,
save over a file, install anything, or export automatically. Re-running creates
another scene. Save your existing Blender work before running any script.

## Run the script

1. Open Blender 4.5.4 LTS. Close the splash screen if shown.
2. Click **Scripting** in the workspace tabs at the top. If hidden, scroll the tabs.
3. In the **Text Editor** panel, choose **Text > Open** (or Alt+O with your mouse
   over that panel).
4. Open `create_hand.py` from this project's `tools/blender` folder.
5. Choose **Text > Run Script**, or press **Alt+P** while your mouse is over the
   Text Editor. Wait for the hand to finish generating.
6. Click the **Layout** workspace at the top. The scene selector at the top right
   should show **ASL Hand Prototype** (possibly with a number suffix).
7. The hand should be selected. Hover over the 3D viewport and press **Numpad .**
   to frame it, or use **View > Frame Selected** if you have no number pad.

## Inspect the hand

### Thumb-weight diagnostic view

Crash-fix revision: color layers are now created and filled after weight writes,
using fresh lookups instead of retaining attribute references across allocations.
Before re-running, use **Text > Reload** so Blender executes the updated disk file.
For troubleshooting on Windows, open **Window > Toggle System Console** before
running. The script prints `[ASL Hand]` progress stages there. If Blender closes,
note the last stage visible (a phone recording can help); do not repeatedly run
the same crashing version. These changes have not been runtime-tested in Blender.

The latest script opens in a color inspection view. **Blue = no thumb influence,
yellow = about half, red = full thumb influence**, summed across all three thumb
bones. Blue on other fingers does not mean those fingers are palm-controlled;
this view measures only the thumb. Colors stay attached to the deforming surface.

1. Reload and run `create_hand.py`, then switch to Layout.
2. Compare frames **1** and **21**, particularly the ridge between thumb and palm.
3. With the hand surface selected, open **Object Data Properties** (green triangle
   in the Properties editor), expand **Color Attributes**, and select
   **Thumb_Before** or **Thumb_After** to compare influence maps. These are maps
   on the same adjusted mesh; they do not switch the actual deformation back.
4. For the white surface, open the viewport shading popover (arrow beside the
   shading spheres at the upper right) and set **Color > Material**. Choose
   **Attribute** again to see the active color map in Solid shading.
5. Capture the palm-side patch from the same angle at frame 21, ideally with
   the After map and again in white. If the patch is blue but still forms a ridge,
   geometry or the neighboring transition is involved, not thumb weight alone.

This experiment transfers some thumb influence on the palm-facing web to the
palm with a gradual release toward the thumb shaft. Geometry, poses, and the
accepted fallback are unchanged. The inspection colors are diagnostic data;
they do not establish that the deformation is anatomically correct.

The smoothing experiment was rejected and removed by restoring the fallback.
The current experiment transfers thumb influence to the palm in a small oval
on the index-facing thumb web. The oval center has zero thumb influence (blue),
with a gradual boundary. This changes actual skin weights, not just colors.
Geometry and animation match the fallback. Compare **Thumb_After** at frames
**1**, **21**, and **265**, then inspect the white Material view for stretching
or a new crease. The oval is estimated from the screenshot; check whether it
covers the circled yellow patch. **Thumb_Before** means weights without web
protection, not the previous script revision.

### Current thumb-base experiment

The fuller thumb-base version is now saved in `create_hand_fallback_v1.py`.
The current experiment gives the outer base more thumb influence by finishing
its palm-to-thumb transition sooner. The change fades out toward the index-facing
web; its small blue patch remains protected. Geometry and animation are unchanged
from this new fallback. Compare frame **21** from the side in **Thumb_After** and
white Material color: look for less lagging skin without pulling the palm along.

This revision adds a small fused volume around the thumb attachment for fullness.
The root weight interval is consistent around the thumb, and the horizontal
lower-palm cutoff no longer applies to the oblique thumb. The medial web anchor,
including the small blue patch, remains in place. Other finger controls, test
poses, and the saved fallback are unchanged.

Inspect frames **1**, **21**, and **265** from both sides in white Material color.
Look for a rounded attachment instead of a pinched waist, and verify the blue
webbing patch stays stable in **Thumb_After**. Check the lower thumb pad for any
new pulling, since removing its horizontal cutoff may allow more base movement.
Save the result separately until this experiment is preferred.

- Orbit: drag the middle mouse button. Alternatively drag the axis gizmo in the
  top-right corner of the viewport.
- Zoom: scroll the mouse wheel. Pan: Shift + middle mouse drag.
- Front/back/top views: click the labeled axes on the viewport gizmo. These labels
  describe Blender's axes; the hand lies in the XY plane, so Z views show its palm
  and back.
- In the timeline at the bottom, enter **1** for the open hand. Each finger curls
  inward, pauses, and opens before the next finger starts: thumb, index, middle,
  ring, then pinky. Finally all five curl together, hold, and open for looping.
- Inspect the curled poses at these frames:

  | Frame | Test |
  | --- | --- |
  | 21 | Thumb |
  | 69 | Index |
  | 117 | Middle |
  | 165 | Ring |
  | 213 | Pinky |
  | 265 | All fingers |
  | 313 | Open again |

- Playback runs at 24 frames per second over frames 1–313 (about 13 seconds).
- Press **Space** over the timeline to play/stop the movement between test poses.
  The timeline markers identify each pose. These are movement tests, not ASL demos.

## Regenerate after the palm-weight fix

### Saved fallback and current webbing experiment

`create_hand_fallback_v1.py` has been refreshed to the accepted fuller thumb-base
version with the small blue web patch and working color-map crash fix. It also keeps
the lowered index-middle gap and thumb-index web trim. Run it in Blender to regenerate
that version. It does not
contain your manual Blender edits; keep your saved fallback `.blend` file too.

The current `create_hand.py` keeps the accepted index-middle gap. Its thumb-index
trim is smaller and farther outward to preserve a fuller thumb attachment. Thumb
weights now use one broad root transition, slightly delayed on the index-facing
edge, instead of several overlapping restrictions. The common lower-palm anchor
remains. Finger lengths, knuckles, and animation are kept.
Compare frame **1** for the gap shape, then **21**, **69**, **117**, and **265**
for deformation from identical views. Look for reduced web stretching without
new stationary flaps, holes, or pinching. Save this experiment under a different
`.blend` filename until you prefer it to the fallback.

1. Save the previous prototype if you want to keep it for comparison.
2. Switch to **Scripting**. With `create_hand.py` selected in the Text Editor,
   choose **Text > Reload**, confirming the reload if prompted. This reads the
   updated file from disk; running the old text would recreate the old weights.
   Alternatively open the script from disk again using **Text > Open**.
3. Run with **Alt+P** while your mouse is over the Text Editor.
4. Switch to **Layout**. The newly created scene is selected automatically;
   previous scenes remain available in the scene selector.
5. Compare frames **1**, **69**, and **265**, looking at both palm and back.
   The palm should remain steadier, with bending concentrated at finger roots
   and joints. This revision adds fuller finger shafts and subtle dorsal base
   knuckles, and moves the four root pivots toward the palm edge. Animation
   frames and test angles remain unchanged.

This version protects the lower palm and thumb pad more firmly and blends the
shared webbing between nearby finger chains rather than assigning it abruptly
to one finger. Creasing at extreme bends and the thumb's motion still need visual
review. Each finger circumference now shares a short attachment transition;
neighboring fingers share less influence above the knuckles. During individual
curls, look for stationary skin flaps, inward shaft dents, and knuckle pinching.

The latest refinement places lower, elongated knuckle bumps on the back (-Z),
opposite the inward curl (+Z). The thumb curl test now uses 45/65/50 degrees at
its three joints instead of 15/30/35. Inspect frame 21 from the side and palm
side for a fuller curl and any new pinching or surface intersections. This is
still a curl test; anatomical thumb opposition has not yet been authored.

## Move a finger or the whole hand yourself

1. Stop playback and return to frame **1**. Keep automatic keyframing off.
2. Select **ASL_Hand_Rig** in the Outliner (the object list at the top right).
3. Hover over the viewport and press **Ctrl+Tab** to enter Pose Mode.
4. Select a bone, such as `Index_2`. The bones are visible through the surface.
5. Press **R**, **X**, **X**, type **45**, then **Enter**. The repeated X chooses
   the bone's local X axis and bends that joint by 45 degrees.
6. Press **Alt+R** to reset the selected bone's rotation. Other local axes can be
   explored with R, Y, Y or R, Z, Z, using small angles.
7. To rotate the entire hand, return to Object Mode using Ctrl+Tab, select the rig,
   then press R and an axis such as Z. Type an angle and press Enter. Alt+R resets it.
8. Changing timeline frames restores the recorded test pose, discarding unkeyed
   finger changes. Whole-object rotation is not recorded by the test animation.

## Save and report results

Use **File > Save As** to save a new `.blend` file, for example
`asl-hand-prototype.blend`. This is your editable Blender source.

Review the open silhouette, thumb placement, finger separation, and bending at
frames 69 and 265. Watch for pinching, fingers merging, and unrealistic thumb
movement. Share screenshots or describe what needs adjustment.

The surface and skin weights are generated approximations. The thumb does not yet
have a carefully authored opposition movement (crossing the palm), and the fist
test is not a validated anatomical pose or ASL letter. This milestone is for
evaluating the custom-model approach, not teaching gestures.

## Later export (after reviewing the model)

## Website preview

Run `npm run dev` from the project folder and open the local address printed by
Vite. The viewer loads `public/models/ASLTutor_hand_model_clean.glb` independently
of camera permission. It starts paused; **Play test** runs the exported finger
sequence, **Pause** holds the pose, and **Restart** returns to its beginning.
Drag inside the room to orbit, scroll/pinch or use +/- to zoom, and use
**Reset view** to restore the camera. The alphabet buttons still select letters;
they do not pose this test model. Live mirroring is a later milestone.

`src/HandViewer.jsx` owns model loading, white display material, room grids,
lighting, animation, camera controls, and cleanup. `src/App.css` gives the two
right panels equal shares of the webcam-stage height after the gap. They stack
below the webcam on narrow screens. Existing webcam tracking is unchanged.

To refine the asset, export over the clean GLB using the same skeleton, bone
names, orientation, and scale, then reload the page. Keep one test-animation
clip. If you change the filename, update `MODEL_URL` in `HandViewer.jsx`. The
viewer centers/scales the open model automatically and ignores diagnostic
vertex colors in favor of white. Verify exported bending visually: Blender's
preserve-volume modifier is not identical to standard glTF skinning.

### Original export notes

We will export the surface and rig as glTF Binary (`.glb`) and load that asset in
the website. The procedural source currently uses large modeling units; we will
set the final scale and check browser skinning before integration. The browser's
bone controls will drive poses directly. Blender's preserve-volume deformation
can look different from standard glTF skinning, so export needs its own visual
check. Nothing in this script modifies the website.
