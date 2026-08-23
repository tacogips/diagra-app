// REST client for the sync server's document routes.
//
// Every call returns a result rather than throwing: an unreachable host, an
// expired share link and a document that was deleted are all ordinary things
// for this UI to show, not exceptions for a caller to catch. That mirrors
// `file/session.ts`, which treats a missing file the same way.
//
// The endpoint always arrives from the caller (see `settings.ts`).

export interface CloudDocument {
  readonly id: string;
  readonly title: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status: number | null;
      readonly error: string;
    };

export interface CloudApiOptions {
  readonly endpoint: string;
  /** Dev principal, forwarded as `?dev_user=`. */
  readonly devUser?: string | undefined;
  /** Share-link token, forwarded as `?token=`. Memory-only. */
  readonly token?: string | undefined;
}

export interface CloudApi {
  listDocuments(
    options: CloudApiOptions,
  ): Promise<ApiResult<readonly CloudDocument[]>>;
  createDocument(
    options: CloudApiOptions & {
      readonly title?: string;
      /** JSONL body; seeds the room from an existing document. */
      readonly jsonl?: string;
    },
  ): Promise<ApiResult<CloudDocument>>;
  probeDocument(
    options: CloudApiOptions & { readonly docId: string },
  ): Promise<ApiResult<void>>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build a route URL on the configured endpoint, carrying the credentials. */
function routeUrl(
  options: CloudApiOptions,
  path: string,
  extra: Record<string, string> = {},
): URL {
  if (options.endpoint.trim() === "") {
    throw new Error("no sync endpoint is configured");
  }
  const base = new URL(options.endpoint);
  const url = new URL(
    `${base.pathname.replace(/\/+$/, "")}${path}`,
    base.origin,
  );
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  if (options.devUser) {
    url.searchParams.set("dev_user", options.devUser);
  }
  if (options.token) {
    url.searchParams.set("token", options.token);
  }
  return url;
}

/** Server errors are `{ error: { code, message } }` (sync-server design 4.1). */
async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; code?: string };
    };
    const message = body.error?.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim();
}

async function failure<T>(response: Response): Promise<ApiResult<T>> {
  return {
    ok: false,
    status: response.status,
    error: await readError(response),
  };
}

export const cloudApi: CloudApi = {
  async listDocuments(options) {
    let url: URL;
    try {
      url = routeUrl(options, "/api/documents");
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        return failure(response);
      }
      const body = (await response.json()) as {
        documents?: readonly CloudDocument[];
      };
      return { ok: true, value: body.documents ?? [] };
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
  },

  async createDocument(options) {
    let url: URL;
    try {
      url = routeUrl(
        options,
        "/api/documents",
        options.title ? { title: options.title } : {},
      );
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        ...(options.jsonl === undefined ? {} : { body: options.jsonl }),
      });
      if (!response.ok) {
        return failure(response);
      }
      return { ok: true, value: (await response.json()) as CloudDocument };
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
  },

  /**
   * Check that this caller may open this document, before any socket exists.
   *
   * A rejected WebSocket upgrade closes before the 101 and tells the client
   * nothing a provider can act on — it just retries with backoff, forever.
   * Asking REST first turns "wrong token" and "no such document" into a
   * message instead of a spinner. `export.jsonl` is the only per-document
   * read route, so the body is cancelled rather than read.
   */
  async probeDocument(options) {
    let url: URL;
    try {
      url = routeUrl(
        options,
        `/api/documents/${encodeURIComponent(options.docId)}/export.jsonl`,
      );
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        return failure(response);
      }
      // Nothing here wants the document itself, and it can be megabytes.
      await response.body?.cancel().catch(() => {});
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
  },
};
