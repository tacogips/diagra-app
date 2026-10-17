import { expect, test } from "bun:test";
import {
  dispatchFileMenuAction,
  type FileMenuHandlers,
} from "./native-menu.ts";

test("native file commands route to the matching document operation", () => {
  const calls: string[] = [];
  const handlers: FileMenuHandlers = {
    canEdit: () => true,
    newDocument: () => {
      calls.push("new");
    },
    newFromTemplate: () => {
      calls.push("templates");
    },
    open: () => {
      calls.push("open");
    },
    reload: () => {
      calls.push("reload");
    },
    save: () => {
      calls.push("save");
    },
    saveAs: () => {
      calls.push("save-as");
    },
    exportDocument: () => {
      calls.push("export");
    },
  };
  for (const action of [
    "new",
    "templates",
    "open",
    "reload",
    "save",
    "save-as",
    "export",
    "unknown",
  ])
    dispatchFileMenuAction(action, handlers);
  expect(calls).toEqual([
    "new",
    "templates",
    "open",
    "reload",
    "save",
    "save-as",
    "export",
  ]);
});

test("native file commands cannot write to an editor owned by a cloud session", () => {
  const calls: string[] = [];
  const denied = () => {
    calls.push("unexpected local operation");
  };
  const handlers: FileMenuHandlers = {
    canEdit: () => false,
    newDocument: denied,
    open: denied,
    reload: denied,
    save: denied,
    saveAs: denied,
    exportDocument: () => {
      calls.push("export");
    },
  };
  for (const action of ["new", "open", "reload", "save", "save-as", "export"])
    dispatchFileMenuAction(action, handlers);
  expect(calls).toEqual(["export"]);
});
