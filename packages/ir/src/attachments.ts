const encoder = new TextEncoder();

/** Portable attachment paths are relative to the document, never process cwd. */
export function isRelativeAttachmentPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    encoder.encode(value).byteLength > 1024
  )
    return false;
  if (
    /[\\:%?#]/.test(value) ||
    [...value].some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    ) ||
    value.startsWith("/")
  )
    return false;
  return value
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment.trim() === segment,
    );
}
export function isRasterAttachmentPath(value: unknown): value is string {
  return (
    isRelativeAttachmentPath(value) && /\.(png|jpe?g|webp|gif)$/i.test(value)
  );
}
