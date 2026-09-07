import { expect, test } from "bun:test";
import { layerRows, selectLayerRow } from "./layer-tree.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function fixture() {
  return makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        index: "a0",
        semantic: { name: "Screen", memberIds: ["group"] },
        visual: { x: 0, y: 0, width: 400, height: 800 },
      }),
      element({
        id: "group",
        type: "group",
        index: "a1",
        semantic: { memberIds: ["text", "shape"] },
      }),
      element({
        id: "text",
        type: "text.note",
        index: "a2",
        semantic: { text: "Sign in" },
        visual: {
          x: 20,
          y: 20,
          layerName: "Primary action",
          hidden: true,
          locked: true,
        },
      }),
      element({
        id: "shape",
        type: "shape.geo",
        index: "a3",
        semantic: { kind: "rectangle" },
        visual: { x: 20, y: 60 },
      }),
      element({
        id: "token",
        type: "design.token",
        index: "a4",
        semantic: { name: "Primary", kind: "color", value: "#123456" },
      }),
    ]),
  });
}

test("layer search retains parent context and does not change collapse or document state", () => {
  const editor = fixture();
  const collapsed = new Set(["frame"]);
  const before = JSON.stringify(editor.getSnapshot());
  expect(layerRows(editor, collapsed).map((row) => row.element.id)).toEqual([
    "frame",
  ]);
  const rows = layerRows(editor, collapsed, "PRIMARY");
  expect(rows.map((row) => [row.element.id, row.depth, row.matched])).toEqual([
    ["frame", 0, false],
    ["group", 1, false],
    ["text", 2, true],
  ]);
  expect(
    layerRows(editor, collapsed, "Sign in").map((row) => row.element.id),
  ).toEqual(["frame", "group", "text"]);
  expect(layerRows(editor, collapsed).map((row) => row.element.id)).toEqual([
    "frame",
  ]);
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
});

test("layer search supports types and empty results without exposing palette resources", () => {
  const editor = fixture();
  expect(
    layerRows(editor, new Set(), "shape.geo").map((row) => row.element.id),
  ).toEqual(["frame", "group", "shape"]);
  expect(layerRows(editor, new Set(), "no matches")).toEqual([]);
  expect(layerRows(editor).some((row) => row.element.id === "token")).toBe(
    false,
  );
});

test("cyclic imported groups remain visible exactly once without repairing document data", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "a",
        type: "group",
        index: "a0",
        semantic: { memberIds: ["b"] },
      }),
      element({
        id: "b",
        type: "group",
        index: "a1",
        semantic: { memberIds: ["a"] },
      }),
    ]),
  });
  const before = JSON.stringify(editor.getSnapshot());
  const rows = layerRows(editor);
  expect(new Set(rows.map((row) => row.element.id))).toEqual(
    new Set(["a", "b"]),
  );
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
});

test("engineering search finds columns, expressions, indexes and UML member details", () => {
  const editor = makeEditor();
  const table = editor.createElement("erd.table", {
    semantic: {
      tableName: "Accounts",
      columns: [
        { id: "private-column-id", name: "email_address", dataType: "varchar" },
      ],
      indexes: [
        {
          id: "idx",
          name: "unique_email",
          columns: ["private-column-id"],
          unique: true,
        },
      ],
      checks: [
        {
          id: "chk",
          name: "email_check",
          expression: "length(email_address) > 0",
        },
      ],
    },
  });
  const klass = editor.createElement("uml.class", {
    semantic: {
      name: "AccountService",
      attributes: [{ id: "attr", name: "repository", type: "AccountStore" }],
      methods: [
        {
          id: "method",
          name: "findAccount",
          returnType: "Account",
          parameters: [{ name: "lookupEmail", type: "EmailAddress" }],
        },
      ],
    },
  });
  const before = editor.getSnapshot();
  for (const query of [
    "EMAIL_ADDRESS",
    "varchar",
    "unique_email",
    "length(email_address)",
  ]) {
    const rows = layerRows(editor, new Set(), query);
    expect(rows.map((row) => row.element.id)).toEqual([table]);
    expect(rows[0]?.matchDetail?.toLowerCase()).toContain(query.toLowerCase());
  }
  for (const query of ["AccountStore", "findAccount", "lookupEmail"]) {
    expect(
      layerRows(editor, new Set(), query).map((row) => row.element.id),
    ).toEqual([klass]);
  }
  expect(layerRows(editor, new Set(), "private-column-id")).toEqual([]);
  expect(editor.getSnapshot()).toEqual(before);
});

test("layer search tolerates unknown null semantics", () => {
  const editor = makeEditor({
    document: document([
      element({ id: "unknown", type: "custom.unknown", semantic: null }),
    ]),
  });
  expect(
    layerRows(editor, new Set(), "custom.unknown").map((row) => row.element.id),
  ).toEqual(["unknown"]);
});

