// Structured validation issues shared by the IR validator and the registry.

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly severity: IssueSeverity;
  /** Stable machine-readable code, e.g. `field.missing`. */
  readonly code: string;
  /** JSON-ish location, e.g. `elements[2].semantic.columns[0].name`. */
  readonly path: string;
  readonly message: string;
}

export function error(
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return { severity: "error", code, path, message };
}

export function warning(
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return { severity: "warning", code, path, message };
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((candidate) => candidate.severity === "error");
}

export function formatIssue(candidate: ValidationIssue): string {
  return `${candidate.severity} ${candidate.path}: ${candidate.message} (${candidate.code})`;
}

/** Thrown by the `assert*` helpers when validation produced errors. */
export class DocumentValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], context?: string) {
    const errors = issues.filter((candidate) => candidate.severity === "error");
    const head = context ? `${context}: ` : "";
    super(
      `${head}${errors.length} validation error(s)\n${errors
        .map(formatIssue)
        .join("\n")}`,
    );
    this.name = "DocumentValidationError";
    this.issues = issues;
  }
}
