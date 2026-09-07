/** Embedded raster assets keep designs portable without external requests. */
export const MAX_IMAGE_BYTES = 1024 * 1024;
export function isRasterDataUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
  )
    return false;
  const match =
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) return false;
  const mime = match[1];
  const encoded = match[2] as string;
  if (encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const bytes = (encoded.length / 4) * 3 - padding;
  if (bytes > MAX_IMAGE_BYTES) return false;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const last = alphabet.indexOf(encoded[encoded.length - padding - 1] ?? "");
  if (
    (padding === 2 && (last & 15) !== 0) ||
    (padding === 1 && (last & 3) !== 0)
  )
    return false;
  // Only a short header is decoded here. Full decoding belongs to the
  // image renderer; this portable validator checks type and encoded size.
  const header: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const char of encoded.slice(0, 16)) {
    if (char === "=") break;
    accumulator = (accumulator << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      header.push((accumulator >> bits) & 255);
    }
  }
  const starts = (signature: readonly number[]): boolean =>
    signature.every((byte, index) => header[index] === byte);
  if (mime === "png") return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (mime === "jpeg") return starts([255, 216, 255]);
  if (mime === "gif")
    return starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]);
  return (
    starts([82, 73, 70, 70]) && header.slice(8, 12).join(",") === "87,69,66,80"
  );
}