test("searching another page preserves active page, selection and camera", () => {
  const editor = makeEditor();
  const first = editor.currentPageId;
  const second = editor.createPage({ name: "Mobile" });
  const label = editor.buildElement("text.note", {
    semantic: { text: "Checkout" },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Phone", memberIds: [label.id] },
  });
  editor.apply(
    [frame, label].map((element) => ({ type: "createElement", element })),
  );
  editor.setCurrentPage(first);
  const camera = editor.camera.get();
  const before = editor.getSnapshot();
  const rows = layerRows(editor, new Set([frame.id]), "Checkout", second);
  expect(rows.map((row) => row.element.id)).toEqual([frame.id, label.id]);
  expect(editor.currentPageId).toBe(first);
  expect(editor.selection.size).toBe(0);
  expect(editor.camera.get()).toEqual(camera);
  expect(editor.getSnapshot()).toEqual(before);
  expect(layerRows(editor, new Set(), "Checkout")).toEqual([]);
});

test("layer range selection follows visible hierarchy and retains its anchor when shrinking", () => {
  const editor = fixture();
  const rows = layerRows(editor);
  expect(rows.map((row) => row.element.id)).toEqual([
    "frame",
    "group",
    "shape",
    "text",
  ]);
  const before = editor.getSnapshot();
  const camera = editor.camera.get();
  let anchor = selectLayerRow(editor, rows, "group", undefined);
  anchor = selectLayerRow(editor, rows, "text", anchor, { range: true });
  expect([...editor.selection.ids()]).toEqual(["group", "shape", "text"]);
  expect(anchor).toBe("group");
  anchor = selectLayerRow(editor, rows, "shape", anchor, { range: true });
  expect([...editor.selection.ids()]).toEqual(["group", "shape"]);
  selectLayerRow(editor, rows, "frame", anchor, { range: true });
  expect([...editor.selection.ids()]).toEqual(["frame", "group"]);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.camera.get()).toEqual(camera);
  expect(editor.store.get("text")?.visual.hidden).toBe(true);
  expect(editor.store.get("text")?.visual.locked).toBe(true);
});

test("additive layer clicks toggle individuals and additive ranges retain other selections", () => {
  const editor = fixture();
  const rows = layerRows(editor);
  selectLayerRow(editor, rows, "frame", undefined);
  let anchor = selectLayerRow(editor, rows, "shape", undefined, {
    additive: true,
  });
  expect([...editor.selection.ids()]).toEqual(["frame", "shape"]);
  selectLayerRow(editor, rows, "text", anchor, { additive: true, range: true });
  expect([...editor.selection.ids()]).toEqual(["frame", "shape", "text"]);
  anchor = selectLayerRow(editor, rows, "shape", anchor, { additive: true });
  expect([...editor.selection.ids()]).toEqual(["frame", "text"]);
  selectLayerRow(editor, rows, "group", anchor, { range: true });
  expect([...editor.selection.ids()]).toEqual(["group"]);
});

test("layer ranges omit filtered and collapsed descendants and reset unavailable anchors", () => {
  const editor = fixture();
  const rows = layerRows(editor, new Set(), "Sign in");
  const anchor = selectLayerRow(editor, rows, "frame", undefined);
  selectLayerRow(editor, rows, "text", anchor, { range: true });
  expect([...editor.selection.ids()]).toEqual(["frame", "group", "text"]);
  selectLayerRow(
    editor,
    layerRows(editor, new Set(["group"])),
    "group",
    "frame",
    { range: true },
  );
  expect([...editor.selection.ids()]).toEqual(["frame", "group"]);
  selectLayerRow(editor, rows, "text", "shape", { range: true });
  expect([...editor.selection.ids()]).toEqual(["text"]);
});

test("all-page layer ranges switch pages without including the previous page", () => {
  const editor = fixture();
  const first = editor.currentPageId;
  const second = editor.createPage({ name: "Mobile" });
  const label = editor.createElement("text.note", {
    semantic: { text: "Checkout" },
  });
  const rows = editor.store
    .listPages()
    .flatMap((page) => layerRows(editor, new Set(), "", page.id));
  editor.setCurrentPage(first);
  const anchor = selectLayerRow(editor, rows, "frame", undefined);
  const next = selectLayerRow(editor, rows, label, anchor, {
    range: true,
    additive: true,
  });
  expect(editor.currentPageId).toBe(second);
  expect([...editor.selection.ids()]).toEqual([label]);
  expect(next).toBe(label);
});

test("stale layer rows cannot select deleted targets or missing range members", () => {
  const editor = fixture();
  const rows = layerRows(editor);
  const anchor = selectLayerRow(editor, rows, "group", undefined);
  editor.apply([{ type: "deleteElements", ids: ["shape"] }]);
  expect(selectLayerRow(editor, rows, "shape", anchor)).toBe(anchor);
  expect([...editor.selection.ids()]).toEqual(["group"]);
  selectLayerRow(editor, rows, "text", anchor, { range: true });
  expect([...editor.selection.ids()]).toEqual(["group", "text"]);
  selectLayerRow(editor, rows, "token", anchor);
  expect([...editor.selection.ids()]).toEqual(["group", "text"]);
});
