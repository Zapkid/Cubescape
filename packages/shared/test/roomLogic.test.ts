import { describe, expect, it } from "vitest";
import { ROOM_LOGIC, spikeRowActive, type RoomLogicCtx } from "../src/rules/roomLogic.js";
import { calculateExp } from "../src/exp.js";
import type { RulePlayer } from "../src/types.js";

function player(over: Partial<RulePlayer> = {}): RulePlayer {
  return {
    id: "p1",
    charId: "scout",
    x: 4.5,
    z: 4.5,
    might: 3,
    wits: 6,
    keys: [],
    grappleActiveUntil: 0,
    downed: false,
    ...over,
  };
}

function ctx(over: Partial<RoomLogicCtx> = {}): RoomLogicCtx {
  return {
    params: {},
    tick: 100,
    dt: 1 / 20,
    elapsedSeconds: 5,
    cleared: false,
    playersInRoom: [player()],
    platePressCount: () => 0,
    mobsAlive: 0,
    mobsSpawned: false,
    events: [],
    state: {},
    holdingNear: () => false,
    ...over,
  };
}

describe("plates_and_gate", () => {
  const mod = ROOM_LOGIC.get("plates_and_gate")!;
  const params = { plateCells: [[4, 3], [4, 5]], requiredSimultaneous: 2, targetFace: "E" };

  it("opens the target door when both plates are pressed", () => {
    const c = ctx({ params, platePressCount: () => 2 });
    const r = mod.tick(c);
    expect(r.effects).toContainEqual({ type: "openDoorFace", face: "E" });
    expect(c.state.opened).toBe(true);
  });

  it("does nothing at 1/2 plates and never re-fires once opened", () => {
    const c = ctx({ params, platePressCount: () => 1 });
    expect(mod.tick(c).effects).toHaveLength(0);
    const opened = ctx({ params, platePressCount: () => 2, state: { opened: true } });
    expect(mod.tick(opened).effects).toHaveLength(0);
  });
});

describe("levers_sequence", () => {
  const mod = ROOM_LOGIC.get("levers_sequence")!;
  const params = { order: ["lever_b", "lever_a", "lever_c"] };

  it("clears after the full correct sequence", () => {
    const state: Record<string, unknown> = {};
    const pulls = ["lever_b", "lever_a", "lever_c"];
    let cleared = false;
    for (const leverId of pulls) {
      const r = mod.tick(
        ctx({ params, state, events: [{ type: "leverPull", leverId, playerId: "p1" }] }),
      );
      cleared = r.effects.some((e) => e.type === "clearObjective");
    }
    expect(cleared).toBe(true);
  });

  it("a wrong pull resets progress", () => {
    const state: Record<string, unknown> = {};
    mod.tick(ctx({ params, state, events: [{ type: "leverPull", leverId: "lever_b", playerId: "p1" }] }));
    expect(state.progress).toBe(1);
    mod.tick(ctx({ params, state, events: [{ type: "leverPull", leverId: "lever_c", playerId: "p1" }] }));
    expect(state.progress).toBe(0);
  });
});

describe("spikes_pattern", () => {
  const mod = ROOM_LOGIC.get("spikes_pattern")!;
  const params = {
    period: 2.4,
    rows: [{ z: 4, phase: 0 }],
    activeFraction: 0.5,
    damage: 10,
  };

  it("damages a player standing on an active row", () => {
    const c = ctx({
      params,
      elapsedSeconds: 0.1, // phase 0 ⇒ active at start of period
      playersInRoom: [player({ x: 4.5, z: 4.5 })],
    });
    const r = mod.tick(c);
    expect(r.effects).toContainEqual(
      expect.objectContaining({ type: "damagePlayer", amount: 10 }),
    );
  });

  it("spares players when the row is retracted", () => {
    const c = ctx({
      params,
      elapsedSeconds: 1.3, // t/period ≈ 0.54 > activeFraction
      playersInRoom: [player({ x: 4.5, z: 4.5 })],
    });
    expect(mod.tick(c).effects).toHaveLength(0);
  });

  it("throttles repeat damage on the same player", () => {
    const state: Record<string, unknown> = {};
    const mk = (tick: number) =>
      ctx({ params, state, tick, elapsedSeconds: 0.1, playersInRoom: [player({ z: 4.5 })] });
    expect(mod.tick(mk(100)).effects).toHaveLength(1);
    expect(mod.tick(mk(105)).effects).toHaveLength(0); // within throttle window
    expect(mod.tick(mk(120)).effects).toHaveLength(1);
  });

  it("visual helper agrees with the damage window", () => {
    expect(spikeRowActive(0.1, 2.4, 0, 0.5)).toBe(true);
    expect(spikeRowActive(1.3, 2.4, 0, 0.5)).toBe(false);
  });
});

