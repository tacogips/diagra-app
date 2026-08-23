// Desktop entry point.
//
// Builds an editor, seeds a demo document that exercises every element type
// the phase-0 renderer knows, and mounts the Solid app. The seed is applied
// with `history: "ignore"` so the user's first undo does not empty the page.

import { createDefaultRegistry, Editor } from "@diagra/core";
import type { Command } from "@diagra/core";
import type { Element } from "@diagra/ir";
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./style.css";

function seed(editor: Editor): void {
  const elements: Element[] = [];
  const add = (element: Element): Element => {
    elements.push(element);
    return element;
  };

  const users = add(
    editor.buildElement("erd.table", {
      visual: { x: 60, y: 60, width: 240 },
      semantic: {
        tableName: "users",
        columns: [
          { id: "u1", name: "id", dataType: "uuid", pk: true },
          { id: "u2", name: "email", dataType: "text" },
          { id: "u3", name: "display_name", dataType: "text", nullable: true },
        ],
      },
    }),
  );
  const orders = add(
    editor.buildElement("erd.table", {
      visual: { x: 460, y: 60, width: 240 },
      semantic: {
        tableName: "orders",
        columns: [
          { id: "o1", name: "id", dataType: "uuid", pk: true },
          { id: "o2", name: "user_id", dataType: "uuid" },
          { id: "o3", name: "total_cents", dataType: "int" },
          {
            id: "o4",
            name: "shipped_at",
            dataType: "timestamp",
            nullable: true,
          },
        ],
      },
    }),
  );
  add(
    editor.buildElement("erd.relation", {
      semantic: {
        from: { table: users.id, column: "u1" },
        to: { table: orders.id, column: "o2" },
        cardinality: "1:*",
        label: "places",
      },
    }),
  );

  const entity = add(
    editor.buildElement("uml.class", {
      visual: { x: 60, y: 300, width: 240 },
      semantic: {
        name: "Entity",
        stereotype: "abstract",
        attributes: [{ id: "e1", name: "id", type: "Uuid", visibility: "#" }],
        methods: [
          { id: "e2", name: "save", returnType: "void", abstract: true },
        ],
      },
    }),
  );
  const order = add(
    editor.buildElement("uml.class", {
      visual: { x: 460, y: 300, width: 240 },
      semantic: {
        name: "Order",
        attributes: [
          { id: "c1", name: "total", type: "Money", visibility: "-" },
          { id: "c2", name: "shippedAt", type: "Instant?", visibility: "-" },
        ],
        methods: [
          {
            id: "c3",
            name: "submit",
            parameters: [{ name: "at", type: "Instant" }],
            returnType: "void",
            visibility: "+",
          },
          { id: "c4", name: "save", returnType: "void", visibility: "+" },
        ],
      },
    }),
  );
  add(
    editor.buildElement("uml.association", {
      semantic: { from: order.id, to: entity.id, kind: "inherit" },
    }),
  );

  add(
    editor.buildElement("shape.geo", {
      visual: { x: 60, y: 560, width: 160, height: 90 },
      semantic: { geo: "rect", label: "Notes" },
    }),
  );
  add(
    editor.buildElement("shape.geo", {
      visual: { x: 260, y: 560, width: 160, height: 90 },
      semantic: { geo: "ellipse", label: "Start" },
    }),
  );
  add(
    editor.buildElement("shape.geo", {
      visual: { x: 460, y: 560, width: 160, height: 90 },
      semantic: { geo: "diamond", label: "Ready?" },
    }),
  );

  const first = add(
    editor.buildElement("node.generic", {
      visual: { x: 700, y: 560, width: 140, height: 60 },
      semantic: { label: "Service A" },
    }),
  );
  const second = add(
    editor.buildElement("node.generic", {
      visual: { x: 940, y: 560, width: 140, height: 60 },
      semantic: { label: "Service B" },
    }),
  );
  add(
    editor.buildElement("edge.generic", {
      semantic: {
        from: first.id,
        to: second.id,
        label: "calls",
        arrowheads: { end: "arrow" },
      },
    }),
  );

  const commands: Command[] = elements.map((element) => ({
    type: "createElement",
    element,
  }));
  editor.apply(commands, { history: "ignore" });
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root element");
}

const editor = new Editor({ registry: createDefaultRegistry() });
seed(editor);

render(() => <App editor={editor} />, root);
