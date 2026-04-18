//! `captureScreenshot()` — platform-specific full-screen capture, encoded as PNG.
//!
//! Windows: GDI BitBlt from the virtual screen DC into a DIB, then encode with `image`.
//! macOS:   Deferred — needs `CGDisplayCreateImage` via core-graphics when a Mac dev box
//!          is available.
//!
//! Called from the N-API `captureScreenshot()` export. Callers send the PNG over the
//! existing WS `screenshot` ClientMessage.

use crate::error::AudioError;

#[cfg(target_os = "windows")]
pub mod windows_impl;

#[cfg(target_os = "macos")]
pub mod macos_impl;

pub fn capture_primary_screen_png() -> Result<Vec<u8>, AudioError> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::capture()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::capture()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(AudioError::Other(
            "capture_primary_screen_png: unsupported platform".into(),
        ))
    }
}
