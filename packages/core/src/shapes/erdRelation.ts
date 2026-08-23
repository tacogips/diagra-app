// erd.relation: a connector whose endpoints are table references.

import { createConnectorUtil, readTableEndpoints } from "./connector.ts";

export const erdRelationShapeUtil = createConnectorUtil({
  type: "erd.relation",
  readEndpoints: readTableEndpoints,
  defaultSemantic() {
    return { from: { table: "" }, to: { table: "" }, cardinality: "1:*" };
  },
});
