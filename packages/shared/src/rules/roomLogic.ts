import type { Face, RulePlayer } from "../types.js";
import type { Effect } from "./effects.js";

export type RoomEvent = { type: "leverPull"; leverId: string; playerId: string };

export interface RoomLogicCtx {
  params: Record<string, unknown>;
  tick: number;
  dt: number;
  /** seconds since the room was first entered by any player */
  elapsedSeconds: number;
  cleared: boolean;
  playersInRoom: readonly RulePlayer[];
  /** active presses on these plate cells: players standing + hold-fast tokens */
  platePressCount(cells: readonly (readonly [number, number])[]): number;
  mobsAlive: number;
  mobsSpawned: boolean;
  events: readonly RoomEvent[];
  /** logic-owned scratch, persisted per room by the server */
  state: Record<string, unknown>;
  /** is the player currently holding interact within range of this cell */
  holdingNear(
    playerId: string,
    cell: readonly [number, number],
    range: number,
  ): boolean;
}

export interface RoomLogicResult {
  effects: Effect[];
}

export interface RoomLogicModule {
  id: string;
  tick(ctx: RoomLogicCtx): RoomLogicResult;
}

// ---------- param helpers ----------
function num(p: Record<string, unknown>, key: string, dflt: number): number {
  const v = p[key];
  return typeof v === "number" ? v : dflt;
}
function cells(
  p: Record<string, unknown>,
  key: string,
): readonly (readonly [number, number])[] {
  const v = p[key];
  if (!Array.isArray(v)) return [];
  return v.filter(
    (c): c is [number, number] =>
      Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number",
  );
}
function strs(p: Record<string, unknown>, key: string): readonly string[] {
  const v = p[key];
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

// ---------- modules ----------

/** Twin plates: N simultaneous presses open the target face door (latches). */
const platesAndGate: RoomLogicModule = {
  id: "plates_and_gate",
  tick(ctx) {
    const effects: Effect[] = [];
    if (ctx.state.opened === true) return { effects };
    const required = num(ctx.params, "requiredSimultaneous", 2);
    const pressed = ctx.platePressCount(cells(ctx.params, "plateCells"));
    if (pressed >= required) {
      ctx.state.opened = true;
      const face = (ctx.params.targetFace ?? "E") as Face;
      effects.push({ type: "openDoorFace", face });
      effects.push({ type: "clearObjective" });
      effects.push({ type: "message", text: "Plates engage — the sealed door grinds open." });
    }
    return { effects };
  },
};

/** Pull levers in the lamp-numbered order; a wrong pull resets progress. */
const leversSequence: RoomLogicModule = {
  id: "levers_sequence",
  tick(ctx) {
    const effects: Effect[] = [];
    if (ctx.cleared) return { effects };
    const order = strs(ctx.params, "order");
    let progress = typeof ctx.state.progress === "number" ? ctx.state.progress : 0;
    for (const ev of ctx.events) {
      if (ev.type !== "leverPull") continue;
      if (ev.leverId === order[progress]) {
        progress++;
        if (progress >= order.length) {
          effects.push({ type: "clearObjective" });
          effects.push({ type: "message", text: "Sequence accepted." });
        } else {
          effects.push({ type: "message", text: `Lever locks in (${progress}/${order.length}).` });
        }
      } else {
        progress = 0;
        effects.push({ type: "message", text: "Wrong lever — the mechanism resets." });
      }
    }
    ctx.state.progress = progress;
    return { effects };
  },
};

/** Rows of spikes pulse on a timed pattern; standing on an active row hurts. */
const spikesPattern: RoomLogicModule = {
  id: "spikes_pattern",
  tick(ctx) {
    const effects: Effect[] = [];
    const period = num(ctx.params, "period", 2.4);
    const activeFraction = num(ctx.params, "activeFraction", 0.45);
    const damage = num(ctx.params, "damage", 10);
    const rows = Array.isArray(ctx.params.rows)
      ? (ctx.params.rows as { z: number; phase: number }[])
      : [];
    const lastHit = (ctx.state.lastHit ?? {}) as Record<string, number>;
    for (const row of rows) {
      const t = (ctx.elapsedSeconds / period + row.phase) % 1;
      if (t >= activeFraction) continue; // row currently retracted
      for (const p of ctx.playersInRoom) {
        if (p.downed) continue;
        if (Math.floor(p.z) !== row.z) continue;
        if (p.x < 1 || p.x >= 8) continue; // safe margins match template art
        const last = lastHit[p.id] ?? -999;
        if (ctx.tick - last < 12) continue; // 0.6s per-player damage throttle
        lastHit[p.id] = ctx.tick;
        effects.push({ type: "damagePlayer", playerId: p.id, amount: damage, cause: "spikes" });
      }
    }
    ctx.state.lastHit = lastHit;
    return { effects };
  },
};

/** Is a spike row currently up? Exported for the renderer (visual truth = logic truth). */
export function spikeRowActive(
  elapsedSeconds: number,
  period: number,
  phase: number,
  activeFraction: number,
): boolean {
  const t = (elapsedSeconds / period + phase) % 1;
  return t < activeFraction;
}

/** Gas drains HP after a grace period until someone vents the room. */
const gasRoom: RoomLogicModule = {
  id: "gas_room",
  tick(ctx) {
    const effects: Effect[] = [];
    if (ctx.cleared) return { effects };
    const grace = num(ctx.params, "graceSeconds", 10);
    const drain = num(ctx.params, "drainPerSecond", 3);
    const channelSeconds = num(ctx.params, "channelSeconds", 3);
    const instantWits = num(ctx.params, "instantWits", 7);
    const ventCell: readonly [number, number] = [4, 4];

    // channel progress
    const holdTicks = (ctx.state.holdTicks ?? {}) as Record<string, number>;
    for (const p of ctx.playersInRoom) {
      if (p.downed) continue;
      if (ctx.holdingNear(p.id, ventCell, 1.8)) {
        if (p.wits >= instantWits) {
          effects.push({ type: "clearObjective" });
          effects.push({ type: "message", text: "Vent rerouted instantly — clever." });
          return { effects };
        }
        holdTicks[p.id] = (holdTicks[p.id] ?? 0) + 1;
        if ((holdTicks[p.id] ?? 0) * ctx.dt >= channelSeconds) {
          effects.push({ type: "clearObjective" });
          effects.push({ type: "message", text: "The vents hiss shut. Air clears." });
          return { effects };
        }
      } else {
        holdTicks[p.id] = 0;
      }
    }
    ctx.state.holdTicks = holdTicks;

    // drain
    if (ctx.elapsedSeconds > grace) {
      // throttle to ~2 damage events per second
      if (ctx.tick % 10 === 0) {
        for (const p of ctx.playersInRoom) {
          if (p.downed) continue;
          effects.push({
            type: "damagePlayer",
            playerId: p.id,
            amount: drain / 2,
            cause: "gas",
          });
        }
      }
    }
    return { effects };
  },
};

/** Cleared when all mobs are dead (after they've spawned). */
const combatClear: RoomLogicModule = {
  id: "combat_clear",
  tick(ctx) {
    const effects: Effect[] = [];
    if (!ctx.cleared && ctx.mobsSpawned && ctx.mobsAlive === 0) {
      effects.push({ type: "clearObjective" });
      effects.push({ type: "message", text: "Room secured." });
    }
    return { effects };
  },
};

/** Heal aura around the beacon. */
const sanctuaryHeal: RoomLogicModule = {
  id: "sanctuary_heal",
  tick(ctx) {
    const effects: Effect[] = [];
    const rate = num(ctx.params, "healPerSecond", 5);
    const radius = num(ctx.params, "radius", 3);
    if (ctx.tick % 10 !== 0) return { effects }; // heal in 0.5s pulses
    for (const p of ctx.playersInRoom) {
      const d = Math.hypot(p.x - 4.5, p.z - 4.5);
      if (d <= radius) {
        effects.push({ type: "healPlayer", playerId: p.id, amount: rate / 2 });
      }
    }
    return { effects };
  },
};

/** Latching plate extends the bridge over the moat. */
const vaultBridge: RoomLogicModule = {
  id: "vault_bridge",
  tick(ctx) {
    const effects: Effect[] = [];
    if (ctx.state.latched === true) return { effects };
    const pressed = ctx.platePressCount(cells(ctx.params, "plateCells"));
    if (pressed >= 1) {
      ctx.state.latched = true;
      const bridge = cells(ctx.params, "bridgeCells").map((c) => `${c[0]},${c[1]}`);
      effects.push({ type: "setWalkable", cells: bridge, on: true });
      effects.push({ type: "clearObjective" });
      effects.push({ type: "message", text: "The bridge slides out across the moat." });
    }
    return { effects };
  },
};

/** Final objective: channel the exit terminal for N seconds; guards wake on first touch. */
const exitTerminal: RoomLogicModule = {
  id: "exit_terminal",
  tick(ctx) {
    const effects: Effect[] = [];
    if (ctx.cleared) return { effects };
    const channelSeconds = num(ctx.params, "channelSeconds", 5);
    const cell: readonly [number, number] = [4, 4];
    const holdTicks = (ctx.state.holdTicks ?? {}) as Record<string, number>;
    for (const p of ctx.playersInRoom) {
      if (p.downed) continue;
      if (ctx.holdingNear(p.id, cell, 1.9)) {
        if (ctx.state.guardsWoken !== true) {
          ctx.state.guardsWoken = true;
          effects.push({ type: "spawnTriggeredMobs" });
          effects.push({ type: "message", text: "The terminal screams. Something answers." });
        }
        holdTicks[p.id] = (holdTicks[p.id] ?? 0) + 1;
        if ((holdTicks[p.id] ?? 0) * ctx.dt >= channelSeconds) {
          effects.push({ type: "clearObjective" });
          return { effects };
        }
      } else {
        holdTicks[p.id] = 0;
      }
    }
    ctx.state.holdTicks = holdTicks;
    return { effects };
  },
};

export const ROOM_LOGIC: ReadonlyMap<string, RoomLogicModule> = new Map(
  [
    platesAndGate,
    leversSequence,
    spikesPattern,
    gasRoom,
    combatClear,
    sanctuaryHeal,
    vaultBridge,
    exitTerminal,
  ].map((m) => [m.id, m]),
);
