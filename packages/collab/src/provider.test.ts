import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  createDocProvider,
  documentSocketPath,
  parseEndpoint,
  toQueryParams,
} from "./provider.ts";

describe("parseEndpoint", () => {
  test("derives the socket protocol from the endpoint scheme", () => {
    expect(parseEndpoint("https://sync.example.com").protocol).toBe("wss");
    expect(parseEndpoint("http://localhost:8787").protocol).toBe("ws");
    // Not the provider's private-range guess: a user who typed https must
    // never be downgraded to a plaintext socket (design 11).
    expect(parseEndpoint("https://127.0.0.1:8787").protocol).toBe("wss");
    expect(parseEndpoint("ws://10.0.0.4:8787").protocol).toBe("ws");
  });

  test("keeps host, port and mount path", () => {
    expect(parseEndpoint("http://localhost:8787")).toEqual({
      host: "localhost:8787",
      protocol: "ws",
      basePath: "",
    });
    expect(parseEndpoint("https://example.com/diagra/")).toEqual({
      host: "example.com",
      protocol: "wss",
      basePath: "/diagra",
    });
  });

  test("rejects what cannot be a sync endpoint", () => {
    expect(() => parseEndpoint("sync.example.com")).toThrow(
      /not a valid endpoint URL/,
    );
    expect(() => parseEndpoint("ftp://example.com")).toThrow(
      /unsupported endpoint scheme/,
    );
  });
});

describe("createDocProvider", () => {
  test("targets the server's document route", () => {
    const provider = createDocProvider({
      endpoint: "http://localhost:8787",
      docId: "01JDOC0000000000000000000",
      doc: new Y.Doc(),
      connect: false,
    });
    // `workers/sync/src/router.ts` WS_PATH: /ws/documents/:id
    expect(provider.url).toBe(
      "ws://localhost:8787/ws/documents/01JDOC0000000000000000000",
    );
    provider.destroy();
  });

  test("does not construct a socket when explicitly disconnected", () => {
    const provider = createDocProvider({
      endpoint: "http://localhost:8787",
      docId: "01JDOC0000000000000000000",
      doc: new Y.Doc(),
      connect: false,
    });
    expect(provider.shouldConnect).toBe(false);
    expect(provider.ws).toBeNull();
    provider.destroy();
  });

  test("cancels a pending controlled connect before it can construct a socket", async () => {
    const original = globalThis.WebSocket;
    let sockets = 0;
    let resolveParams: ((value: Record<string, never>) => void) | undefined;
    class FakeWebSocket {
      constructor() {
        sockets++;
      }
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const provider = createDocProvider({
      endpoint: "http://localhost:8787",
      docId: "01JDOC0000000000000000000",
      doc: new Y.Doc(),
      connect: false,
      managedReconnect: true,
      params: () =>
        new Promise<Record<string, never>>((resolve) => {
          resolveParams = resolve;
        }),
    });
    provider._WS = FakeWebSocket as unknown as typeof WebSocket;
    try {
      const pending = provider.connect();
      provider.disconnect();
      resolveParams?.({});
      await pending;
      expect(sockets).toBe(0);
      await provider._reconnectWS();
      expect(sockets).toBe(0);
    } finally {
      provider.destroy();
      globalThis.WebSocket = original;
    }
  });

  test("cancels an immediately resolved connect before its base transport opens", async () => {
    const original = globalThis.WebSocket;
    let sockets = 0;
    let closes = 0;
    class FakeWebSocket {
      constructor() {
        sockets++;
      }
      close(): void {
        closes++;
      }
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const provider = createDocProvider({
      endpoint: "http://localhost:8787",
      docId: "01JDOC0000000000000000000",
      doc: new Y.Doc(),
      connect: false,
      managedReconnect: true,
      params: () => ({ token: "credential" }),
    });
    provider._WS = FakeWebSocket as unknown as typeof WebSocket;
    try {
      const pending = provider.connect();
      await Promise.resolve();
      const beforeDestroy = sockets;
      provider.destroy();
      await pending;
      expect(sockets).toBe(beforeDestroy);
      expect(closes).toBe(1);
    } finally {
      provider.destroy();
      globalThis.WebSocket = original;
    }
  });

  test("never opens a managed transport after destruction", async () => {
    const original = globalThis.WebSocket;
    let sockets = 0;
    class FakeWebSocket {
      constructor() {
        sockets++;
      }
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const provider = createDocProvider({
      endpoint: "http://localhost:8787",
      docId: "01JDOC0000000000000000000",
      doc: new Y.Doc(),
      connect: false,
      managedReconnect: true,
    });
    provider._WS = FakeWebSocket as unknown as typeof WebSocket;
    try {
      provider.destroy();
      await provider.connect();
      expect(sockets).toBe(0);
    } finally {
      globalThis.WebSocket = original;
    }
  });

  test("guards constructor-started managed connects too", async () => {
    const original = globalThis.WebSocket;
    let sockets = 0;
    let resolveParams: ((value: Record<string, never>) => void) | undefined;
    class FakeWebSocket {
      constructor() {
        sockets++;
      }
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const provider = createDocProvider({
      endpoint: "http://localhost:8787",
      docId: "01JDOC0000000000000000000",
      doc: new Y.Doc(),
      managedReconnect: true,
      params: () =>
        new Promise<Record<string, never>>((resolve) => {
          resolveParams = resolve;
        }),
    });
    provider._WS = FakeWebSocket as unknown as typeof WebSocket;
    try {
      provider.destroy();
      resolveParams?.({});
      await Promise.resolve();
      expect(sockets).toBe(0);
    } finally {
      globalThis.WebSocket = original;
    }
  });

  test("escapes the document id and honours a mount path", () => {
    expect(documentSocketPath("a/b", "/diagra")).toBe(
      "/diagra/ws/documents/a%2Fb",
    );
  });

  test("passes only the credentials that are set", () => {
    expect(toQueryParams({})).toEqual({});
    expect(toQueryParams({ token: "", devUser: "" })).toEqual({});
    expect(toQueryParams({ token: "t", devUser: "alice" })).toEqual({
      token: "t",
      dev_user: "alice",
    });
  });
});
