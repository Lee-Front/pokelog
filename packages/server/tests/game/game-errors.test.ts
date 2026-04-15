import { describe, it, expect } from "vitest";
import { GameRuleError } from "../../src/game/game-errors.js";

describe("GameRuleError", () => {
  it("is an instance of Error", () => {
    const err = new GameRuleError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of GameRuleError", () => {
    const err = new GameRuleError("test");
    expect(err).toBeInstanceOf(GameRuleError);
  });

  it("has the correct message", () => {
    const err = new GameRuleError("not enough points");
    expect(err.message).toBe("not enough points");
  });

  it("defaults status to 400", () => {
    const err = new GameRuleError("bad request");
    expect(err.status).toBe(400);
  });

  it("accepts a custom status code", () => {
    const err = new GameRuleError("forbidden", 403);
    expect(err.status).toBe(403);
  });

  it("accepts status 404", () => {
    const err = new GameRuleError("not found", 404);
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
  });
});
