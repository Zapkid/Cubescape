import { describe, expect, it } from "vitest";
import { canOpenGate, gatePassableForCaps, type GateCheckCtx } from "../src/rules/doors.js";
import type { Gate, RulePlayer, SolverCaps } from "../src/types.js";

function player(over: Partial<RulePlayer> = {}): RulePlayer {
  return {
    id: "p1",
    charId: "brute",
    x: 4,
    z: 4,
    might: 8,
    wits: 3,
    keys: [],
    grappleActiveUntil: 0,
    downed: false,
    ...over,
  };
}

function ctx(over: Partial<GateCheckCtx> = {}): GateCheckCtx {
  const p = player();
  return {
    playersNear: [p],
    interactor: p,
    activePlateCount: 0,
    roomCleared: false,
    liftPowered: false,
    tick: 100,
    ...over,
  };
}

describe("canOpenGate truth table", () => {
  it("open gates always pass", () => {
    expect(canOpenGate({ type: "open" }, ctx()).ok).toBe(true);
  });

  it("key gates require a nearby holder", () => {
    const gate: Gate = { type: "key", color: "ruby" };
    expect(canOpenGate(gate, ctx()).ok).toBe(false);
    const holder = player({ id: "p2", keys: ["ruby"] });
    expect(
      canOpenGate(gate, ctx({ playersNear: [player(), holder] })).ok,
    ).toBe(true);
  });

  it("plates gates count active presses", () => {
    const gate: Gate = { type: "plates", count: 2 };
    expect(canOpenGate(gate, ctx({ activePlateCount: 1 })).ok).toBe(false);
    expect(canOpenGate(gate, ctx({ activePlateCount: 2 })).ok).toBe(true);
  });

  describe("combined-stat door (the co-op door)", () => {
    const gate: Gate = { type: "stat", stat: "might", threshold: 12 };
    it("solo Brute (8) fails", () => {
      expect(canOpenGate(gate, ctx()).ok).toBe(false);
    });
    it("Brute (8) + Tinker (4) together pass", () => {
      const tinker = player({ id: "p2", charId: "tinker", might: 4, wits: 8 });
      expect(canOpenGate(gate, ctx({ playersNear: [player(), tinker] })).ok).toBe(true);
    });
    it("Brute (8) + Scout (3) fall short at 11", () => {
      const scout = player({ id: "p2", charId: "scout", might: 3, wits: 6 });
      expect(canOpenGate(gate, ctx({ playersNear: [player(), scout] })).ok).toBe(false);
    });
  });

  it("objective gates need the owning room cleared", () => {
    const gate: Gate = { type: "objective" };
    expect(canOpenGate(gate, ctx()).ok).toBe(false);
    expect(canOpenGate(gate, ctx({ roomCleared: true })).ok).toBe(true);
  });

  it("lift gates pass when powered or when the interactor grapples", () => {
    const gate: Gate = { type: "lift" };
    expect(canOpenGate(gate, ctx()).ok).toBe(false);
    expect(canOpenGate(gate, ctx({ liftPowered: true })).ok).toBe(true);
    const grappler = player({ grappleActiveUntil: 999 });
    expect(canOpenGate(gate, ctx({ interactor: grappler })).ok).toBe(true);
  });
});

describe("gatePassableForCaps (solver view)", () => {
  const teamCaps: SolverCaps = {
    might: 12,
    wits: 11,
    players: 3,
    hasBrute: true,
    hasScout: true,
    hasTinker: true,
  };
  const soloScout: SolverCaps = {
    might: 3,
    wits: 6,
    players: 1,
    hasBrute: false,
    hasScout: true,
    hasTinker: false,
  };

  it("key gates depend on the collected key set", () => {
    const gate: Gate = { type: "key", color: "ruby" };
    expect(
      gatePassableForCaps(gate, teamCaps, { keysAvailable: new Set(), objectiveCompletable: false }),
    ).toBe(false);
    expect(
      gatePassableForCaps(gate, teamCaps, { keysAvailable: new Set(["ruby"]), objectiveCompletable: false }),
    ).toBe(true);
  });

  it("plates(2) is impossible for a solo scout but fine for a solo brute", () => {
    const gate: Gate = { type: "plates", count: 2 };
    const none = { keysAvailable: new Set<string>(), objectiveCompletable: false };
    expect(gatePassableForCaps(gate, soloScout, none)).toBe(false);
    const soloBrute: SolverCaps = { ...soloScout, hasBrute: true, hasScout: false, might: 8, wits: 3 };
    expect(gatePassableForCaps(gate, soloBrute, none)).toBe(true);
  });

  it("stat gates compare against the caps", () => {
    const gate: Gate = { type: "stat", stat: "wits", threshold: 8 };
    const none = { keysAvailable: new Set<string>(), objectiveCompletable: false };
    expect(gatePassableForCaps(gate, soloScout, none)).toBe(false);
    expect(gatePassableForCaps(gate, teamCaps, none)).toBe(true);
  });

  it("lift gates are always passable (every kit has an answer)", () => {
    const none = { keysAvailable: new Set<string>(), objectiveCompletable: false };
    expect(gatePassableForCaps({ type: "lift" }, soloScout, none)).toBe(true);
  });
});
