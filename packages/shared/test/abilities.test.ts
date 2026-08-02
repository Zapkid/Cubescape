import { describe, expect, it } from "vitest";
import { executeAbility, type AbilityCtx } from "../src/rules/abilities.js";
import type { RulePlayer } from "../src/types.js";

function caster(over: Partial<RulePlayer> = {}): RulePlayer {
  return {
    id: "c1",
    charId: "brute",
    x: 4.5,
    z: 4.5,
    might: 8,
    wits: 3,
    keys: [],
    grappleActiveUntil: 0,
    downed: false,
    ...over,
  };
}

function ctx(over: Partial<AbilityCtx> = {}): AbilityCtx {
  return {
    caster: caster(),
    yaw: 0,
    tick: 1000,
    cooldownUntil: 0,
    doors: [],
    crackedCells: [],
    mobs: [],
    bypassUsedInRoom: false,
    belowExists: true,
    ...over,
  };
}

describe("ability framework", () => {
  it("rejects while on cooldown", () => {
    const r = executeAbility("swing", ctx({ cooldownUntil: 2000 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("on cooldown");
  });

  it("rejects while downed", () => {
    const r = executeAbility("swing", ctx({ caster: caster({ downed: true }) }));
    expect(r.ok).toBe(false);
  });

  it("sets a cooldown on success", () => {
    const r = executeAbility("holdfast", ctx());
    expect(r.ok).toBe(true);
    expect(r.cooldownUntil).toBeGreaterThan(1000);
  });
});

describe("breach", () => {
  it("smashes the nearest cracked cell in range", () => {
    const r = executeAbility(
      "breach",
      ctx({ crackedCells: [[4, 5]], caster: caster({ x: 4.5, z: 4.6 }) }),
    );
    expect(r.ok).toBe(true);
    expect(r.effects).toContainEqual({ type: "breachFloor", cell: [4, 5] });
  });

  it("fails out of range", () => {
    const r = executeAbility(
      "breach",
      ctx({ crackedCells: [[0, 0]], caster: caster({ x: 8, z: 8 }) }),
    );
    expect(r.ok).toBe(false);
  });

  it("fails on the bottom layer", () => {
    const r = executeAbility(
      "breach",
      ctx({ crackedCells: [[4, 5]], belowExists: false }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("swing", () => {
  it("hits mobs in the front cone only", () => {
    const r = executeAbility(
      "swing",
      ctx({
        yaw: 0, // facing +z
        mobs: [
          { id: "front", x: 4.5, z: 5.8, hp: 30 },
          { id: "behind", x: 4.5, z: 3.0, hp: 30 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const hit = r.effects.filter((e) => e.type === "damageMob");
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ mobId: "front", staggerSeconds: 1 });
  });
});

describe("dart", () => {
  it("requires a target in the aim cone", () => {
    const miss = executeAbility("dart", ctx({ yaw: 0, mobs: [{ id: "m", x: 4.5, z: 1.0, hp: 30 }] }));
    expect(miss.ok).toBe(false); // target is behind
    const hit = executeAbility("dart", ctx({ yaw: 0, mobs: [{ id: "m", x: 4.5, z: 8.0, hp: 30 }] }));
    expect(hit.ok).toBe(true);
    expect(hit.effects[0]).toMatchObject({ type: "damageMob", slowMult: 0.6 });
  });

  it("ignores dead mobs", () => {
    const r = executeAbility("dart", ctx({ yaw: 0, mobs: [{ id: "m", x: 4.5, z: 8.0, hp: 0 }] }));
    expect(r.ok).toBe(false);
  });
});

describe("bypass", () => {
  const door = {
    face: "E" as const,
    gate: { type: "key", color: "ruby" } as const,
    open: false,
    cell: [8, 4] as [number, number],
  };
  it("opens a nearby gated door once per room", () => {
    const r = executeAbility("bypass", ctx({ caster: caster({ x: 7.8, z: 4.5 }), doors: [door] }));
    expect(r.ok).toBe(true);
    expect(r.effects).toContainEqual({ type: "openDoorFace", face: "E" });
    const again = executeAbility(
      "bypass",
      ctx({ caster: caster({ x: 7.8, z: 4.5 }), doors: [door], bypassUsedInRoom: true }),
    );
    expect(again.ok).toBe(false);
  });

  it("cannot bypass lift or objective doors", () => {
    const liftDoor = { ...door, gate: { type: "lift" } as const };
    const objDoor = { ...door, gate: { type: "objective" } as const };
    const r = executeAbility(
      "bypass",
      ctx({ caster: caster({ x: 7.8, z: 4.5 }), doors: [liftDoor, objDoor] }),
    );
    expect(r.ok).toBe(false);
  });

  it("fails when the door is out of range", () => {
    const r = executeAbility("bypass", ctx({ caster: caster({ x: 1, z: 1 }), doors: [door] }));
    expect(r.ok).toBe(false);
  });
});

describe("grapple / peek / deployables", () => {
  it("grapple flags the caster", () => {
    const r = executeAbility("grapple", ctx());
    expect(r.ok).toBe(true);
    expect(r.effects[0]).toMatchObject({ type: "setGrapple", playerId: "c1" });
  });

  it("peek reveals for the team", () => {
    const r = executeAbility("peek", ctx());
    expect(r.effects[0]).toMatchObject({ type: "revealAdjacent" });
  });

  it("fieldkit and turret deploy at the caster's feet", () => {
    const fk = executeAbility("fieldkit", ctx());
    expect(fk.effects[0]).toMatchObject({ type: "placeFieldkit", x: 4.5, z: 4.5 });
    const t = executeAbility("turret", ctx());
    expect(t.effects[0]).toMatchObject({ type: "deployTurret" });
  });
});
