// uml.association: a connector between two classes (assoc, aggregate,
// compose, inherit). The kind only changes the marker the renderer draws.

import { createConnectorUtil, readDirectEndpoints } from "./connector.ts";

export const umlAssociationShapeUtil = createConnectorUtil({
  type: "uml.association",
  readEndpoints: readDirectEndpoints,
  defaultSemantic() {
    return { from: "", to: "", kind: "assoc" };
  },
});
