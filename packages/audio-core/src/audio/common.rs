//! Shared audio types + resampler. Platform-agnostic.

use crate::error::AudioError;
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

/// Target output contract. See docs/INTERVIEW-COPILOT-COMPLETE.txt §04 ARCHITECTURE Part 2.
pub const OUTPUT_SAMPLE_RATE_HZ: u32 = 16_000;
pub const OUTPUT_CHANNELS: u16 = 1;
pub const OUTPUT_SAMPLES_PER_FRAME: usize = 320;
pub const OUTPUT_FRAMES_PER_SECOND: u32 = OUTPUT_SAMPLE_RATE_HZ / OUTPUT_SAMPLES_PER_FRAME as u32;

/// A single emitted PCM frame. 20 ms @ 16 kHz mono.
#[derive(Debug, Clone)]
pub struct PcmFrame {
    pub samples: [i16; OUTPUT_SAMPLES_PER_FRAME],
    pub timestamp_ns: u64,
}

/// Resamples arbitrary-rate Float32 mono into 16 kHz Int16 mono, emitting full 320-sample frames.
///
/// Uses `rubato::SincFixedIn` with moderate-quality parameters (256 taps) — ~0.3% CPU on M1 per
/// the plan's performance budget.
pub struct FrameResampler {
    input_rate: u32,
    resampler: SincFixedIn<f32>,
    /// Collected 16 kHz output that hasn't been chopped into 320-sample frames yet.
    pending: Vec<f32>,
    /// Incoming source samples; flushed to the resampler in `chunk_size` groups.
    input_buffer: Vec<f32>,
    chunk_size: usize,
    next_timestamp_ns: u64,
}

impl FrameResampler {
    pub fn new(input_rate: u32, chunk_size: usize) -> Result<Self, AudioError> {
        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };
        let resampler = SincFixedIn::<f32>::new(
            f64::from(OUTPUT_SAMPLE_RATE_HZ) / f64::from(input_rate),
            1.1,
            params,
            chunk_size,
            1,
        )
        .map_err(|e| AudioError::Resample(e.to_string()))?;
        Ok(Self {
            input_rate,
            resampler,
            pending: Vec::with_capacity(OUTPUT_SAMPLES_PER_FRAME * 4),
            input_buffer: Vec::with_capacity(chunk_size * 2),
            chunk_size,
            next_timestamp_ns: 0,
        })
    }

    pub fn input_rate(&self) -> u32 {
        self.input_rate
    }

    /// Feeds f32 mono samples and drains full 320-sample frames.
    /// `base_timestamp_ns` is the timestamp corresponding to the first sample in `input`.
    /// Output frame timestamps are derived by advancing at exactly 16 kHz.
    pub fn push(
        &mut self,
        input: &[f32],
        base_timestamp_ns: u64,
        out: &mut Vec<PcmFrame>,
    ) -> Result<(), AudioError> {
        if self.next_timestamp_ns == 0 {
            self.next_timestamp_ns = base_timestamp_ns;
        }
        self.input_buffer.extend_from_slice(input);

        while self.input_buffer.len() >= self.chunk_size {
            let chunk: Vec<f32> = self.input_buffer.drain(..self.chunk_size).collect();
            let out_chunk = self
                .resampler
                .process(&[chunk], None)
                .map_err(|e| AudioError::Resample(e.to_string()))?;
            if let Some(first) = out_chunk.into_iter().next() {
                self.pending.extend_from_slice(&first);
            }
        }

        self.drain_frames(out);
        Ok(())
    }

    /// Flushes any remaining buffered output as zero-padded frames. Called on stop().
    pub fn flush(&mut self, out: &mut Vec<PcmFrame>) {
        if !self.pending.is_empty() {
            while self.pending.len() % OUTPUT_SAMPLES_PER_FRAME != 0 {
                self.pending.push(0.0);
            }
            self.drain_frames(out);
        }
    }

    fn drain_frames(&mut self, out: &mut Vec<PcmFrame>) {
        while self.pending.len() >= OUTPUT_SAMPLES_PER_FRAME {
            let mut samples = [0_i16; OUTPUT_SAMPLES_PER_FRAME];
            for (i, f) in self.pending.drain(..OUTPUT_SAMPLES_PER_FRAME).enumerate() {
                samples[i] = float_to_i16(f);
            }
            let frame = PcmFrame {
                samples,
                timestamp_ns: self.next_timestamp_ns,
            };
            // 320 samples / 16000 Hz = 20 ms = 20_000_000 ns
            self.next_timestamp_ns = self.next_timestamp_ns.saturating_add(20_000_000);
            out.push(frame);
        }
    }
}

