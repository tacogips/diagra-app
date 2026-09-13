// REST client for the sync server's document routes.
//
// Every call returns a result rather than throwing: an unreachable host, an
// expired share link and a document that was deleted are all ordinary things
// for this UI to show, not exceptions for a caller to catch. That mirrors
// `file/session.ts`, which treats a missing file the same way.
//
// The endpoint always arrives from the caller (see `settings.ts`).

export type CloudRole = "owner" | "editor" | "viewer";
export interface CloudShare {
  readonly token: string;
  readonly role: "viewer" | "editor";
  readonly documentId: string;
}

export interface CloudShareInfo extends CloudShare {
  readonly createdAt: string;
  readonly revoked: boolean;
}
export interface CloudSharePage {
  readonly items: readonly CloudShareInfo[];
  readonly nextBefore: number | null;
}

export interface CloudDocument {
  readonly id: string;
  readonly title: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A bounded personal-workspace page returned by `GET /api/documents`. */
export interface CloudDocumentPage {
  readonly items: readonly CloudDocument[];
  readonly nextCursor: string | null;
  readonly workspaceId: string | null;
  readonly adoptedCount: number;
  /** More historical documents still need to be adopted; refresh from head. */
  readonly moreDocuments: boolean;
  readonly pendingInvalidation: boolean;
  /** A cursor page changed while migration ran; discard it and restart at head. */
  readonly cursorReset: boolean;
  readonly status: "pending" | "complete";
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
  listShares(
    options: CloudApiOptions & {
      readonly docId: string;
      readonly before?: number;
    },
  ): Promise<ApiResult<CloudSharePage>>;
  revokeShare(
    options: CloudApiOptions & {
      readonly docId: string;
      readonly shareToken: string;
    },
  ): Promise<ApiResult<void>>;
  createShare(
    options: CloudApiOptions & {
      readonly docId: string;
      readonly role: "viewer" | "editor";
    },
  ): Promise<ApiResult<CloudShare>>;
  listDocuments(
    options: CloudApiOptions & { readonly before?: string },
  ): Promise<ApiResult<CloudDocumentPage>>;
  createDocument(
    options: CloudApiOptions & {
      readonly title?: string;
      /** JSONL body; seeds the room from an existing document. */
      readonly jsonl?: string;
    },
  ): Promise<ApiResult<CloudDocument>>;
  probeDocument(
    options: CloudApiOptions & { readonly docId: string },
  ): Promise<ApiResult<CloudRole>>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCloudDocument(value: unknown): value is CloudDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<CloudDocument>;
  return (
    typeof document.id === "string" &&
    document.id.length > 0 &&
    typeof document.title === "string" &&
    typeof document.ownerId === "string" &&
    document.ownerId.length > 0 &&
    typeof document.createdAt === "string" &&
    Number.isFinite(Date.parse(document.createdAt)) &&
    typeof document.updatedAt === "string" &&
    Number.isFinite(Date.parse(document.updatedAt))
  );
}

function invalidDocumentPage(status: number): ApiResult<CloudDocumentPage> {
  return {
    ok: false,
    status,
    error: "Server returned an invalid document list.",
  };
}

function parseDocumentPage(
  body: unknown,
  status: number,
  before: string | undefined,
): ApiResult<CloudDocumentPage> {
  if (!body || typeof body !== "object") return invalidDocumentPage(status);
  const page = body as Record<string, unknown>;
  if (
    !Array.isArray(page.documents) ||
    !page.documents.every(isCloudDocument) ||
    new Set(page.documents.map((document) => document.id)).size !==
      page.documents.length
  )
    return invalidDocumentPage(status);

  // Keep development servers from before workspace pagination usable.
  const hasProgressFields = [
    "nextCursor",
    "workspaceId",
    "adoptedCount",
    "moreDocuments",
    "pendingInvalidation",
    "cursorReset",
    "status",
  ].some((field) => field in page);
  if (!hasProgressFields)
    return {
      ok: true,
      value: {
        items: page.documents,
        nextCursor: null,
        workspaceId: null,
        adoptedCount: 0,
        moreDocuments: false,
        pendingInvalidation: false,
        cursorReset: false,
        status: "complete",
      },
    };

  const nextCursor = page.nextCursor;
  const documents = page.documents;
  const descending = documents.every((document, index) => {
    const previous = documents[index - 1];
    return index === 0 || (previous !== undefined && previous.id > document.id);
  });
  if (
    documents.length > 100 ||
    !(
      nextCursor === null ||
      (typeof nextCursor === "string" &&
        /^[0-9A-HJKMNP-TV-Z]{26}$/.test(nextCursor))
    ) ||
    (typeof nextCursor === "string" &&
      (documents.length !== 100 ||
        documents.at(-1)?.id !== nextCursor ||
        (before !== undefined && nextCursor >= before))) ||
    !descending ||
    !(
      typeof page.workspaceId === "string" &&
      /^[0-9A-HJKMNP-TV-Z]{26}$/.test(page.workspaceId)
    ) ||
    !Number.isSafeInteger(page.adoptedCount) ||
    (page.adoptedCount as number) < 0 ||
    (page.adoptedCount as number) > 10 ||
    typeof page.moreDocuments !== "boolean" ||
    typeof page.pendingInvalidation !== "boolean" ||
    typeof page.cursorReset !== "boolean" ||
    (page.status !== "pending" && page.status !== "complete") ||
    (page.status === "pending") !==
      (page.moreDocuments === true || page.pendingInvalidation === true) ||
    ((page.moreDocuments || page.cursorReset) && nextCursor !== null) ||
    (page.cursorReset && (before === undefined || documents.length !== 0))
  )
    return invalidDocumentPage(status);

  return {
    ok: true,
    value: {
      items: page.documents,
      nextCursor,
      workspaceId: page.workspaceId,
      adoptedCount: page.adoptedCount as number,
      moreDocuments: page.moreDocuments,
      pendingInvalidation: page.pendingInvalidation,
      cursorReset: page.cursorReset,
      status: page.status,
    },
  };
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
  async listShares(options) {
    try {
      const response = await fetch(
        routeUrl(
          options,
          `/api/documents/${encodeURIComponent(options.docId)}/shares`,
          options.before === undefined
            ? {}
            : { before: String(options.before) },
        ),
        {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return failure(response);
      const body = (await response.json()) as Partial<CloudSharePage> | null;
      if (
        !body ||
        !Array.isArray(body.items) ||
        body.items.length > 50 ||
        !(
          body.nextBefore === null ||
          (typeof body.nextBefore === "number" &&
            Number.isSafeInteger(body.nextBefore) &&
            body.nextBefore > 0 &&
            (options.before === undefined || body.nextBefore < options.before))
        ) ||
        (body.nextBefore !== null && body.items.length !== 50) ||
        !body.items.every(
          (item) =>
            item &&
            item.documentId === options.docId &&
            (item.role === "viewer" || item.role === "editor") &&
            typeof item.token === "string" &&
            /^[A-Za-z0-9_-]{16,256}$/.test(item.token) &&
            typeof item.createdAt === "string" &&
            Number.isFinite(Date.parse(item.createdAt)) &&
            typeof item.revoked === "boolean",
        ) ||
        new Set(body.items.map((item) => item.token)).size !== body.items.length
      )
        return {
          ok: false,
          status: response.status,
          error: "Server returned an invalid share list.",
        };
      return {
        ok: true,
        value: { items: body.items, nextBefore: body.nextBefore },
      };
    } catch {
      return {
        ok: false,
        status: null,
        error: "Share links could not be loaded. Retry to refresh.",
      };
    }
  },
  async revokeShare(options) {
    try {
      const response = await fetch(
        routeUrl(
          options,
          `/api/documents/${encodeURIComponent(options.docId)}/revoke-share`,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: options.shareToken }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return failure(response);
      if (response.status !== 204)
        return {
          ok: false,
          status: response.status,
          error: "Server did not confirm share revocation. Retry to confirm.",
        };
      return { ok: true, value: undefined };
    } catch {
      return {
        ok: false,
        status: null,
        error: "Share revocation could not be confirmed. Retry to confirm.",
      };
    }
  },
  async createShare(options) {
    try {
      const response = await fetch(
        routeUrl(
          options,
          `/api/documents/${encodeURIComponent(options.docId)}/shares`,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: options.role }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return failure(response);
      const body = (await response.json()) as Partial<CloudShare>;
      if (
        body.documentId !== options.docId ||
        body.role !== options.role ||
        typeof body.token !== "string" ||
        !/^[A-Za-z0-9_-]{16,256}$/.test(body.token)
      )
        return {
          ok: false,
          status: response.status,
          error: "server returned an invalid share",
        };
      return {
        ok: true,
        value: {
          documentId: body.documentId,
          role: body.role,
          token: body.token,
        },
      };
    } catch {
      return {
        ok: false,
        status: null,
        error: "Could not create a share link. Check the connection.",
      };
    }
  },
  async listDocuments(options) {
    let url: URL;
    try {
      url = routeUrl(
        options,
        "/api/documents",
        options.before === undefined ? {} : { before: options.before },
      );
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
    try {
      const response = await fetch(url.toString(), {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return failure(response);
      }
      return parseDocumentPage(
        await response.json(),
        response.status,
        options.before,
      );
    } catch {
      return {
        ok: false,
        status: null,
        error: "Documents could not be loaded. Retry to refresh.",
      };
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
        `/api/documents/${encodeURIComponent(options.docId)}/access`,
      );
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        return failure(response);
      }
      const body = (await response.json()) as { role?: unknown };
      if (
        body.role !== "owner" &&
        body.role !== "editor" &&
        body.role !== "viewer"
      ) {
        return {
          ok: false,
          status: response.status,
          error: "server returned an invalid document role",
        };
      }
      return { ok: true, value: body.role };
    } catch (error) {
      return { ok: false, status: null, error: describe(error) };
    }
  },
};
