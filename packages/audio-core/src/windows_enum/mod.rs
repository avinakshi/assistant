//! `applyStealth` — platform-specific window stealth.
//!
//! macOS: no-op from Rust. Electron's `BrowserWindow.setContentProtection(true)` covers it
//! (calls `NSWindow.sharingType = NSWindowSharingNone`), and LSUIElement in Info.plist
//! hides the dock entry.
//!
//! Windows: `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`. Requires Windows 10
//! build 19041 (2004) or later. On older builds degrade to `WDA_MONITOR` (renders black in
//! screen captures) and log a warning — reported via AudioError so the TS side can surface
//! a KNOWN_LIMITATIONS banner.
//!
//! Reference: docs/INTERVIEW-COPILOT-COMPLETE.txt §02 SPEC 5.2, §04 ARCH Part 3,
//! §05 TESTING Phase 2.

use crate::error::AudioError;

#[cfg(target_os = "windows")]
pub mod windows_impl;

#[cfg(target_os = "macos")]
pub mod macos_impl;

pub fn apply_stealth(hwnd_or_nswindow: u64, platform: &str) -> Result<(), AudioError> {
    match platform {
        "win" | "windows" => {
            #[cfg(target_os = "windows")]
            {
                windows_impl::apply_windows_stealth(hwnd_or_nswindow)
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = hwnd_or_nswindow;
                Err(AudioError::Other(
                    "apply_stealth('win') called on non-Windows platform".into(),
                ))
            }
        }
        "mac" | "darwin" | "macos" => {
            #[cfg(target_os = "macos")]
            {
                macos_impl::apply_macos_stealth(hwnd_or_nswindow)
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = hwnd_or_nswindow;
                // On non-Mac, this is just a no-op — callers use it on the "current" platform,
                // so calling the wrong platform branch is a bug but not fatal.
                Err(AudioError::Other(
                    "apply_stealth('mac') called on non-Mac platform".into(),
                ))
            }
        }
        other => Err(AudioError::Other(format!(
            "apply_stealth: unknown platform '{other}'"
        ))),
    }
}
