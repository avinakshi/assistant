//! Windows WASAPI loopback capture.
//!
//! References:
//!   - Microsoft: "Loopback Recording" (AUDCLNT_STREAMFLAGS_LOOPBACK)
//!   - Microsoft: IAudioCaptureClient / IAudioClient
//!   - docs/INTERVIEW-COPILOT-COMPLETE.txt §04 ARCHITECTURE Part 2 ("Windows capture implementation notes")
//!
//! Design:
//!   - Get default render endpoint (what the user hears)
//!   - Initialize IAudioClient with AUDCLNT_SHAREMODE_SHARED + AUDCLNT_STREAMFLAGS_LOOPBACK + EVENTCALLBACK
//!   - Dedicated capture thread waits on buffer-ready event, pulls packets, downmix + resample
//!   - Emit 320-sample Int16 frames to a crossbeam channel for napi dispatch
//!
//! Frame loss budget per plan: < 0.1% over 30 min.

use crate::audio::common::{FrameResampler, PcmFrame};
use crate::error::AudioError;
use crossbeam_channel::Sender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use windows::core::{Result as WinResult, GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

/// Stable Win32 WAVE_FORMAT_* tags — defined since Vista, safe to hardcode.
/// Not in `Win32_Media_Audio` module of windows-rs 0.58.
const WAVE_FORMAT_PCM: u16 = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

/// AUDCLNT_BUFFERFLAGS_SILENT = 0x02 per IAudioCaptureClient::GetBuffer.
const AUDCLNT_BUFFERFLAG_SILENT_BIT: u32 = 0x0000_0002;

/// KSDATAFORMAT_SUBTYPE_* — WAVEFORMATEXTENSIBLE subformat GUIDs.
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x0000_0003_0000_0010_8000_00AA_00389B71);
const KSDATAFORMAT_SUBTYPE_PCM: GUID =
    GUID::from_u128(0x0000_0001_0000_0010_8000_00AA_00389B71);

pub struct WindowsLoopbackCapture {
    stop_flag: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WindowsLoopbackCapture {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread: None,
        }
    }

    pub fn start(&mut self, frame_tx: Sender<PcmFrame>) -> Result<(), AudioError> {
        if self.thread.is_some() {
            return Err(AudioError::AlreadyRunning);
        }
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = Arc::clone(&self.stop_flag);
        let thread = std::thread::Builder::new()
            .name("wasapi-loopback".into())
            .spawn(move || {
                if let Err(e) = capture_loop(&stop_flag, &frame_tx) {
                    // Best effort: drop the channel — receiver sees disconnect.
                    tracing::error!(error = %e, "wasapi capture loop exited with error");
                }
            })
            .map_err(|e| AudioError::Wasapi(format!("spawn: {e}")))?;
        self.thread = Some(thread);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), AudioError> {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
        Ok(())
    }
}

impl Drop for WindowsLoopbackCapture {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn capture_loop(
    stop_flag: &Arc<AtomicBool>,
    frame_tx: &Sender<PcmFrame>,
) -> Result<(), AudioError> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        // HRESULT returned here — S_OK / S_FALSE both mean "initialized ok".
        // S_FALSE (= 1) happens when COM was already initialized on this thread.
        if hr.is_err() {
            return Err(AudioError::Wasapi(format!("CoInitializeEx: {hr:?}")));
        }
    }
    let result = capture_loop_inner(stop_flag, frame_tx);
    unsafe { CoUninitialize() };
    result
}

