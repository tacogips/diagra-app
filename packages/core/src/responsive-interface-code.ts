import type { ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { generateInterfaceCode, type InterfaceCode } from "./interface-code.ts";
import { collectResponsiveFamily } from "./responsive-family.ts";

export interface ResponsiveInterfaceBreakpoint {
  readonly rootId: ElementId;
  readonly name: string;
  readonly platform?: FrameSemantic["platform"];
  readonly width: number;
  readonly className: string;
}

export interface ResponsiveInterfaceCode {
  readonly sourceRootId: ElementId;
  readonly breakpoints: readonly ResponsiveInterfaceBreakpoint[];
  readonly html: string;
  readonly css: string;
  readonly linkedCss: string;
  readonly manifest: string;
  readonly notes: readonly string[];
}

interface GeneratedBreakpoint extends ResponsiveInterfaceBreakpoint {
  readonly code: InterfaceCode;
}

function encoded(value: string): string {
  return Array.from(value, (char) => char.codePointAt(0)?.toString(16)).join(
    "-",
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

function responsiveCss(
  breakpoints: readonly GeneratedBreakpoint[],
  linked: boolean,
): string {
  if (breakpoints.length === 1)
    return linked
      ? (breakpoints[0]?.code.linkedCss ?? "")
      : (breakpoints[0]?.code.css ?? "");
  return [
    ".diagra-responsive-view { display: none; }",
    `.${breakpoints[0]?.className} { display: block; }`,
    ...breakpoints.map((breakpoint) =>
      linked ? breakpoint.code.linkedCss : breakpoint.code.css,
    ),
    ...breakpoints.slice(1).map((breakpoint, index) => {
      const previous = breakpoints[index] as GeneratedBreakpoint;
      return `@media (min-width: ${breakpoint.width}px) {\n  .${previous.className} { display: none; }\n  .${breakpoint.className} { display: block; }\n}`;
    }),
  ].join("\n\n");
}

/** Generate one deterministic HTML/CSS package for a linked artboard family. */
export function generateResponsiveInterfaceCode(
  editor: Editor,
  rootId: ElementId,
): ResponsiveInterfaceCode | null {
  const family = collectResponsiveFamily(editor, rootId);
  if (!family) return null;
  const breakpoints: GeneratedBreakpoint[] = family.members.flatMap(
    (member) => {
      const code = generateInterfaceCode(editor, member.rootId);
      return code
        ? [
            {
              rootId: member.rootId,
              name: member.name,
              ...(member.platform ? { platform: member.platform } : {}),
              width: member.width,
              className: `diagra-breakpoint-${encoded(member.rootId)}`,
              code,
            },
          ]
        : [];
    },
  );
  if (!breakpoints.length) return null;
  const html = breakpoints
    .map(
      (breakpoint) =>
        `<div class="diagra-responsive-view ${breakpoint.className}" data-breakpoint-width="${breakpoint.width}" data-breakpoint-root="${escapeAttribute(breakpoint.rootId)}">\n${breakpoint.code.html
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}\n</div>`,
    )
    .join("\n");
  const outputNotes = [
    "Each responsive artboard remains an explicit DOM branch; media queries activate one designer-authored hierarchy at a time.",
    ...family.notes,
    ...breakpoints.flatMap((breakpoint) =>
      breakpoint.code.notes.map(
        (note) => `${breakpoint.name} (${breakpoint.width}px): ${note}`,
      ),
    ),
  ];
  const manifestValue = {
    sourceRoot: family.sourceRootId,
    breakpoints: breakpoints.map((breakpoint) => ({
      rootId: breakpoint.rootId,
      name: breakpoint.name,
      ...(breakpoint.platform ? { platform: breakpoint.platform } : {}),
      width: breakpoint.width,
      manifest: JSON.parse(breakpoint.code.manifest) as unknown,
    })),
    notes: outputNotes,
  };
  return {
    sourceRootId: family.sourceRootId,
    breakpoints: breakpoints.map(
      ({ code: _code, ...breakpoint }) => breakpoint,
    ),
    html,
    css: responsiveCss(breakpoints, false),
    linkedCss: responsiveCss(breakpoints, true),
    manifest: JSON.stringify(manifestValue, null, 2),
    notes: outputNotes,
  };
}
