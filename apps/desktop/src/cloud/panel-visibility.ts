import type { CloudStatus } from "./session.ts";

/** Hide only dormant embedded chrome, never recovery or connection feedback. */
export function isCloudPanelDormant(input: {
  readonly embedded: boolean;
  readonly expanded: boolean;
  readonly status: CloudStatus;
  readonly docId: string | null;
  readonly recoveryCount: number;
  readonly error: string | null;
  readonly notice: string | null;
  readonly busy: boolean;
}): boolean {
  return (
    input.embedded &&
    !input.expanded &&
    !input.busy &&
    (input.status === "idle" || input.status === "closed") &&
    !input.docId &&
    !input.recoveryCount &&
    !input.error &&
    !input.notice
  );
}