fn capture_loop_inner(
    stop_flag: &Arc<AtomicBool>,
    frame_tx: &Sender<PcmFrame>,
) -> Result<(), AudioError> {
    let device = default_render_device().map_err(|e| AudioError::Wasapi(e.to_string()))?;
    let client: IAudioClient = unsafe {
        device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| AudioError::Wasapi(format!("Activate: {e}")))?
    };

    let mix_format_ptr = unsafe {
        client
            .GetMixFormat()
            .map_err(|e| AudioError::Wasapi(format!("GetMixFormat: {e}")))?
    };
    let mix_format = unsafe { *mix_format_ptr };
    let input_rate = mix_format.nSamplesPerSec;
    let input_channels = mix_format.nChannels;
    let format_kind = detect_format(&mix_format, mix_format_ptr)?;

    unsafe {
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                // 200 ms buffer — plenty to absorb jitter without adding latency.
                2_000_000,
                0,
                mix_format_ptr,
                None,
            )
            .map_err(|e| AudioError::Wasapi(format!("Initialize: {e}")))?;
    }

    let event = unsafe {
        CreateEventW(None, false, false, PCWSTR::null())
            .map_err(|e| AudioError::Wasapi(format!("CreateEventW: {e}")))?
    };
    unsafe {
        client
            .SetEventHandle(event)
            .map_err(|e| AudioError::Wasapi(format!("SetEventHandle: {e}")))?;
    }

    let capture_client: IAudioCaptureClient = unsafe {
        client
            .GetService()
            .map_err(|e| AudioError::Wasapi(format!("GetService: {e}")))?
    };

    unsafe {
        client
            .Start()
            .map_err(|e| AudioError::Wasapi(format!("Start: {e}")))?;
    }

    // chunk_size: enough samples at input_rate to land one 320-sample 16k output frame.
    // Using 1 input frame per 20 ms target → input_rate / 50.
    let chunk_size = (input_rate / 50) as usize;
    let mut resampler = FrameResampler::new(input_rate, chunk_size.max(160))?;
    let start_ns = now_ns();
    let mut pending_frames: Vec<PcmFrame> = Vec::with_capacity(4);
    let mut mono_buf: Vec<f32> = Vec::with_capacity(chunk_size * 4);

    let result: Result<(), AudioError> = (|| {
        while !stop_flag.load(Ordering::SeqCst) {
            let wait = unsafe { WaitForSingleObject(event, 200) };
            if wait != WAIT_OBJECT_0 {
                continue;
            }

            loop {
                let packet_len = unsafe { capture_client.GetNextPacketSize() }
                    .map_err(|e| AudioError::Wasapi(format!("GetNextPacketSize: {e}")))?;
                if packet_len == 0 {
                    break;
                }

                let mut data_ptr = std::ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;
                unsafe {
                    capture_client
                        .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                        .map_err(|e| AudioError::Wasapi(format!("GetBuffer: {e}")))?;
                }

                let is_silent = (flags & AUDCLNT_BUFFERFLAG_SILENT_BIT) != 0;
                let sample_count = num_frames as usize * input_channels as usize;
                mono_buf.clear();

                if is_silent {
                    for _ in 0..num_frames {
                        mono_buf.push(0.0);
                    }
                } else if !data_ptr.is_null() {
                    unsafe {
                        downmix_to_mono(
                            data_ptr,
                            sample_count,
                            input_channels,
                            format_kind,
                            &mut mono_buf,
                        );
                    }
                }

                unsafe {
                    capture_client
                        .ReleaseBuffer(num_frames)
                        .map_err(|e| AudioError::Wasapi(format!("ReleaseBuffer: {e}")))?;
                }

                resampler.push(&mono_buf, now_ns().saturating_sub(start_ns), &mut pending_frames)?;
                for frame in pending_frames.drain(..) {
                    if frame_tx.send(frame).is_err() {
                        return Ok(()); // receiver dropped — graceful exit
                    }
                }
            }
        }
        Ok(())
    })();

    unsafe {
        let _ = client.Stop();
        let _ = CloseHandle(event);
    }

    result
}

#[derive(Copy, Clone, Debug)]
enum FormatKind {
    Pcm16,
    Pcm24,
    Pcm32,
    Float32,
}

