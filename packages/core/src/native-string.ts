/** Native literals must not reuse JSON escaping or enable string interpolation. */
export function swiftString(value: string): string {
  return `"${Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"' || character === "\\") return `\\${character}`;
    if (code < 32 || code === 0x2028 || code === 0x2029)
      return `\\u{${code.toString(16)}}`;
    // Swift strings contain Unicode scalars, not isolated UTF-16 surrogates.
    if (code >= 0xd800 && code <= 0xdfff) return "\\u{fffd}";
    return character;
  }).join("")}"`;
}

export function kotlinString(value: string): string {
  return `"${Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"' || character === "\\" || character === "$")
      return `\\${character}`;
    if (
      code < 32 ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      return `\\u${code.toString(16).padStart(4, "0")}`;
    return character;
  }).join("")}"`;
}
