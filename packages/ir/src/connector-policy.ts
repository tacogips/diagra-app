import { isPlainObject, type ElementId } from "./types.ts";

/** Generic edges are unrestricted; notation-specific connectors have typed ends. */
export const CONNECTOR_ENDPOINT_TYPES: Readonly<
  Record<string, readonly string[]>
> = {
  "erd.relation": ["erd.table"],
  "uml.association": ["uml.class"],
  "sequence.message": ["sequence.participant"],
  "uml.component-relationship": ["uml.component", "uml.interface", "uml.port"],
};

export interface ConnectorEndpointIssue {
  readonly code: "connector.endpointType" | "connector.endpointPage";
  readonly field: string;
  readonly message: string;
}

/** Missing references are draft/reference warnings; existing wrong targets are invalid edits. */
export function connectorEndpointIssues(
  type: string,
  semantic: unknown,
  page: string,
  resolve: (
    id: ElementId,
  ) => { readonly type: string; readonly page: string } | undefined,
): readonly ConnectorEndpointIssue[] {
  const allowed = Object.hasOwn(CONNECTOR_ENDPOINT_TYPES, type)
    ? CONNECTOR_ENDPOINT_TYPES[type]
    : undefined;
  if (!allowed || !isPlainObject(semantic)) return [];
  const issues: ConnectorEndpointIssue[] = [];
  for (const end of ["from", "to"] as const) {
    const raw = semantic[end];
    const id =
      type === "erd.relation" && isPlainObject(raw) ? raw["table"] : raw;
    if (typeof id !== "string") continue;
    const target = resolve(id);
    if (!target) continue;
    const field = type === "erd.relation" ? `${end}.table` : end;
    const label = end === "from" ? "Source endpoint" : "Target endpoint";
    if (!allowed.includes(target.type))
      issues.push({
        code: "connector.endpointType",
        field,
        message: `${label} must connect to ${type === "erd.relation" ? "a table" : type === "uml.association" ? "a UML class" : type === "sequence.message" ? "a sequence participant" : "a UML component, interface, or port"}.`,
      });
    if (target.page !== page)
      issues.push({
        code: "connector.endpointPage",
        field,
        message: `${label} must be on the same page.`,
      });
  }
  return issues;
}
