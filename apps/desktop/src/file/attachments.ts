import type { Editor } from "@nodetto/core";
import {
  decodeRasterDataUrl,
  encodeRasterDataUrl,
  isRasterAttachmentPath,
  isRasterDataUrl,
  type Document,
  type ImageSemantic,
} from "@nodetto/ir";
import type { FileBackend } from "./backend.ts";

export interface PreparedAttachments {
  readonly document: Document;
  readonly changes: readonly {
    readonly id: string;
    readonly before: string;
    readonly after: string;
  }[];
  readonly resolved: ReadonlyMap<string, string>;
}
export async function prepareDocumentAttachments(
  editor: Editor,
  document: Document,
  backend: FileBackend,
  destination: string,
  sourcePath: string | null,
): Promise<PreparedAttachments> {
  const sources = new Map<string, string>();
  const resolved = new Map<string, string>();
  const changes: { id: string; before: string; after: string }[] = [];
  const elements = [];
  for (const element of document.elements) {
    if (element.type !== "image.raster") {
      elements.push(element);
      continue;
    }
    const image = element.semantic as ImageSemantic;
    // Legacy/test hosts can still preserve embedded images without an asset backend.
    if (!backend.storeAttachment) {
      if (!isRasterDataUrl(image.src))
        throw new Error("This file backend cannot save document attachments.");
      elements.push(element);
      continue;
    }
    let reference = sources.get(image.src);
    if (!reference) {
      let data = editor.assets.resolve(image.src);
      if (!data && sourcePath && backend.readAttachment)
        data = encodeRasterDataUrl(
          await backend.readAttachment(sourcePath, image.src),
        );
      if (!data)
        throw new Error(
          `Missing attachment: ${image.src}. Restore the file before saving a copy.`,
        );
      const { bytes, extension } = decodeRasterDataUrl(data);
      reference = await backend.storeAttachment(destination, extension, bytes);
      if (!isRasterAttachmentPath(reference))
        throw new Error("File backend returned an invalid attachment path.");
      sources.set(image.src, reference);
      resolved.set(reference, data);
    }
    if (reference !== image.src)
      changes.push({ id: element.id, before: image.src, after: reference });
    elements.push({ ...element, semantic: { ...image, src: reference } });
  }
  return { document: { ...document, elements }, changes, resolved };
}

/** Missing assets never discard a valid document; callers surface these messages. */
export async function hydrateDocumentAttachments(
  editor: Editor,
  backend: FileBackend,
  documentPath: string,
  isCurrent: () => boolean,
): Promise<readonly string[]> {
  const paths = new Set(
    editor.getSnapshot().elements.flatMap((element) => {
      if (element.type !== "image.raster") return [];
      const source = (element.semantic as ImageSemantic).src;
      return isRasterAttachmentPath(source) && !editor.assets.resolve(source)
        ? [source]
        : [];
    }),
  );
  const errors: string[] = [];
  for (const path of paths) {
    if (!isCurrent()) break;
    try {
      if (!backend.readAttachment)
        throw new Error("This file backend cannot read attachments.");
      const data = encodeRasterDataUrl(
        await backend.readAttachment(documentPath, path),
      );
      if (isCurrent()) editor.assets.set(path, data);
    } catch (error) {
      if (isCurrent())
        errors.push(
          `${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }
  return errors;
}
