export interface SharedDocument {
  readonly docId: string;
  readonly token: string;
}

/** Validate an owner-pasted link without ever visiting its URL. */
export function shareTokenForRevocation(
  value: string,
  endpoint: string,
  docId: string,
): string | null {
  if (value.length > 4096) return null;
  try {
    const link = new URL(value.trim());
    const expected = new URL(endpoint);
    if (
      !["http:", "https:"].includes(link.protocol) ||
      link.username ||
      link.password ||
      link.origin !== expected.origin ||
      link.pathname.replace(/\/+$/, "") !==
        expected.pathname.replace(/\/+$/, "")
    )
      return null;
    const share = parseShareFragment(link.hash);
    return share?.docId === docId ? share.token : null;
  } catch {
    return null;
  }
}

/** Fragment-only capability: the initial page request does not send it. */
export function createShareUrl(
  endpoint: string,
  share: SharedDocument,
): string {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Sharing requires an HTTP(S) endpoint without embedded credentials.",
    );
  url.search = "";
  url.hash = new URLSearchParams({
    document: share.docId,
    token: share.token,
  }).toString();
  return url.toString();
}

export function parseShareFragment(fragment: string): SharedDocument | null {
  if (fragment.length > 2048) return null;
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (
    params.getAll("document").length !== 1 ||
    params.getAll("token").length !== 1
  )
    return null;
  const docId = params.get("document");
  const token = params.get("token");
  if (
    !docId ||
    docId.length > 256 ||
    /[\s/\\]/.test(docId) ||
    Array.from(docId).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !token ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(token)
  )
    return null;
  return { docId, token };
}
