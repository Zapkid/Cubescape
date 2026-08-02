import { Client, Room } from "colyseus.js";
import {
  CHARACTERS,
  generateCube,
  getTemplate,
  parseTiles,
  coordId,
  parseCoordId,
  neighborCoord,
  FACE_DELTA,
  type CharId,
  type CoordId,
  type CubeSpec,
  type Face,
  type SolverCaps,
} from "@cubescape/shared";

/** Minimal structural views of the server schema (bot reads state loosely). */
interface DoorView {
  face: string;
  gateType: string;
  gateParam: string;
  gateValue: number;
  open: boolean;
  cellX: number;
  cellZ: number;
}
interface RoomView {
  templateId: string;
  doors: DoorView[];
  keyColor: string;
  keyTaken: boolean;
  cleared: boolean;
  mobs: Map<string, { x: number; z: number; hp: number; friendly: boolean }>;
  logicProgress: number;
}
interface PlayerView {
  roomCoord: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  downed: boolean;
  lastProcessedSeq: number;
  keys: string[];
}
interface StateView {
  phase: string;
  seed: number;
  tick: number;
  exit: string;
  players: Map<string, PlayerView>;
  rooms: Map<string, RoomView>;
}

export interface BotOptions {
  url: string;
  code: string;
  seed?: number;
  name: string;
  charId: CharId;
  solve: boolean;
}

export interface BotReport {
  name: string;
  charId: CharId;
  roomsVisited: number;
  reachedExit: boolean;
  errors: string[];
  finalSeq: number;
}

const STEP_MS = 50; // send 3×(1/60s) steps every 50ms

