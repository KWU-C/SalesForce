import { describe, expect, it } from "vitest";
import { PRODUCTION_DATABASE_ID, resolveFirestoreDatabaseId } from "./databaseId";

describe("resolveFirestoreDatabaseId", () => {
  it("uses the production database when unset or blank (unchanged behaviour)", () => {
    expect(PRODUCTION_DATABASE_ID).toBe("dashboard");
    expect(resolveFirestoreDatabaseId(undefined)).toBe("dashboard");
    expect(resolveFirestoreDatabaseId("")).toBe("dashboard");
    expect(resolveFirestoreDatabaseId("  ")).toBe("dashboard");
  });

  it("uses the configured database", () => {
    expect(resolveFirestoreDatabaseId("dashboard-dev")).toBe("dashboard-dev");
    expect(resolveFirestoreDatabaseId(" dashboard ")).toBe("dashboard");
  });
});
