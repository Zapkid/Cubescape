import { describe, expect, it } from "vitest";
import { MOB_DEFS } from "../src/constants.js";
import { stepMob, type MobSim, type MobTargetView } from "../src/rules/mobs.js";

const noWalls = () => false;

function slime(over: Partial<MobSim> = {}): MobSim {
  return {
    id: "m1",
    kind: "slime",
    x: 2,
    z: 2,
    hp: 30,
    ai: "idle",
    stateUntil: 0,
    targetId: "",
    slowMult: 1,
    slowUntil: 0,
    staggerUntil: 0,
    ...over,
  };
}

const target = (over: Partial<MobTargetView> = {}): MobTargetView => ({
  id: "p1",
  x: 6,
  z: 2,
  downed: false,
  isTurretDecoy: false,
  ...over,
});

describe("mob AI state machine", () => {
  it("idle → seek when a target exists, and moves toward it", () => {
    let m = slime();
    const r1 = stepMob(m, [target()], noWalls, 0, 1 / 20);
    expect(r1.mob.ai).toBe("seek");
    m = r1.mob;
    const r2 = stepMob(m, [target()], noWalls, 1, 1 / 20);
    expect(r2.mob.x).toBeGreaterThan(m.x); // walked toward +x target
  });

  it("winds up in range, then strikes for damage", () => {
    let m = slime({ ai: "seek", x: 5.5, z: 2 });
    const t = target();
    const r = stepMob(m, [t], noWalls, 10, 1 / 20);
    expect(r.mob.ai).toBe("windup");
    m = r.mob;
    const strike = stepMob(m, [t], noWalls, m.stateUntil, 1 / 20);
    expect(strike.effects).toContainEqual(
      expect.objectContaining({
        type: "damagePlayer",
        playerId: "p1",
        amount: MOB_DEFS.slime.damage,
      }),
    );
    expect(strike.mob.ai).toBe("cooldown");
  });

  it("whiffs when the target escapes during windup", () => {
    let m = slime({ ai: "seek", x: 5.5, z: 2 });
    const r = stepMob(m, [target()], noWalls, 10, 1 / 20);
    m = r.mob;
    const escaped = target({ x: 1, z: 8 });
    const strike = stepMob(m, [escaped], noWalls, m.stateUntil, 1 / 20);
    expect(strike.effects).toHaveLength(0);
  });

  it("ignores downed players", () => {
    const m = slime({ ai: "seek" });
    const r = stepMob(m, [target({ downed: true })], noWalls, 5, 1 / 20);
    expect(r.mob.ai).toBe("idle");
  });

  it("prefers turret decoys over players", () => {
    const m = slime({ ai: "seek", x: 4, z: 2 });
    const player = target({ id: "p1", x: 4.6, z: 2 });
    const decoy = target({ id: "turret9", x: 8, z: 8, isTurretDecoy: true });
    const r = stepMob(m, [player, decoy], noWalls, 5, 1 / 20);
    expect(r.mob.targetId).toBe("turret9");
  });

  it("stagger freezes the mob", () => {
    const m = slime({ ai: "seek", staggerUntil: 100 });
    const r = stepMob(m, [target()], noWalls, 50, 1 / 20);
    expect(r.mob.x).toBe(m.x);
    expect(r.mob.z).toBe(m.z);
  });

  it("slow reduces seek speed", () => {
    const fast = stepMob(slime({ ai: "seek" }), [target()], noWalls, 5, 1 / 20);
    const slowed = stepMob(
      slime({ ai: "seek", slowMult: 0.5, slowUntil: 100 }),
      [target()],
      noWalls,
      5,
      1 / 20,
    );
    const fastDist = fast.mob.x - 2;
    const slowDist = slowed.mob.x - 2;
    expect(slowDist).toBeCloseTo(fastDist * 0.5, 5);
  });

  it("turrets never move but strike at range", () => {
    let m = slime({ kind: "turret", ai: "seek", x: 4, z: 4 });
    const t = target({ x: 8, z: 4 }); // distance 4 < turret range 6.5
    const r = stepMob(m, [t], noWalls, 10, 1 / 20);
    expect(r.mob.x).toBe(4);
    expect(r.mob.ai).toBe("windup");
    m = r.mob;
    const strike = stepMob(m, [t], noWalls, m.stateUntil, 1 / 20);
    expect(strike.effects).toContainEqual(
      expect.objectContaining({ type: "damagePlayer", amount: MOB_DEFS.turret.damage }),
    );
  });
});
