// Schema version and the migration scaffold.
//
// v1 is the first published schema, so `MIGRATIONS` is empty. The runner is
// still live code: `parseDocument` routes every file through it, and the
// pipeline is exercised by tests with a synthetic chain, so the first real
// migration only has to add one entry.

export const SCHEMA_VERSION = 1;

/**
 * A document as read from disk, before it is known to match the current
 * schema. Migrations rewrite this loose shape; validation runs afterwards.
 */
export type DocumentSnapshot = Record<string, unknown> & {
  schemaVersion: number;
};

export interface Migration {
  /** Schema version this migration reads. */
  readonly from: number;
  /** Schema version this migration produces; must be `from + 1`. */
  readonly to: number;
  readonly description: string;
  migrate(snapshot: DocumentSnapshot): DocumentSnapshot;
}

/** Ordered v(n) -> v(n+1) steps. Empty until a v2 schema exists. */
export const MIGRATIONS: readonly Migration[] = [];

export class SchemaMigrationError extends Error {
  readonly schemaVersion: number;
  readonly targetVersion: number;

  constructor(message: string, schemaVersion: number, targetVersion: number) {
    super(message);
    this.name = "SchemaMigrationError";
    this.schemaVersion = schemaVersion;
    this.targetVersion = targetVersion;
  }
}

export interface MigrateOptions {
  /** Version to migrate to. Defaults to {@link SCHEMA_VERSION}. */
  readonly targetVersion?: number;
  /** Migration chain to use. Defaults to {@link MIGRATIONS}. */
  readonly migrations?: readonly Migration[];
}

export function needsMigration(
  schemaVersion: number,
  targetVersion: number = SCHEMA_VERSION,
): boolean {
  return schemaVersion !== targetVersion;
}

/**
 * Migrate a snapshot forward to `targetVersion`.
 *
 * Throws {@link SchemaMigrationError} when the version is not a positive
 * integer, when the document was written by a newer build (downgrades are
 * never attempted), or when a step in the chain is missing.
 */
export function migrateSnapshot(
  snapshot: DocumentSnapshot,
  options: MigrateOptions = {},
): DocumentSnapshot {
  const target = options.targetVersion ?? SCHEMA_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  const start = snapshot.schemaVersion;

  if (!Number.isInteger(start) || start < 1) {
    throw new SchemaMigrationError(
      `schemaVersion must be a positive integer, received ${JSON.stringify(start)}`,
      start,
      target,
    );
  }
  if (start > target) {
    throw new SchemaMigrationError(
      `document schemaVersion ${start} is newer than the supported version ${target}; upgrade diagra to open it`,
      start,
      target,
    );
  }

  let current = snapshot;
  let version = start;
  while (version < target) {
    const step = migrations.find((candidate) => candidate.from === version);
    if (!step) {
      throw new SchemaMigrationError(
        `no migration registered from schemaVersion ${version} to ${version + 1}`,
        start,
        target,
      );
    }
    current = { ...step.migrate(current), schemaVersion: step.to };
    version = step.to;
  }

  return current;
}
