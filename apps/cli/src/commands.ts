import {
  BpmnLintConfigError,
  DATABASE_DIALECTS,
  type DatabaseDialect,
  Editor,
  bpmnRouteResolver,
  generateDatabaseDdl,
  lintBpmnPage,
  parseLintConfig,
  recommendedLintConfig,
  type ArrangeMode,
  type LayoutDirection,
  planArrangement,
} from "@nodetto/core";
import {
  exportBpmnXml,
  importBpmnXml,
  parseDocumentResult,
  serializeDocument,
  type BpmnExportReport,
  type BpmnImportReport,
} from "@nodetto/io";
import {
  isDatabaseObjectType,
  type Document,
  type Page,
  type ValidationIssue,
} from "@nodetto/ir";
import { helpFor, OVERVIEW } from "./help.ts";
import { inspectCommand } from "./inspect-command.ts";
import { typesCommand } from "./types-command.ts";
import { editCommand } from "./edit-command.ts";
import { diffCommand } from "./diff-command.ts";

/** Result of one command: text for stdout/stderr plus a process exit code. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Exit codes shared by every command. */
export const EXIT_OK = 0;
/** Generated output differs from the file named by `--check`. */
export const EXIT_DRIFT = 1;
/** Usage, parse or validation error. */
export const EXIT_ERROR = 2;
/** `--strict` was given and the export produced warnings. */
export const EXIT_WARNINGS = 3;

export const USAGE = OVERVIEW;

/** Reads and writes go through this seam so commands stay testable. */
export interface CommandIo {
  readText(path: string): string;
  /** Launch the desktop editor with an existing local file. */
  openDocument?(path: string, app?: string): Promise<void>;
  readAttachment?(documentPath: string, relative: string): Uint8Array;
  writeText(path: string, text: string): void;
  /** Standard input, for `--ops -`. */
  readStdin?(): string;
  /** Binary output (PNG, PDF); required only by commands that write bytes. */
  writeBytes?(path: string, bytes: Uint8Array): void;
  exists?(path: string): boolean;
}

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

const VALUE_OPTIONS = new Set(["--dialect", "--page", "--output", "--check"]);
const ARRANGE_OPTIONS = new Set(["--mode", "--direction", "--page"]);
const LINT_OPTIONS = new Set(["--page", "--config", "--format"]);
const BPMN_IMPORT_OPTIONS = new Set(["--output"]);
const BPMN_EXPORT_OPTIONS = new Set(["--page", "--output", "--check"]);

export function ok(stdout: string, stderr = ""): CommandResult {
  return { exitCode: EXIT_OK, stdout, stderr };
}

export function fail(message: string, exitCode = EXIT_ERROR): CommandResult {
  return { exitCode, stdout: "", stderr: `${message}\n` };
}

export function parseArgs(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string>,
): ParsedArgs | string {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (flagOptions.has(name)) {
      if (equals !== -1) return `${name} does not take a value.`;
      flags.add(name);
      continue;
    }
    if (!valueOptions.has(name)) return `Unknown option: ${name}`;
    const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
    // A following option is a missing value, not a value: write
    // `--output=--name` for a value that really starts with "--".
    if (
      value === undefined ||
      value === "" ||
      (equals === -1 && value.startsWith("--"))
    )
      return `${name} requires a value.`;
    if (equals === -1) index += 1;
    if (options.has(name)) return `${name} was given more than once.`;
    options.set(name, value);
  }
  return { positional, options, flags };
}

function formatIssue(issue: ValidationIssue): string {
  return `${issue.severity}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`;
}

