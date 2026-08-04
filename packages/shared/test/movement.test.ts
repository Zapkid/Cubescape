import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  doorSlotToSpawnPosition,
  isSolidCell,
  stepPlayer,
  type MoveContext,
  type SimPlayerState,
} from "../src/rules/movement.js";
import { PLAYER_BASE_SPEED, PLAYER_RADIUS, ROOM_D, ROOM_W, GRAPPLE_SPEED_MULT } from "../src/constants.js";
import { getTemplate, parseTiles } from "../src/templates/index.js";
import type { Face } from "../src/types.js";

function ctxFor(templateId: string, overrides: Partial<MoveContext> = {}): MoveContext {
  return {
    tiles: parseTiles(getTemplate(templateId)),
    solidProps: new Set(),
    walkableOverrides: new Set(),
    openDoors: {},
    ignorePits: false,
    ...overrides,
  };
}

const start = (): SimPlayerState => ({ x: 1.5, y: 0, z: 1.5, vy: 0 });

describe("grid collision", () => {
  it("treats out-of-bounds as solid walls", () => {
    const ctx = ctxFor("connector_basic");
    expect(isSolidCell(ctx, -1, 0)).toBe(true);
    expect(isSolidCell(ctx, 9, 4)).toBe(true);
    expect(isSolidCell(ctx, 0, 0)).toBe(false);
  });

  it("blocks pits unless grappling", () => {
    const ctx = ctxFor("puzzle_plates");
    expect(isSolidCell(ctx, 4, 4)).toBe(true); // pit
    const grappling = ctxFor("puzzle_plates", { ignorePits: true });
    expect(isSolidCell(grappling, 4, 4)).toBe(false);
  });

  it("honors walkable overrides (extended bridge)", () => {
    const ctx = ctxFor("vault_key", { walkableOverrides: new Set(["4,3"]) });
    expect(isSolidCell(ctx, 4, 3)).toBe(false);
    expect(isSolidCell(ctx, 3, 3)).toBe(true); // rest of the moat still blocks
  });

  it("cannot walk through a pit row", () => {
    const ctx = ctxFor("puzzle_plates");
    let s: SimPlayerState = { x: 4.5, y: 0, z: 3.4, vy: 0 };
    for (let i = 0; i < 120; i++) {
      s = stepPlayer(s, { seq: i, mx: 0, mz: 1, yaw: 0, jump: false }, 1 / 60, ctx, 1).state;
    }
    expect(s.z).toBeLessThan(4 + PLAYER_RADIUS); // stopped at the pit edge
  });

  it("crosses the same pit row while grappling", () => {
    const ctx = ctxFor("puzzle_plates", { ignorePits: true });
    let s: SimPlayerState = { x: 4.5, y: 0, z: 3.4, vy: 0 };
    for (let i = 0; i < 120; i++) {
      s = stepPlayer(s, { seq: i, mx: 0, mz: 1, yaw: 0, jump: false }, 1 / 60, ctx, 1).state;
    }
    expect(s.z).toBeGreaterThan(5.5);
  });
});

