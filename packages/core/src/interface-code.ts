import type {
  AccessibilityRole,
  Element,
  ElementId,
  FrameSemantic,
  GeoShapeSemantic,
  ImageSemantic,
  TextNoteSemantic,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { inspectDesign } from "./handoff.ts";
import { collectInterfaceTree } from "./interface-tree.ts";
import { layoutHandoff } from "./layout-handoff.ts";
import { richTextSegments, safeTextLinkHref } from "./rich-text.ts";

export interface InterfaceCode {
  readonly rootId: ElementId;
  readonly html: string;
  readonly css: string;
  readonly linkedCss: string;
  readonly manifest: string;
  readonly notes: readonly string[];
}

function encoded(value: string): string {
  return Array.from(value, (char) => char.codePointAt(0)?.toString(16)).join(
    "-",
  );
}

function nodeClass(id: ElementId): string {
  return `diagra-node-${encoded(id)}`;
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;",
  );
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/["']/g, (char) =>
    char === '"' ? "&quot;" : "&#39;",
  );
}

const HTML_ROLES: Readonly<Partial<Record<AccessibilityRole, string>>> = {
  button: "button",
  link: "link",
  image: "img",
  heading: "heading",
  textbox: "textbox",
  checkbox: "checkbox",
  switch: "switch",
  navigation: "navigation",
  main: "main",
  region: "region",
  group: "group",
  list: "list",
  "list-item": "listitem",
};

