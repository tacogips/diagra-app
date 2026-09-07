import { expect, test, spyOn } from "bun:test";
import { cloudApi } from "./api.ts";

test("share listing validates each capability and requests an uncached bounded page", async () => {
  const fetchMock = spyOn(globalThis, "fetch");
  const item = {
    documentId: "doc",
    role: "viewer" as const,
    token: "abcdefghijklmnop123456",
    createdAt: "2026-09-07T00:00:00Z",
    revoked: false,
  };
  const options = {
    endpoint: "https://example.test",
    docId: "doc",
    before: 100,
  };
  try {
    fetchMock.mockResolvedValueOnce(
      Response.json({ items: [item], nextBefore: null }),
    );
    expect(await cloudApi.listShares(options)).toEqual({
      ok: true,
      value: { items: [item], nextBefore: null },
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/documents/doc/shares");
    expect(url.searchParams.get("before")).toBe("100");
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
    const fullPage = {
      items: Array.from({ length: 50 }, (_, index) => ({
        ...item,
        token: `${item.token}${index}`,
      })),
      nextBefore: 50,
    };
    fetchMock.mockResolvedValueOnce(Response.json(fullPage));
    expect(await cloudApi.listShares(options)).toEqual({
      ok: true,
      value: fullPage,
    });
    for (const body of [
      null,
      {},
      { items: [item] },
      { items: [item], nextBefore: 100 },
      { items: [item], nextBefore: 90 },
      { items: [item, item], nextBefore: null },
      ...[
        { documentId: "other" },
        { role: "owner" },
        { token: "bad" },
        { createdAt: "invalid" },
        { revoked: "false" },
      ].map((change) => ({
        items: [{ ...item, ...change }],
        nextBefore: null,
      })),
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      expect((await cloudApi.listShares(options)).ok).toBe(false);
    }
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { message: "Only owners may list shares" } },
        { status: 403 },
      ),
    );
    expect((await cloudApi.listShares(options)).ok).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error(item.token));
    const result = await cloudApi.listShares(options);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(item.token);
  } finally {
    fetchMock.mockRestore();
  }
});

test("revocation sends its target only in the POST body and requires confirmation", async () => {
  const fetchMock = spyOn(globalThis, "fetch");
  const options = {
    endpoint: "https://example.test/sync",
    docId: "doc/1",
    shareToken: "abcdefghijklmnop123456",
  };
  try {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await cloudApi.revokeShare(options)).toEqual({
      ok: true,
      value: undefined,
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/sync/api/documents/doc%2F1/revoke-share");
    expect(url.search).toBe("");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ token: options.shareToken }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response("unconfirmed", { status: 200 }),
    );
    expect((await cloudApi.revokeShare(options)).ok).toBe(false);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { message: "Retry to disconnect existing clients" } },
        { status: 502 },
      ),
    );
    expect(await cloudApi.revokeShare(options)).toEqual({
      ok: false,
      status: 502,
      error: "Retry to disconnect existing clients",
    });
    fetchMock.mockRejectedValueOnce(
      new Error(`sensitive ${options.shareToken}`),
    );
    const failed = await cloudApi.revokeShare(options);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(options.shareToken);
  } finally {
    fetchMock.mockRestore();
  }
});

test("share creation posts explicit permission and validates document and role", async () => {
  const fetchMock = spyOn(globalThis, "fetch");
  try {
    const share = {
      documentId: "doc",
      role: "viewer" as const,
      token: "abcdefghijklmnop123456",
    };
    fetchMock.mockResolvedValueOnce(Response.json(share, { status: 201 }));
    expect(
      await cloudApi.createShare({
        endpoint: "https://example.test",
        docId: "doc",
        role: "viewer",
      }),
    ).toEqual({ ok: true, value: share });
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"role":"viewer"}');
    for (const invalid of [
      { ...share, role: "editor" },
      { ...share, documentId: "other" },
      { ...share, token: "bad" },
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(invalid));
      expect(
        (
          await cloudApi.createShare({
            endpoint: "https://example.test",
            docId: "doc",
            role: "viewer",
          })
        ).ok,
      ).toBe(false);
    }
  } finally {
    fetchMock.mockRestore();
  }
});

test("access probe reads an authoritative role from the lightweight endpoint", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ role: "viewer" }),
  );
  try {
    expect(
      await cloudApi.probeDocument({
        endpoint: "https://example.test/sync",
        docId: "doc/1",
        token: "test-capability",
      }),
    ).toEqual({ ok: true, value: "viewer" });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/sync/api/documents/doc%2F1/access");
    expect(url.searchParams.get("token")).toBe("test-capability");
  } finally {
    fetchMock.mockRestore();
  }
});

test("access probe does not guess edit permission from malformed success responses", async () => {
  const fetchMock = spyOn(globalThis, "fetch");
  try {
    for (const body of [{}, { role: "admin" }, { role: true }]) {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      const result = await cloudApi.probeDocument({
        endpoint: "https://example.test",
        docId: "doc",
      });
      expect(result.ok).toBe(false);
    }
  } finally {
    fetchMock.mockRestore();
  }
});
