const GENERICS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "fangsong",
  "emoji",
]);
/** Preserve font stacks and generic families while keeping each named family a CSS string. */
export function fontFamilyCss(source: string): string {
  const families: string[] = [];
  let current = "";
  let quote: string | null = null;
  const finish = () => {
    if (current.trim()) families.push(current.trim());
    current = "";
  };
  for (let at = 0; at < source.length; at++) {
    const char = source[at] ?? "";
    if (quote) {
      if (char === "\\" && at + 1 < source.length) {
        current += source[++at];
      } else if (char === quote) quote = null;
      else current += char;
    } else if (char === ",") finish();
    else if ((char === '"' || char === "'") && !current.trim()) quote = char;
    else current += char;
  }
  finish();
  return (
    families
      .map((family) =>
        GENERICS.has(family.toLowerCase())
          ? family
          : `"${family.replace(/[\\"\n\r\f<>]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`,
      )
      .join(", ") || "sans-serif"
  );
}
