// The websocket provider (design 7).
//
// URL and parameter derivation only: no UI, no storage, and — deliberately —
// no default endpoint anywhere in this package. The endpoint is user
// configuration that arrives from the caller, so a build of this repo can
// never phone home to somebody else's server.

import YProvider from "y-partyserver/provider";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/** Server route for document sockets (`workers/sync/src/router.ts` WS_PATH). */
export const DOCUMENT_WS_PREFIX = "/ws/documents";

/** Credentials the server reads off the query string (`auth.ts`). */
export interface DocProviderParams {
  /** Share-link capability token. Held in memory only. */
  readonly token?: string | undefined;
  /** Dev principal, honoured only while the server allows anonymous dev. */
  readonly devUser?: string | undefined;
}

export interface CreateDocProviderOptions {
  /** User-configured server origin, e.g. `http://localhost:8787`. */
  readonly endpoint: string;
  readonly docId: string;
  readonly doc: Y.Doc;
  /**
   * Re-evaluated on every (re)connect, so a token that was entered after the
   * first attempt is picked up without rebuilding the provider.
   */
  readonly params?: () => DocProviderParams | Promise<DocProviderParams>;
  readonly awareness?: Awareness;
  /** False to construct without opening a socket (tests). */
  readonly connect?: boolean;
}

export interface EndpointTarget {
  /** `host[:port]`, what `YProvider` wants as its first argument. */
  readonly host: string;
  readonly protocol: "ws" | "wss";
  /** Path the server is mounted under, `""` for the root. */
  readonly basePath: string;
}

/**
 * Split a user-entered endpoint into what the provider needs.
 *
 * The protocol is derived from the endpoint's own scheme rather than left to
 * the provider's private-range heuristic: a user who typed `https://` must
 * never be silently downgraded to a plaintext socket (design 11).
 */
export function parseEndpoint(endpoint: string): EndpointTarget {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(
      `not a valid endpoint URL: ${endpoint} (expected e.g. https://sync.example.com)`,
    );
  }
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const plain = url.protocol === "http:" || url.protocol === "ws:";
  if (!secure && !plain) {
    throw new Error(`unsupported endpoint scheme: ${url.protocol}`);
  }
  if (url.host === "") {
    throw new Error(`endpoint has no host: ${endpoint}`);
  }
  return {
    host: url.host,
    protocol: secure ? "wss" : "ws",
    // A deployment behind a path prefix keeps it: the route is relative to
    // wherever the Worker is mounted.
    basePath: url.pathname.replace(/\/+$/, ""),
  };
}

/**
 * The websocket path for one document.
 *
 * `YProvider`'s `prefix` option is the *whole* path: with it set the provider
 * stops appending the room name (`isPrefixedUrl`, y-partyserver 2.2.0), so
 * the document id has to be part of it. Passing only `/ws/documents` would
 * connect to the route without an id and be answered with a 404.
 */
export function documentSocketPath(docId: string, basePath = ""): string {
  return `${basePath}${DOCUMENT_WS_PREFIX}/${encodeURIComponent(docId)}`;
}

/** Query parameters for one connection attempt, omitting what is unset. */
export function toQueryParams(
  params: DocProviderParams,
): Record<string, string> {
  return {
    ...(params.token === undefined || params.token === ""
      ? {}
      : { token: params.token }),
    ...(params.devUser === undefined || params.devUser === ""
      ? {}
      : { dev_user: params.devUser }),
  };
}

/**
 * Open (or prepare) a socket to `endpoint` for one document.
 *
 * `disableBc` is on: BroadcastChannel would short-circuit two clients in the
 * same origin into never touching the server, which hides exactly the
 * failures this transport is supposed to surface.
 */
export function createDocProvider(
  options: CreateDocProviderOptions,
): YProvider {
  const target = parseEndpoint(options.endpoint);
  const readParams = options.params;
  return new YProvider(target.host, options.docId, options.doc, {
    prefix: documentSocketPath(options.docId, target.basePath),
    protocol: target.protocol,
    disableBc: true,
    params: readParams ? async () => toQueryParams(await readParams()) : {},
    ...(options.awareness ? { awareness: options.awareness } : {}),
    ...(options.connect === undefined ? {} : { connect: options.connect }),
  });
}
