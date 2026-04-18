//! macOS stealth — Electron's `setContentProtection(true)` on the BrowserWindow is the
//! load-bearing call (it sets `NSWindow.sharingType = NSWindowSharingNone`). This module
//! is kept for symmetry and will host Mac-specific extensions (e.g. programmatic LSUIElement
//! toggling) when we add full Mac support.

use crate::error::AudioError;

pub fn apply_macos_stealth(_nswindow_handle: u64) -> Result<(), AudioError> {
    // Intentional no-op. The Electron side covers Mac stealth via setContentProtection.
    Ok(())
}
