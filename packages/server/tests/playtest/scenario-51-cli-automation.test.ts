/**
 * Scenario 51 — CLI Automation.
 *
 * Smoke-tests the CLI surface in two ways:
 *
 *   1. Spawn `pokelog --help` against the compiled dist (if present)
 *      and assert exit code 0 + something on stdout.
 *   2. Import a few CLI command-module pure helpers (renderJudgeOutput,
 *      renderIvBar, colorForIv) and assert they return sane structures
 *      for canonical inputs.
 *
 * The spawn test is skipped if the CLI dist isn't built — this lets the
 * scenario be useful in both built and source-only environments.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  renderIvBar,
  colorForIv,
  renderJudgeOutput,
} from "../../../cli/src/commands/judge.js";

const cliRepoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const cliDistEntry = path.join(
  cliRepoRoot,
  "packages",
  "cli",
  "dist",
  "packages",
  "cli",
  "src",
  "index.js",
);

describe("Scenario 51 — CLI Automation", () => {
  describe("spawn smoke test (requires built dist)", () => {
    const distExists = fs.existsSync(cliDistEntry);

    it.skipIf(!distExists)("`node dist/index.js --help` exits 0 and emits text", () => {
      const result = spawnSync(process.execPath, [cliDistEntry, "--help"], {
        encoding: "utf-8",
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
      // Commander emits the program description on --help; this is enough
      // to verify the entry point loaded without crashing.
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it.skipIf(!distExists)("`node dist/index.js --version` exits 0 with version string", () => {
      const result = spawnSync(process.execPath, [cliDistEntry, "--version"], {
        encoding: "utf-8",
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it.skipIf(distExists)("dist build absent — skipping spawn smoke (build CLI first)", () => {
      // Documenting the skipped path so the report is explicit.
      expect(distExists).toBe(false);
    });
  });

  describe("CLI helpers: pure functions", () => {
    it("renderIvBar(0) shows empty bar", () => {
      const bar = renderIvBar(0);
      expect(bar).not.toContain("█");
      expect(bar.length).toBe(11);
    });

    it("renderIvBar(31) shows full bar", () => {
      const bar = renderIvBar(31);
      expect(bar).toMatch(/^█+░*$/);
      expect(bar.length).toBe(11);
    });

    it("renderIvBar(15) shows half-ish bar", () => {
      const bar = renderIvBar(15);
      // Math.floor(15/3) = 5 filled, 6 empty.
      expect(bar.split("█").length - 1).toBe(5);
      expect(bar.split("░").length - 1).toBe(6);
    });

    it("colorForIv: 31 → yellow, 26 → green, 16 → cyan, 1 → dim, 0 → red", () => {
      const c31 = colorForIv(31);
      const c26 = colorForIv(26);
      const c16 = colorForIv(16);
      const c1 = colorForIv(1);
      const c0 = colorForIv(0);
      // Each tier returns a different ANSI escape; we just assert
      // pairwise distinctness (the exact codes are implementation-detail).
      const colors = [c31, c26, c16, c1, c0];
      const unique = new Set(colors);
      expect(unique.size).toBe(5);
    });

    it("renderJudgeOutput: legacy payload renders message + species name", () => {
      const lines = renderJudgeOutput({
        legacy: true,
        species: "pikachu",
        nickname: "Sparky",
        message: "더 자라면 판정할 수 있다",
      });
      expect(lines.some((l) => l.includes("Sparky"))).toBe(true);
      expect(lines.some((l) => l.includes("pikachu"))).toBe(true);
    });

    it("renderJudgeOutput: full payload includes verdict and per-stat lines", () => {
      const lines = renderJudgeOutput({
        legacy: false,
        species: "magikarp",
        nickname: null,
        total: 100,
        verdict: "쓸만하군",
        ivs: { hp: 20, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 31 },
        perStat: {
          hp: { value: 20, verdict: "쓸만함" },
          attack: { value: 10, verdict: "보통" },
          defense: { value: 10, verdict: "보통" },
          spAttack: { value: 10, verdict: "보통" },
          spDefense: { value: 10, verdict: "보통" },
          speed: { value: 31, verdict: "최고" },
        },
      });
      expect(lines.some((l) => l.includes("쓸만하군"))).toBe(true);
      expect(lines.some((l) => l.includes("100/186"))).toBe(true);
      // The V indicator should mark the perfect speed stat.
      expect(lines.some((l) => l.includes("[V]"))).toBe(true);
    });

    it("renderJudgeOutput: no nickname → species name shown alone", () => {
      const lines = renderJudgeOutput({
        legacy: false,
        species: "ditto",
        nickname: null,
        total: 60,
        verdict: "그저그래",
        ivs: { hp: 10, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 10 },
        perStat: {
          hp: { value: 10, verdict: "보통" },
          attack: { value: 10, verdict: "보통" },
          defense: { value: 10, verdict: "보통" },
          spAttack: { value: 10, verdict: "보통" },
          spDefense: { value: 10, verdict: "보통" },
          speed: { value: 10, verdict: "보통" },
        },
      });
      expect(lines.some((l) => /ditto/.test(l))).toBe(true);
    });
  });
});
