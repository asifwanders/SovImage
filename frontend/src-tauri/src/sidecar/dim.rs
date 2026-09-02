//! Bounded input inspection and full generated-PNG validation.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

const HEADER_LIMIT: u64 = 1024 * 1024;
const MAX_INPUT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_DIMENSION: u32 = 8192;
const MAX_PIXELS: u64 = 40_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Bmp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageInfo {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

pub fn validate_input(path: &Path) -> Result<ImageInfo, String> {
    inspect(path, MAX_INPUT_BYTES)
}

pub fn validate_output_png(
    path: &Path,
    expected_width: u32,
    expected_height: u32,
) -> Result<ImageInfo, String> {
    let info = inspect(path, MAX_OUTPUT_BYTES)?;
    if info.format != ImageFormat::Png {
        return Err("generation output is not a PNG".into());
    }
    if (info.width, info.height) != (expected_width, expected_height) {
        return Err(format!(
            "generation output has dimensions {}x{}, expected {}x{}",
            info.width, info.height, expected_width, expected_height
        ));
    }

    let decoder = png::Decoder::new(BufReader::new(
        File::open(path).map_err(|error| error.to_string())?,
    ));
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("generation output is not a valid PNG: {error}"))?;
    let buffer_size = reader
        .output_buffer_size()
        .ok_or_else(|| "generation output is too large to decode safely".to_string())?;
    let maximum = usize::try_from(u64::from(expected_width) * u64::from(expected_height) * 8)
        .map_err(|_| "generation output dimensions overflow".to_string())?;
    if buffer_size > maximum {
        return Err("generation output expands beyond its declared dimensions".into());
    }
    let mut pixels = vec![0; buffer_size];
    let frame = reader
        .next_frame(&mut pixels)
        .map_err(|error| format!("generation output is not a valid PNG: {error}"))?;
    if (frame.width, frame.height) != (expected_width, expected_height) {
        return Err("decoded generation dimensions changed unexpectedly".into());
    }
    Ok(info)
}

fn inspect(path: &Path, max_bytes: u64) -> Result<ImageInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(format!(
            "image must be a non-empty file no larger than {} MiB",
            max_bytes / (1024 * 1024)
        ));
    }

    let mut header = Vec::with_capacity(metadata.len().min(HEADER_LIMIT) as usize);
    File::open(path)
        .map_err(|error| error.to_string())?
        .take(HEADER_LIMIT)
        .read_to_end(&mut header)
        .map_err(|error| error.to_string())?;
    let (format, width, height) = inspect_bytes(&header)
        .ok_or_else(|| "unsupported or malformed image (PNG, JPEG, GIF, BMP only)".to_string())?;
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(format!("unsafe image dimensions: {width}x{height}"));
    }
    Ok(ImageInfo {
        format,
        width,
        height,
        bytes: metadata.len(),
    })
}

fn inspect_bytes(bytes: &[u8]) -> Option<(ImageFormat, u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        && bytes.get(12..16) == Some(b"IHDR")
        && bytes.len() >= 24
    {
        return Some((
            ImageFormat::Png,
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        ));
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        return jpeg_dimensions(bytes).map(|(width, height)| (ImageFormat::Jpeg, width, height));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some((
            ImageFormat::Gif,
            u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?) as u32,
            u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?) as u32,
        ));
    }
    if bytes.starts_with(b"BM") && bytes.len() >= 26 {
        let width = i32::from_le_bytes(bytes[18..22].try_into().ok()?);
        let height = i32::from_le_bytes(bytes[22..26].try_into().ok()?);
        return (width > 0 && height != 0).then_some((
            ImageFormat::Bmp,
            width as u32,
            height.unsigned_abs(),
        ));
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut index = 2usize;
    while index + 4 <= bytes.len() {
        while bytes.get(index) == Some(&0xff) {
            index += 1;
        }
        let marker = *bytes.get(index)?;
        index += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(index..index + 2)?.try_into().ok()?) as usize;
        if length < 2 || index + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            let height = u16::from_be_bytes(bytes.get(index + 3..index + 5)?.try_into().ok()?);
            let width = u16::from_be_bytes(bytes.get(index + 5..index + 7)?.try_into().ok()?);
            return Some((width as u32, height as u32));
        }
        index += length;
    }
    None
}

pub fn fit_to_max(
    src_width: u32,
    src_height: u32,
    max_width: u32,
    max_height: u32,
    align: u32,
) -> (u32, u32) {
    debug_assert!(src_width > 0 && src_height > 0 && align > 0);
    let scale = (max_width as f64 / src_width as f64)
        .min(max_height as f64 / src_height as f64)
        .min(1.0);
    let width = align * ((src_width as f64 * scale / align as f64).round() as u32).max(1);
    let height = align * ((src_height as f64 * scale / align as f64).round() as u32).max(1);
    (width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_png_without_decoding_pixels() {
        let mut bytes = vec![0u8; 24];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&800u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&600u32.to_be_bytes());
        assert_eq!(inspect_bytes(&bytes), Some((ImageFormat::Png, 800, 600)));
    }

    #[test]
    fn rejects_webp_when_the_bundled_engine_has_it_disabled() {
        let mut bytes = vec![0u8; 30];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[8..12].copy_from_slice(b"WEBP");
        bytes[12..16].copy_from_slice(b"VP8X");
        bytes[24..27].copy_from_slice(&[0xff, 0x03, 0]);
        bytes[27..30].copy_from_slice(&[0xff, 0x01, 0]);
        assert_eq!(inspect_bytes(&bytes), None);
    }

    #[test]
    fn output_requires_decodable_png_data() {
        let directory = tempfile::tempdir().unwrap();
        let fake = directory.path().join("fake.png");
        let valid = directory.path().join("valid.png");
        let mut header = vec![0u8; 24];
        header[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        header[12..16].copy_from_slice(b"IHDR");
        header[16..20].copy_from_slice(&32u32.to_be_bytes());
        header[20..24].copy_from_slice(&32u32.to_be_bytes());
        std::fs::write(&fake, header).unwrap();
        assert!(validate_output_png(&fake, 32, 32).is_err());

        std::fs::write(&valid, include_bytes!("../../icons/32x32.png")).unwrap();
        assert!(validate_output_png(&valid, 32, 32).is_ok());
    }

    #[test]
    fn preserves_aspect_ratio_and_alignment() {
        assert_eq!(fit_to_max(1920, 1080, 1024, 1024, 16), (1024, 576));
        assert_eq!(fit_to_max(1080, 1920, 1024, 1024, 16), (576, 1024));
        let (width, height) = fit_to_max(1000, 750, 1024, 1024, 16);
        assert_eq!(width % 16, 0);
        assert_eq!(height % 16, 0);
    }
}
