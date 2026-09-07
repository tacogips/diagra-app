import {
  DATABASE_DIALECTS,
  type DatabaseDialect,
  type Editor,
  generateDatabaseDdl,
} from "@diagra/core";
import type { PageId } from "@diagra/ir";
import { createMemo, createSignal, For, type JSX } from "solid-js";
import { createEditorSignals } from "../adapter.ts";

const DIALECT_LABELS: Readonly<Record<DatabaseDialect, string>> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

function fileStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "schema"
  );
}

function fallbackCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

export function DatabaseExportSection(props: {
  readonly editor: Editor;
  readonly pageId: PageId;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [dialect, setDialect] = createSignal<DatabaseDialect>("postgresql");
  const [status, setStatus] = createSignal("");
  const report = createMemo(() => {
    signals.rev();
    return generateDatabaseDdl(props.editor, props.pageId, dialect());
  });
  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(report().sql);
      else if (!fallbackCopy(report().sql)) throw new Error("copy failed");
      setStatus("SQL copied.");
    } catch {
      setStatus("Clipboard unavailable. Select and copy the SQL below.");
    }
  };
  const download = (): void => {
    const pageName = props.editor.store.getPage(props.pageId)?.name ?? "schema";
    const url = URL.createObjectURL(
      new Blob([report().sql], { type: "application/sql;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileStem(pageName)}.${dialect()}.sql`;
    document.body.append(link);
    try {
      link.click();
      setStatus("SQL download requested.");
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  return (
    <details class="diagra-inspector-section">
      <summary>Database DDL</summary>
      <p>
        Generates reviewable tables, safe defaults, ordered indexes, check
        constraints, primary keys, foreign keys and one-to-one uniqueness from
        every ERD layer on this page. Relations need columns at both ends; 1:*
        and *:1 place the foreign key on the many side, while 1:1 uses the To
        side. Many-to-many relations require an explicit junction table.
      </p>
      <label>
        SQL dialect
        <select
          aria-label="Database SQL dialect"
          value={dialect()}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDialect(
              DATABASE_DIALECTS.includes(value as DatabaseDialect)
                ? (value as DatabaseDialect)
                : "postgresql",
            );
            setStatus("");
          }}
        >
          <For each={DATABASE_DIALECTS}>
            {(value) => <option value={value}>{DIALECT_LABELS[value]}</option>}
          </For>
        </select>
      </label>
      <p>
        {`${report().tableCount} tables, ${report().relationCount} relations, ${report().indexCount} indexes, ${report().checkCount} checks, ${report().warnings.length} warnings`}
      </p>
      <button type="button" onClick={() => void copy()}>
        Copy SQL
      </button>
      <button type="button" onClick={download}>
        Download .sql
      </button>
      <textarea
        aria-label="Generated database DDL"
        readOnly
        rows={14}
        value={report().sql}
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

export default DatabaseExportSection;
