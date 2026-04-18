//! macOS ScreenCaptureKit system-audio capture.
//!
//! **Status: SKELETON — deferred until Mac hardware is available.**
//!
//! Target design (per docs/INTERVIEW-COPILOT-COMPLETE.txt §04 ARCHITECTURE Part 2):
//!   1. `SCShareableContent::current()` to enumerate displays
//!   2. `SCContentFilter::new(display, excluded = [own app])` — critical: exclude self-audio
//!   3. `SCStreamConfiguration { captures_audio = true, sample_rate = 48000, channel_count = 2 }`
//!   4. Start `SCStream`, receive sample buffers, funnel into `FrameResampler`
//!
//! When implementing:
//!   - Permissions: `CGPreflightScreenCaptureAccess()` before `start()`; return
//!     `AudioError::PermissionDenied` with clear re-grant instructions.
//!   - App bundle ID in entitlements MUST match Electron's bundle ID in production
//!     (see CLAUDE.md Part 10 "ScreenCaptureKit throws permission denied even though granted").
//!   - Min macOS 13 (Ventura) — `ScreenCaptureKit` audio requires it.

use crate::audio::common::PcmFrame;
use crate::error::AudioError;
use crossbeam_channel::Sender;

pub struct MacOsSckAudioCapture;

impl MacOsSckAudioCapture {
    pub fn new() -> Self {
        Self
    }

    pub fn start(&mut self, _frame_tx: Sender<PcmFrame>) -> Result<(), AudioError> {
        Err(AudioError::Other(
            "macOS ScreenCaptureKit capture not yet implemented — scheduled for Phase 1 extension \
             once a Mac dev machine is available."
                .into(),
        ))
    }

    pub fn stop(&mut self) -> Result<(), AudioError> {
        Ok(())
    }
}
