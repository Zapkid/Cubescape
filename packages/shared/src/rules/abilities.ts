import {
  ABILITIES,
} from "../characters.js";
import {
  BYPASS_RANGE,
  DART_DAMAGE,
  DART_SLOW_DURATION,
  DART_SLOW_MULT,
  DEPLOY_TURRET_LIFETIME,
  FIELDKIT_DURATION,
  GRAPPLE_DURATION,
  HOLDFAST_DURATION,
  PUNCH_DAMAGE,
  PUNCH_RANGE,
  SWING_DAMAGE,
  SWING_RANGE,
  SWING_STAGGER,
  TICK_RATE,
} from "../constants.js";
import type { AbilityId, DoorInfo, RulePlayer } from "../types.js";
import type { Effect } from "./effects.js";

export interface MobView {
  id: string;
  x: number;
  z: number;
  hp: number;
}

export interface AbilityCtx {
  caster: RulePlayer;
  yaw: number;
  tick: number;
  /** cooldown expiry tick for this ability, 0 if ready */
  cooldownUntil: number;
  doors: readonly DoorInfo[];
  crackedCells: readonly (readonly [number, number])[];
  mobs: readonly MobView[];
  /** tinker bypass already used in this room */
  bypassUsedInRoom: boolean;
  /** a room exists below this one (for breach) */
  belowExists: boolean;
}

export interface AbilityResult {
  ok: boolean;
  reason: string;
  effects: Effect[];
  /** new cooldown expiry tick when ok */
  cooldownUntil: number;
}

const fail = (reason: string): AbilityResult => ({
  ok: false,
  reason,
  effects: [],
  cooldownUntil: 0,
});

function forward(yaw: number): { fx: number; fz: number } {
  return { fx: Math.sin(yaw), fz: Math.cos(yaw) };
}

function inCone(
  px: number,
  pz: number,
  yaw: number,
  tx: number,
  tz: number,
  range: number,
  halfAngleRad: number,
): boolean {
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist > range) return false;
  if (dist < 0.001) return true;
  const { fx, fz } = forward(yaw);
  const dot = (dx * fx + dz * fz) / dist;
  return dot >= Math.cos(halfAngleRad);
}

/** Pure ability executor: validates and returns effects. Server applies them. */
export function executeAbility(id: AbilityId, ctx: AbilityCtx): AbilityResult {
  if (ctx.caster.downed) return fail("downed");
  if (ctx.cooldownUntil > ctx.tick) return fail("on cooldown");
  const def = ABILITIES[id];
  const cdTicks = Math.round(def.cooldown * TICK_RATE);
  const done = (effects: Effect[]): AbilityResult => ({
    ok: true,
    reason: "",
    effects,
    cooldownUntil: ctx.tick + cdTicks,
  });
  const c = ctx.caster;

  switch (id) {
    case "breach": {
      if (!ctx.belowExists) return fail("nothing below to breach into");
      let best: readonly [number, number] | undefined;
      let bestD = def.range;
      for (const cell of ctx.crackedCells) {
        const d = Math.hypot(cell[0] + 0.5 - c.x, cell[1] + 0.5 - c.z);
        if (d <= bestD) {
          bestD = d;
          best = cell;
        }
      }
      if (!best) return fail("no cracked floor in range");
      return done([
        { type: "breachFloor", cell: best },
        { type: "message", text: "The floor gives way!" },
      ]);
    }
    case "holdfast":
      return done([
        {
          type: "placeHoldfast",
          x: c.x,
          z: c.z,
          untilTick: ctx.tick + Math.round(HOLDFAST_DURATION * TICK_RATE),
        },
      ]);
    case "swing": {
      const effects: Effect[] = [];
      for (const m of ctx.mobs) {
        if (m.hp <= 0) continue;
        if (inCone(c.x, c.z, ctx.yaw, m.x, m.z, SWING_RANGE, Math.PI * 0.6)) {
          effects.push({
            type: "damageMob",
            mobId: m.id,
            amount: SWING_DAMAGE,
            staggerSeconds: SWING_STAGGER,
          });
        }
      }
      return done(effects); // whiffing still costs the cooldown
    }
    case "grapple":
      return done([
        {
          type: "setGrapple",
          playerId: c.id,
          untilTick: ctx.tick + Math.round(GRAPPLE_DURATION * TICK_RATE),
        },
      ]);
    case "peek":
      return done([{ type: "revealAdjacent", byPlayerId: c.id }]);
    case "dart": {
      let best: MobView | undefined;
      let bestD = def.range;
      for (const m of ctx.mobs) {
        if (m.hp <= 0) continue;
        if (!inCone(c.x, c.z, ctx.yaw, m.x, m.z, def.range, Math.PI / 6)) continue;
        const d = Math.hypot(m.x - c.x, m.z - c.z);
        if (d <= bestD) {
          bestD = d;
          best = m;
        }
      }
      if (!best) return fail("no target in sights");
      return done([
        {
          type: "damageMob",
          mobId: best.id,
          amount: DART_DAMAGE,
          slowMult: DART_SLOW_MULT,
          slowSeconds: DART_SLOW_DURATION,
        },
      ]);
    }
    case "bypass": {
      if (ctx.bypassUsedInRoom) return fail("bypass already used in this room");
      let best: DoorInfo | undefined;
      let bestD = BYPASS_RANGE;
      for (const d of ctx.doors) {
        if (d.open) continue;
        if (
          d.gate.type !== "key" &&
          d.gate.type !== "stat" &&
          d.gate.type !== "plates"
        )
          continue;
        const dist = Math.hypot(d.cell[0] + 0.5 - c.x, d.cell[1] + 0.5 - c.z);
        if (dist <= bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!best) return fail("no bypassable door in range");
      return done([
        { type: "openDoorFace", face: best.face },
        { type: "message", text: "Lock hotwired." },
      ]);
    }
    case "fieldkit":
      return done([
        {
          type: "placeFieldkit",
          x: c.x,
          z: c.z,
          untilTick: ctx.tick + Math.round(FIELDKIT_DURATION * TICK_RATE),
        },
      ]);
    case "turret":
      return done([
        {
          type: "deployTurret",
          x: c.x,
          z: c.z,
          untilTick: ctx.tick + Math.round(DEPLOY_TURRET_LIFETIME * TICK_RATE),
        },
      ]);
    case "punch": {
      // single target: the NEAREST thing in the cone
      let best: MobView | undefined;
      let bestD = PUNCH_RANGE;
      for (const m of ctx.mobs) {
        if (m.hp <= 0) continue;
        if (!inCone(c.x, c.z, ctx.yaw, m.x, m.z, PUNCH_RANGE, Math.PI * 0.5)) continue;
        const d = Math.hypot(m.x - c.x, m.z - c.z);
        if (d <= bestD) {
          bestD = d;
          best = m;
        }
      }
      return done(
        best ? [{ type: "damageMob", mobId: best.id, amount: PUNCH_DAMAGE }] : [],
      );
    }
  }
}
