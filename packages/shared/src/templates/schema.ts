import { z } from "zod";

export const FACES = ["N", "E", "S", "W", "U", "D"] as const; // indices 0-5
export type Face = (typeof FACES)[number];

export const TileType = z.enum([
  "floor", // walkable
  "void", // hole in the floor grid
  "pit", // impassable gap, crossable via Grapple
  "spike", // hazard, damage on active phase (pattern via logicParams)
  "plate", // pressure plate, wired via logicParams
  "lift", // lift tile — powers U-face hatch when energized
  "gas_vent", // hazard emitter / objective target
  "cracked", // Brute-breachable floor cell (creates a D shortcut)
]);
export type TileType = z.infer<typeof TileType>;

export const GateType = z.enum([
  "open",
  "key",
  "plates",
  "stat",
  "objective",
  "lift",
  "oneway",
]);
export type GateType = z.infer<typeof GateType>;

const Cell = z.tuple([
  z.number().int().min(0).max(8),
  z.number().int().min(0).max(8),
]); // [x, z]
export type CellTuple = z.infer<typeof Cell>;

export const PropPlacement = z.object({
  type: z.string(), // mesh/behavior key: "crate", "lever", "cracked_wall", "turret", ...
  cell: Cell,
  rotY: z.number().default(0), // radians
  id: z.string().optional(), // stable id when logic must reference this prop
  meta: z.record(z.unknown()).default({}),
});
export type PropPlacement = z.infer<typeof PropPlacement>;

export const DoorSlot = z.object({
  allowedGates: z.array(GateType).nonempty(),
  cell: Cell.optional(), // wall cell for N/E/S/W doors; U/D use center or `cell` as hatch position
});
export type DoorSlot = z.infer<typeof DoorSlot>;

export const RoomTemplate = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  version: z.literal(1),
  archetype: z.enum([
    "connector",
    "puzzle",
    "hazard",
    "combat",
    "sanctuary",
    "vault",
    "exit",
  ]),
  displayName: z.string(),

  grid: z.object({ w: z.literal(9), d: z.literal(9), h: z.literal(5) }),
  tiles: z.array(z.string().length(9)).length(9), // 9 rows (z=0..8) of 9 chars (x=0..8)
  tileLegend: z.record(z.string().length(1), TileType),

  props: z.array(PropPlacement).default([]),

  // Exactly 6 entries ordered N, E, S, W, U, D. null = this face can never have a door.
  doorSlots: z.array(DoorSlot.nullable()).length(6),

  logicId: z.string().nullable(), // module in shared/rules/roomLogic/<logicId>.ts
  logicParams: z.record(z.unknown()).default({}),

  lighting: z.object({
    ambient: z.string(), // hex — archetype palette
    point: z.string(),
    intensity: z.number().min(0).max(3),
  }),

  spawnCells: z.array(Cell).nonempty(), // used when players enter via respawn/match start

  // Generator metadata
  weight: z.number().positive().default(1),
  maxPerCube: z.number().int().positive().default(27),
  minPerCube: z.number().int().min(0).default(0),
});
export type RoomTemplate = z.infer<typeof RoomTemplate>;
