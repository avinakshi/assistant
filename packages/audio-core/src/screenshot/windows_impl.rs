//! Windows screenshot via GDI BitBlt.
//!
//! Flow: GetDC(NULL) → CreateCompatibleDC → CreateCompatibleBitmap → BitBlt →
//! GetDIBits → encode PNG via `image`. All handles released on error.
//!
//! We capture the VIRTUAL screen (SM_XVIRTUALSCREEN .. SM_CYVIRTUALSCREEN) so multi-monitor
//! layouts work — LeetCode might be on the user's second display. For Phase 5 we PNG-encode
//! at full res; the plan's downscale-to-max-1920x1080 step is a Phase 6 optimization once
//! we see real file sizes.

use crate::error::AudioError;
use image::{ImageBuffer, Rgba};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

pub fn capture() -> Result<Vec<u8>, AudioError> {
    // SAFETY: every GDI call below is wrapped in an RAII guard to release on early-return.
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };

    if width <= 0 || height <= 0 {
        return Err(AudioError::Other(format!(
            "virtual screen dimensions invalid: {width} x {height}"
        )));
    }

    let screen_dc_guard = ScreenDc::acquire()?;
    let mem_dc_guard = MemDc::create(screen_dc_guard.hdc)?;
    let bmp_guard = DibBitmap::create(screen_dc_guard.hdc, width, height)?;

    // Select the bitmap into the memory DC.
    let _old_obj = unsafe { SelectObject(mem_dc_guard.hdc, bmp_guard.hbmp) };

    // Copy the whole virtual screen into our DIB.
    let copied = unsafe {
        BitBlt(
            mem_dc_guard.hdc,
            0,
            0,
            width,
            height,
            screen_dc_guard.hdc,
            x,
            y,
            SRCCOPY,
        )
    };
    if let Err(e) = copied {
        return Err(AudioError::Other(format!("BitBlt failed: {e}")));
    }

    // Pull pixel bytes out of the bitmap. BGRA8, bottom-up unless we negate the height.
    let mut header = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // negative = top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default(); 1],
    };
    let byte_count = (width as usize) * (height as usize) * 4;
    let mut buf = vec![0u8; byte_count];
    let rows = unsafe {
        GetDIBits(
            mem_dc_guard.hdc,
            bmp_guard.hbmp,
            0,
            height as u32,
            Some(buf.as_mut_ptr().cast()),
            &mut header,
            DIB_RGB_COLORS,
        )
    };
    if rows == 0 {
        return Err(AudioError::Other("GetDIBits returned 0 rows".into()));
    }

    // BGRA → RGBA swap in-place. `image` takes RGBA.
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2);
    }

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width as u32, height as u32, buf)
            .ok_or_else(|| AudioError::Other("image buffer size mismatch".into()))?;

    let mut png_bytes = Vec::with_capacity(byte_count / 4);
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| AudioError::Other(format!("PNG encode failed: {e}")))?;

    Ok(png_bytes)
}

/// RAII wrapper for `GetDC(NULL)` / `ReleaseDC`.
struct ScreenDc {
    hdc: HDC,
}
impl ScreenDc {
    fn acquire() -> Result<Self, AudioError> {
        let hdc = unsafe { GetDC(HWND::default()) };
        if hdc.is_invalid() {
            return Err(AudioError::Other("GetDC(NULL) returned null".into()));
        }
        Ok(Self { hdc })
    }
}
impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe { ReleaseDC(HWND::default(), self.hdc) };
    }
}

/// RAII wrapper for `CreateCompatibleDC` / `DeleteDC`.
struct MemDc {
    hdc: HDC,
}
impl MemDc {
    fn create(screen: HDC) -> Result<Self, AudioError> {
        let hdc = unsafe { CreateCompatibleDC(screen) };
        if hdc.is_invalid() {
            return Err(AudioError::Other("CreateCompatibleDC failed".into()));
        }
        Ok(Self { hdc })
    }
}
impl Drop for MemDc {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteDC(self.hdc);
        };
    }
}

/// RAII wrapper for `CreateCompatibleBitmap` / `DeleteObject`.
struct DibBitmap {
    hbmp: HBITMAP,
}
impl DibBitmap {
    fn create(screen: HDC, width: i32, height: i32) -> Result<Self, AudioError> {
        let hbmp = unsafe { CreateCompatibleBitmap(screen, width, height) };
        if hbmp.is_invalid() {
            return Err(AudioError::Other("CreateCompatibleBitmap failed".into()));
        }
        Ok(Self { hbmp })
    }
}
impl Drop for DibBitmap {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.hbmp);
        };
    }
}
