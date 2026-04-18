use thiserror::Error;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("device not found: {0}")]
    DeviceNotFound(String),

    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("WASAPI failure: {0}")]
    Wasapi(String),

    #[error("ScreenCaptureKit failure: {0}")]
    ScreenCaptureKit(String),

    #[error("resampler failure: {0}")]
    Resample(String),

    #[error("callback dispatch failure: {0}")]
    Dispatch(String),

    #[error("session not running")]
    NotRunning,

    #[error("session already running")]
    AlreadyRunning,

    #[error("{0}")]
    Other(String),
}

impl From<AudioError> for napi::Error {
    fn from(value: AudioError) -> Self {
        let code = match &value {
            AudioError::PermissionDenied(_) => "PERMISSION_DENIED",
            AudioError::DeviceNotFound(_) => "DEVICE_NOT_FOUND",
            AudioError::UnsupportedFormat(_) => "UNSUPPORTED_FORMAT",
            AudioError::Wasapi(_) => "WASAPI",
            AudioError::ScreenCaptureKit(_) => "SCREEN_CAPTURE_KIT",
            AudioError::Resample(_) => "RESAMPLE",
            AudioError::Dispatch(_) => "DISPATCH",
            AudioError::NotRunning => "NOT_RUNNING",
            AudioError::AlreadyRunning => "ALREADY_RUNNING",
            AudioError::Other(_) => "OTHER",
        };
        napi::Error::new(napi::Status::GenericFailure, format!("{code}: {value}"))
    }
}
