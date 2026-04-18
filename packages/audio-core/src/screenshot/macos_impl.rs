//! macOS screenshot — deferred until a Mac dev machine is available.
//! Will use `CGDisplayCreateImage(CGMainDisplayID())` + `CGImageDestinationAddImage` to
//! encode PNG. For now returns a clear error so the desktop app degrades gracefully.

use crate::error::AudioError;

pub fn capture() -> Result<Vec<u8>, AudioError> {
    Err(AudioError::Other(
        "captureScreenshot not implemented on macOS yet — Phase 5b follow-up".into(),
    ))
}
