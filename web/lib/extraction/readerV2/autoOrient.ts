import { loadSharp } from "./sharpLoader";

// Owner report, 2026-10-19 (Aug 8 benchmark): the new reader read the date
// as "2024-08-28", labels as "BAB-807"/"BAB-78"/"BAB-637", matched none of
// the 10 real flocks, and its own notes said "heavily cropped, only one
// flock block visible" — the region-detection call's answer and the
// actual crop ended up looking at DIFFERENT orientations of the same
// photo.
//
// The likely cause: a phone photo almost always carries an EXIF
// orientation tag (the sensor data is stored "as captured", with a tag
// saying how a viewer should rotate it for display). Whether Claude's own
// image decoding honors that tag is not something this app controls or
// can rely on either way — but sharp's rotate(ANGLE) with an EXPLICIT
// angle (what crop.ts always calls, even rotate(0)) deliberately IGNORES
// the EXIF tag and rotates the raw, as-stored pixels by exactly that
// angle. If the detection call's view of the photo was EXIF-corrected
// (upright) while the raw buffer crop.ts rotates is NOT, the model's
// answer and the pixels crop.ts rotates are two different starting
// orientations — any rotation_degrees the model reports then lands the
// crop boxes somewhere else entirely, exactly matching what was reported.
//
// The fix: do this ONCE, before anything else touches the photo, and use
// the result everywhere — both for what the detection call is shown and
// for what crop.ts actually rotates and crops. sharp's rotate() with NO
// arguments means "auto-rotate from the EXIF tag, then strip it" — after
// this, the buffer has one single, unambiguous orientation and no EXIF
// tag left for anything downstream to apply a second time.
export async function autoOrientPhoto(buffer: Buffer): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(buffer).rotate().toBuffer();
}
