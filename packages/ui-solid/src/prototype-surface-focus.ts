interface FocusSurface {
  readonly isConnected: boolean;
  focus(options: { preventScroll: boolean }): void;
}

/** Defer focus until the newly active overlay surface is mounted. */
export class PrototypeSurfaceFocus {
  private key: string | null = null;
  private version = 0;
  private disposed = false;
  constructor(
    private readonly schedule: (callback: () => void) => void = queueMicrotask,
  ) {}

  update(key: string | null, resolve: () => FocusSurface | null): void {
    if (this.disposed || key === this.key) return;
    this.key = key;
    const version = ++this.version;
    this.schedule(() => {
      if (this.disposed || version !== this.version) return;
      const surface = resolve();
      if (surface?.isConnected) surface.focus({ preventScroll: true });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.version += 1;
  }
}
