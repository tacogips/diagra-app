import { isRasterAttachmentPath, isRasterDataUrl } from "@nodetto/ir";

/** Decoded sources are host-owned view state. They never enter JSONL/history. */
export class AssetCache {
  private readonly sources = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  readonly resolve = (source: string): string | undefined =>
    isRasterDataUrl(source) ? source : this.sources.get(source);
  set(path: string, source: string): void {
    if (!isRasterAttachmentPath(path) || !isRasterDataUrl(source))
      throw new Error("Invalid raster attachment or decoded source.");
    if (this.sources.get(path) === source) return;
    this.sources.set(path, source);
    this.notify();
  }
  copyFrom(other: AssetCache): void {
    if (
      this.sources.size === other.sources.size &&
      [...this.sources].every(
        ([key, value]) => other.sources.get(key) === value,
      )
    )
      return;
    this.sources.clear();
    for (const [key, value] of other.sources) this.sources.set(key, value);
    this.notify();
  }
  clear(): void {
    if (!this.sources.size) return;
    this.sources.clear();
    this.notify();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