export class Bot {
  private room!: Room;
  private seq = 0;
  private itinerary: CoordId[] = [];
  private itineraryIdx = 0;
  private visited = new Set<CoordId>();
  private lastRoom = "";
  private lastRoomChangeAt = Date.now();
  private lastInteractAt = 0;
  private lastAbilityAt = 0;
  /** doors I've been failing at solo: edgeKey -> first attempt time */
  private doorWaits = new Map<string, number>();
  /** doors temporarily banned from routing: edgeKey -> ban expiry */
  private doorBans = new Map<string, number>();
  private errors: string[] = [];
  private reachedExit = false;
  private spec: CubeSpec | null = null;
  private leverIdx = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: BotOptions) {}

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  get hasReachedExit(): boolean {
    return this.reachedExit;
  }

  async join(): Promise<void> {
    const client = new Client(this.opts.url);
    this.room = await client.joinOrCreate("match", {
      code: this.opts.code,
      seed: this.opts.seed,
      name: this.opts.name,
      charId: this.opts.charId,
    });
    this.room.onMessage("ev", () => undefined);
    this.room.onError((code, message) =>
      this.errors.push(`room error ${code}: ${message}`),
    );
    this.room.send("ready", { ready: true });
  }

  private state(): StateView {
    return this.room.state as unknown as StateView;
  }

  start(): void {
    this.timer = setInterval(() => {
      try {
        this.step();
      } catch (err) {
        this.errors.push(String(err));
      }
    }, STEP_MS);
  }

  stop(): BotReport {
    if (this.timer) clearInterval(this.timer);
    const me = this.state().players.get(this.sessionId);
    return {
      name: this.opts.name,
      charId: this.opts.charId,
      roomsVisited: this.visited.size,
      reachedExit: this.reachedExit,
      errors: this.errors,
      finalSeq: me?.lastProcessedSeq ?? -1,
    };
  }

  // ---------------- behavior ----------------

  private step(): void {
    const s = this.state();
    if (!s || s.phase !== "running") return;
    const me = s.players.get(this.sessionId);
    if (!me || me.downed) return;

    if (!this.spec && this.opts.solve) {
      this.buildPlan(s);
    }
    if (me.roomCoord !== this.lastRoom) {
      this.lastRoom = me.roomCoord;
      this.lastRoomChangeAt = Date.now();
      this.visited.add(me.roomCoord);
      if (me.roomCoord === s.exit) this.reachedExit = true;
    }

    const room = s.rooms.get(me.roomCoord);
    if (!room) return;

    // fight back when mobs are around
    this.combat(me, room);

    const target = this.currentTarget(s, me, room);
    this.moveToward(me, room, target);
  }

  private buildPlan(s: StateView): void {
    const chars: CharId[] = [];
    s.players.forEach((p) => {
      const cid = (p as unknown as { charId?: string }).charId;
      if (cid === "brute" || cid === "scout" || cid === "tinker") chars.push(cid);
    });
    if (chars.length === 0) chars.push(this.opts.charId);
    const mights = chars.map((c) => CHARACTERS[c].might).sort((a, b) => b - a);
    const wits = chars.map((c) => CHARACTERS[c].wits).sort((a, b) => b - a);
    const top2 = (arr: number[]) => (arr[0] ?? 0) + (arr.length > 1 ? arr[1]! : 0);
    const caps: SolverCaps = {
      might: top2(mights),
      wits: top2(wits),
      players: chars.length,
      hasBrute: chars.includes("brute"),
      hasScout: chars.includes("scout"),
      hasTinker: chars.includes("tinker"),
    };
    this.spec = generateCube(s.seed, caps);
    // visit rooms in discovery order, ending with the exit path
    this.itinerary = [
      ...this.spec.solution.discoveryOrder,
      ...this.spec.solution.path,
    ];
  }

  /** Where should I go right now? Returns an in-room cell target. */
  private currentTarget(
    s: StateView,
    me: PlayerView,
    room: RoomView,
  ): { x: number; z: number; interact: boolean; hold: boolean } {
    const template = getTemplate(room.templateId);

    // 1. pick up an available key
    if (room.keyColor && !room.keyTaken) {
      const pedestal = template.props.find((p) => p.type === "key_pedestal");
      const cell = pedestal?.cell ?? [4, 4];
      return { x: cell[0] + 0.5, z: cell[1] + 0.5, interact: true, hold: false };
    }

    // 2. objective work in special rooms
    if (!room.cleared) {
      if (template.logicId === "levers_sequence") {
        const order = (template.logicParams.order ?? []) as string[];
        const idx = Math.min(room.logicProgress, order.length - 1);
        const leverId = order[idx];
        const lever = template.props.find((p) => p.id === leverId);
        if (lever) {
          return { x: lever.cell[0] + 0.5, z: lever.cell[1] + 0.5, interact: true, hold: false };
        }
      }
      if (template.logicId === "gas_room" || template.logicId === "exit_terminal") {
        return { x: 4.5, z: 4.5, interact: false, hold: true };
      }
      if (template.logicId === "vault_bridge") {
        const plate = (template.logicParams.plateCells as [number, number][] | undefined)?.[0];
        if (plate && room.keyColor && room.keyTaken === false) {
          return { x: plate[0] + 0.5, z: plate[1] + 0.5, interact: false, hold: false };
        }
      }
    }

    // 3. head for the next itinerary room (solve mode) or a random door
    const nextCoord = this.nextItineraryCoord(s, me);
    const door = this.doorToward(me.roomCoord, nextCoord, room);
    if (door) {
      // plates duty: even-indexed bots stand on a plate instead of pushing the door;
      // brutes on duty also plant Hold Fast once they're standing on it
      if (door.gateType === "plates" && !door.open) {
        const duty = this.plateDuty(template);
        if (duty) {
          const me2 = this.state().players.get(this.sessionId);
          if (
            me2 &&
            this.opts.charId === "brute" &&
            Math.floor(me2.x) === duty[0] &&
            Math.floor(me2.z) === duty[1] &&
            Date.now() - this.lastAbilityAt > 6000
          ) {
            this.lastAbilityAt = Date.now();
            this.room.send("ability", { slot: 1 }); // holdfast
          }
          return { x: duty[0] + 0.5, z: duty[1] + 0.5, interact: false, hold: false };
        }
      }
      const near =
        Math.hypot(me.x - (door.cellX + 0.5), me.z - (door.cellZ + 0.5)) < 1.4;
      if (door.face === "U" && near) {
        this.maybeLiftAbility();
      }
      // co-op doors: don't wait alone forever — ban and reroute
      if (!door.open && (door.gateType === "stat" || door.gateType === "plates")) {
        const key = `${me.roomCoord}|${door.face}`;
        if (near) {
          let mateNear = false;
          s.players.forEach((mate, id) => {
            if (id === this.sessionId || mate.roomCoord !== me.roomCoord) return;
            if (Math.hypot(mate.x - (door.cellX + 0.5), mate.z - (door.cellZ + 0.5)) < 3.5) {
              mateNear = true;
            }
          });
          const since = this.doorWaits.get(key) ?? Date.now();
          this.doorWaits.set(key, since);
          if (!mateNear && Date.now() - since > 10000) {
            this.doorBans.set(key, Date.now() + 60000);
            this.doorWaits.delete(key);
          }
        }
      }
      return {
        x: door.cellX + 0.5,
        z: door.cellZ + 0.5,
        interact: near,
        hold: false,
      };
    }
    // wander
    const t = Date.now() / 3000 + this.seq / 100;
    return {
      x: 4.5 + Math.sin(t) * 3,
      z: 4.5 + Math.cos(t * 1.3) * 3,
      interact: false,
      hold: false,
    };
  }

  private nextItineraryCoord(s: StateView, me: PlayerView): CoordId | null {
    if (!this.opts.solve || this.itinerary.length === 0) return null;
    // stuck? skip ahead
    if (Date.now() - this.lastRoomChangeAt > 20000) {
      this.itineraryIdx = Math.min(this.itineraryIdx + 1, this.itinerary.length - 1);
      this.lastRoomChangeAt = Date.now();
    }
    while (
      this.itineraryIdx < this.itinerary.length &&
      (this.itinerary[this.itineraryIdx] === me.roomCoord ||
        (this.visited.has(this.itinerary[this.itineraryIdx]!) &&
          this.itinerary[this.itineraryIdx] !== s.exit))
    ) {
      this.itineraryIdx++;
    }
    return this.itinerary[this.itineraryIdx] ?? s.exit;
  }

  /** BFS through currently-open/openable doors toward the target room; returns the first door to take. */
  private doorToward(
    from: CoordId,
    target: CoordId | null,
    room: RoomView,
  ): DoorView | null {
    const s = this.state();
    const me = s.players.get(this.sessionId)!;
    const partySize = s.players.size;
    const now = Date.now();
    const edgeKey = (roomId: CoordId, d: DoorView) => `${roomId}|${d.face}`;
    const passable = (roomId: CoordId, d: DoorView): boolean => {
      if (d.open) return true;
      if ((this.doorBans.get(edgeKey(roomId, d)) ?? 0) > now) return false;
      switch (d.gateType) {
        case "open":
          return true;
        case "key":
          return me.keys.includes(d.gateParam);
        case "lift":
          return true; // we can power it with our kit
        case "stat":
          // the pack travels together — enough bodies will pile up at the door
          return partySize >= 2;
        case "plates":
          return partySize >= 2; // someone will take plate duty (see plateDuty)
        case "objective":
          return false; // needs the owning room cleared — route around
        default:
          return d.face === "D";
      }
    };
    if (!target || target === from) {
      // no plan: take any passable door, favoring unvisited neighbors
      const options = room.doors.filter((d) => passable(from, d));
      const fresh = options.filter(
        (d) => !this.visited.has(coordId(neighborCoord(parseCoordId(from), d.face as Face))),
      );
      const pool = fresh.length > 0 ? fresh : options;
      if (pool.length === 0) return room.doors[0] ?? null;
      return pool[Math.floor(Math.random() * pool.length)]!;
    }
    // BFS across rooms
    const prevDoor = new Map<CoordId, { from: CoordId; door: DoorView }>();
    const queue: CoordId[] = [from];
    const seen = new Set<CoordId>([from]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === target) break;
      const curRoom = cur === from ? room : (s.rooms.get(cur) as RoomView | undefined);
      if (!curRoom) continue;
      for (const d of curRoom.doors) {
        if (!passable(cur, d)) continue;
        const n = coordId(neighborCoord(parseCoordId(cur), d.face as Face));
        if (seen.has(n) || !s.rooms.has(n)) continue;
        seen.add(n);
        prevDoor.set(n, { from: cur, door: d });
        queue.push(n);
      }
    }
    // walk back to find the first hop out of `from`
    let cur = target;
    let hop: { from: CoordId; door: DoorView } | undefined;
    while (cur !== from) {
      hop = prevDoor.get(cur);
      if (!hop) return null; // unreachable right now — caller wanders
      cur = hop.from;
    }
    return hop?.door ?? null;
  }

  /** Even-indexed bots take plate duty; returns the plate cell to stand on. */
  private plateDuty(
    template: ReturnType<typeof getTemplate>,
  ): [number, number] | null {
    const m = /-(\d+)-/.exec(this.opts.name);
    const idx = m ? Number(m[1]) : 0;
    if (idx % 2 !== 0) return null;
    const cells: [number, number][] = [];
    const tiles = parseTiles(template);
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) if (tiles[z]![x] === "plate") cells.push([x, z]);
    if (cells.length === 0) {
      // no plates here — brutes plant hold-fast instead
      if (this.opts.charId === "brute") this.maybeLiftAbility();
      return null;
    }
    return cells[Math.floor(idx / 2) % cells.length]!;
  }

  private maybeLiftAbility(): void {
    if (Date.now() - this.lastAbilityAt < 3000) return;
    this.lastAbilityAt = Date.now();
    // brute: holdfast(1) | scout: grapple(0) | tinker: fieldkit(1)
    const slot = this.opts.charId === "scout" ? 0 : 1;
    this.room.send("ability", { slot });
  }

  private combat(me: PlayerView, room: RoomView): void {
    let nearest: { x: number; z: number } | null = null;
    let bestD = 8;
    room.mobs.forEach((m) => {
      if (m.friendly || m.hp <= 0) return;
      const d = Math.hypot(m.x - me.x, m.z - me.z);
      if (d < bestD) {
        bestD = d;
        nearest = m;
      }
    });
    if (!nearest) return;
    const n = nearest as { x: number; z: number };
    const yaw = Math.atan2(n.x - me.x, n.z - me.z);
    this.faceYaw = yaw;
    if (Date.now() - this.lastAbilityAt > 1500) {
      this.lastAbilityAt = Date.now();
      this.room.send("ability", { slot: 2 }); // combat slot for every char
    }
    if (bestD < 1.6) {
      this.room.send("ability", { slot: 3 }); // universal strike when adjacent
    }
  }

  private faceYaw = 0;

  private moveToward(
    me: PlayerView,
    room: RoomView,
    target: { x: number; z: number; interact: boolean; hold: boolean },
  ): void {
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const dist = Math.hypot(dx, dz);
    let mx = 0;
    let mz = 0;
    if (dist > 0.25) {
      mx = dx / dist;
      mz = dz / dist;
      // jitter to slide around pillars
      const wobble = Math.sin(Date.now() / 400 + this.seq) * 0.4;
      const wx = -mz * wobble;
      const wz = mx * wobble;
      const m = Math.hypot(mx + wx, mz + wz) || 1;
      mx = (mx + wx) / m;
      mz = (mz + wz) / m;
    }
    const yaw = this.faceYaw || Math.atan2(mx, mz);
    const steps = Array.from({ length: 3 }, () => ({
      seq: this.seq++,
      mx,
      mz,
      yaw,
      jump: false,
      hold: target.hold,
    }));
    this.room.send("input", { steps });
    this.faceYaw = 0;

    if (target.interact && Date.now() - this.lastInteractAt > 600) {
      this.lastInteractAt = Date.now();
      this.room.send("interact", {});
    }
    // pit rooms: grapple across if scout and blocked
    void room;
    void FACE_DELTA;
  }
}
