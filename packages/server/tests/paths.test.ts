import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "../src/paths.js";

/**
 * Regression guard for the dist-layout PROJECT_ROOT bug: tsc emits with the
 * monorepo root as rootDir, so the compiled paths.js is nested two segments
 * deeper than the source. A fixed `../../..` resolved to packages/server/dist
 * in production and broke all data/ loads. resolveProjectRoot now walks up to
 * the directory that actually contains data/, which must hold for both the
 * dev (src) and dist depths.
 */

// This test file lives at <root>/packages/server/tests/paths.test.ts
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("resolveProjectRoot", () => {
  it("sanity: the computed repo root actually contains data/", () => {
    expect(fs.existsSync(path.join(repoRoot, "data"))).toBe(true);
  });

  it("resolves from the dev source layout (packages/server/src)", () => {
    const devDir = path.join(repoRoot, "packages", "server", "src");
    expect(resolveProjectRoot(devDir, {})).toBe(repoRoot);
  });

  it("resolves from the dist layout (dist/packages/server/src)", () => {
    // The exact production layout that triggered the bug.
    const distDir = path.join(repoRoot, "packages", "server", "dist", "packages", "server", "src");
    expect(resolveProjectRoot(distDir, {})).toBe(repoRoot);
  });

  it("honours the POKELOG_PROJECT_ROOT override", () => {
    const custom = path.join(repoRoot, "packages");
    expect(resolveProjectRoot("/whatever", { POKELOG_PROJECT_ROOT: custom })).toBe(custom);
  });

  it("falls back to resolve(startDir, '../../..') when no data/ is found upward", () => {
    // Use an isolated temp tree guaranteed to have no data/ ancestor so the
    // upward walk fails and the historical fallback formula is exercised.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-paths-"));
    try {
      const start = path.join(base, "a", "b", "c");
      fs.mkdirSync(start, { recursive: true });
      expect(resolveProjectRoot(start, {})).toBe(path.resolve(start, "../../.."));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