function accessibilityHtmlAttributes(
  element: Element,
  fallbackLabel?: string,
): string {
  const metadata = element.accessibility;
  if (!metadata)
    return fallbackLabel
      ? ` aria-label="${escapeAttribute(fallbackLabel)}"`
      : "";
  if (metadata.decorative) return ' aria-hidden="true"';
  const role = metadata.role ? HTML_ROLES[metadata.role] : undefined;
  const description = [
    metadata.hint,
    metadata.value ? `Current value: ${metadata.value}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return [
    role ? ` role="${role}"` : "",
    (metadata.label ?? fallbackLabel)
      ? ` aria-label="${escapeAttribute(metadata.label ?? fallbackLabel ?? "")}"`
      : "",
    description ? ` aria-description="${escapeAttribute(description)}"` : "",
    metadata.disabled ? ' aria-disabled="true"' : "",
    metadata.headingLevel ? ` aria-level="${metadata.headingLevel}"` : "",
  ].join("");
}

function px(value: number): string {
  return `${Number(value.toFixed(4))}px`;
}

function declarationBody(
  source: string,
  element: Element,
  parent: Element | null,
  editor: Editor,
): string[] {
  const omitted = new Set([
    "position",
    "box-sizing",
    "left",
    "top",
    "width",
    "height",
  ]);
  const declarations = source
    .split("\n")
    .filter(Boolean)
    .filter((line) => !omitted.has(line.slice(0, line.indexOf(":"))));
  const bounds = editor.getBounds(element.id);
  const parentBounds = parent ? editor.getBounds(parent.id) : null;
  const parentLayout =
    parent?.type === "frame"
      ? (parent.semantic as FrameSemantic).layout
      : undefined;
  const inFlow = parentLayout && element.visual.layoutPosition !== "absolute";
  const position = inFlow ? "relative" : parent ? "absolute" : "relative";
  const geometry = [`position: ${position};`, "box-sizing: border-box;"];
  if (bounds) {
    if (parent && !inFlow) {
      geometry.push(
        `left: ${px(bounds.x - (parentBounds?.x ?? 0))};`,
        `top: ${px(bounds.y - (parentBounds?.y ?? 0))};`,
      );
    }
    geometry.push(
      `width: ${px(bounds.width)};`,
      `height: ${px(bounds.height)};`,
    );
  }
  if (element.type === "frame") {
    const semantic = element.semantic as FrameSemantic;
    geometry.push(`overflow: ${semantic.clipContent ? "hidden" : "visible"};`);
    if (semantic.safeArea) {
      geometry.push(
        `--diagra-safe-area-top: ${px(semantic.safeArea.top)};`,
        `--diagra-safe-area-right: ${px(semantic.safeArea.right)};`,
        `--diagra-safe-area-bottom: ${px(semantic.safeArea.bottom)};`,
        `--diagra-safe-area-left: ${px(semantic.safeArea.left)};`,
      );
    }
  }
  if (element.type === "image.raster") geometry.push("overflow: hidden;");
  if (element.type === "text.note") geometry.push("margin: 0;");
  if (element.type === "shape.geo") {
    const geo = (element.semantic as GeoShapeSemantic).geo;
    const shape =
      geo === "ellipse"
        ? "border-radius: 50%;"
        : geo === "diamond"
          ? "clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);"
          : geo === "triangle"
            ? "clip-path: polygon(50% 0, 100% 100%, 0 100%);"
            : geo === "hexagon"
              ? "clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);"
              : geo === "parallelogram"
                ? "clip-path: polygon(18% 0, 100% 0, 82% 100%, 0 100%);"
                : geo === "star"
                  ? "clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 93%, 50% 71%, 21% 93%, 32% 57%, 2% 35%, 39% 35%);"
                  : null;
    if (shape) geometry.push(shape);
  }
  return [...geometry, ...declarations];
}

function styleRule(className: string, declarations: readonly string[]): string {
  return `.${className} {\n${declarations.map((line) => `  ${line}`).join("\n")}\n}`;
}

function imageHtml(element: Element, classNames: string): string {
  const semantic = element.semantic as ImageSemantic;
  const explicit = Boolean(element.accessibility);
  const alt = explicit ? "" : semantic.alt;
  const hiddenMedia = explicit ? ' aria-hidden="true"' : "";
  return `<div class="${classNames}" data-diagra-id="${escapeAttribute(element.id)}" data-diagra-type="image.raster"${accessibilityHtmlAttributes(element, explicit ? semantic.alt : undefined)}><img class="${nodeClass(element.id)}__media" src="${escapeAttribute(semantic.src)}" alt="${escapeAttribute(alt)}"${hiddenMedia}></div>`;
}

function imageRule(element: Element): string {
  const semantic = element.semantic as ImageSemantic;
  const selector = `.${nodeClass(element.id)}__media`;
  if (semantic.crop) {
    const crop = semantic.crop;
    return `${selector} {\n  position: absolute;\n  left: ${Number((-crop.x / crop.width) * 100).toFixed(4)}%;\n  top: ${Number((-crop.y / crop.height) * 100).toFixed(4)}%;\n  width: ${Number(100 / crop.width).toFixed(4)}%;\n  height: ${Number(100 / crop.height).toFixed(4)}%;\n  object-fit: fill;\n}`;
  }
  return `${selector} {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: ${semantic.fit ?? "contain"};\n}`;
}

function elementText(editor: Editor, element: Element): string {
  const text = editor.getText(element.id);
  if (text !== null) return text;
  return "";
}

function richTextHtml(element: Element): string {
  if (element.type !== "text.note") return "";
  return richTextSegments(element.semantic)
    .map((segment) => {
      let value = escapeText(segment.text);
      for (const mark of [...segment.marks].reverse()) {
        if (mark.kind === "bold") value = `<strong>${value}</strong>`;
        else if (mark.kind === "italic") value = `<em>${value}</em>`;
        else if (mark.kind === "code") value = `<code>${value}</code>`;
        else if (mark.kind === "strike") value = `<s>${value}</s>`;
        else if (mark.kind === "underline") value = `<u>${value}</u>`;
        else {
          const href = safeTextLinkHref(mark.href);
          if (href)
            value = `<a href="${escapeAttribute(href)}" rel="noopener noreferrer">${value}</a>`;
        }
      }
      return value;
    })
    .join("");
}

/**
 * Generate a deterministic HTML/CSS starting point for one artboard.
 * The editor document is never changed; unsupported connector geometry stays
 * available in the accompanying semantic manifest.
 */
export function generateInterfaceCode(
  editor: Editor,
  rootId: ElementId,
): InterfaceCode | null {
  const tree = collectInterfaceTree(editor, rootId);
  if (!tree) return null;
  const { root, included, includedIds, omitted, parents } = tree;
  const orderedChildren = tree.childrenOf;

  const layoutClasses = new Map<ElementId, string>();
  const layoutCss: string[] = [];
  const linkedLayoutCss: string[] = [];
  const coveredLayouts = new Set<ElementId>();
  for (const element of included) {
    if (element.type !== "frame" || coveredLayouts.has(element.id)) continue;
    const layout = layoutHandoff(editor, element.id, {
      include: (id) => includedIds.has(id),
    });
    if (!layout) continue;
    layoutCss.push(layout.css);
    linkedLayoutCss.push(layout.linkedCss);
    for (const frame of layout.frames) {
      coveredLayouts.add(frame.id);
      layoutClasses.set(frame.id, frame.className);
    }
  }

  const css: string[] = [];
  const linkedCss: string[] = [];
  const imageCss: string[] = [];
  for (const element of included) {
    const report = inspectDesign(editor, element.id);
    if (!report) continue;
    const parentId = parents.get(element.id);
    const parent = parentId ? (editor.store.get(parentId) ?? null) : null;
    css.push(
      styleRule(
        nodeClass(element.id),
        declarationBody(report.css, element, parent, editor),
      ),
    );
    linkedCss.push(
      styleRule(
        nodeClass(element.id),
        declarationBody(report.linkedCss, element, parent, editor),
      ),
    );
    if (element.type === "image.raster") imageCss.push(imageRule(element));
  }

  const htmlLines: string[] = [];
  const render = (element: Element, depth: number): void => {
    const indent = "  ".repeat(depth);
    const classes = [nodeClass(element.id), layoutClasses.get(element.id)]
      .filter(Boolean)
      .join(" ");
    if (element.type === "image.raster") {
      htmlLines.push(`${indent}${imageHtml(element, classes)}`);
      return;
    }
    const childrenForElement = orderedChildren(element).filter((child) =>
      includedIds.has(child.id),
    );
    const tag =
      element.id === root.id
        ? "section"
        : element.type === "text.note"
          ? "p"
          : "div";
    const frameSemantic =
      element.type === "frame"
        ? (element.semantic as FrameSemantic)
        : undefined;
    const platform = frameSemantic?.platform
      ? ` data-platform="${frameSemantic.platform}"`
      : "";
    const open = `<${tag} class="${classes}" data-diagra-id="${escapeAttribute(element.id)}" data-diagra-type="${escapeAttribute(element.type)}"${platform}${accessibilityHtmlAttributes(element, frameSemantic?.name)}>`;
    const text = elementText(editor, element);
    const renderedText =
      element.type === "text.note" ? richTextHtml(element) : escapeText(text);
    if (!childrenForElement.length) {
      htmlLines.push(`${indent}${open}${renderedText}</${tag}>`);
      return;
    }
    htmlLines.push(`${indent}${open}`);
    if (text && element.id !== root.id)
      htmlLines.push(`${indent}  ${renderedText}`);
    for (const child of childrenForElement) render(child, depth + 1);
    htmlLines.push(`${indent}</${tag}>`);
  };
  render(root, 0);

  const manifestValue = {
    root: root.id,
    elements: included.map((element) => ({
      id: element.id,
      type: element.type,
      parent: parents.get(element.id) ?? null,
      ...(element.accessibility
        ? { accessibility: element.accessibility }
        : {}),
      semantic: element.semantic,
    })),
    omitted: omitted.map((element) => ({
      id: element.id,
      type: element.type,
      ...(element.accessibility
        ? { accessibility: element.accessibility }
        : {}),
      semantic: element.semantic,
    })),
  };
  const palette = inspectDesign(editor, root.id)?.palette.css ?? "";
  const typography = inspectDesign(editor, root.id)?.typography.css ?? "";
  const omittedConnectors = omitted.filter((element) =>
    [
      "edge.generic",
      "erd.relation",
      "uml.association",
      "sequence.message",
    ].includes(element.type),
  );
  const omittedMasks = omitted.filter((element) =>
    editor.createShapeContext().isMaskSource?.(element.id),
  );
  const notes = [
    "Generated HTML/CSS is a deterministic implementation starting point, not a framework component.",
    "Auto-layout frames use flexbox; other descendants keep parent-relative design geometry.",
    "Database/UML boxes remain semantic approximations. Use the manifest for application data modeling.",
    ...((root.semantic as FrameSemantic).safeArea
      ? [
          "Safe-area insets are emitted as --diagra-safe-area-* CSS custom properties; map them to env(safe-area-inset-*) where the host viewport supports display cutouts.",
        ]
      : []),
    ...(omittedConnectors.length
      ? [
          `Connector geometry is omitted from HTML: ${omittedConnectors.map((element) => element.id).join(", ")}.`,
        ]
      : []),
    ...(omittedMasks.length
      ? [
          `Mask source layers are represented through CSS clipping and omitted from HTML: ${omittedMasks.map((element) => element.id).join(", ")}.`,
        ]
      : []),
    ...(included.some((element) => {
      const style = element.visual.style;
      return Boolean(
        style?.strokeCap || style?.strokeJoin || style?.strokeMiterLimit,
      );
    })
      ? [
          "Stroke cap/join declarations are preserved as SVG presentation properties; HTML border boxes cannot reproduce open-path caps.",
        ]
      : []),
    ...(included.some(
      (element) =>
        element.type === "text.note" &&
        ((element.semantic as TextNoteSemantic).marks?.some(
          (mark) =>
            mark.kind === "link" && safeTextLinkHref(mark.href) === null,
        ) ??
          false),
    )
      ? ["Unsafe rich-text link protocols are omitted from generated HTML."]
      : []),
  ];
  const combinedCss = [...css, ...imageCss, ...layoutCss].join("\n\n");
  const combinedLinkedCss = [
    palette,
    typography,
    ...linkedCss,
    ...imageCss,
    ...linkedLayoutCss,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    rootId,
    html: htmlLines.join("\n"),
    css: combinedCss,
    linkedCss: combinedLinkedCss,
    manifest: JSON.stringify(manifestValue, null, 2),
    notes,
  };
}