describe("gas_room", () => {
  const mod = ROOM_LOGIC.get("gas_room")!;
  const params = { graceSeconds: 10, drainPerSecond: 3, channelSeconds: 3, instantWits: 7 };

  it("does not drain during grace", () => {
    const r = mod.tick(ctx({ params, elapsedSeconds: 5, tick: 100 }));
    expect(r.effects.filter((e) => e.type === "damagePlayer")).toHaveLength(0);
  });

  it("drains after grace", () => {
    const r = mod.tick(ctx({ params, elapsedSeconds: 15, tick: 100 }));
    expect(r.effects.filter((e) => e.type === "damagePlayer")).toHaveLength(1);
  });

  it("high-wits character vents instantly", () => {
    const tinker = player({ charId: "tinker", wits: 8 });
    const r = mod.tick(
      ctx({ params, playersInRoom: [tinker], holdingNear: () => true }),
    );
    expect(r.effects).toContainEqual({ type: "clearObjective" });
  });

  it("low-wits character must hold the full channel", () => {
    const state: Record<string, unknown> = {};
    const brute = player({ charId: "brute", wits: 3 });
    // 3s at 20Hz = 60 ticks of holding
    let cleared = false;
    for (let i = 0; i < 61 && !cleared; i++) {
      const r = mod.tick(
        ctx({ params, state, tick: 100 + i, playersInRoom: [brute], holdingNear: () => true }),
      );
      cleared = r.effects.some((e) => e.type === "clearObjective");
    }
    expect(cleared).toBe(true);
    // and letting go resets
    const state2: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      mod.tick(ctx({ params, state: state2, tick: 100 + i, playersInRoom: [brute], holdingNear: () => true }));
    }
    mod.tick(ctx({ params, state: state2, tick: 131, playersInRoom: [brute], holdingNear: () => false }));
    const after = mod.tick(
      ctx({ params, state: state2, tick: 132, playersInRoom: [brute], holdingNear: () => true }),
    );
    expect(after.effects.some((e) => e.type === "clearObjective")).toBe(false);
  });
});

describe("combat_clear / vault_bridge / exit_terminal", () => {
  it("combat room clears only after spawned mobs all die", () => {
    const mod = ROOM_LOGIC.get("combat_clear")!;
    expect(mod.tick(ctx({ mobsAlive: 2, mobsSpawned: true })).effects).toHaveLength(0);
    expect(mod.tick(ctx({ mobsAlive: 0, mobsSpawned: false })).effects).toHaveLength(0);
    expect(
      mod.tick(ctx({ mobsAlive: 0, mobsSpawned: true })).effects,
    ).toContainEqual({ type: "clearObjective" });
  });

  it("vault bridge latches once and extends the bridge", () => {
    const mod = ROOM_LOGIC.get("vault_bridge")!;
    const params = { bridgeCells: [[4, 3]], plateCells: [[4, 1]], latching: true };
    const state: Record<string, unknown> = {};
    const r = mod.tick(ctx({ params, state, platePressCount: () => 1 }));
    expect(r.effects).toContainEqual({ type: "setWalkable", cells: ["4,3"], on: true });
    expect(state.latched).toBe(true);
  });

  it("exit terminal wakes guards on first touch and clears after the channel", () => {
    const mod = ROOM_LOGIC.get("exit_terminal")!;
    const params = { channelSeconds: 5 };
    const state: Record<string, unknown> = {};
    const first = mod.tick(
      ctx({ params, state, tick: 0, holdingNear: () => true }),
    );
    expect(first.effects).toContainEqual({ type: "spawnTriggeredMobs" });
    let cleared = false;
    for (let i = 1; i <= 101 && !cleared; i++) {
      const r = mod.tick(ctx({ params, state, tick: i, holdingNear: () => true }));
      cleared = r.effects.some((e) => e.type === "clearObjective");
    }
    expect(cleared).toBe(true);
  });
});

describe("EXP calculation", () => {
  it("pays out a successful run with the alive multiplier", () => {
    const exp = calculateExp({
      roomsVisited: 10,
      objectivesCleared: 3,
      mobKills: 5,
      deaths: 0,
      reachedExit: true,
      hazardRoomsClearedNoDeath: 2,
      finishedAlive: true,
    });
    // (100 + 75 + 75 + 20 + 100) * 1.2 = 444
    expect(exp).toBe(444);
  });

  it("banks 60% on failure — deaths still pay", () => {
    const exp = calculateExp({
      roomsVisited: 5,
      objectivesCleared: 1,
      mobKills: 2,
      deaths: 3,
      reachedExit: false,
      hazardRoomsClearedNoDeath: 0,
      finishedAlive: false,
    });
    // (50 + 25 + 30) * 0.6 = 63
    expect(exp).toBe(63);
  });
});
