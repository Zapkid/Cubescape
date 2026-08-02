import { MOB_DEFS, MOB_RADIUS, type MobKind } from "../constants.js";
import type { Effect } from "./effects.js";
import { resolveMove } from "./movement.js";

export type MobAiState = "idle" | "seek" | "windup" | "cooldown";

export interface MobSim {
  id: string;
  kind: MobKind;
  x: number;
  z: number;
  hp: number;
  ai: MobAiState;
  /** tick when current ai state ends (windup -> strike, cooldown -> seek) */
  stateUntil: number;
  targetId: string;
  slowMult: number;
  slowUntil: number;
  staggerUntil: number;
}

export interface MobTargetView {
  id: string;
  x: number;
  z: number;
  downed: boolean;
  /** deployed tinker turrets register as high-priority targets */
  isTurretDecoy: boolean;
}

/**
 * One AI step for one mob. Pure: returns the updated mob + effects.
 * Deterministic given identical inputs (no RNG needed for MVP AI).
 */
export function stepMob(
  mob: MobSim,
  targets: readonly MobTargetView[],
  solid: (tx: number, tz: number) => boolean,
  tick: number,
  dt: number,
): { mob: MobSim; effects: Effect[] } {
  const def = MOB_DEFS[mob.kind];
  const effects: Effect[] = [];
  const m: MobSim = { ...mob };

  if (m.hp <= 0) return { mob: m, effects };
  if (m.staggerUntil > tick) return { mob: m, effects };

  // pick target: prefer turret decoys, else nearest non-downed player
  const viable = targets.filter((t) => !t.downed);
  const decoys = viable.filter((t) => t.isTurretDecoy);
  const pool = decoys.length > 0 ? decoys : viable;
  let target: MobTargetView | undefined;
  let bestD = Infinity;
  for (const t of pool) {
    const d = Math.hypot(t.x - m.x, t.z - m.z);
    if (d < bestD) {
      bestD = d;
      target = t;
    }
  }

  if (!target) {
    m.ai = "idle";
    return { mob: m, effects };
  }
  m.targetId = target.id;

  switch (m.ai) {
    case "idle":
      m.ai = "seek";
      break;
    case "seek": {
      if (bestD <= def.attackRange) {
        m.ai = "windup";
        m.stateUntil = tick + Math.round(def.windup * (1 / dt));
        break;
      }
      if (def.speed > 0) {
        const slow = m.slowUntil > tick ? m.slowMult : 1;
        const spd = def.speed * slow;
        const dx = ((target.x - m.x) / bestD) * spd * dt;
        const dz = ((target.z - m.z) / bestD) * spd * dt;
        const moved = resolveMove(m.x, m.z, dx, dz, MOB_RADIUS, solid);
        m.x = moved.x;
        m.z = moved.z;
      }
      break;
    }
    case "windup": {
      if (tick >= m.stateUntil) {
        // strike lands if target still in generous range
        if (bestD <= def.attackRange + 0.4 && !target.isTurretDecoy) {
          effects.push({
            type: "damagePlayer",
            playerId: target.id,
            amount: def.damage,
            cause: mob.kind,
          });
        } else if (bestD <= def.attackRange + 0.4 && target.isTurretDecoy) {
          effects.push({
            type: "damageMob", // decoy turrets are tracked as friendly mobs server-side
            mobId: target.id,
            amount: def.damage,
          });
        }
        m.ai = "cooldown";
        m.stateUntil = tick + Math.round(def.attackCooldown * (1 / dt));
      }
      break;
    }
    case "cooldown":
      if (tick >= m.stateUntil) m.ai = "seek";
      break;
  }

  return { mob: m, effects };
}
