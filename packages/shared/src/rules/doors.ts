import type { Gate, RulePlayer, SolverCaps } from "../types.js";

export interface GateCheckCtx {
  /** players within STAT_DOOR_RANGE of the door cell (alive, not downed) */
  playersNear: readonly RulePlayer[];
  /** the player attempting to open */
  interactor: RulePlayer;
  /** players standing on plates + active hold-fast tokens, room-wide */
  activePlateCount: number;
  /** objective flag of the room that owns this door */
  roomCleared: boolean;
  /** lift currently powered (plate held / field kit / hold fast) */
  liftPowered: boolean;
  /** current server tick (for grapple checks) */
  tick: number;
}

export interface GateCheckResult {
  ok: boolean;
  reason: string;
}

/** THE door rule. Server-only caller; pure and unit-testable. */
export function canOpenGate(gate: Gate, ctx: GateCheckCtx): GateCheckResult {
  switch (gate.type) {
    case "open":
    case "oneway":
      return { ok: true, reason: "" };
    case "key": {
      const holder = ctx.playersNear.find((p) => p.keys.includes(gate.color));
      return holder
        ? { ok: true, reason: "" }
        : { ok: false, reason: `needs ${gate.color} key` };
    }
    case "plates":
      return ctx.activePlateCount >= gate.count
        ? { ok: true, reason: "" }
        : {
            ok: false,
            reason: `needs ${gate.count} plate${gate.count > 1 ? "s" : ""} held (${ctx.activePlateCount}/${gate.count})`,
          };
    case "stat": {
      const sum = ctx.playersNear.reduce(
        (acc, p) => acc + (gate.stat === "might" ? p.might : p.wits),
        0,
      );
      return sum >= gate.threshold
        ? { ok: true, reason: "" }
        : {
            ok: false,
            reason: `needs ${gate.stat} ${gate.threshold} nearby (have ${sum})`,
          };
    }
    case "objective":
      return ctx.roomCleared
        ? { ok: true, reason: "" }
        : { ok: false, reason: "room objective incomplete" };
    case "lift": {
      if (ctx.liftPowered) return { ok: true, reason: "" };
      if (ctx.interactor.grappleActiveUntil > ctx.tick)
        return { ok: true, reason: "" };
      return { ok: false, reason: "lift unpowered — hold a plate, Field Kit, or Grapple" };
    }
  }
}

export interface SolverGateCtx {
  keysAvailable: ReadonlySet<string>;
  /** the room owning this door is reachable and its objective is completable */
  objectiveCompletable: boolean;
}

/** Solver-side passability: can a party with these caps EVER pass this gate? */
export function gatePassableForCaps(
  gate: Gate,
  caps: SolverCaps,
  ctx: SolverGateCtx,
): boolean {
  switch (gate.type) {
    case "open":
    case "oneway":
      return true;
    case "key":
      return ctx.keysAvailable.has(gate.color);
    case "plates":
      // one plate can always be covered by Hold Fast; player bodies cover the rest
      return caps.players + (caps.hasBrute ? 1 : 0) >= gate.count;
    case "stat": {
      const have = gate.stat === "might" ? caps.might : caps.wits;
      return have >= gate.threshold;
    }
    case "objective":
      return ctx.objectiveCompletable;
    case "lift":
      // every kit has a solo lift answer (grapple / field kit / hold fast),
      // and any 2 players can plate-and-ride
      return true;
  }
}
