import {
  auditAccessibility,
  type Editor,
  generateAdaptiveMobileInterfaceCode,
  generateInterfaceCode,
  generateMobileInterfaceCode,
  generateResponsiveInterfaceCode,
  inspectDesign,
} from "@nodetto/core";
import type { ElementId } from "@nodetto/ir";
import { createMemo, createSignal, type JSX } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { HelpHint } from "../HelpHint.tsx";

export function HandoffSection(props: {
  editor: Editor;
  id: ElementId;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [format, setFormat] = createSignal<
    | "css"
    | "json"
    | "linked"
    | "palette"
    | "typography"
    | "layout"
    | "html"
    | "code-css"
    | "code-linked"
    | "manifest"
    | "responsive-html"
    | "responsive-css"
    | "responsive-linked"
    | "responsive-manifest"
    | "adaptive-swiftui"
    | "adaptive-compose"
    | "adaptive-manifest"
    | "swiftui"
    | "compose"
    | "mobile-assets"
    | "accessibility-audit"
  >("css");
  const [status, setStatus] = createSignal("");
  const report = createMemo(() => {
    signals.rev();
    return inspectDesign(props.editor, props.id);
  });
  const generated = createMemo(() => {
    signals.rev();
    return generateInterfaceCode(props.editor, props.id);
  });
  const mobile = createMemo(() => {
    signals.rev();
    return generateMobileInterfaceCode(props.editor, props.id);
  });
  const responsive = createMemo(() => {
    signals.rev();
    return generateResponsiveInterfaceCode(props.editor, props.id);
  });
  const adaptiveMobile = createMemo(() => {
    signals.rev();
    return generateAdaptiveMobileInterfaceCode(props.editor, props.id);
  });
  const accessibilityAudit = createMemo(() => {
    signals.rev();
    return auditAccessibility(props.editor, props.id);
  });
  const text = (): string =>
    format() === "accessibility-audit"
      ? JSON.stringify(accessibilityAudit(), null, 2)
      : format() === "adaptive-swiftui"
        ? (adaptiveMobile()?.swiftUi ??
          "Select an artboard to generate adaptive native code.")
        : format() === "adaptive-compose"
          ? (adaptiveMobile()?.jetpackCompose ??
            "Select an artboard to generate adaptive native code.")
          : format() === "adaptive-manifest"
            ? (adaptiveMobile()?.manifest ??
              "Select an artboard to generate adaptive native code.")
            : format() === "swiftui"
              ? (mobile()?.swiftUi ??
                "Select an artboard to generate native code.")
              : format() === "compose"
                ? (mobile()?.jetpackCompose ??
                  "Select an artboard to generate native code.")
                : format() === "mobile-assets"
                  ? JSON.stringify(
                      {
                        assets: mobile()?.assets ?? [],
                        notes: mobile()?.notes ?? [],
                      },
                      null,
                      2,
                    )
                  : format() === "responsive-html"
                    ? (responsive()?.html ??
                      "Select an artboard to generate responsive interface code.")
                    : format() === "responsive-css"
                      ? (responsive()?.css ??
                        "Select an artboard to generate responsive interface code.")
                      : format() === "responsive-linked"
                        ? (responsive()?.linkedCss ??
                          "Select an artboard to generate responsive interface code.")
                        : format() === "responsive-manifest"
                          ? (responsive()?.manifest ??
                            "Select an artboard to generate responsive interface code.")
                          : format() === "html"
                            ? (generated()?.html ??
                              "Select an artboard to generate interface code.")
                            : format() === "code-css"
                              ? (generated()?.css ??
                                "Select an artboard to generate interface code.")
                              : format() === "code-linked"
                                ? (generated()?.linkedCss ??
                                  "Select an artboard to generate interface code.")
                                : format() === "manifest"
                                  ? (generated()?.manifest ??
                                    "Select an artboard to generate interface code.")
                                  : format() === "layout"
                                    ? (report()?.layout?.css ??
                                      "Select an explicit auto-layout frame to inspect flex rules.")
                                    : format() === "palette"
                                      ? (report()?.palette.css ?? "")
                                      : format() === "typography"
                                        ? (report()?.typography.css ?? "")
                                        : format() === "linked"
                                          ? (report()?.linkedCss ?? "")
                                          : format() === "css"
                                            ? (report()?.css ?? "")
                                            : JSON.stringify(report(), null, 2);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text());
      setStatus("Copied.");
    } catch {
      setStatus("Clipboard unavailable. Select and copy the text below.");
    }
  };
  const formatHelp = (): string => {
    switch (format()) {
      case "css":
      case "code-css":
        return "CSS uses parent-relative absolute positioning and stored styles; it does not reproduce layout rules or shape paths.";
      case "linked":
      case "code-linked":
      case "responsive-linked":
        return "Token-linked CSS includes literal fallbacks. Copy the matching palette, measurement, and typography variable CSS separately.";
      case "layout":
        return "Use the child order in Design JSON and omit absolute child positioning. Verify browser sizing.";
      case "html":
      case "manifest":
      case "responsive-html":
      case "responsive-css":
      case "responsive-manifest":
        return "Select an artboard. Responsive outputs include its linked viewport family.";
      case "swiftui":
      case "compose":
      case "adaptive-swiftui":
      case "adaptive-compose":
      case "adaptive-manifest":
      case "mobile-assets":
        return "Select an artboard to generate native output. Adaptive formats use the responsive family.";
      case "accessibility-audit":
        return "Reports naming, structure, target-size, and measurable solid-color contrast issues without changing the document.";
      default:
        return "Design JSON preserves the selected artboard's semantic hierarchy and resource references.";
    }
  };
  return (
    <details class="nodetto-inspector-section">
      <summary>Generate code</summary>
      <HelpHint text={formatHelp()} />
      <label>
        Output
        <select
          value={format()}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setFormat(
              value === "json" ||
                value === "linked" ||
                value === "palette" ||
                value === "typography" ||
                value === "layout" ||
                value === "html" ||
                value === "code-css" ||
                value === "code-linked" ||
                value === "manifest" ||
                value === "responsive-html" ||
                value === "responsive-css" ||
                value === "responsive-linked" ||
                value === "responsive-manifest" ||
                value === "adaptive-swiftui" ||
                value === "adaptive-compose" ||
                value === "adaptive-manifest" ||
                value === "swiftui" ||
                value === "compose" ||
                value === "mobile-assets" ||
                value === "accessibility-audit"
                ? value
                : "css",
            );
            setStatus("");
          }}
        >
          <option value="css">CSS declarations</option>
          <option value="linked">CSS with shared style variables</option>
          <option value="palette">Palette CSS variables</option>
          <option value="typography">Typography CSS variables</option>
          <option value="layout">Auto-layout flex CSS</option>
          <option value="html">Generated artboard HTML</option>
          <option value="code-css">Generated artboard CSS</option>
          <option value="code-linked">Generated CSS with shared styles</option>
          <option value="manifest">Generated semantic manifest</option>
          <option value="responsive-html">Responsive family HTML</option>
          <option value="responsive-css">Responsive family CSS</option>
          <option value="responsive-linked">
            Responsive CSS with shared styles
          </option>
          <option value="responsive-manifest">
            Responsive family manifest
          </option>
          <option value="swiftui">Generated SwiftUI</option>
          <option value="compose">Generated Jetpack Compose</option>
          <option value="adaptive-swiftui">Adaptive family SwiftUI</option>
          <option value="adaptive-compose">
            Adaptive family Jetpack Compose
          </option>
          <option value="adaptive-manifest">Adaptive native manifest</option>
          <option value="mobile-assets">Native assets and notes</option>
          <option value="accessibility-audit">Accessibility audit</option>
          <option value="json">Design JSON</option>
        </select>
      </label>
      <button type="button" onClick={() => void copy()}>
        Copy
      </button>
      <textarea
        aria-label="Developer handoff output"
        readOnly
        rows={12}
        value={text()}
        style={{
          width: "100%",
          "box-sizing": "border-box",
          "font-family": "monospace",
        }}
      />
      <p role="status">{status()}</p>
    </details>
  );
}
