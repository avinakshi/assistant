//! `@repo/audio-core` — native Rust addon exposed to Node/Electron via napi-rs.
//!
//! Phase 1 surface:
//!   - `AudioSession { start(), stop() }` with an `onFrame(Buffer)` callback delivering
//!     640-byte chunks (320 samples Int16 mono @ 16 kHz, 50 fps).
//!
//! Later phases (stubs below):
//!   - `captureScreenshot()` — Phase 5 (CGDisplayCreateImage / BitBlt)
//!   - `listMeetingWindows()` — Phase 7 (CGWindowListCopyWindowInfo / EnumWindows)
//!   - `applyStealth()` — Phase 2 (setContentProtection / WDA_EXCLUDEFROMCAPTURE)
//!
//! All exports are documented by napi-derive into an auto-generated `index.d.ts`.

#![cfg_attr(
    not(any(target_os = "macos", target_os = "windows")),
    allow(dead_code, unused_imports)
)]

mod audio;
mod error;
mod screenshot;
mod windows_enum;

use crate::audio::{PcmFrame, OUTPUT_SAMPLES_PER_FRAME};
use crate::error::AudioError;
use crossbeam_channel::Receiver;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use crate::audio::windows::WindowsLoopbackCapture;

#[cfg(target_os = "macos")]
use crate::audio::macos::MacOsSckAudioCapture;

#[napi(object)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub kind: String, // 'output' | 'input'
}

#[napi(object)]
pub struct WindowInfo {
    pub title: String,
    pub owner_name: String,
    pub pid: u32,
}

#[napi]
pub struct AudioSession {
    on_frame: ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled>,
    on_error: Option<ThreadsafeFunction<(String, String), ErrorStrategy::CalleeHandled>>,
    running: Arc<AtomicBool>,
    dispatch_thread: Mutex<Option<std::thread::JoinHandle<()>>>,

    #[cfg(target_os = "windows")]
    capture: Mutex<Option<WindowsLoopbackCapture>>,

    #[cfg(target_os = "macos")]
    capture: Mutex<Option<MacOsSckAudioCapture>>,
}

#[napi]
impl AudioSession {
    #[napi(constructor)]
    pub fn new(
        on_frame: ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled>,
        on_error: Option<ThreadsafeFunction<(String, String), ErrorStrategy::CalleeHandled>>,
    ) -> Self {
        Self {
            on_frame,
            on_error,
            running: Arc::new(AtomicBool::new(false)),
            dispatch_thread: Mutex::new(None),

            #[cfg(target_os = "windows")]
            capture: Mutex::new(None),
            #[cfg(target_os = "macos")]
            capture: Mutex::new(None),
        }
    }

    #[napi]
    pub fn start(&self) -> Result<()> {
        if self.running.load(Ordering::SeqCst) {
            return Err(AudioError::AlreadyRunning.into());
        }
        self.running.store(true, Ordering::SeqCst);

        let (tx, rx) = crossbeam_channel::bounded::<PcmFrame>(256);

        #[cfg(target_os = "windows")]
        {
            let mut cap = WindowsLoopbackCapture::new();
            cap.start(tx).map_err(napi::Error::from)?;
            *self.capture.lock().expect("capture lock") = Some(cap);
        }

        #[cfg(target_os = "macos")]
        {
            let mut cap = MacOsSckAudioCapture::new();
            cap.start(tx).map_err(napi::Error::from)?;
            *self.capture.lock().expect("capture lock") = Some(cap);
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = tx;
            let _ = rx;
            return Err(AudioError::Other(
                "audio capture not supported on this platform (only Mac + Windows)".into(),
            )
            .into());
        }

        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            let cb = self.on_frame.clone();
            let running = Arc::clone(&self.running);
            let on_err = self.on_error.clone();
            let handle = std::thread::Builder::new()
                .name("audio-core-dispatch".into())
                .spawn(move || dispatch_loop(rx, cb, on_err, running))
                .map_err(|e| AudioError::Dispatch(format!("spawn dispatch: {e}")))?;
            *self.dispatch_thread.lock().expect("dispatch lock") = Some(handle);
        }