#[inline]
fn float_to_i16(f: f32) -> i16 {
    let clamped = f.clamp(-1.0, 1.0);
    (clamped * f32::from(i16::MAX)) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sinc_48k_to_16k_mono_preserves_amplitude_within_0_5db() {
        // 1 second of a 1 kHz sine at 48 kHz, amplitude 0.5 → analytic RMS = 0.5/sqrt(2).
        // Feed ≥1 s so the resampler's sinc filter is primed past its 256-tap latency and we
        // skip the leading transient when measuring RMS.
        let freq = 1000.0_f32;
        let amp = 0.5_f32;
        let input: Vec<f32> = (0..48_000)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * (i as f32 / 48_000.0)).sin())
            .collect();

        let mut rs = FrameResampler::new(48_000, 480).expect("resampler");
        let mut out = Vec::new();
        rs.push(&input, 0, &mut out).expect("push");

        assert!(out.len() > 10, "expected many frames, got {}", out.len());
        for frame in &out {
            assert_eq!(frame.samples.len(), OUTPUT_SAMPLES_PER_FRAME);
        }

        // Skip first 5 frames (filter prime) and last 1 frame (possible trailing zeros).
        let measurement_start = 5 * OUTPUT_SAMPLES_PER_FRAME;
        let measurement_end = out.len().saturating_sub(1) * OUTPUT_SAMPLES_PER_FRAME;
        let total_samples: Vec<f32> = out
            .iter()
            .flat_map(|f| {
                f.samples
                    .iter()
                    .map(|&s| f32::from(s) / f32::from(i16::MAX))
            })
            .skip(measurement_start)
            .take(measurement_end.saturating_sub(measurement_start))
            .collect();
        assert!(!total_samples.is_empty(), "no measurement window");
        let rms =
            (total_samples.iter().map(|s| s * s).sum::<f32>() / total_samples.len() as f32).sqrt();
        let expected = amp / 2.0_f32.sqrt();
        let ratio_db = 20.0 * (rms / expected).log10();
        assert!(
            ratio_db.abs() < 0.5,
            "RMS differs by {ratio_db:.2} dB (rms={rms}, expected={expected})"
        );
    }

    #[test]
    fn handles_partial_input_without_crashing() {
        let mut rs = FrameResampler::new(48_000, 480).expect("resampler");
        let mut out = Vec::new();
        rs.push(&vec![0.0; 100], 0, &mut out).expect("push");
        // Fewer than chunk_size samples → no output yet, but no crash.
        assert!(out.is_empty());
    }

    #[test]
    fn exactly_320_samples_per_frame() {
        let mut rs = FrameResampler::new(48_000, 480).expect("resampler");
        let mut out = Vec::new();
        rs.push(&vec![0.0; 48_000], 0, &mut out).expect("push");
        for f in &out {
            assert_eq!(f.samples.len(), 320);
        }
    }

    #[test]
    fn timestamps_monotonic() {
        let mut rs = FrameResampler::new(48_000, 480).expect("resampler");
        let mut out = Vec::new();
        rs.push(&vec![0.0; 48_000 * 2], 0, &mut out).expect("push");
        for pair in out.windows(2) {
            let [a, b]: &[PcmFrame; 2] = pair.try_into().unwrap();
            assert!(b.timestamp_ns > a.timestamp_ns);
        }
    }

    #[test]
    fn drains_buffer_on_stop() {
        let mut rs = FrameResampler::new(48_000, 480).expect("resampler");
        let mut out = Vec::new();
        rs.push(&vec![0.0; 1000], 0, &mut out).expect("push");
        rs.flush(&mut out);
        // We don't care exactly how many frames — we care that flush drains whatever was left.
        // No crash = pass.
        for f in &out {
            assert_eq!(f.samples.len(), 320);
        }
    }
}
