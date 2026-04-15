import { describe, it, expect, beforeEach } from "vitest";
import { enqueue, dequeueByUserId, tryMatch, getQueueSize, resetQueue } from "../../src/pvp/matchmaking.js";

describe("matchmaking", () => {
  beforeEach(() => resetQueue());

  it("enqueue increases queue size", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    expect(getQueueSize()).toBe(1);
  });

  it("duplicate userId replaces entry", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    enqueue({ userId: "a", socketId: "s2", nickname: "A" });
    expect(getQueueSize()).toBe(1);
  });

  it("tryMatch returns null with < 2 entries", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    expect(tryMatch()).toBeNull();
  });

  it("tryMatch pairs two entries and empties queue", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    enqueue({ userId: "b", socketId: "s2", nickname: "B" });
    const pair = tryMatch();
    expect(pair).not.toBeNull();
    expect(pair![0].userId).toBe("a");
    expect(pair![1].userId).toBe("b");
    expect(getQueueSize()).toBe(0);
  });

  it("dequeueByUserId removes correct entry", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    enqueue({ userId: "b", socketId: "s2", nickname: "B" });
    dequeueByUserId("a");
    expect(getQueueSize()).toBe(1);
  });
});
