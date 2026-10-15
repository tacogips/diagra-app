import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { importBpmnXml } from "@nodetto/io";
import { lintBpmnPage, recommendedLintConfig } from "./lint/index.ts";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const referenceRoot = resolve(repositoryRoot, ".reference/bpmn-article/docs");
const referenceFixtures = [
  { file: "purchase_request/purchase_request.bpmn", expected: [] },
  {
    file: "purchase_request_draft/purchase_request_draft.bpmn",
    expected: ["label-required", "no-implicit-end", "no-implicit-start"],
  },
  {
    file: "purchase_request_swapped/purchase_request_swapped.bpmn",
    expected: [],
  },
  {
    file: "purchase_request_inverted/purchase_request_inverted.bpmn",
    expected: [],
  },
] as const;

describe.skipIf(!existsSync(referenceRoot))(
  "local BPMN reference lint parity",
  () => {
    for (const { file, expected } of referenceFixtures) {
      test(`matches recommended rule ids for ${file}`, () => {
        const imported = importBpmnXml(
          readFileSync(resolve(referenceRoot, file), "utf8"),
        );
        const ruleIds = lintBpmnPage(
          imported.document,
          imported.pageId,
          recommendedLintConfig(),
        )
          .map(({ ruleId }) => ruleId)
          .sort();
        expect(ruleIds).toEqual([...expected].sort());
      });
    }
  },
);
