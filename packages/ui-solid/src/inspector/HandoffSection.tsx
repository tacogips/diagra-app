import {
  auditAccessibility,
  type Editor,
  generateAdaptiveMobileInterfaceCode,
  generateInterfaceCode,
  generateMobileInterfaceCode,
  generateResponsiveInterfaceCode,
  inspectDesign,
} from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import { createMemo, createSignal, type JSX } from "solid-js";
import { createEditorSignals } from "../adapter.ts";

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
  return (
    <details class="diagra-inspector-section">
      <summary>Developer handoff</summary>
      <p>
        Parent-frame-relative coordinates in design pixels. CSS uses absolute
        positioning and stored styles only; it does not reproduce layout rules
        or shape paths. Linked CSS uses palette, measurement and typography
        variables with literal fallbacks. Copy the corresponding variable CSS
        separately to share design-system values in your application; variables
        use stable resource IDs and their names are mapped in Design JSON.
      </p>
      <p>
        Flex CSS is separate: use the child order in Design JSON and omit
        absolute child positioning. Apply each frame class listed in Design
        JSON. Browser sizing still needs verification.
      </p>
      <p>
        Select an artboard for generated HTML, complete CSS, token-linked CSS,
        and a semantic manifest. Auto-layout becomes flexbox; ordinary children
        retain parent-relative geometry. The same hierarchy also generates
        SwiftUI and Jetpack Compose starting points plus a native asset list.
        Responsive family outputs collect the selected artboard and every linked
        viewport into explicit branches with deterministic media queries.
        Adaptive native outputs generate unique SwiftUI and Compose views plus
        container-width dispatchers for the same family. The accessibility audit
        reports naming, structure, target-size and measurable solid-color
        contrast issues without changing the document.
      </p>
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
          <option value="linked">CSS with token variables</option>
          <option value="palette">Palette CSS variables</option>
          <option value="typography">Typography CSS variables</option>
          <option value="layout">Auto-layout flex CSS</option>
          <option value="html">Generated artboard HTML</option>
          <option value="code-css">Generated artboard CSS</option>
          <option value="code-linked">Generated token-linked CSS</option>
          <option value="manifest">Generated semantic manifest</option>
          <option value="responsive-html">Responsive family HTML</option>
          <option value="responsive-css">Responsive family CSS</option>
          <option value="responsive-linked">
            Responsive family token-linked CSS
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
