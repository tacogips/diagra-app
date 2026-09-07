export type PrototypeVariantMode = "activate" | "restore" | "toggle";

/** Ephemeral state memory for reversible preview-only component interactions. */
export class PrototypeVariantState {
  private readonly origins = new Map<string, string>();

  clear(): void {
    this.origins.clear();
  }

  next(
    linkId: string,
    current: string,
    requested: string,
    mode: PrototypeVariantMode,
  ): string | undefined {
    const origin = this.origins.get(linkId);
    if (mode === "restore") {
      this.origins.delete(linkId);
      return origin && origin !== current ? origin : undefined;
    }
    if (mode === "toggle" && current === requested && origin) {
      this.origins.delete(linkId);
      return origin === current ? undefined : origin;
    }
    if (current === requested) return undefined;
    if (!origin) this.origins.set(linkId, current);
    return requested;
  }
}
