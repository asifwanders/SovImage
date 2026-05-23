//! Hardware profiling: detect installed memory / VRAM and pick a model Tier.
//!
//! macOS arm64 → `sysctl hw.memsize` for unified memory.
//! Windows x64  → NVIDIA VRAM via NVML (preferred). If NVML init fails (no
//!                NVIDIA GPU or driver), fall back to system RAM via
//!                `GlobalMemoryStatusEx`. The sprint UI gates Windows on
//!                NVIDIA — if VRAM probe fails we still return a Tier so the
//!                splash can render the "Unsupported hardware" panel.

use serde::Serialize;

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
    /// `"unified"` on Apple Silicon, `"vram"` on NVIDIA, `"ram"` on fallback.
    pub kind: &'static str,
    /// Best-effort device label for the splash screen.
    pub device: String,
    /// True iff the host is supported for actual generation this sprint.
    /// (Windows without an NVIDIA GPU → false.)
    pub supported: bool,
}

pub fn detect() -> HardwareProfile {
    #[cfg(target_os = "macos")]
    {
        let bytes = mac_total_unified_memory();
        return HardwareProfile {
            tier: tier_for_bytes(bytes),
            total_bytes: bytes,
            kind: "unified",
            device: "Apple Silicon".into(),
            supported: cfg!(target_arch = "aarch64"),
        };
    }

    #[cfg(target_os = "windows")]
    {
        if let Some((vram, name)) = win_nvidia_vram() {
            return HardwareProfile {
                tier: tier_for_bytes(vram),
                total_bytes: vram,
                kind: "vram",
                device: name,
                supported: true,
            };
        }
        let ram = win_system_ram();
        return HardwareProfile {
            tier: tier_for_bytes(ram),
            total_bytes: ram,
            kind: "ram",
            device: "Non-NVIDIA Windows".into(),
            supported: false,
        };
    }

    #[allow(unreachable_code)]
    HardwareProfile {
        tier: Tier::Three,
        total_bytes: 0,
        kind: "unknown",
        device: "Unsupported platform".into(),
        supported: false,
    }
}

pub fn tier_for_bytes(bytes: u64) -> Tier {
    const GB: u64 = 1024 * 1024 * 1024;
    match bytes {
        b if b < 12 * GB => Tier::One,
        b if b <= 16 * GB => Tier::Two,
        _ => Tier::Three,
    }
}

// ---------- macOS ----------

#[cfg(target_os = "macos")]
fn mac_total_unified_memory() -> u64 {
    use std::process::Command;
    // `sysctl -n hw.memsize` prints a single decimal byte count.
    if let Ok(out) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
        if out.status.success() {
            if let Ok(s) = std::str::from_utf8(&out.stdout) {
                if let Ok(v) = s.trim().parse::<u64>() {
                    return v;
                }
            }
        }
    }
    0
}

// ---------- Windows ----------

#[cfg(target_os = "windows")]
fn win_nvidia_vram() -> Option<(u64, String)> {
    use nvml_wrapper::Nvml;
    let nvml = Nvml::init().ok()?;
    let count = nvml.device_count().ok()?;
    if count == 0 {
        return None;
    }
    // Pick the highest-VRAM device.
    let mut best: Option<(u64, String)> = None;
    for i in 0..count {
        if let Ok(dev) = nvml.device_by_index(i) {
            let mem = dev.memory_info().ok().map(|m| m.total).unwrap_or(0);
            let name = dev.name().unwrap_or_else(|_| "NVIDIA GPU".into());
            best = match best {
                Some((b, _)) if b >= mem => best,
                _ => Some((mem, name)),
            };
        }
    }
    best
}

#[cfg(target_os = "windows")]
fn win_system_ram() -> u64 {
    use windows_sys::Win32::System::SystemInformation::{
        GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };
    let mut stat = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..unsafe { std::mem::zeroed() }
    };
    if unsafe { GlobalMemoryStatusEx(&mut stat) } != 0 {
        stat.ullTotalPhys
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const GB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn tier_thresholds() {
        assert_eq!(tier_for_bytes(8 * GB), Tier::One);
        assert_eq!(tier_for_bytes(11 * GB), Tier::One);
        assert_eq!(tier_for_bytes(12 * GB), Tier::Two);
        assert_eq!(tier_for_bytes(16 * GB), Tier::Two);
        assert_eq!(tier_for_bytes(24 * GB), Tier::Three);
        assert_eq!(tier_for_bytes(64 * GB), Tier::Three);
    }
}
