export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_PIXELS = 40_000_000;
export const MAX_ATTACHMENT_DIMENSION = 8_192;

export type SupportedImage = {
  extension: ".png" | ".jpg";
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
};

export function inspectImage(bytes: Uint8Array): SupportedImage {
  const image = isPng(bytes) ? pngInfo(bytes) : jpegInfo(bytes);
  if (!image) {
    throw new Error("Choose a valid PNG or JPEG image.");
  }
  if (
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_ATTACHMENT_DIMENSION ||
    image.height > MAX_ATTACHMENT_DIMENSION ||
    image.width * image.height > MAX_ATTACHMENT_PIXELS
  ) {
    throw new Error(
      `Image dimensions must be at most ${MAX_ATTACHMENT_DIMENSION}px per side and ${MAX_ATTACHMENT_PIXELS / 1_000_000} megapixels.`,
    );
  }
  return image;
}

function isPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= 24 && signature.every((byte, i) => bytes[i] === byte);
}

function pngInfo(bytes: Uint8Array): SupportedImage | null {
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    extension: ".png",
    mime: "image/png",
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function jpegInfo(bytes: Uint8Array): SupportedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (isStartOfFrame(marker)) {
      if (length < 7) return null;
      return {
        extension: ".jpg",
        mime: "image/jpeg",
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

function isStartOfFrame(marker: number) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}
