import { expect, test } from "bun:test";
import { erdColumnKey } from "@diagra/core";
import type { ErdTableSemantic } from "@diagra/ir";

test("ERD column badges prioritize primary, unique and ordinary indexes", () => {
  const semantic: ErdTableSemantic = {
    tableName: "users",
    columns: [
      { id: "id", name: "id", dataType: "uuid", pk: true },
      { id: "email", name: "email", dataType: "text" },
      { id: "created", name: "created_at", dataType: "timestamp" },
      { id: "plain", name: "name", dataType: "text" },
    ],
    indexes: [
      { id: "email-uq", columns: ["email"], unique: true },
      { id: "timeline", columns: ["created", "email"] },
    ],
  };
  expect(
    semantic.columns.map((column) => erdColumnKey(semantic, column)),
  ).toEqual(["PK", "UQ", "IX", ""]);
});