fn detect_format(_fmt: &WAVEFORMATEX, ptr: *const WAVEFORMATEX) -> Result<FormatKind, AudioError> {
    // `WAVEFORMATEX` (and especially `WAVEFORMATEXTENSIBLE`) are declared packed in windows-rs,
    // so references to fields are UB. Copy the couple of fields we need out via aligned reads
    // from the raw pointer and work with local values from here on.
    let tag = unsafe { (*ptr).wFormatTag };
    let bits = unsafe { (*ptr).wBitsPerSample };
    match tag {
        WAVE_FORMAT_PCM => match bits {
            16 => Ok(FormatKind::Pcm16),
            24 => Ok(FormatKind::Pcm24),
            32 => Ok(FormatKind::Pcm32),
            b => Err(AudioError::UnsupportedFormat(format!("PCM {b}-bit"))),
        },
        WAVE_FORMAT_IEEE_FLOAT => match bits {
            32 => Ok(FormatKind::Float32),
            b => Err(AudioError::UnsupportedFormat(format!("float {b}-bit"))),
        },
        WAVE_FORMAT_EXTENSIBLE => {
            // SAFETY: when tag is EXTENSIBLE, the struct at `ptr` is actually WAVEFORMATEXTENSIBLE.
            let ext_ptr: *const WAVEFORMATEXTENSIBLE = ptr.cast();
            let sub = unsafe { (*ext_ptr).SubFormat };
            if sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && bits == 32 {
                Ok(FormatKind::Float32)
            } else if sub == KSDATAFORMAT_SUBTYPE_PCM {
                match bits {
                    16 => Ok(FormatKind::Pcm16),
                    24 => Ok(FormatKind::Pcm24),
                    32 => Ok(FormatKind::Pcm32),
                    b => Err(AudioError::UnsupportedFormat(format!("ext PCM {b}-bit"))),
                }
            } else {
                Err(AudioError::UnsupportedFormat(format!(
                    "extensible subformat {sub:?} @ {bits}-bit"
                )))
            }
        }
        other => Err(AudioError::UnsupportedFormat(format!("format tag {other:#x}"))),
    }
}

/// SAFETY: `ptr` must point to at least `sample_count` samples of the indicated `kind`. `channels`
/// must be the true interleaved channel count.
unsafe fn downmix_to_mono(
    ptr: *mut u8,
    sample_count: usize,
    channels: u16,
    kind: FormatKind,
    out: &mut Vec<f32>,
) {
    let ch = channels.max(1) as usize;
    let frame_count = sample_count / ch;
    out.reserve(frame_count);
    match kind {
        FormatKind::Float32 => {
            let slice = unsafe { std::slice::from_raw_parts(ptr.cast::<f32>(), sample_count) };
            for frame in slice.chunks_exact(ch) {
                let sum: f32 = frame.iter().sum();
                out.push(sum / ch as f32);
            }
        }
        FormatKind::Pcm16 => {
            let slice = unsafe { std::slice::from_raw_parts(ptr.cast::<i16>(), sample_count) };
            for frame in slice.chunks_exact(ch) {
                let sum: i32 = frame.iter().map(|&s| i32::from(s)).sum();
                let avg = sum / ch as i32;
                out.push(avg as f32 / f32::from(i16::MAX));
            }
        }
        FormatKind::Pcm32 => {
            let slice = unsafe { std::slice::from_raw_parts(ptr.cast::<i32>(), sample_count) };
            for frame in slice.chunks_exact(ch) {
                let sum: i64 = frame.iter().map(|&s| i64::from(s)).sum();
                let avg = sum / ch as i64;
                out.push(avg as f32 / i32::MAX as f32);
            }
        }
        FormatKind::Pcm24 => {
            // 24-bit little-endian packed: 3 bytes per sample.
            let bytes = unsafe { std::slice::from_raw_parts(ptr, sample_count * 3) };
            for frame_idx in 0..frame_count {
                let mut sum: i64 = 0;
                for c in 0..ch {
                    let off = (frame_idx * ch + c) * 3;
                    let b0 = bytes[off] as i32;
                    let b1 = bytes[off + 1] as i32;
                    let b2 = bytes[off + 2] as i32;
                    let mut v = (b2 << 16) | (b1 << 8) | b0;
                    if (v & 0x0080_0000) != 0 {
                        v |= !0x00FF_FFFF_i32; // sign-extend
                    }
                    sum += i64::from(v);
                }
                let avg = (sum / ch as i64) as f32 / (1_i32 << 23) as f32;
                out.push(avg);
            }
        }
    }
}

fn default_render_device() -> WinResult<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
    }
}

fn now_ns() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}
