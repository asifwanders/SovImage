//! Conservative hardware profiling for the pinned FLUX.2 Klein packs.

#![cfg_attr(feature = "stub_runtime", allow(dead_code))]

use serde::Serialize;

const GIB: u64 = 1024 * 1024 * 1024;
const MIN_ACCELERATOR_BYTES: u64 = 12 * GIB;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    One = 1,
    Two = 2,
    Three = 3,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub tier: Tier,
    pub total_bytes: u64,
    pub kind: &'static str,
    pub device: String,
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    /// Exact sd.cpp backend name selected by the same probe that chose the tier.
    pub backend: Option<String>,
}

pub fn detect() -> HardwareProfile {
    #[cfg(target_os = "macos")]
    {
        let bytes = mac_total_unified_memory();
        let architecture_ok = cfg!(target_arch = "aarch64");
        let unsupported_reason = if !architecture_ok {
            Some("SovImage requires Apple Silicon; Intel Macs are not supported.".into())
        } else if bytes == 0 {
            Some("SovImage could not read this Mac's unified memory.".into())
        } else if !has_safe_headroom(bytes) {
            Some(format!(
                "This Mac has {:.1} GiB of unified memory; SovImage requires at least 12 GiB.",
                bytes as f64 / GIB as f64
            ))
        } else {
            None
        };
        return HardwareProfile {
            tier: tier_for_bytes(bytes),
            total_bytes: bytes,
            kind: "unified",
            device: if architecture_ok {
                "Apple Silicon".into()
            } else {
                "Intel Mac".into()
            },
            supported: unsupported_reason.is_none(),
            unsupported_reason,
            backend: architecture_ok.then(|| "metal".into()),
        };
    }

    #[cfg(target_os = "windows")]
    {
        return match win_nvidia_vram() {
            Ok((vram, name, index)) => {
                let unsupported_reason = (!has_safe_headroom(vram)).then(|| {
                    format!(
                        "{name} has {:.1} GiB of VRAM; SovImage requires at least 12 GiB.",
                        vram as f64 / GIB as f64
                    )
                });
                HardwareProfile {
                    tier: tier_for_bytes(vram),
                    total_bytes: vram,
                    kind: "vram",
                    device: name,
                    supported: unsupported_reason.is_none(),
                    unsupported_reason,
                    backend: Some(format!("cuda{index}")),
                }
            }
            Err(reason) => HardwareProfile {
                tier: Tier::One,
                total_bytes: 0,
                kind: "vram",
                device: "NVIDIA GPU unavailable".into(),
                supported: false,
                unsupported_reason: Some(reason),
                backend: None,
            },
        };
    }

    #[allow(unreachable_code)]
    HardwareProfile {
        tier: Tier::One,
        total_bytes: 0,
        kind: "unknown",
        device: "Unsupported platform".into(),
        supported: false,
        unsupported_reason: Some(
            "SovImage supports only macOS and Windows release targets.".into(),
        ),
        backend: None,
    }
}

pub fn has_safe_headroom(bytes: u64) -> bool {
    bytes >= MIN_ACCELERATOR_BYTES
}

pub fn tier_for_bytes(bytes: u64) -> Tier {
    match bytes {
        b if b < 24 * GIB => Tier::One,
        b if b < 32 * GIB => Tier::Two,
        _ => Tier::Three,
    }
}

#[cfg(target_os = "macos")]
fn mac_total_unified_memory() -> u64 {
    use std::ffi::{c_void, CString};

    let Ok(name) = CString::new("hw.memsize") else {
        return 0;
    };
    let mut value = 0u64;
    let mut size = std::mem::size_of::<u64>();
    // Safety: `value` and `size` point to writable objects of the advertised
    // length; no new value is supplied, so sysctlbyname only reads hw.memsize.
    let rc = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut u64).cast::<c_void>(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc == 0 && size == std::mem::size_of::<u64>() {
        value
    } else {
        0
    }
}

