import { describe, expect, it } from "vitest";
import { generateCube } from "@cubescape/shared";
import { MatchState, PlayerState } from "../src/schema/MatchState.js";
import { Simulation } from "../src/sim/Simulation.js";

const soloBrute = {
  might: 8,
  wits: 3,
  players: 1,
  hasBrute: true,
  hasScout: false,
  hasTinker: false,
};

function makeSim(): { sim: Simulation; state: MatchState; p: PlayerState } {
  const state = new MatchState();
  const sim = new Simulation(state);
  state.phase = "running";
  const spec = generateCube(5, soloBrute); // seed 5: plates room south of spawn
  sim.buildWorld(spec);
  const p = new PlayerState();
  p.sessionId = "t1";
  p.name = "T";
  p.charId = "brute";
  p.maxHp = 140;
  p.hp = 140;
  state.players.set("t1", p);
  sim.spawnPlayerAtStart(p);
  return { sim, state, p };
}

/** feed continuous movement input and tick the sim */
function walk(sim: Simulation, state: MatchState, mx: number, mz: number, ticks: number) {
  let seq = 1000000; // fresh sequence range per walk
  for (let i = 0; i < ticks; i++) {
    sim.queueInput("t1", [
      { seq: seq++, mx, mz, yaw: 0, jump: false, hold: false },
      { seq: seq++, mx, mz, yaw: 0, jump: false, hold: false },
      { seq: seq++, mx, mz, yaw: 0, jump: false, hold: false },
    ]);
    sim.tick();
  }
}

