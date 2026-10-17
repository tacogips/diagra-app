import { UmlComponentType } from "@nodetto/ir";
import type {
  AccessibilityRole,
  Element,
  ElementId,
  FrameSemantic,
  GeoShapeSemantic,
  ImageSemantic,
  TextNoteSemantic,
  UiControlSemantic,
} from "@nodetto/ir";
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
  return `nodetto-node-${encoded(id)}`;
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

function controlHtml(element: Element, classes: string): string {
  const s = element.semantic as UiControlSemantic;
  const attrs = ` class="${classes}" data-nodetto-id="${escapeAttribute(element.id)}" data-nodetto-type="ui.control" data-control="${s.control}" aria-label="${escapeAttribute(s.label)}"${s.disabled ? " disabled" : ""}`;
  const value = escapeAttribute(s.value ?? "");
  const placeholder = escapeAttribute(s.placeholder ?? "");
  switch (s.control) {
    case "button":
      return `<button type="button"${attrs}>${escapeText(s.label)}</button>`;
    case "input":
      return `<input type="${s.inputType ?? "text"}"${attrs} value="${value}" placeholder="${placeholder}">`;
    case "textarea":
      return `<textarea${attrs} placeholder="${placeholder}">${escapeText(s.value ?? "")}</textarea>`;
    case "select":
      return `<select${attrs}>${(s.options ?? []).map((option) => `<option${option === s.value ? " selected" : ""}>${escapeText(option)}</option>`).join("")}</select>`;
    case "tabs":
      return `<div${attrs} role="tablist">${(s.options ?? []).map((option) => `<button type="button" role="tab" aria-selected="${option === (s.value ?? s.options?.[0])}"${s.disabled ? " disabled" : ""}>${escapeText(option)}</button>`).join("")}</div>`;
    case "progress":
      return `<progress${attrs} max="100" value="${s.progress ?? 0}">${s.progress ?? 0}%</progress>`;
    case "radio":
    case "checkbox":
    case "switch":
      return `<label class="${classes}" data-nodetto-type="ui.control" data-control="${s.control}" data-nodetto-id="${escapeAttribute(element.id)}"><input type="${s.control === "radio" ? "radio" : "checkbox"}"${s.control === "switch" ? ' role="switch"' : ""} aria-label="${escapeAttribute(s.label)}"${s.checked ? " checked" : ""}${s.disabled ? " disabled" : ""}> ${escapeText(s.label)}</label>`;
  }
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
  if (
    element.type === "ui.control" &&
    ["checkbox", "switch", "radio", "tabs", "progress"].includes(
      (element.semantic as UiControlSemantic).control,
    )
  )
    for (const property of [
      "background",
      "background-color",
      "border",
      "border-color",
      "border-width",
      "border-style",
      "border-radius",
    ])
      omitted.add(property);
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
        `--nodetto-safe-area-top: ${px(semantic.safeArea.top)};`,
        `--nodetto-safe-area-right: ${px(semantic.safeArea.right)};`,
        `--nodetto-safe-area-bottom: ${px(semantic.safeArea.bottom)};`,
        `--nodetto-safe-area-left: ${px(semantic.safeArea.left)};`,
      );
    }
  }
  if (
    element.type === "ui.control" &&
    !["checkbox", "switch", "radio", "tabs", "progress"].includes(
      (element.semantic as UiControlSemantic).control,
    )
  )
    geometry.push("padding: 8px 12px;");
  if (element.type === "image.raster") geometry.push("overflow: hidden;");
  if (element.type === "text.note")
    geometry.push(
      "margin: 0;",
      `padding: ${element.visual.textPadding === undefined ? "6px 8px" : px(element.visual.textPadding)};`,
      "white-space: pre-wrap;",
      `line-height: ${element.visual.style?.lineHeight ?? 1.2};`,
    );
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
  return `<div class="${classNames}" data-nodetto-id="${escapeAttribute(element.id)}" data-nodetto-type="image.raster"${accessibilityHtmlAttributes(element, explicit ? semantic.alt : undefined)}><img class="${nodeClass(element.id)}__media" src="${escapeAttribute(semantic.src)}" alt="${escapeAttribute(alt)}"${hiddenMedia}></div>`;
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
    if (element.type === "ui.control") {
      htmlLines.push(`${indent}${controlHtml(element, classes)}`);
      return;
    }
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
    const screenKind = frameSemantic?.screenKind
      ? ` data-screen-kind="${frameSemantic.screenKind}"`
      : "";
    const open = `<${tag} class="${classes}" data-nodetto-id="${escapeAttribute(element.id)}" data-nodetto-type="${escapeAttribute(element.type)}"${platform}${screenKind}${accessibilityHtmlAttributes(element, frameSemantic?.name)}>`;
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
      UmlComponentType.Relationship,
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
          "Safe-area insets are emitted as --nodetto-safe-area-* CSS custom properties; map them to env(safe-area-inset-*) where the host viewport supports display cutouts.",
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
  const controlCss = included.some((element) => element.type === "ui.control")
    ? `[data-nodetto-type="ui.control"][data-control="checkbox"], [data-nodetto-type="ui.control"][data-control="radio"], [data-nodetto-type="ui.control"][data-control="switch"] { display: flex; align-items: center; gap: 9px; }
[data-nodetto-type="ui.control"] > input[type="checkbox"], [data-nodetto-type="ui.control"] > input[type="radio"] { flex-shrink: 0; margin: 0; width: 18px; height: 18px; accent-color: #137e7e; }
[data-nodetto-type="ui.control"] > input[role="switch"] { appearance: none; position: relative; width: 34px; height: 20px; border: 0; border-radius: 999px; background: #b5bebc; }
[data-nodetto-type="ui.control"] > input[role="switch"]:checked { background: #137e7e; }
[data-nodetto-type="ui.control"] > input[role="switch"]::after { content: ""; position: absolute; width: 16px; height: 16px; top: 2px; left: 2px; border-radius: 50%; background: white; }
[data-nodetto-type="ui.control"] > input[role="switch"]:checked::after { left: 16px; }`
    : "";
  const designControlCss = included.some(
    (element) => element.type === "ui.control",
  )
    ? `
[data-control="tabs"] { display: flex; overflow: hidden; background: #f1f5f9; }
[data-control="tabs"] > button { flex: 1; min-width: 0; padding: 6px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: inherit; font: inherit; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
[data-control="tabs"] > button[aria-selected="true"] { border-bottom-color: #137e7e; background: #d6ecef; font-weight: 600; }
progress[data-control="progress"] { accent-color: #137e7e; appearance: none; border: 0; border-radius: 999px; overflow: hidden; }
progress[data-control="progress"]::-webkit-progress-bar { background: #e2e8f0; border-radius: 999px; }
progress[data-control="progress"]::-webkit-progress-value { background: #137e7e; border-radius: 999px; }
progress[data-control="progress"]::-moz-progress-bar { background: #137e7e; border-radius: 999px; }`
    : "";
  const combinedCss = [
    ...css,
    ...imageCss,
    ...layoutCss,
    controlCss,
    designControlCss,
  ]
    .filter(Boolean)
    .join("\n\n");
  const combinedLinkedCss = [
    palette,
    typography,
    ...linkedCss,
    ...imageCss,
    ...linkedLayoutCss,
    controlCss,
    designControlCss,
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
