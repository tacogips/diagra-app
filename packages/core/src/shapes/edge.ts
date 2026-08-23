// edge.generic: a plain connector between two elements.

import { createConnectorUtil, readDirectEndpoints } from "./connector.ts";

export const edgeShapeUtil = createConnectorUtil({
  type: "edge.generic",
  readEndpoints: readDirectEndpoints,
  defaultSemantic() {
    return { from: "", to: "", arrowheads: { end: "arrow" } };
  },
});
