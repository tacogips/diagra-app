import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import type { Document, Element, Page } from "@diagra/ir";
import { bpmnProblemRows, focusBpmnProblem } from "./bpmn-problems.ts";

const BPMN_PAGE: Page = { id: "bpmn-page", name: "Order flow", kind: "bpmn" };
const task: Element = {
  id: "unnamed-task",
  page: BPMN_PAGE.id,
  type: "bpmn.task",
  index: "a1",
  semantic: { taskType: "user", loop: "none" },
  visual: { x: 20, y: 20, width: 100, height: 80 },
};
const documentWith = (elements: readonly Element[] = []): Document => ({
  schemaVersion: 1,
  id: "doc-1",
  title: "Test",
  pages: [BPMN_PAGE],
  elements,
});

test("maps recommended lint findings to labeled selectable problem rows", () => {
  const rows = bpmnProblemRows(documentWith([task]), BPMN_PAGE.id);
  const taskRows = rows.filter((row) => row.elementId === task.id);
  expect(taskRows.map((row) => row.ruleId)).toContain("label-required");
  expect(taskRows.map((row) => row.ruleId)).toContain("no-implicit-end");
  expect(taskRows.every((row) => row.label === task.id)).toBe(true);
  expect(taskRows.every((row) => row.selectable)).toBe(true);
});

test("focus selects and frames the offending element", () => {
  const otherPage: Page = { id: "other", name: "Other", kind: "freeform" };
  const editor = new Editor({
    document: {
      ...documentWith([{ ...task, page: "other" }]),
      pages: [BPMN_PAGE, otherPage],
    },
  });
  const row = {
    key: "label-required:unnamed-task:0",
    severity: "error" as const,
    elementId: task.id,
    label: task.id,
    message: "Needs a label",
    ruleId: "label-required",
    selectable: true,
  };
  const cameraBefore = editor.camera.get();
  expect(focusBpmnProblem(editor, row, { width: 600, height: 400 })).toBe(true);
  expect(editor.currentPageId).toBe(otherPage.id);
  expect([...editor.selection.ids()]).toEqual([task.id]);
  expect(editor.camera.get()).not.toEqual(cameraBefore);
});

test("page-level findings cannot change the selection", () => {
  const editor = new Editor({ document: documentWith([task]) });
  editor.selection.set([task.id]);
  const row = bpmnProblemRows(documentWith([task]), BPMN_PAGE.id).find(
    (candidate) => candidate.ruleId === "start-event-required",
  );
  expect(row).toBeDefined();
  expect(row?.elementId).toBe(BPMN_PAGE.id);
  expect(row?.label).toBe(BPMN_PAGE.name);
  expect(row?.selectable).toBe(false);
  expect(
    focusBpmnProblem(editor, row as NonNullable<typeof row>, {
      width: 600,
      height: 400,
    }),
  ).toBe(false);
  expect([...editor.selection.ids()]).toEqual([task.id]);
});

test("clean BPMN pages have no problem rows", () => {
  expect(bpmnProblemRows(documentWith(), BPMN_PAGE.id)).toEqual([]);
});

test("non-BPMN pages are not linted by the panel helper", () => {
  const page: Page = { id: "plain", name: "Plain", kind: "freeform" };
  expect(
    bpmnProblemRows({ ...documentWith([task]), pages: [page] }, page.id),
  ).toEqual([]);
});
