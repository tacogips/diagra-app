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
