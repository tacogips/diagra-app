// The default ShapeUtil registry: every element type this build renders.
//
// Types that are registered in `@diagra/ir` but not here fall through to the
// unknown util, which keeps documents from newer builds openable.

import { groupShapeUtil } from "../group.ts";
import { freehandShapeUtil } from "./freehand.ts";
import { compoundPathShapeUtil } from "./compound-path.ts";
import { ShapeUtilRegistry } from "../shape-util.ts";
import { edgeShapeUtil } from "./edge.ts";
import { erdRelationShapeUtil } from "./erdRelation.ts";
import { erdTableShapeUtil } from "./erdTable.ts";
import { geoShapeUtil } from "./geo.ts";
import { frameShapeUtil } from "./frame.ts";
import { nodeShapeUtil } from "./node.ts";
import { textNoteShapeUtil } from "./textNote.ts";
import {
  sequenceActivationShapeUtil,
  sequenceMessageShapeUtil,
  sequenceParticipantShapeUtil,
} from "./sequence.ts";
import { umlAssociationShapeUtil } from "./umlAssociation.ts";
import { umlClassShapeUtil } from "./umlClass.ts";
import { unknownShapeUtil } from "./unknown.ts";

export function createDefaultRegistry(): ShapeUtilRegistry {
  return new ShapeUtilRegistry(unknownShapeUtil)
    .register({
      type: "design.guide",
      canResize: false,
      getBounds: () => null,
      hitTest: () => false,
      defaultSemantic: () => ({ axis: "x", position: 0 }),
      defaultVisual: () => ({}),
    })
    .register({
      type: "design.token",
      canResize: false,
      getBounds: () => null,
      hitTest: () => false,
      defaultSemantic: () => ({
        name: "Primary",
        kind: "color",
        value: "#2563eb",
      }),
      defaultVisual: () => ({}),
    })
    .register({
      type: "review.comment",
      canResize: false,
      getBounds: () => null,
      hitTest: () => false,
      defaultSemantic: () => ({
        messages: [
          {
            id: "message",
            author: "Anonymous",
            body: "Comment",
            createdAt: "1970-01-01T00:00:00.000Z",
          },
        ],
      }),
      defaultVisual: () => ({ x: 0, y: 0 }),
    })
    .register({
      type: "design.text-style",
      canResize: false,
      getBounds: () => null,
      hitTest: () => false,
      defaultSemantic: () => ({
        name: "Body",
        value: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          fontWeight: 400,
          fontStyle: "normal",
          lineHeight: 1.35,
          letterSpacing: 0,
          textAlign: "start",
          textDecoration: "none",
          verticalAlign: "top",
        },
      }),
      defaultVisual: () => ({}),
    })
    .register(geoShapeUtil)
    .register(freehandShapeUtil)
    .register(compoundPathShapeUtil)
    .register(frameShapeUtil)
    .register(nodeShapeUtil)
    .register({
      ...nodeShapeUtil,
      type: "image.raster",
      defaultSemantic: () => ({
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        alt: "",
        fit: "contain",
      }),
      defaultVisual: () => ({ x: 0, y: 0, width: 320, height: 240 }),
    })
    .register(edgeShapeUtil)
    .register(erdTableShapeUtil)
    .register(umlClassShapeUtil)
    .register(erdRelationShapeUtil)
    .register(umlAssociationShapeUtil)
    .register(sequenceParticipantShapeUtil)
    .register(sequenceMessageShapeUtil)
    .register(sequenceActivationShapeUtil)
    .register(textNoteShapeUtil)
    .register(groupShapeUtil);
}