        Ok(())
    }

    #[napi]
    pub fn stop(&self) -> Result<()> {
        if !self.running.swap(false, Ordering::SeqCst) {
            return Ok(());
        }

        #[cfg(target_os = "windows")]
        if let Some(mut cap) = self.capture.lock().expect("capture lock").take() {
            cap.stop().map_err(napi::Error::from)?;
        }

        #[cfg(target_os = "macos")]
        if let Some(mut cap) = self.capture.lock().expect("capture lock").take() {
            cap.stop().map_err(napi::Error::from)?;
        }

        if let Some(h) = self.dispatch_thread.lock().expect("dispatch lock").take() {
            let _ = h.join();
        }
        Ok(())
    }
}

#[allow(dead_code)]
fn dispatch_loop(
    rx: Receiver<PcmFrame>,
    on_frame: ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled>,
    on_error: Option<ThreadsafeFunction<(String, String), ErrorStrategy::CalleeHandled>>,
    running: Arc<AtomicBool>,
) {
    while running.load(Ordering::SeqCst) {
        match rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(frame) => {
                debug_assert_eq!(frame.samples.len(), OUTPUT_SAMPLES_PER_FRAME);
                let mut bytes = Vec::with_capacity(frame.samples.len() * 2);
                for s in frame.samples.iter() {
                    bytes.extend_from_slice(&s.to_le_bytes());
                }
                on_frame.call(Ok(bytes), ThreadsafeFunctionCallMode::NonBlocking);
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                if let Some(ref err_cb) = on_error {
                    err_cb.call(
                        Ok(("DISPATCH".into(), "capture channel disconnected".into())),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                return;
            }
        }
    }
}

// ---------- Phase 2+ stubs (compile-only until implemented) ----------

/// Apply platform-specific window stealth.
///
/// `hwnd_or_ns_window` is the native window handle as returned by Electron:
///   - Windows: `BrowserWindow.getNativeWindowHandle().readBigUInt64LE(0)` — a pointer.
///   - macOS: unused on this path (Electron's setContentProtection does the work). Pass 0.
///
/// `platform` is one of `"win"` / `"mac"` — matches `process.platform`-ish strings.
#[napi]
pub fn apply_stealth(hwnd_or_ns_window: BigInt, platform: String) -> Result<()> {
    let (_signed, handle, _lossless) = hwnd_or_ns_window.get_u64();
    windows_enum::apply_stealth(handle, &platform).map_err(napi::Error::from)
}

/// Capture the primary (virtual) screen as a PNG. Called from the desktop main process on
/// Ctrl+Shift+C or via the `captureScreenshot` IPC.
///
/// `display_id` is reserved for Phase 5.x when we support per-monitor targeting — right now
/// we always capture the full virtual screen so multi-monitor LeetCode pages work.
///
/// Runs synchronously on the napi call thread. BitBlt + PNG encode take ~100-400 ms on
/// modern hardware which is fine for a user-initiated action; async off-thread is a future
/// optimization if we start invoking this automatically.
#[napi]
pub fn capture_screenshot(_display_id: Option<u32>) -> Result<Buffer> {
    let bytes = screenshot::capture_primary_screen_png().map_err(napi::Error::from)?;
    Ok(Buffer::from(bytes))
}

#[napi]
pub async fn list_meeting_windows() -> Result<Vec<WindowInfo>> {
    Err(AudioError::Other("list_meeting_windows lands in Phase 7".into()).into())
}

#[napi]
pub async fn request_screen_recording_permission() -> Result<String> {
    // Windows: no permission required for loopback. Return 'granted' immediately.
    #[cfg(target_os = "windows")]
    {
        return Ok("granted".into());
    }
    #[cfg(target_os = "macos")]
    {
        return Err(AudioError::Other(
            "screen recording permission check lands with Mac impl".into(),
        )
        .into());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(AudioError::Other("unsupported platform".into()).into())
    }
}