export function loadDocument(
  io: CommandIo,
  path: string,
): { readonly document: Document; readonly warnings: string } | string {
  let text: string;
  try {
    text = io.readText(path);
  } catch (cause) {
    return `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  const result = parseDocumentResult(text);
  const report = result.issues.map(formatIssue).join("\n");
  if (!result.ok) return `${path} is not a valid nodetto document:\n${report}`;
  return { document: result.document, warnings: report ? `${report}\n` : "" };
}

function erdPages(document: Document): readonly Page[] {
  const pagesWithTables = new Set(
    document.elements
      .filter(
        (element) =>
          element.type === "erd.table" || isDatabaseObjectType(element.type),
      )
      .map((element) => element.page),
  );
  return document.pages.filter((page) => pagesWithTables.has(page.id));
}

export function selectPage(
  document: Document,
  query: string | undefined,
  candidatePages?: readonly Page[],
  noneMessage = "The document contains no ERD tables or database objects.",
  candidateDescription = "pages with ERD tables or database objects",
): Page | string {
  const candidates = candidatePages ?? erdPages(document);
  if (query !== undefined) {
    const searchPages = candidatePages ?? document.pages;
    const byId = searchPages.find((page) => page.id === query);
    if (byId) return byId;
    const byName = searchPages.filter((page) => page.name === query);
    if (byName.length === 1) return byName[0] as Page;
    if (byName.length > 1)
      return `Several pages are named "${query}"; pass the page id instead.`;
    return `No page has the id or name "${query}".`;
  }
  if (candidates.length === 1) return candidates[0] as Page;
  if (!candidates.length) return noneMessage;
  return `The document has ${candidates.length} ${candidateDescription}; choose one with --page:\n${candidates
    .map((page) => `  ${page.id}\t${page.name}`)
    .join("\n")}`;
}

function bpmnPages(document: Document): readonly Page[] {
  return document.pages.filter((page) => page.kind === "bpmn");
}

function warningLines(
  warnings: readonly {
    readonly message: string;
    readonly xmlId?: string;
    readonly element?: string;
    readonly elementId?: string;
  }[],
): string {
  return warnings
    .map((warning) => {
      const subject = warning.xmlId ?? warning.elementId ?? "document";
      const kind = warning.element ? `${warning.element} ` : "";
      return `warning: ${kind}${subject}: ${warning.message}\n`;
    })
    .join("");
}

function lintCommand(io: CommandIo, args: readonly string[]): CommandResult {
  const parsed = parseArgs(args, LINT_OPTIONS, new Set());
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("lint")}`);
  if (parsed.positional.length !== 1)
    return fail(`lint expects exactly one input path.\n\n${helpFor("lint")}`);
  const path = parsed.positional[0] as string;
  const format = parsed.options.get("--format") ?? "text";
  if (format !== "text" && format !== "json")
    return fail(`Unsupported format "${format}". Choose text or json.`);

  let document: Document;
  let context: { readonly missingDi?: readonly string[] } = {};
  let stderr = "";
  if (path.toLowerCase().endsWith(".bpmn")) {
    let source: string;
    try {
      source = io.readText(path);
    } catch (cause) {
      return fail(
        `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    try {
      const imported = importBpmnXml(source, {
        title: path
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/\.bpmn$/i, ""),
      });
      document = imported.document;
      context = { missingDi: imported.missingDi };
      stderr = warningLines(imported.warnings);
    } catch (cause) {
      return fail(
        `Cannot parse BPMN ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  } else {
    const loaded = loadDocument(io, path);
    if (typeof loaded === "string") return fail(loaded);
    document = loaded.document;
    stderr = loaded.warnings;
  }

  const pages = bpmnPages(document);
  const query = parsed.options.get("--page");
  let selectedPages: readonly Page[];
  if (query !== undefined) {
    const selected = selectPage(
      document,
      query,
      pages,
      "The document contains no BPMN pages.",
    );
    if (typeof selected === "string") return fail(selected);
    selectedPages = [selected];
  } else {
    selectedPages = pages;
  }
  if (!selectedPages.length)
    return fail("The document contains no BPMN pages.");

  let config = recommendedLintConfig();
  const configPath = parsed.options.get("--config");
  const discoveredPath =
    configPath ?? (io.exists?.(".bpmnlintrc") ? ".bpmnlintrc" : undefined);
  if (discoveredPath !== undefined) {
    let source: string;
    try {
      source = io.readText(discoveredPath);
    } catch (cause) {
      return fail(
        `Cannot read ${discoveredPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    try {
      config = parseLintConfig(source);
    } catch (cause) {
      if (cause instanceof BpmnLintConfigError) return fail(cause.message);
      return fail(
        `Cannot parse ${discoveredPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  const reports = selectedPages.map((page) => ({
    page,
    findings: lintBpmnPage(document, page.id, config, context),
  }));
  const allFindings = reports.flatMap((report) => report.findings);
  const errors = allFindings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = allFindings.length - errors;
  if (format === "json") {
    const report = {
      input: path,
      pages: reports.map(({ page, findings }) => ({
        pageId: page.id,
        pageName: page.name,
        findings: findings.map(({ elementId, severity, message, ruleId }) => ({
          elementId,
          severity,
          message,
          ruleId,
        })),
      })),
      summary: { problems: allFindings.length, errors, warnings },
    };
    return {
      exitCode: errors ? EXIT_DRIFT : EXIT_OK,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr,
    };
  }
  if (!allFindings.length) return ok("", stderr);
  const output = [path];
  for (const { page, findings } of reports) {
    if (!findings.length) continue;
    if (reports.length > 1) output.push(`page ${page.name} (${page.id})`);
    const columns = findings.map((finding) => [
      finding.elementId,
      finding.severity,
      finding.message,
      finding.ruleId,
    ]);
    const widths = [0, 1, 2, 3].map((column) =>
      Math.max(...columns.map((row) => (row[column] as string).length)),
    );
    for (const row of columns)
      output.push(
        `  ${row
          .map((value, index) =>
            (value as string).padEnd(widths[index] as number),
          )
          .join("  ")
          .trimEnd()}`,
      );
  }
  output.push(
    "",
    `${allFindings.length} ${allFindings.length === 1 ? "problem" : "problems"} (${errors} errors, ${warnings} warnings)`,
  );
  return {
    exitCode: errors ? EXIT_DRIFT : EXIT_OK,
    stdout: `${output.join("\n")}\n`,
    stderr,
  };
}

function bpmnImport(io: CommandIo, args: readonly string[]): CommandResult {
  const parsed = parseArgs(args, BPMN_IMPORT_OPTIONS, new Set(["--strict"]));
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("bpmn")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `bpmn import expects exactly one BPMN file path.\n\n${helpFor("bpmn")}`,
    );
  const path = parsed.positional[0] as string;
  let report: BpmnImportReport;
  try {
    const basename = path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.bpmn$/i, "");
    report = importBpmnXml(io.readText(path), { title: basename });
  } catch (cause) {
    return fail(
      `Cannot import ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const warnings = warningLines(report.warnings);
  if (parsed.flags.has("--strict") && report.warnings.length)
    return {
      exitCode: EXIT_WARNINGS,
      stdout: "",
      stderr: `${warnings}${report.warnings.length} BPMN import warning(s) with --strict.\n`,
    };
  const jsonl = serializeDocument(report.document);
  const outputPath = parsed.options.get("--output");
  if (outputPath !== undefined) {
    const failure = writeOutput(io, outputPath, jsonl);
    if (failure) return fail(`${warnings}${failure}`);
    return ok("", `${warnings}Wrote BPMN document to ${outputPath}.\n`);
  }
  return ok(jsonl, warnings);
}

function bpmnExport(io: CommandIo, args: readonly string[]): CommandResult {
  const parsed = parseArgs(args, BPMN_EXPORT_OPTIONS, new Set(["--strict"]));
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("bpmn")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `bpmn export expects exactly one document path.\n\n${helpFor("bpmn")}`,
    );
  if (parsed.options.has("--output") && parsed.options.has("--check"))
    return fail("--output and --check cannot be combined.");
  const path = parsed.positional[0] as string;
  const loaded = loadDocument(io, path);
  if (typeof loaded === "string") return fail(loaded);
  const page = selectPage(
    loaded.document,
    parsed.options.get("--page"),
    bpmnPages(loaded.document),
    "The document contains no BPMN pages.",
    "BPMN pages",
  );
  if (typeof page === "string") return fail(page);
  let report: BpmnExportReport;
  try {
    report = exportBpmnXml(loaded.document, page.id, {
      routeOf: bpmnRouteResolver(new Editor({ document: loaded.document })),
    });
  } catch (cause) {
    return fail(`${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const warnings = `${loaded.warnings}${report.warnings.map((warning) => `warning: ${warning.elementId ?? "document"}: ${warning.message}\n`).join("")}`;
  if (parsed.flags.has("--strict") && report.warnings.length)
    return {
      exitCode: EXIT_WARNINGS,
      stdout: "",
      stderr: `${warnings}${report.warnings.length} BPMN export warning(s) with --strict.\n`,
    };
  const checkPath = parsed.options.get("--check");
  if (checkPath !== undefined) {
    let current: string;
    try {
      current = io.readText(checkPath);
    } catch (cause) {
      return fail(
        `Cannot read ${checkPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (normalizeNewlines(current) !== report.xml)
      return {
        exitCode: EXIT_DRIFT,
        stdout: "",
        stderr: `${warnings}${checkPath} is out of date with ${path} (page "${page.name}"). Regenerate it with nodetto-cli bpmn export --output.\n`,
      };
    return ok("", `${warnings}${checkPath} is up to date.\n`);
  }
  const outputPath = parsed.options.get("--output");
  if (outputPath !== undefined) {
    const failure = writeOutput(io, outputPath, report.xml);
    if (failure) return fail(`${warnings}${failure}`);
    return ok("", `${warnings}Wrote BPMN XML to ${outputPath}.\n`);
  }
  return ok(report.xml, warnings);
}

function bpmnCommand(io: CommandIo, args: readonly string[]): CommandResult {
  const [subcommand, ...rest] = args;
  if (subcommand === "import") return bpmnImport(io, rest);
  if (subcommand === "export") return bpmnExport(io, rest);
  return fail(
    `bpmn expects the import or export subcommand.\n\n${helpFor("bpmn")}`,
  );
}

function isDialect(value: string): value is DatabaseDialect {
  return (DATABASE_DIALECTS as readonly string[]).includes(value);
}

/** Write through the seam; a failure is an operational error, not drift. */
export function writeOutput(
  io: CommandIo,
  path: string,
  text: string,
): string | undefined {
  try {
    io.writeText(path, text);
    return undefined;
  } catch (cause) {
    return `Cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function ddlCommand(io: CommandIo, args: readonly string[]): CommandResult {
  const parsed = parseArgs(args, VALUE_OPTIONS, new Set(["--strict"]));
  if (typeof parsed === "string") return fail(`${parsed}\n\n${helpFor("ddl")}`);
  if (parsed.positional.length !== 1)
    return fail(`ddl expects exactly one document path.\n\n${helpFor("ddl")}`);
  const path = parsed.positional[0] as string;
  const dialect = parsed.options.get("--dialect") ?? "postgresql";
  if (!isDialect(dialect))
    return fail(
      `Unsupported dialect "${dialect}". Choose ${DATABASE_DIALECTS.join(", ")}.`,
    );
  if (parsed.options.has("--output") && parsed.options.has("--check"))
    return fail("--output and --check cannot be combined.");
  const loaded = loadDocument(io, path);
  if (typeof loaded === "string") return fail(loaded);
  const page = selectPage(loaded.document, parsed.options.get("--page"));
  if (typeof page === "string") return fail(page);
  const editor = new Editor({ document: loaded.document });
  const ddl = generateDatabaseDdl(editor, page.id, dialect);
  const warningText = ddl.warnings
    .map((warning) => `warning: ${warning}\n`)
    .join("");
  const stderr = `${loaded.warnings}${warningText}`;
  if (parsed.flags.has("--strict") && ddl.warnings.length)
    return {
      exitCode: EXIT_WARNINGS,
      stdout: "",
      stderr: `${stderr}${ddl.warnings.length} DDL warning(s) with --strict.\n`,
    };
  const checkPath = parsed.options.get("--check");
  if (checkPath !== undefined) {
    let current: string;
    try {
      current = io.readText(checkPath);
    } catch (cause) {
      return fail(
        `Cannot read ${checkPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (normalizeNewlines(current) !== ddl.sql)
      return {
        exitCode: EXIT_DRIFT,
        stdout: "",
        stderr: `${stderr}${checkPath} is out of date with ${path} (page "${page.name}", ${dialect}). Regenerate it with nodetto-cli ddl --output.\n`,
      };
    return ok("", `${stderr}${checkPath} is up to date.\n`);
  }
  const outputPath = parsed.options.get("--output");
  if (outputPath !== undefined) {
    const failure = writeOutput(io, outputPath, ddl.sql);
    if (failure) return fail(`${stderr}${failure}`);
    return ok(
      "",
      `${stderr}Wrote ${ddl.tableCount} table(s)${ddl.objectCount ? `, ${ddl.objectCount} database object(s)` : ""} and ${ddl.indexCount} index(es) to ${outputPath}.\n`,
    );
  }
  return ok(ddl.sql, stderr);
}

function arrangeCommand(io: CommandIo, args: readonly string[]): CommandResult {
  const parsed = parseArgs(
    args,
    ARRANGE_OPTIONS,
    new Set(["--write", "--check"]),
  );
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("arrange")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `arrange expects exactly one document path.\n\n${helpFor("arrange")}`,
    );
  if (parsed.flags.has("--write") && parsed.flags.has("--check"))
    return fail("--write and --check cannot be combined.");
  const mode = parsed.options.get("--mode") ?? "tidy";
  if (mode !== "tidy" && mode !== "overlaps")
    return fail(`Unsupported mode "${mode}". Choose tidy or overlaps.`);
  const direction = parsed.options.get("--direction") ?? "LR";
  if (direction !== "LR" && direction !== "TB")
    return fail(`Unsupported direction "${direction}". Choose LR or TB.`);
  const path = parsed.positional[0] as string;
  const loaded = loadDocument(io, path);
  if (typeof loaded === "string") return fail(loaded);
  const query = parsed.options.get("--page");
  let page: Page | string;
  if (query !== undefined) page = selectPage(loaded.document, query);
  else if (loaded.document.pages.length === 1)
    page = loaded.document.pages[0] as Page;
  else page = "The document has several pages; choose one with --page.";
  if (typeof page === "string") return fail(page);
  const editor = new Editor({ document: loaded.document });
  const { commands, placed } = planArrangement(
    editor.store,
    page.id,
    editor.createShapeContext(1),
    {
      mode: mode as ArrangeMode,
      direction: direction as LayoutDirection,
    },
  );
  editor.apply(commands, { placed });
  const arranged = serializeDocument(editor.getSnapshot());
  if (parsed.flags.has("--check")) {
    if (commands.length)
      return {
        exitCode: EXIT_DRIFT,
        stdout: "",
        stderr: `${loaded.warnings}${path}: arranging page "${page.name}" would move ${commands.length} layer(s).\n`,
      };
    return ok("", `${loaded.warnings}${path} is already arranged.\n`);
  }
  if (parsed.flags.has("--write")) {
    const failure = writeOutput(io, path, arranged);
    if (failure) return fail(`${loaded.warnings}${failure}`);
    return ok(
      "",
      `${loaded.warnings}Arranged page "${page.name}" of ${path}: ${commands.length} layer update(s).\n`,
    );
  }
  return ok(arranged, loaded.warnings);
}

function formatCommand(io: CommandIo, args: readonly string[]): CommandResult {
  const parsed = parseArgs(args, new Set(), new Set(["--write", "--check"]));
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("format")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `format expects exactly one document path.\n\n${helpFor("format")}`,
    );
  if (parsed.flags.has("--write") && parsed.flags.has("--check"))
    return fail("--write and --check cannot be combined.");
  const path = parsed.positional[0] as string;
  const loaded = loadDocument(io, path);
  if (typeof loaded === "string") return fail(loaded);
  const canonical = serializeDocument(loaded.document);
  if (parsed.flags.has("--check")) {
    let current: string;
    try {
      current = io.readText(path);
    } catch (cause) {
      return fail(
        `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (normalizeNewlines(current) !== canonical)
      return {
        exitCode: EXIT_DRIFT,
        stdout: "",
        stderr: `${loaded.warnings}${path} is not in canonical form. Run nodetto-cli format --write.\n`,
      };
    return ok("", `${loaded.warnings}${path} is canonical.\n`);
  }
  if (parsed.flags.has("--write")) {
    const failure = writeOutput(io, path, canonical);
    if (failure) return fail(`${loaded.warnings}${failure}`);
    return ok("", `${loaded.warnings}Formatted ${path}.\n`);
  }
  return ok(canonical, loaded.warnings);
}

function validateCommand(
  io: CommandIo,
  args: readonly string[],
): CommandResult {
  const parsed = parseArgs(args, new Set(), new Set());
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("validate")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `validate expects exactly one document path.\n\n${helpFor("validate")}`,
    );
  const path = parsed.positional[0] as string;
  const loaded = loadDocument(io, path);
  if (typeof loaded === "string") return fail(loaded);
  const { document } = loaded;
  return ok(
    `${path}: ${document.pages.length} page(s), ${document.elements.length} element(s).\n`,
    loaded.warnings,
  );
}

/** Dispatch one command line (without the executable name). */
export function runCli(
  args: readonly string[],
  io: CommandIo,
  version: string,
): CommandResult {
  const [command, ...rest] = args;
  if (command === "help") return ok(`${helpFor(rest[0])}\n`);
  if (
    command !== undefined &&
    !command.startsWith("-") &&
    (rest.includes("--help") || rest.includes("-h"))
  )
    return ok(`${helpFor(command)}\n`);
  switch (command) {
    case "mcp":
      return fail(
        `mcp takes no options. Start the stdio server with nodetto-cli mcp.\n\n${helpFor("mcp")}`,
      );
    case "ddl":
      return ddlCommand(io, rest);
    case "arrange":
      return arrangeCommand(io, rest);
    case "format":
      return formatCommand(io, rest);
    case "validate":
      return validateCommand(io, rest);
    case "lint":
      return lintCommand(io, rest);
    case "bpmn":
      return bpmnCommand(io, rest);
    case "diff":
      return diffCommand(io, rest);
    case "edit":
      return editCommand(io, rest);
    case "types":
      return typesCommand(io, rest);
    case "inspect":
      return inspectCommand(io, rest);
    case "open":
    case "export":
      return fail(`${command} is asynchronous; call runCliAsync from cli.ts.`);
    case "--version":
    case "-V":
      return ok(`nodetto-cli ${version}\n`);
    case "--help":
    case "-h":
      return ok(`${OVERVIEW}\n`);
    case undefined:
      return fail(USAGE);
    default:
      return fail(`Unknown command: ${command}\n\n${USAGE}`);
  }
}
