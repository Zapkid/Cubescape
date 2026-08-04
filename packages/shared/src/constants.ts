/** Tuning constants. All gameplay feel lives here — tweak, don't scatter. */

export const TICK_RATE = 20; // server simulation Hz
export const TICK_DT = 1 / TICK_RATE;
export const CLIENT_SIM_RATE = 60; // client prediction fixed-step Hz
export const CLIENT_SIM_DT = 1 / CLIENT_SIM_RATE;
/** Max input steps a client may submit per second (anti-speedup budget). */
export const MAX_INPUT_STEPS_PER_SEC = 75;

export const CUBE_SIZE = 3;
export const ROOM_W = 9; // tiles, x axis
export const ROOM_D = 9; // tiles, z axis
export const ROOM_H = 5; // wall height in tiles (render only)
export const TILE_SIZE = 1; // meters per tile

export const PLAYER_RADIUS = 0.32;
export const PLAYER_BASE_SPEED = 4.4; // m/s before character multiplier
export const PLAYER_JUMP_VEL = 5.2;
export const GRAVITY = 16;
export const MOB_RADIUS = 0.3;

export const INTERACT_RANGE = 1.7; // meters from door/prop cell center
export const STAT_DOOR_RANGE = 2.4; // players within this of door count toward stat sum
export const DOOR_WIDTH = 1.0; // opening spans exactly the slot cell

export const DOWNED_DURATION = 15; // seconds until death if not revived
export const REVIVE_HOLD = 3; // seconds of hold-interact to revive
export const RESPAWN_HP_FRACTION = 0.6;

export const HOLDFAST_DURATION = 5; // seconds token counts as a plate
export const GRAPPLE_DURATION = 2.0; // seconds of pit-crossing + speed burst
export const GRAPPLE_SPEED_MULT = 1.6;
export const FIELDKIT_DURATION = 8;
export const FIELDKIT_HEAL_PER_SEC = 4;
export const FIELDKIT_RADIUS = 3;
export const DEPLOY_TURRET_LIFETIME = 20;
export const DEPLOY_TURRET_HP = 60;
export const DEPLOY_TURRET_DMG = 6;
export const DEPLOY_TURRET_RATE = 1.2; // shots/sec
export const DART_DAMAGE = 18;
export const DART_SLOW_MULT = 0.6;
export const DART_SLOW_DURATION = 3;
export const SWING_DAMAGE = 25;
export const SWING_RANGE = 2.0;
export const SWING_STAGGER = 1.0;
export const BYPASS_RANGE = 2.5;
/** universal light attack — every runner can always fight back */
export const PUNCH_DAMAGE = 8;
export const PUNCH_RANGE = 1.7;
export const PUNCH_COOLDOWN = 0.35;
/** hostile mob spawns are capped at 1 + party size (solo isn't swarmed) */
export const MOB_PARTY_CAP_BONUS = 1;

/** Difficulty knobs (generator) */
export const GEN = {
  gatedEdgeFraction: 0.45, // fraction of edges that get a non-open gate
  maxKeyChainDepth: 3,
  minPathLengthToExit: 4, // rooms on shortest path spawn→exit
  keyColors: ["ruby", "sapphire", "amber", "jade"],
  maxGenRetries: 40,
  gateWeights: { key: 3, plates: 2, stat: 2, objective: 2 } as Record<string, number>,
} as const;

export const EXP = {
  roomFirstVisit: 10,
  objectiveCleared: 25,
  mobKill: 15,
  exitReached: 100,
  hazardNoDeathBonus: 10,
  finishAliveMult: 1.2,
  failureBankFraction: 0.6,
} as const;

/** Archetype lighting palette — the entire MVP lighting design. */
export const ARCHETYPE_LIGHTING: Record<
  string,
  { ambient: string; point: string; mood: string }
> = {
  connector: { ambient: "#1a1a2e", point: "#8888aa", mood: "neutral dim" },
  puzzle: { ambient: "#0e2a2e", point: "#2dd4bf", mood: "teal — think" },
  hazard: { ambient: "#2e0e12", point: "#f43f5e", mood: "red — danger" },
  combat: { ambient: "#241a0e", point: "#f59e0b", mood: "amber — fight" },
  sanctuary: { ambient: "#1f1a0e", point: "#fbbf24", mood: "warm — safe" },
  vault: { ambient: "#160e2e", point: "#a78bfa", mood: "violet — treasure" },
  exit: { ambient: "#0e2e16", point: "#4ade80", mood: "green — goal" },
};

/** dynamic environment objects: pushable, breakable, pit-fillable */
export const DYN_PROP_DEFS = {
  crate: { hp: 25, radius: 0.4, pushable: true },
  barrel: { hp: 14, radius: 0.32, pushable: true },
} as const;
export type DynPropKind = keyof typeof DYN_PROP_DEFS;

export const MOB_DEFS = {
  slime: { hp: 25, speed: 2.0, damage: 6, attackRange: 0.9, attackCooldown: 1.8, windup: 0.5, exp: 15 },
  turret: { hp: 50, speed: 0, damage: 7, attackRange: 6.5, attackCooldown: 2.2, windup: 0.8, exp: 15 },
} as const;
export type MobKind = keyof typeof MOB_DEFS;
