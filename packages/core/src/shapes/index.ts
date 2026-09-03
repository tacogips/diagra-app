// The default ShapeUtil registry: every element type this build renders.
//
// Types that are registered in `@diagra/ir` but not here (sequence.*,
// draw.freehand, frame) fall through to the unknown util until their phase
// lands, which keeps documents that contain them openable.

import { groupShapeUtil } from "../group.ts";
import { ShapeUtilRegistry } from "../shape-util.ts";
import { edgeShapeUtil } from "./edge.ts";
import { erdRelationShapeUtil } from "./erdRelation.ts";
import { erdTableShapeUtil } from "./erdTable.ts";
import { geoShapeUtil } from "./geo.ts";
import { nodeShapeUtil } from "./node.ts";
import { textNoteShapeUtil } from "./textNote.ts";
import { umlAssociationShapeUtil } from "./umlAssociation.ts";
import { umlClassShapeUtil } from "./umlClass.ts";
import { unknownShapeUtil } from "./unknown.ts";

export function createDefaultRegistry(): ShapeUtilRegistry {
  return new ShapeUtilRegistry(unknownShapeUtil)
    .register(geoShapeUtil)
    .register(nodeShapeUtil)
    .register(edgeShapeUtil)
    .register(erdTableShapeUtil)
    .register(umlClassShapeUtil)
    .register(erdRelationShapeUtil)
    .register(umlAssociationShapeUtil)
    .register(textNoteShapeUtil)
    .register(groupShapeUtil);
}