#[cfg(target_os = "windows")]
fn win_nvidia_vram() -> Result<(u64, String, u32), String> {
    use nvml_wrapper::Nvml;

    let nvml = Nvml::init()
        .map_err(|_| "No usable NVIDIA GPU or NVIDIA driver was detected.".to_string())?;
    let count = nvml
        .device_count()
        .map_err(|error| format!("Could not enumerate NVIDIA GPUs: {error}"))?;
    let visible = std::env::var_os("CUDA_VISIBLE_DEVICES");
    let visible = match visible.as_ref() {
        Some(value) => Some(value.to_str().ok_or_else(|| {
            "CUDA_VISIBLE_DEVICES is not valid Unicode; select one full GPU UUID.".to_string()
        })?),
        None => None,
    };
    let index = match visible_device_selector(count, visible)? {
        VisibleDevice::Index(index) => index,
        VisibleDevice::Uuid(expected) => {
            let mut matched = None;
            for index in 0..count {
                let Ok(device) = nvml.device_by_index(index) else {
                    continue;
                };
                if device
                    .uuid()
                    .ok()
                    .is_some_and(|uuid| uuid.eq_ignore_ascii_case(&expected))
                {
                    if matched.is_some() {
                        return Err("CUDA_VISIBLE_DEVICES matched more than one NVIDIA GPU.".into());
                    }
                    matched = Some(index);
                }
            }
            matched.ok_or_else(|| {
                "CUDA_VISIBLE_DEVICES does not match a full NVIDIA GPU UUID.".to_string()
            })?
        }
    };
    let device = nvml
        .device_by_index(index)
        .map_err(|error| format!("Could not open the selected NVIDIA GPU: {error}"))?;
    let memory = device
        .memory_info()
        .map_err(|error| format!("Could not read NVIDIA VRAM: {error}"))?;
    if memory.total == 0 {
        return Err("The selected NVIDIA GPU reported zero VRAM.".into());
    }
    Ok((
        memory.total,
        device.name().unwrap_or_else(|_| "NVIDIA GPU".into()),
        0,
    ))
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
enum VisibleDevice {
    Index(u32),
    Uuid(String),
}

#[cfg(any(target_os = "windows", test))]
fn visible_device_selector(count: u32, value: Option<&str>) -> Result<VisibleDevice, String> {
    let Some(value) = value else {
        // ponytail: multi-GPU needs CUDA-runtime UUID enumeration; require an
        // explicit single visible device until that evidence exists.
        return match count {
            0 => Err("No NVIDIA GPU was detected.".into()),
            1 => Ok(VisibleDevice::Index(0)),
            _ => Err(
                "Multiple NVIDIA GPUs detected; set CUDA_VISIBLE_DEVICES to one full GPU UUID."
                    .into(),
            ),
        };
    };
    let value = value.trim();
    if value.is_empty() || value == "-1" {
        return Err("CUDA_VISIBLE_DEVICES hides all NVIDIA GPUs.".into());
    }
    if value.contains(',') {
        return Err("CUDA_VISIBLE_DEVICES must expose exactly one NVIDIA GPU.".into());
    }
    if let Ok(index) = value.parse::<u32>() {
        return if count == 1 && index == 0 {
            Ok(VisibleDevice::Index(0))
        } else {
            Err("Numeric CUDA_VISIBLE_DEVICES is ambiguous; use one full GPU UUID.".into())
        };
    }
    if value.starts_with("GPU-") {
        Ok(VisibleDevice::Uuid(value.to_owned()))
    } else {
        Err("CUDA_VISIBLE_DEVICES must be one full GPU UUID.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_memory_fails_closed() {
        assert!(!has_safe_headroom(0));
        assert!(!has_safe_headroom(8 * GIB));
        assert!(has_safe_headroom(12 * GIB));
    }

    #[test]
    fn tier_thresholds_leave_runtime_headroom() {
        assert_eq!(tier_for_bytes(12 * GIB), Tier::One);
        assert_eq!(tier_for_bytes(16 * GIB), Tier::One);
        assert_eq!(tier_for_bytes(24 * GIB), Tier::Two);
        assert_eq!(tier_for_bytes(31 * GIB), Tier::Two);
        assert_eq!(tier_for_bytes(32 * GIB), Tier::Three);
    }

    #[test]
    fn cuda_selection_requires_one_unambiguous_visible_device() {
        assert_eq!(
            visible_device_selector(1, None),
            Ok(VisibleDevice::Index(0))
        );
        assert!(visible_device_selector(2, None).is_err());
        assert_eq!(
            visible_device_selector(1, Some("0")),
            Ok(VisibleDevice::Index(0))
        );
        assert_eq!(
            visible_device_selector(2, Some("GPU-uuid")),
            Ok(VisibleDevice::Uuid("GPU-uuid".into()))
        );
        assert!(visible_device_selector(2, Some("1,0")).is_err());
        assert!(visible_device_selector(2, Some("1")).is_err());
        assert!(visible_device_selector(2, Some("-1")).is_err());
        assert!(visible_device_selector(2, Some("2")).is_err());
    }
}
