import { describe, expect, test } from "bun:test";
import {
  type DocumentSnapshot,
  MIGRATIONS,
  type Migration,
  migrateSnapshot,
  needsMigration,
  SCHEMA_VERSION,
  SchemaMigrationError,
} from "./migrations.ts";

function snapshot(schemaVersion: number): DocumentSnapshot {
  return {
    schemaVersion,
    id: "d1",
    title: "T",
    pages: [],
    elements: [],
  };
}

/**
 * v1 ships with an empty chain, so the runner is exercised with a synthetic
 * two-step chain. This is the shape a real migration will take.
 */
const V1_TO_V2: Migration = {
  from: 1,
  to: 2,
  description: "rename title -> name",
  migrate: (input) => {
    const { title, ...rest } = input;
    return { ...rest, name: title } as DocumentSnapshot;
  },
};

const V2_TO_V3: Migration = {
  from: 2,
  to: 3,
  description: "stamp a marker",
  migrate: (input) => ({ ...input, migratedAt: "v3" }),
};

describe("SCHEMA_VERSION", () => {
  test("is a positive integer", () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  test("has one migration per version step above 1", () => {
    expect(MIGRATIONS.length).toBe(SCHEMA_VERSION - 1);
  });

  test("the registered chain is contiguous and forward-only", () => {
    for (const [i, migration] of MIGRATIONS.entries()) {
      expect(migration.from).toBe(i + 1);
      expect(migration.to).toBe(migration.from + 1);
    }
  });
});

describe("needsMigration", () => {
  test("is false at the current version", () => {
    expect(needsMigration(SCHEMA_VERSION)).toBe(false);
  });

  test("is true for any other version", () => {
    expect(needsMigration(SCHEMA_VERSION + 1)).toBe(true);
    expect(needsMigration(0)).toBe(true);
  });
});

describe("migrateSnapshot", () => {
  test("is a no-op at the current version", () => {
    const input = snapshot(SCHEMA_VERSION);
    expect(migrateSnapshot(input)).toEqual(input);
  });

  test("applies a chain in order and stamps the target version", () => {
    const result = migrateSnapshot(snapshot(1), {
      targetVersion: 3,
      migrations: [V1_TO_V2, V2_TO_V3],
    });
    expect(result.schemaVersion).toBe(3);
    expect(result["name"]).toBe("T");
    expect(result["title"]).toBeUndefined();
    expect(result["migratedAt"]).toBe("v3");
  });

  test("stops at the requested target version", () => {
    const result = migrateSnapshot(snapshot(1), {
      targetVersion: 2,
      migrations: [V1_TO_V2, V2_TO_V3],
    });
    expect(result.schemaVersion).toBe(2);
    expect(result["migratedAt"]).toBeUndefined();
  });

  test("does not mutate its input", () => {
    const input = snapshot(1);
    migrateSnapshot(input, {
      targetVersion: 2,
      migrations: [V1_TO_V2],
    });
    expect(input).toEqual(snapshot(1));
  });

  test("overrides whatever version a migration returns", () => {
    const liar: Migration = {
      from: 1,
      to: 2,
      description: "forgets to bump the version",
      migrate: (input) => input,
    };
    expect(
      migrateSnapshot(snapshot(1), {
        targetVersion: 2,
        migrations: [liar],
      }).schemaVersion,
    ).toBe(2);
  });

  test("refuses a document from a newer build", () => {
    expect(() => migrateSnapshot(snapshot(SCHEMA_VERSION + 1))).toThrow(
      SchemaMigrationError,
    );
    expect(() => migrateSnapshot(snapshot(SCHEMA_VERSION + 1))).toThrow(
      /newer than the supported version/,
    );
  });

  test("refuses a gap in the chain", () => {
    expect(() =>
      migrateSnapshot(snapshot(1), {
        targetVersion: 3,
        migrations: [V1_TO_V2],
      }),
    ).toThrow(/no migration registered from schemaVersion 2 to 3/);
  });

  test("refuses a non-integer or non-positive version", () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expect(() => migrateSnapshot(snapshot(version))).toThrow(
        SchemaMigrationError,
      );
    }
  });

  test("carries the versions on the thrown error", () => {
    try {
      migrateSnapshot(snapshot(42));
      throw new Error("expected a throw");
    } catch (cause) {
      expect(cause).toBeInstanceOf(SchemaMigrationError);
      expect((cause as SchemaMigrationError).schemaVersion).toBe(42);
      expect((cause as SchemaMigrationError).targetVersion).toBe(
        SCHEMA_VERSION,
      );
    }
  });
});
