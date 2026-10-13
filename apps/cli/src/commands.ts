import {
  type ArrangeMode,
  DATABASE_DIALECTS,
  type DatabaseDialect,
  Editor,
  generateDatabaseDdl,
  type LayoutDirection,
  planArrangement,
} from "@nodetto/core";
import { parseDocumentResult, serializeDocument } from "@nodetto/io";
import type { Document, Page, ValidationIssue } from "@nodetto/ir";

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

export const USAGE = `Usage:
  nodetto-cli ddl <document.jsonl> [--dialect postgresql|mysql|sqlite]
                 [--page <page id or name>] [--output <file.sql>]
                 [--check <file.sql>] [--strict]
  nodetto-cli arrange <document.jsonl> [--mode tidy|overlaps]
                     [--direction LR|TB] [--page <page id or name>]
                     [--write] [--check]
  nodetto-cli format <document.jsonl> [--write] [--check]
  nodetto-cli validate <document.jsonl>
  nodetto-cli --version | --help

ddl       Print the deterministic schema DDL the editor's Database DDL panel
          generates for one ERD page. Without --page, the document must
          contain exactly one page with ERD tables.
          --output writes the SQL to a file instead of stdout.
          --check compares the generated SQL with an existing file and exits
          1 when it is out of date.
          --strict exits 3 when the export reports warnings.
arrange   Run the editor's Tidy layout (default) or Remove overlaps on one
          page and print the canonical result. Without --page, the document
          must have exactly one page. --write rewrites the file; --check
          exits 1 when arranging would move anything.
format    Print the canonical JSONL form. --write rewrites the file in place;
          --check exits 1 when the file is not canonical.
validate  Parse and validate a document; prints warnings and errors.`;

/** Reads and writes go through this seam so commands stay testable. */
export interface CommandIo {
  readText(path: string): string;
  writeText(path: string, text: string): void;
}

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

const VALUE_OPTIONS = new Set(["--dialect", "--page", "--output", "--check"]);
const ARRANGE_OPTIONS = new Set(["--mode", "--direction", "--page"]);

function ok(stdout: string, stderr = ""): CommandResult {
  return { exitCode: EXIT_OK, stdout, stderr };
}

function fail(message: string, exitCode = EXIT_ERROR): CommandResult {
  return { exitCode, stdout: "", stderr: `${message}\n` };
}

function parseArgs(
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

function loadDocument(
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
      .filter((element) => element.type === "erd.table")
      .map((element) => element.page),
  );
  return document.pages.filter((page) => pagesWithTables.has(page.id));
}

function selectPage(
  document: Document,
  query: string | undefined,
): Page | string {
  if (query !== undefined) {
    const byId = document.pages.find((page) => page.id === query);
    if (byId) return byId;
    const byName = document.pages.filter((page) => page.name === query);
    if (byName.length === 1) return byName[0] as Page;
    if (byName.length > 1)
      return `Several pages are named "${query}"; pass the page id instead.`;
    return `No page has the id or name "${query}".`;
  }
  const candidates = erdPages(document);
  if (candidates.length === 1) return candidates[0] as Page;
  if (!candidates.length) return "The document contains no ERD tables.";
  return `The document has ${candidates.length} pages with ERD tables; choose one with --page:\n${candidates
    .map((page) => `  ${page.id}\t${page.name}`)
    .join("\n")}`;
}

function isDialect(value: string): value is DatabaseDialect {
  return (DATABASE_DIALECTS as readonly string[]).includes(value);
}

/** Write through the seam; a failure is an operational error, not drift. */
function writeOutput(
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
  if (typeof parsed === "string") return fail(`${parsed}\n\n${USAGE}`);
  if (parsed.positional.length !== 1)
    return fail(`ddl expects exactly one document path.\n\n${USAGE}`);
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
      `${stderr}Wrote ${ddl.tableCount} table(s) and ${ddl.indexCount} index(es) to ${outputPath}.\n`,
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
  if (typeof parsed === "string") return fail(`${parsed}\n\n${USAGE}`);
  if (parsed.positional.length !== 1)
    return fail(`arrange expects exactly one document path.\n\n${USAGE}`);
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
  if (typeof parsed === "string") return fail(`${parsed}\n\n${USAGE}`);
  if (parsed.positional.length !== 1)
    return fail(`format expects exactly one document path.\n\n${USAGE}`);
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
  if (typeof parsed === "string") return fail(`${parsed}\n\n${USAGE}`);
  if (parsed.positional.length !== 1)
    return fail(`validate expects exactly one document path.\n\n${USAGE}`);
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
  switch (command) {
    case "ddl":
      return ddlCommand(io, rest);
    case "arrange":
      return arrangeCommand(io, rest);
    case "format":
      return formatCommand(io, rest);
    case "validate":
      return validateCommand(io, rest);
    case "--version":
    case "-V":
      return ok(`nodetto-cli ${version}\n`);
    case "--help":
    case "-h":
    case "help":
      return ok(`${USAGE}\n`);
    case undefined:
      return fail(USAGE);
    default:
      return fail(`Unknown command: ${command}\n\n${USAGE}`);
  }
}
