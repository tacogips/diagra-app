import { importHtmlLayout, type HtmlLayoutNode } from "@nodetto/core";
import { HtmlImportAssets, htmlDependencyPath } from "./html-assets.ts";
import type { Document, UiControlKind } from "@nodetto/ir";
import type { FileBackend } from "./backend.ts";

export interface HtmlImportReport {
  readonly document: Document;
  readonly assets: ReadonlyMap<string, string>;
  readonly warnings: readonly {
    code: string;
    message: string;
    element: string;
  }[];
}

/** Static HTML capture: no script execution, remote requests, navigation or embeds. */
export async function importHtmlPage(
  source: string,
  sourcePath: string,
  backend: FileBackend,
): Promise<HtmlImportReport> {
  if (typeof document === "undefined")
    throw new Error("HTML import requires the desktop webview.");
  if (source.length > 8 * 1024 * 1024)
    throw new Error("HTML exceeds the 8 MiB import limit.");
  // Template contents are inert, including image loads, until sanitization finishes.
  const template = document.createElement("template");
  template.innerHTML = source;
  const parsed = template.content;
  const warnings = new Set<string>();
  const importedAssets = new HtmlImportAssets(async (relative) => {
    if (!backend.readAttachment)
      throw new Error("This host cannot read local HTML dependencies");
    return backend.readAttachment(sourcePath, relative);
  });
  const assets = importedAssets.assets;
  for (const node of parsed.querySelectorAll(
    "script,iframe,object,embed,base,meta,video,audio,source,svg,canvas",
  )) {
    warnings.add(
      "Scripts, embedded documents, media, SVG and canvas content are omitted.",
    );
    node.remove();
  }
  for (const node of parsed.querySelectorAll("*")) {
    for (const attr of [...node.attributes]) {
      if (
        ![
          "class",
          "id",
          "style",
          "src",
          "alt",
          "type",
          "value",
          "placeholder",
          "checked",
          "disabled",
          "selected",
          "width",
          "height",
          "rel",
          "href",
          "aria-label",
          "role",
          "max",
          "aria-selected",
        ].includes(attr.name)
      )
        node.removeAttribute(attr.name);
      if (attr.name === "href" && node.tagName !== "LINK")
        node.removeAttribute("href");
    }
  }
  for (const link of parsed.querySelectorAll("link")) {
    let relative: string;
    try {
      relative = htmlDependencyPath(link.getAttribute("href") ?? "");
    } catch {
      warnings.add("Remote or unsafe stylesheet omitted.");
      link.remove();
      continue;
    }
    if (link.getAttribute("rel") === "stylesheet" && backend.readAttachment) {
      try {
        const css = new TextDecoder().decode(
          await backend.readAttachment(sourcePath, relative),
        );
        const style = document.createElement("style");
        style.textContent = await importedAssets.css(css, relative, (message) =>
          warnings.add(message),
        );
        style.setAttribute("data-import-css", "resolved");
        link.replaceWith(style);
      } catch {
        warnings.add(`Stylesheet could not be read: ${relative}`);
        link.remove();
      }
    } else {
      warnings.add("Remote or unsafe stylesheet omitted.");
      link.remove();
    }
  }
  for (const image of parsed.querySelectorAll("img")) {
    const relative = image.getAttribute("src") ?? "";
    try {
      const { path, data } = await importedAssets.image(relative);
      image.setAttribute("src", data);
      image.setAttribute("data-import-asset", path);
    } catch {
      warnings.add(`Image omitted: ${relative.slice(0, 120)}`);
      image.remove();
    }
  }
  for (const style of parsed.querySelectorAll("style:not([data-import-css])"))
    style.textContent = await importedAssets.css(
      style.textContent ?? "",
      "",
      (message) => warnings.add(message),
    );
  for (const node of parsed.querySelectorAll("[style]"))
    node.setAttribute(
      "style",
      await importedAssets.css(
        node.getAttribute("style") ?? "",
        "",
        (message) => warnings.add(message),
      ),
    );
  // CSP is the final authority even for escaped CSS URLs or other parser edge cases.
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText =
    "position:fixed;left:-20000px;top:0;width:1440px;height:1000px;border:0;opacity:0;pointer-events:none";
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("HTML layout timed out")),
      10000,
    );
    frame.onload = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'"></head><body>${template.innerHTML}</body></html>`;
  document.body.append(frame);
  try {
    await ready;
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("HTML layout unavailable");
    await Promise.all(
      [...doc.images].map((image) => image.decode().catch(() => undefined)),
    );
    const title =
      parsed.querySelector("title")?.textContent ||
      sourcePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.html?$/i, "") ||
      "Imported page";
    let count = 0;
    const visit = (
      node: HTMLElement,
      depth: number,
    ): HtmlLayoutNode | undefined => {
      if (++count > 3000 || depth > 100)
        throw new Error("HTML exceeds the layer or nesting limit.");
      const rect = node.getBoundingClientRect();
      const css = win.getComputedStyle(node);
      if (
        css.display === "none" ||
        css.visibility === "hidden" ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        return;
      const backgroundMatch = /^url\(["']?(data:image\/[^"')]+)["']?\)$/.exec(
        css.backgroundImage,
      );
      const backgroundPath = backgroundMatch?.[1]
        ? importedAssets.pathForData(backgroundMatch[1])
        : undefined;
      if (css.backgroundImage !== "none" && !backgroundPath)
        warnings.add("Unsupported CSS background layers are omitted.");
      if (
        backgroundPath &&
        !["cover", "contain", "100% 100%"].includes(css.backgroundSize)
      )
        warnings.add(
          "Background image tiling, size and offset are approximated by the element bounds.",
        );
      if (css.transform !== "none")
        warnings.add("Transformed elements use their measured bounding boxes.");
      const style = {
        fill: css.backgroundColor,
        stroke: css.borderTopColor,
        strokeWidth: Number.parseFloat(css.borderTopWidth) || 0,
        color: css.color,
        fontSize: Number.parseFloat(css.fontSize) || 14,
        fontFamily: css.fontFamily,
        fontWeight: Number.parseFloat(css.fontWeight) || 400,
        lineHeight:
          Number.parseFloat(css.lineHeight) / Number.parseFloat(css.fontSize) ||
          1.2,
        letterSpacing: Number.parseFloat(css.letterSpacing) || 0,
        textAlign:
          css.textAlign === "center"
            ? ("middle" as const)
            : css.textAlign === "right" || css.textAlign === "end"
              ? ("end" as const)
              : ("start" as const),
        opacity: Number.parseFloat(css.opacity),
      };
      const base = {
        name: node.id || node.tagName.toLowerCase(),
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style,
        ...(backgroundPath
          ? {
              backgroundImage: {
                src: backgroundPath,
                alt: "",
                fit:
                  css.backgroundSize === "cover"
                    ? ("cover" as const)
                    : css.backgroundSize === "contain"
                      ? ("contain" as const)
                      : ("fill" as const),
              },
            }
          : {}),
      };
      const tag = node.tagName.toLowerCase();
      if (tag === "img")
        return {
          ...base,
          image: {
            src: node.getAttribute("data-import-asset") ?? "",
            alt: node.getAttribute("alt") ?? "",
            fit:
              css.objectFit === "cover"
                ? "cover"
                : css.objectFit === "contain"
                  ? "contain"
                  : "fill",
          },
        };
      if (tag === "progress") {
        const progress = node as HTMLProgressElement;
        return {
          ...base,
          control: {
            control: "progress",
            label: node.getAttribute("aria-label") ?? "Progress",
            progress: Math.max(
              0,
              Math.min(100, (progress.value / progress.max) * 100),
            ),
          },
        };
      }
      if (node.getAttribute("role") === "tablist") {
        const tabs = [...node.querySelectorAll<HTMLElement>('[role="tab"]')];
        return {
          ...base,
          control: {
            control: "tabs",
            label: node.getAttribute("aria-label") ?? "Navigation tabs",
            options: tabs.map((tab) => tab.textContent ?? ""),
            value:
              (
                tabs.find(
                  (tab) => tab.getAttribute("aria-selected") === "true",
                ) ?? tabs[0]
              )?.textContent ?? "",
            disabled:
              tabs.length > 0 &&
              tabs.every((tab) => tab.hasAttribute("disabled")),
          },
        };
      }
      const labelledCheckbox =
        tag === "label"
          ? node.querySelector<HTMLInputElement>(
              'input[type="checkbox"], input[type="radio"]',
            )
          : null;
      if (
        ["button", "input", "textarea", "select"].includes(tag) ||
        labelledCheckbox
      ) {
        const input = (labelledCheckbox ?? node) as HTMLInputElement;
        const control: UiControlKind =
          tag === "input" || labelledCheckbox
            ? input.type === "checkbox"
              ? input.getAttribute("role") === "switch"
                ? "switch"
                : "checkbox"
              : input.type === "radio"
                ? "radio"
                : "input"
            : (tag as UiControlKind);
        return {
          ...base,
          control: {
            control,
            ...(control === "input"
              ? {
                  inputType: ([
                    "text",
                    "email",
                    "password",
                    "number",
                    "search",
                    "tel",
                    "url",
                    "date",
                  ].includes(input.type)
                    ? input.type
                    : "text") as
                    | "text"
                    | "email"
                    | "password"
                    | "number"
                    | "search"
                    | "tel"
                    | "url"
                    | "date",
                }
              : {}),
            label:
              input.getAttribute("aria-label") ??
              (tag === "button" || labelledCheckbox
                ? (node.textContent ?? "Button")
                : (node.getAttribute("placeholder") ?? control)),
            value: input.value ?? "",
            checked: input.checked ?? false,
            disabled: input.disabled ?? false,
            placeholder: node.getAttribute("placeholder") ?? "",
            ...(tag === "select"
              ? {
                  options: [...(node as HTMLSelectElement).options].map(
                    (option) => option.text,
                  ),
                }
              : {}),
          },
        };
      }
      const children = [...node.children]
        .filter(
          (child): child is HTMLElement =>
            child.namespaceURI === "http://www.w3.org/1999/xhtml",
        )
        .flatMap((child) => {
          const captured = visit(child, depth + 1);
          return captured ? [captured] : [];
        });
      const text = children.length
        ? [...node.childNodes]
            .filter((child) => child.nodeType === 3)
            .map((child) => child.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
        : (node.textContent?.trim() ?? "");
      return { ...base, text, children, clip: css.overflow === "hidden" };
    };
    const body = visit(doc.body, 0);
    const nodes = body ? [body] : [];
    const imported = importHtmlLayout(nodes, {
      title,
      width: 1440,
      height: Math.min(20000, Math.max(1000, doc.body.scrollHeight)),
    });
    warnings.add(
      "Static layout imported at 1440px. Responsive rules, scripts, animations and application behavior are not imported.",
    );
    return {
      document: imported,
      assets,
      warnings: [...warnings].map((message) => ({
        code: "html-import",
        message,
        element: "html",
      })),
    };
  } finally {
    frame.remove();
  }
}