describe("speed clamp property (anti-speed-hack)", () => {
  it("no input sequence moves a player faster than maxSpeed × dt", () => {
    const ctx = ctxFor("connector_basic");
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            mx: fc.double({ min: -50, max: 50, noNaN: true }),
            mz: fc.double({ min: -50, max: 50, noNaN: true }),
            jump: fc.boolean(),
          }),
          { minLength: 1, maxLength: 200 },
        ),
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),
        (inputs, dt) => {
          let s = start();
          const maxStep = PLAYER_BASE_SPEED * 1.25 * GRAPPLE_SPEED_MULT * dt + 1e-9;
          for (let i = 0; i < inputs.length; i++) {
            const inp = inputs[i]!;
            const next = stepPlayer(
              s,
              { seq: i, mx: inp.mx, mz: inp.mz, yaw: 0, jump: inp.jump },
              dt,
              ctx,
              1.25, // fastest character
            ).state;
            const moved = Math.hypot(next.x - s.x, next.z - s.z);
            expect(moved).toBeLessThanOrEqual(maxStep);
            s = next;
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("player always stays inside the room bounds", () => {
    const ctx = ctxFor("hazard_spikes");
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            mx: fc.double({ min: -2, max: 2, noNaN: true }),
            mz: fc.double({ min: -2, max: 2, noNaN: true }),
          }),
          { minLength: 1, maxLength: 300 },
        ),
        (inputs) => {
          let s = start();
          inputs.forEach((inp, i) => {
            s = stepPlayer(s, { seq: i, mx: inp.mx, mz: inp.mz, yaw: 0, jump: false }, 1 / 60, ctx, 1).state;
          });
          expect(s.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
          expect(s.x).toBeLessThanOrEqual(ROOM_W - PLAYER_RADIUS + 1e-9);
          expect(s.z).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
          expect(s.z).toBeLessThanOrEqual(ROOM_D - PLAYER_RADIUS + 1e-9);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("door transitions", () => {
  it("detects pushing through an open north door", () => {
    const ctx = ctxFor("connector_basic", { openDoors: { N: [4, 0] } });
    let s: SimPlayerState = { x: 4.5, y: 0, z: 1.2, vy: 0 };
    let exit: Face | undefined;
    for (let i = 0; i < 200 && !exit; i++) {
      const r = stepPlayer(s, { seq: i, mx: 0, mz: -1, yaw: 0, jump: false }, 1 / 60, ctx, 1);
      s = r.state;
      exit = r.exitFace;
    }
    expect(exit).toBe("N");
  });

  it("does NOT exit through a closed door", () => {
    const ctx = ctxFor("connector_basic");
    let s: SimPlayerState = { x: 4.5, y: 0, z: 1.2, vy: 0 };
    for (let i = 0; i < 200; i++) {
      const r = stepPlayer(s, { seq: i, mx: 0, mz: -1, yaw: 0, jump: false }, 1 / 60, ctx, 1);
      s = r.state;
      expect(r.exitFace).toBeUndefined();
    }
  });

  it("does not exit when pushing at a wall segment away from the open door", () => {
    const ctx = ctxFor("connector_basic", { openDoors: { N: [4, 0] } });
    let s: SimPlayerState = { x: 1.5, y: 0, z: 1.2, vy: 0 };
    for (let i = 0; i < 100; i++) {
      const r = stepPlayer(s, { seq: i, mx: 0, mz: -1, yaw: 0, jump: false }, 1 / 60, ctx, 1);
      s = r.state;
      expect(r.exitFace).toBeUndefined();
    }
  });
});

describe("acceleration model (natural, non-linear movement)", () => {
  const dt = 1 / 60;
  const step = (s: SimPlayerState, mx: number, ctx: MoveContext) =>
    stepPlayer(s, { seq: 0, mx, mz: 0, yaw: 0, jump: false }, dt, ctx, 1).state;

  it("ramps up from rest instead of snapping to full speed", () => {
    const ctx = ctxFor("connector_basic");
    const full = PLAYER_BASE_SPEED * dt;
    let s: SimPlayerState = { x: 1.5, y: 0, z: 1.5, vy: 0 };
    const first = step(s, 1, ctx);
    expect(first.x - 1.5).toBeGreaterThan(0);
    expect(first.x - 1.5).toBeLessThan(full * 0.5); // still accelerating
    // reach steady state
    for (let i = 0; i < 60; i++) s = step(s, 1, ctx);
    const before = s.x;
    s = step(s, 1, ctx);
    expect(s.x - before).toBeGreaterThan(full * 0.95); // at full speed
  });

  it("glides to a stop when input releases", () => {
    const ctx = ctxFor("connector_basic");
    let s: SimPlayerState = { x: 1.5, y: 0, z: 1.5, vy: 0 };
    for (let i = 0; i < 40; i++) s = step(s, 1, ctx);
    const releasePoint = s.x;
    s = step(s, 0, ctx);
    expect(s.x).toBeGreaterThan(releasePoint); // carries momentum
    for (let i = 0; i < 30; i++) s = step(s, 0, ctx);
    const settled = s.x;
    s = step(s, 0, ctx);
    expect(s.x - settled).toBeLessThan(0.002); // effectively stopped in 0.5s
  });

  it("zeroes velocity into a wall instead of storing it up", () => {
    const ctx = ctxFor("connector_basic");
    let s: SimPlayerState = { x: 8.0, y: 0, z: 1.5, vy: 0 };
    for (let i = 0; i < 60; i++) s = step(s, 1, ctx); // pinned against east wall
    expect(s.vx ?? 0).toBeCloseTo(0, 5);
  });
});

describe("collideCircleObstacles (crate physics)", () => {
  it("pushes the mover out and reports push force on the obstacle", async () => {
    const { collideCircleObstacles } = await import("../src/rules/movement.js");
    const r = collideCircleObstacles(4.3, 4.5, 0.32, [
      { id: "c1", x: 4.8, z: 4.5, radius: 0.4 },
    ]);
    // mover ejected to exactly touching distance
    expect(Math.hypot(r.x - 4.8, r.z - 4.5)).toBeCloseTo(0.72, 5);
    expect(r.pushes).toHaveLength(1);
    expect(r.pushes[0]!.id).toBe("c1");
    expect(r.pushes[0]!.dx).toBeGreaterThan(0); // crate shoved away (+x)
  });

  it("no contact, no push", async () => {
    const { collideCircleObstacles } = await import("../src/rules/movement.js");
    const r = collideCircleObstacles(2, 2, 0.32, [
      { id: "c1", x: 6, z: 6, radius: 0.4 },
    ]);
    expect(r.x).toBe(2);
    expect(r.pushes).toHaveLength(0);
  });

  it("dead-center overlap ejects deterministically", async () => {
    const { collideCircleObstacles } = await import("../src/rules/movement.js");
    const r = collideCircleObstacles(5, 5, 0.32, [
      { id: "c1", x: 5, z: 5, radius: 0.4 },
    ]);
    expect(r.x).toBeCloseTo(5.72, 5);
  });
});

describe("doorSlotToSpawnPosition", () => {
  const cases: [Face, readonly [number, number]][] = [
    ["N", [4, 0]],
    ["E", [8, 4]],
    ["S", [4, 8]],
    ["W", [0, 4]],
    ["U", [4, 4]],
    ["D", [6, 2]],
  ];
  it.each(cases)("face %s spawns inside the room facing inward", (face, cell) => {
    const { x, z, yaw } = doorSlotToSpawnPosition(face, cell);
    expect(x).toBeGreaterThan(PLAYER_RADIUS);
    expect(x).toBeLessThan(ROOM_W - PLAYER_RADIUS);
    expect(z).toBeGreaterThan(PLAYER_RADIUS);
    expect(z).toBeLessThan(ROOM_D - PLAYER_RADIUS);
    // walking forward from spawn must move AWAY from the entry wall
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    if (face === "N") expect(fz).toBeGreaterThan(0.9);
    if (face === "S") expect(fz).toBeLessThan(-0.9);
    if (face === "E") expect(fx).toBeLessThan(-0.9);
    if (face === "W") expect(fx).toBeGreaterThan(0.9);
  });
});
