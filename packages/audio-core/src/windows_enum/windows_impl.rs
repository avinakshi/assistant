//! Windows stealth: `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`.
//!
//! Behavior matrix (from MSDN + Raymond Chen's "The Old New Thing"):
//!   - Windows 10 build 19041+ (2004, May 2020): `WDA_EXCLUDEFROMCAPTURE` (0x11) — true excluded,
//!     the capturing process sees nothing where our window was.
//!   - Windows 10 earlier / Windows 7/8: only `WDA_MONITOR` (0x01) — window renders as black
//!     in capture. Less good but better than visible. Treat as a degraded mode, log once.
//!   - Anything that bypasses OS capture APIs (Nvidia ShadowPlay, AMD ReLive) is unaffected.

use crate::error::AudioError;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR, WINDOW_DISPLAY_AFFINITY,
};

pub fn apply_windows_stealth(hwnd: u64) -> Result<(), AudioError> {
    if hwnd == 0 {
        return Err(AudioError::Other(
            "apply_stealth: null HWND passed from Electron".into(),
        ));
    }
    // Electron returns HWND as a u64 little-endian pointer; safe to cast back.
    #[allow(clippy::cast_possible_truncation)]
    let handle = HWND(hwnd as *mut _);

    // Primary: EXCLUDEFROMCAPTURE. If unavailable (pre-19041), fall back to MONITOR.
    if try_set_affinity(handle, WDA_EXCLUDEFROMCAPTURE) {
        Ok(())
    } else if try_set_affinity(handle, WDA_MONITOR) {
        // Degraded — window will render black in captures. Caller gets Ok() but should log.
        // We communicate via a specialized error variant when we want to surface a warning;
        // for now, a best-effort apply is fine and the TS wrapper will check Windows version.
        Ok(())
    } else {
        Err(AudioError::Other(
            "SetWindowDisplayAffinity failed for both EXCLUDEFROMCAPTURE and MONITOR".into(),
        ))
    }
}

fn try_set_affinity(hwnd: HWND, affinity: WINDOW_DISPLAY_AFFINITY) -> bool {
    // SAFETY: `hwnd` is non-null (checked by caller). `SetWindowDisplayAffinity` returns BOOL.
    unsafe { SetWindowDisplayAffinity(hwnd, affinity) }.is_ok()
}
