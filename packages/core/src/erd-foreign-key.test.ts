import { expect, test } from "bun:test";
import type {
  Element,
  ErdRelationSemantic,
  ErdTableSemantic,
} from "@nodetto/ir";
import { Editor } from "./editor.ts";
import { erdForeignKeyWarning } from "./erd-foreign-key.ts";

function fixture() {
  const editor = new Editor();
  const from = editor.createElement("erd.table");
  const to = editor.createElement("erd.table");
  const id = editor.createElement("erd.relation", {
    semantic: { from: { table: from }, to: { table: to }, cardinality: "1:*" },
  });
  const relation = () => editor.store.get(id) as Element;
  const warning = () =>
    erdForeignKeyWarning(relation(), (id) => editor.store.get(id));
  const semantic = () => relation().semantic as ErdRelationSemantic;
  const write = (patch: Partial<ErdRelationSemantic>) =>
    editor.apply([
      { type: "updateSemantic", id, semantic: { ...semantic(), ...patch } },
    ]);
  return { editor, from, to, relation, warning, write };
}

test("table-level FK drafts can be created and warn until both columns are assigned", () => {
  const { from, to, write, warning } = fixture();
  expect(warning()).toContain("not assigned");
  write({ from: { table: from, column: "id" } });
  expect(warning()).toContain("not assigned");
  write({ to: { table: to, column: "id" } });
  expect(warning()).toBeNull();
});

test("composite mapping checks every pair and both legacy and array endpoints", () => {
  const { editor, from, to, relation, write, warning } = fixture();
  const check = (patch: Partial<ErdRelationSemantic>) =>
    erdForeignKeyWarning(
      {
        ...relation(),
        semantic: { ...(relation().semantic as ErdRelationSemantic), ...patch },
      },
      (id) => editor.store.get(id),
    );
  expect(
    check({
      from: { table: from, columns: ["id", "other"] },
      to: { table: to, columns: ["id"] },
    }),
  ).toContain("incomplete");
  write({
    from: { table: from, columns: ["id"] },
    to: { table: to, column: "id" },
  });
  expect(warning()).toBeNull();
  expect(
    check({
      from: { table: from, columns: ["id", "id"] },
      to: { table: to, columns: ["id", "id"] },
    }),
  ).toContain("duplicate");
  write({
    from: { table: from, column: "missing" },
    to: { table: to, column: "id" },
  });
  expect(warning()).toContain("missing column");
});

test("complete composite keys clear the warning only when every mapped column exists", () => {
  const { editor, from, to, write, warning } = fixture();
  for (const id of [from, to]) {
    const table = editor.store.get(id) as Element;
    const semantic = table.semantic as ErdTableSemantic;
    editor.apply([
      {
        type: "updateSemantic",
        id,
        semantic: {
          ...semantic,
          columns: [
            ...semantic.columns,
            { id: "other", name: "other", dataType: "uuid" },
          ],
        },
      },
    ]);
  }
  write({
    from: { table: from, columns: ["id", "other"] },
    to: { table: to, columns: ["id", "other"] },
  });
  expect(warning()).toBeNull();
  write({ to: { table: to, columns: ["id", "missing"] } });
  expect(warning()).toContain("missing column");
});

test("deleting a mapped column raises a warning and undo restores the configured FK", () => {
  const { editor, from, to, write, warning } = fixture();
  write({
    from: { table: from, column: "id" },
    to: { table: to, column: "id" },
  });
  expect(warning()).toBeNull();
  const table = editor.store.get(to) as Element;
  editor.apply([
    {
      type: "updateSemantic",
      id: to,
      semantic: { ...(table.semantic as object), columns: [] },
    },
  ]);
  expect(warning()).toContain("missing column");
  editor.undo();
  expect(warning()).toBeNull();
});

test("logical references are exempt and warnings never modify persisted styles", () => {
  const { editor, relation, write, warning } = fixture();
  const snapshot = editor.getSnapshot();
  expect(warning()).not.toBeNull();
  expect(editor.getSnapshot()).toEqual(snapshot);
  write({ logical: true });
  expect(warning()).toBeNull();
  expect(
    erdForeignKeyWarning(
      { ...relation(), type: "edge.generic" },
      () => undefined,
    ),
  ).toBeNull();
});
