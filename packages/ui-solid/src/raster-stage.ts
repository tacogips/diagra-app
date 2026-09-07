/** Bound a browser callback stage and detach its cancellation listener on settlement. */
export function rasterStage<T>(
  start: () => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("PNG export cancelled."));
      return;
    }
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      action();
    };
    const cancel = (): void =>
      finish(() => reject(new Error("PNG export cancelled.")));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              "PNG rendering timed out. Try a smaller scale or export SVG.",
            ),
          ),
        ),
      timeoutMs,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      start().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
