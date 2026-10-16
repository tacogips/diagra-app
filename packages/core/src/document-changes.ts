import type { ElementId } from "@nodetto/ir";

/** A resource is a local path or a cloud document key, never a display name. */
export interface DocumentChange {
  readonly documentId: string;
  /** Absent means the whole document must be read again (including pages/meta). */
  readonly elementIds?: readonly ElementId[];
  /** Lets a writer suppress its own echo without depending on a transport. */
  readonly origin?: unknown;
}

export interface DocumentChangeSubscription {
  /** Resolves when watching is installed; rejects when setup failed. */
  readonly ready: Promise<void>;
  /** Stops notifications synchronously; asynchronous transport cleanup may follow. */
  close(): void | Promise<void>;
}

/** File watchers, cloud push APIs and in-memory documents implement this seam. */
export interface DocumentChangeSource {
  watch(
    documentId: string,
    listener: (change: DocumentChange) => void,
  ): DocumentChangeSubscription;
}

/** Owns one subscription. Switching sources retires late setup and late events. */
export class DocumentChangeMonitor {
  private generation = 0;
  private subscription: DocumentChangeSubscription | null = null;

  async watch(
    source: DocumentChangeSource,
    documentId: string,
    listener: (change: DocumentChange) => void,
  ): Promise<void> {
    const generation = ++this.generation;
    const previous = this.subscription;
    this.subscription = null;
    if (previous) await previous.close();
    if (generation !== this.generation) return;
    const subscription = source.watch(documentId, (change) => {
      if (generation === this.generation && change.documentId === documentId)
        listener(change);
    });
    this.subscription = subscription;
    try {
      await subscription.ready;
    } catch (error) {
      if (this.subscription === subscription) {
        this.subscription = null;
        ++this.generation;
        await subscription.close();
      }
      throw error;
    }
  }

  close(): Promise<void> {
    ++this.generation;
    const subscription = this.subscription;
    this.subscription = null;
    return Promise.resolve(subscription?.close());
  }
}
