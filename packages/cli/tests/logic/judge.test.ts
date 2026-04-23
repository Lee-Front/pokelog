import { describe, it, expect } from "vitest";
import {
  colorForIv,
  renderIvBar,
  renderJudgeOutput,
} from "../../src/commands/judge.js";

describe("renderIvBar", () => {
  it("renders full bar for IV 31", () => {
    const bar = renderIvBar(31);
    // 31/3 = 10 filled, 1 empty
    expect(bar).toBe("██████████░");
  });

  it("renders empty bar for IV 0", () => {
    expect(renderIvBar(0)).toBe("░░░░░░░░░░░");
  });

  it("always returns 11 characters", () => {
    for (let v = 0; v <= 31; v++) {
      expect(renderIvBar(v)).toHaveLength(11);
    }
  });

  it("clamps out-of-range values safely", () => {
    expect(renderIvBar(-5)).toHaveLength(11);
    expect(renderIvBar(200)).toHaveLength(11);
  });
});

describe("colorForIv", () => {
  it("returns yellow for perfect IV", () => {
    expect(colorForIv(31)).toContain("33"); // yellow
  });

  it("returns green for 26-30", () => {
    expect(colorForIv(26)).toContain("32");
    expect(colorForIv(30)).toContain("32");
  });

  it("returns cyan for 16-25", () => {
    expect(colorForIv(16)).toContain("36");
    expect(colorForIv(25)).toContain("36");
  });

  it("returns dim for 1-15", () => {
    expect(colorForIv(1)).toContain("90");
    expect(colorForIv(15)).toContain("90");
  });

  it("returns red for 0", () => {
    expect(colorForIv(0)).toContain("31");
  });
});

describe("renderJudgeOutput", () => {
  it("renders the legacy message for a pre-IV pokemon", () => {
    const lines = renderJudgeOutput({
      legacy: true,
      species: "pikachu",
      nickname: null,
      message: "개체값 판정 불가 (레거시 포켓몬)",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("개체값 판정 불가");
    expect(joined).toContain("pikachu");
  });

  it("renders the overall verdict and every stat row for a perfect pokemon", () => {
    const lines = renderJudgeOutput({
      legacy: false,
      species: "mewtwo",
      nickname: "Alpha",
      total: 186,
      verdict: "환상적이야!",
      ivs: { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 },
      perStat: {
        hp: { value: 31, verdict: "최고다!" },
        attack: { value: 31, verdict: "최고다!" },
        defense: { value: 31, verdict: "최고다!" },
        spAttack: { value: 31, verdict: "최고다!" },
        spDefense: { value: 31, verdict: "최고다!" },
        speed: { value: 31, verdict: "최고다!" },
      },
    });
    const joined = lines.join("\n");
    expect(joined).toContain("환상적이야!");
    expect(joined).toContain("186/186");
    expect(joined).toContain("[V]");
    expect(joined).toContain("최고다!");
    // Korean labels all present
    expect(joined).toContain("HP");
    expect(joined).toContain("공격");
    expect(joined).toContain("방어");
    expect(joined).toContain("특공");
    expect(joined).toContain("특방");
    expect(joined).toContain("스피드");
  });

  it("renders a mixed roster without the V marker for non-perfect stats", () => {
    const lines = renderJudgeOutput({
      legacy: false,
      species: "snorlax",
      nickname: null,
      total: 100,
      verdict: "좀 더 노력해볼까",
      ivs: { hp: 5, attack: 20, defense: 15, spAttack: 0, spDefense: 30, speed: 30 },
      perStat: {
        hp: { value: 5, verdict: "아쉽네" },
        attack: { value: 20, verdict: "그럭저럭" },
        defense: { value: 15, verdict: "아쉽네" },
        spAttack: { value: 0, verdict: "안 좋아" },
        spDefense: { value: 30, verdict: "훌륭해" },
        speed: { value: 30, verdict: "훌륭해" },
      },
    });
    const joined = lines.join("\n");
    expect(joined).toContain("좀 더 노력해볼까");
    expect(joined).toContain("안 좋아");
    expect(joined).toContain("훌륭해");
    expect(joined).toContain("그럭저럭");
    // No [V] anywhere (no stat is 31)
    expect(joined).not.toContain("[V]");
  });
});
