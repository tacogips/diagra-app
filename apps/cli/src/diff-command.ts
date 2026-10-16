// `nodetto-cli diff`: what changed between two versions of a document, as
// outline lines. An agent keeps the version it last wrote (edit --snapshot)
// and diffs it against the file to see what the person changed meanwhile.

import type { Document, Element, Page } from "@nodetto/ir";
import {
  type CommandIo,
  type CommandResult,
  EXIT_DRIFT,
  fail,
  loadDocument,
  ok,
  parseArgs,
} from "./commands.ts";
import { helpFor } from "./help.ts";
import { shortIds } from "./ids.ts";
import { summarizer } from "./inspect-command.ts";

const DIFF_OPTIONS = new Set(["--format"]);

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(before: Element, after: Element): string[] {
  const fields: string[] = [];
  for (const part of ["semantic", "visual"] as const) {
    const a = before[part] as Record<string, unknown> | undefined;
    const b = after[part] as Record<string, unknown> | undefined;
    if (
      typeof a !== "object" ||
      a === null ||
      typeof b !== "object" ||
      b === null
    ) {
      if (!same(a, b)) fields.push(part);
      continue;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (!same(a[key], b[key])) fields.push(`${part}.${key}`);
  }
  for (const key of ["page", "type", "index", "accessibility"] as const)
    if (!same(before[key], after[key])) fields.push(key);
  return fields;
}

interface Change {
  readonly kind: "added" | "removed" | "changed";
  readonly id: string;
  readonly page: string;
  readonly summary: string;
  readonly fields?: readonly string[];
}

export function diffDocumentsReport(before: Document, after: Document) {
  const short = shortIds([
    ...before.elements.map((element) => element.id),
    ...after.elements.map((element) => element.id),
  ]);
  const shortOf = (id: string) => short.get(id) ?? id;
  const describeBefore = summarizer(before, shortOf);
  const describeAfter = summarizer(after, shortOf);
  const beforeMap = new Map(before.elements.map((e) => [e.id, e]));
  const afterMap = new Map(after.elements.map((e) => [e.id, e]));
  const changes: Change[] = [];
  for (const element of after.elements) {
    const previous = beforeMap.get(element.id);
    if (!previous)
      changes.push({
        kind: "added",
        id: element.id,
        page: element.page,
        summary: describeAfter(element),
      });
    else if (!same(previous, element))
      changes.push({
        kind: "changed",
        id: element.id,
        page: element.page,
        summary: describeAfter(element),
        fields: changedFields(previous, element),
      });
  }
  for (const element of before.elements)
    if (!afterMap.has(element.id))
      changes.push({
        kind: "removed",
        id: element.id,
        page: element.page,
        summary: describeBefore(element),
      });
  const pageChanges: { kind: string; page: Page }[] = [];
  const beforePages = new Map(before.pages.map((page) => [page.id, page]));
  const afterPages = new Map(after.pages.map((page) => [page.id, page]));
  for (const page of after.pages) {
    const previous = beforePages.get(page.id);
    if (!previous) pageChanges.push({ kind: "added", page });
    else if (!same(previous, page)) pageChanges.push({ kind: "changed", page });
  }
  for (const page of before.pages)
    if (!afterPages.has(page.id)) pageChanges.push({ kind: "removed", page });
  return { changes, pageChanges, titleChanged: before.title !== after.title };
}

export function diffCommand(
  io: CommandIo,
  args: readonly string[],
): CommandResult {
  const parsed = parseArgs(args, DIFF_OPTIONS, new Set(["--exit-code"]));
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("diff")}`);
  if (parsed.positional.length !== 2)
    return fail(`diff expects two document paths.\n\n${helpFor("diff")}`);
  const format = parsed.options.get("--format") ?? "text";
  if (format !== "text" && format !== "json")
    return fail(`Unsupported format "${format}". Choose text or json.`);
  const [beforePath, afterPath] = parsed.positional as [string, string];
  const before = loadDocument(io, beforePath);
  if (typeof before === "string") return fail(before);
  const after = loadDocument(io, afterPath);
  if (typeof after === "string") return fail(after);
  const report = diffDocumentsReport(before.document, after.document);
  const changed =
    report.changes.length > 0 ||
    report.pageChanges.length > 0 ||
    report.titleChanged;
  const exitCode = parsed.flags.has("--exit-code") && changed ? EXIT_DRIFT : 0;
  if (format === "json")
    return {
      exitCode,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr: "",
    };
  if (!changed) return { ...ok("No changes.\n"), exitCode };
  const sign = { added: "+", removed: "-", changed: "~" } as const;
  const lines: string[] = [];
  if (report.titleChanged)
    lines.push(
      `~ document title ${JSON.stringify(before.document.title)} -> ${JSON.stringify(after.document.title)}`,
    );
  for (const { kind, page } of report.pageChanges)
    lines.push(
      `${kind === "added" ? "+" : kind === "removed" ? "-" : "~"} page ${page.id} ${JSON.stringify(page.name)} ${page.kind}`,
    );
  const pages = [...new Set(report.changes.map((change) => change.page))];
  for (const page of pages) {
    const name =
      after.document.pages.find((p) => p.id === page)?.name ??
      before.document.pages.find((p) => p.id === page)?.name ??
      page;
    lines.push(`page ${page} ${JSON.stringify(name)}`);
    for (const change of report.changes.filter((c) => c.page === page))
      lines.push(
        `  ${sign[change.kind]} ${change.summary}${change.fields ? `  [${change.fields.join(", ")}]` : ""}`,
      );
  }
  const counts = (kind: Change["kind"]) =>
    report.changes.filter((change) => change.kind === kind).length;
  lines.push(
    `${counts("added")} added, ${counts("changed")} changed, ${counts("removed")} removed.`,
  );
  return { exitCode, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