describe("dynamic props", () => {
  it("spawns crates/barrels as live objects", () => {
    const { state } = makeSim();
    const spawnRoom = state.rooms.get("0,0,0")!;
    expect(spawnRoom.dynProps.size).toBeGreaterThan(0);
  });

  it("player pushes a crate; crate shoved into a pit sinks and bridges it", () => {
    const { sim, state, p } = makeSim();
    const room = state.rooms.get("0,0,1")!;
    expect(room.templateId).toBe("puzzle_plates");
    // teleport the player into the plates room, west of the crate at (1.5, 4.5)
    p.roomCoord = "0,0,1";
    p.x = 0.8;
    p.z = 4.5;
    const crate = room.dynProps.get("c1")!;
    expect(crate.x).toBeCloseTo(1.5, 3);

    walk(sim, state, 1, 0, 400); // shove east for 400 ticks (~20s sim less budget)

    // the crate must have sunk into the pit ring and bridged a cell
    expect(room.dynProps.has("c1")).toBe(false);
    expect(room.walkableOverrides.length).toBeGreaterThan(0);
    const [ox, oz] = room.walkableOverrides[0]!.split(",").map(Number);
    expect(oz).toBe(4);
    expect([3, 4, 5]).toContain(ox);
    // player never entered the pit themselves
    expect(p.z).toBeGreaterThan(3);
    expect(p.z).toBeLessThan(6);
    expect(Math.floor(p.x)).toBeLessThanOrEqual(3);
  });

  it("crates on plates hold them down (sokoban)", () => {
    const { sim, state, p } = makeSim();
    const room = state.rooms.get("0,0,1")!;
    p.roomCoord = "0,0,1";
    // place the crate directly onto a plate cell (4,3) and stand clear
    const crate = room.dynProps.get("c1")!;
    crate.x = 4.5;
    crate.z = 3.5;
    p.x = 1.5;
    p.z = 7.5;
    walk(sim, state, 0, 0, 5);
    // plates door needs 2 simultaneous — crate counts as one press;
    // put the player on the second plate (4,5)
    p.x = 4.5;
    p.z = 5.5;
    walk(sim, state, 0, 0, 10);
    const eDoor = room.doors.find((d) => d.face === "E")!;
    expect(eDoor.open).toBe(true);
  });

  it("lockbox shrugs off strikes", () => {
    const { sim, state, p } = makeSim();
    const room = state.rooms.get("0,0,1")!;
    const lb = room.dynProps.get("lb1")!;
    expect(lb.kind).toBe("lockbox");
    p.roomCoord = "0,0,1";
    p.x = lb.x;
    p.z = lb.z - 0.9;
    for (let i = 0; i < 10; i++) {
      sim.useAbility("t1", 3, 0); // strike facing +z at the box
      for (let t = 0; t < 10; t++) sim.tick();
    }
    expect(room.dynProps.has("lb1")).toBe(true);
    expect(room.dynProps.get("lb1")!.hp).toBe(lb.maxHp);
  });

  it("lockbox refuses to sink when shoved at a pit", () => {
    const { sim, state, p } = makeSim();
    const room = state.rooms.get("0,0,1")!;
    const lb = room.dynProps.get("lb1")!;
    // stand east of the box and shove it west toward the pit ring at (5,4)
    p.roomCoord = "0,0,1";
    p.x = lb.x + 0.75;
    p.z = lb.z;
    walk(sim, state, -1, 0, 300);
    expect(room.dynProps.has("lb1")).toBe(true);
    const after = room.dynProps.get("lb1")!;
    // parked at the pit edge, never inside a pit cell
    expect(Math.floor(after.x)).toBeGreaterThanOrEqual(6);
    expect(room.walkableOverrides.length).toBe(0);
  });

  it("pick up the lockbox, set it on a plate, and it holds the door", () => {
    const { sim, state, p } = makeSim();
    const room = state.rooms.get("0,0,1")!;
    p.roomCoord = "0,0,1";
    // repurpose the W door as a 1-press plates gate (isolated from room logic,
    // which needs 2 presses and would latch)
    const wDoor = room.doors.find((d) => d.face === "W");
    let gateDoor = wDoor;
    if (!gateDoor) {
      gateDoor = room.doors.find((d) => d.face !== "E")!;
    }
    gateDoor.gateType = "plates";
    gateDoor.gateValue = 1;
    gateDoor.open = false;
    gateDoor.latched = false;

    // 1. pick it up (closer to the box than to any door)
    const lb = room.dynProps.get("lb1")!;
    p.x = lb.x;
    p.z = lb.z + 0.9;
    sim.interact("t1");
    expect(p.carryProp).toBe("lockbox");
    expect(room.dynProps.has("lb1")).toBe(false);

    // 2. walk to the plate at (4,3) and set it down on the tile ahead
    p.x = 4.5;
    p.z = 2.6;
    p.yaw = 0; // facing +z → front cell is (4,3)
    sim.interact("t1");
    expect(p.carryProp).toBe("");
    const placed = room.dynProps.get("lb1")!;
    expect(placed.x).toBeCloseTo(4.5, 3);
    expect(placed.z).toBeCloseTo(3.5, 3);

    // 3. one press held by the box → the gate opens without anyone standing
    p.x = 1.5;
    p.z = 7.5;
    walk(sim, state, 0, 0, 3);
    expect(gateDoor.open).toBe(true);

    // 4. pick the box back up → the press releases and the door seals again
    p.x = 4.5;
    p.z = 4.6;
    sim.interact("t1");
    expect(p.carryProp).toBe("lockbox");
    walk(sim, state, 0, 0, 3);
    expect(gateDoor.open).toBe(false);
  });

  it("breaks a barrel with strikes", () => {
    const { sim, state, p } = makeSim();
    const spawnRoom = state.rooms.get("0,0,0")!;
    let barrelId = "";
    spawnRoom.dynProps.forEach((d, id) => {
      if (d.kind === "barrel") barrelId = id;
    });
    expect(barrelId).not.toBe("");
    const barrel = spawnRoom.dynProps.get(barrelId)!;
    // stand next to the barrel facing it (+z)
    p.x = barrel.x;
    p.z = barrel.z - 0.8;
    for (let i = 0; i < 4; i++) {
      sim.useAbility("t1", 3, 0); // strike facing +z
      for (let t = 0; t < 10; t++) sim.tick(); // cooldown
    }
    expect(spawnRoom.dynProps.has(barrelId)).toBe(false);
  });
});
