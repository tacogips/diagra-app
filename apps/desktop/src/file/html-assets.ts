import {
  encodeRasterDataUrl,
  decodeRasterDataUrl,
  isRasterDataUrl,
  isRelativeAttachmentPath,
} from "@nodetto/ir";

/** Resolve dependencies against a stylesheet, never escaping the selected HTML directory. */
export function htmlDependencyPath(reference: string, base = ""): string {
  if (!reference || /[\\:%?#]/.test(reference) || reference.startsWith("/"))
    throw new Error("Unsupported local dependency path");
  const parts = base.split("/").slice(0, -1).filter(Boolean);
  for (const part of reference.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Dependency escapes HTML directory");
      parts.pop();
    } else parts.push(part);
  }
  const path = parts.join("/");
  if (!isRelativeAttachmentPath(path))
    throw new Error("Invalid local dependency path");
  return path;
}
export class HtmlImportAssets {
  readonly assets = new Map<string, string>();
  private readonly references = new Map<string, string>();
  private readonly dataPaths = new Map<string, string>();
  constructor(
    private readonly read: (relative: string) => Promise<Uint8Array>,
  ) {}
  async image(
    reference: string,
    base = "",
  ): Promise<{ path: string; data: string }> {
    let data: string;
    if (isRasterDataUrl(reference)) data = reference;
    else {
      const relative = htmlDependencyPath(reference, base);
      const cached = this.references.get(relative);
      data = cached ?? encodeRasterDataUrl(await this.read(relative));
      this.references.set(relative, data);
    }
    let path = this.dataPaths.get(data);
    if (!path) {
      path = `artifacts/imported-image-${this.assets.size + 1}.${decodeRasterDataUrl(data).extension}`;
      this.assets.set(path, data);
      this.dataPaths.set(data, path);
    }
    return { path, data };
  }
  pathForData(data: string): string | undefined {
    return this.dataPaths.get(data);
  }
  async css(
    source: string,
    base: string,
    warn: (message: string) => void,
  ): Promise<string> {
    const pattern = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
    const replacements: { start: number; end: number; value: string }[] = [];
    for (const match of source.matchAll(pattern)) {
      const reference = match[1] ?? match[2] ?? match[3] ?? "";
      let value = "none";
      try {
        value = `url("${(await this.image(reference, base)).data}")`;
      } catch {
        warn(`CSS resource omitted: ${reference.slice(0, 120)}`);
      }
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        value,
      });
    }
    let result = source;
    for (const replacement of replacements.reverse())
      result =
        result.slice(0, replacement.start) +
        replacement.value +
        result.slice(replacement.end);
    return result;
  }
}
