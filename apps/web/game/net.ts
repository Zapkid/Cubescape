"use client";

import { Client, Room } from "colyseus.js";
import {
  CHARACTERS,
  CLIENT_SIM_DT,
  getTemplate,
  parseTiles,
  stepPlayer,
  SOLID_PROP_TYPES,
  type CharId,
  type Face,
  type MoveContext,
  type ServerEvent,
  type TileType,
} from "@cubescape/shared";
import { describeEvent, useGame } from "./store";
import { playSfx } from "./audio";
import { sampleInput } from "./input";

/** Structural read-only views of server schema state. */
export interface DoorView {
  face: string;
  gateType: string;
  gateParam: string;
  gateValue: number;
  open: boolean;
  cellX: number;
  cellZ: number;
}
export interface MobView {
  id: string;
  kind: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  ai: string;
  friendly: boolean;
  stateUntil: number;
}
export interface DeployableView {
  id: string;
  kind: string;
  x: number;
  z: number;
  untilTick: number;
}
export interface RoomView {
  coordId: string;
  templateId: string;
  doors: DoorView[];
  mobs: Map<string, MobView>;
  deployables: DeployableView[];
  cleared: boolean;
  visited: boolean;
  keyColor: string;
  keyTaken: boolean;
  walkableOverrides: string[];
  breachHoles: string[];
  liftPowered: boolean;
  enteredTick: number;
  logicProgress: number;
}
export interface PlayerView {
  sessionId: string;
  name: string;
  charId: string;
  ready: boolean;
  connected: boolean;
  roomCoord: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  lastProcessedSeq: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  downedUntil: number;
  reviveProgress: number;
  keys: string[];
  cooldowns: number[];
  grappleUntil: number;
  exp: number;
  kills: number;
  deaths: number;
  roomsVisited: number;
  objectives: number;
  emote: string;
  emoteUntil: number;
}
export interface StateView {
  phase: string;
  seed: number;
  tick: number;
  spawn: string;
  exit: string;
  rooms: Map<string, RoomView>;
  players: Map<string, PlayerView>;
  revealed: Map<string, string>;
  matchResult: string;
}

interface PendingStep {
  seq: number;
  mx: number;
  mz: number;
  yaw: number;
  jump: boolean;
  hold: boolean;
}

export class NetClient {
  room: Room | null = null;
  private seq = 0;
  private pending: PendingStep[] = [];
  private outbox: PendingStep[] = [];
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = 0;
  private accumulator = 0;
  private lastRoomCoord = "";
  private tileCache = new Map<string, TileType[][]>();
  private propCache = new Map<string, Set<string>>();
  /** local predicted sim state */
  sim = { x: 4.5, y: 0, z: 4.5, vy: 0 };
  onEvent: ((e: ServerEvent) => void) | null = null;

  async connect(code: string, name: string, charId: string | null, seed?: number): Promise<void> {
    const url =
      process.env.NEXT_PUBLIC_SERVER_URL ??
      `ws://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:2567`;
    const client = new Client(url);
    const store = useGame.getState();
    try {
      this.room = await client.joinOrCreate("match", {
        code,
        name,
        ...(charId ? { charId } : {}),
        ...(seed !== undefined ? { seed } : {}),
      });
    } catch (err) {
      store.setConnected(false, String(err));
      throw err;
    }
    store.setConnected(true);
    store.setSession(this.room.sessionId);

    this.room.onMessage("ev", (events: ServerEvent[]) => {
      for (const e of events) {
        const text = describeEvent(e);
        if (text) useGame.getState().pushFeed(text);
        if (e.t === "ping") {
          useGame.getState().addPing({
            kind: String(e.kind),
            x: Number(e.x),
            z: Number(e.z),
            room: String(e.room),
            by: String(e.by),
            until: Date.now() + 5000,
          });
        }
        playSfx(e.t, e);
        this.onEvent?.(e);
      }
    });
    this.room.onLeave(() => {
      useGame.getState().setConnected(false, "disconnected");
    });
    this.room.onError((code2, message) => {
      useGame.getState().setConnected(false, `error ${code2}: ${message}`);
    });

    // reconciliation on every patch
    this.room.onStateChange(() => this.reconcile());

    this.sendTimer = setInterval(() => this.flush(), 50);
    // rAF pauses when the tab is hidden; keep the sim/input stream alive so the
    // server view stays warm and reconciliation doesn't snap on tab return
    this.heartbeat = setInterval(() => {
      if (performance.now() - this.lastFrameAt < 250) return;
      const inp = sampleInput(useGame.getState().yaw);
      this.update(0.1, { mx: inp.mx, mz: inp.mz, jump: inp.jump, hold: inp.hold });
    }, 100);
  }

  get state(): StateView | null {
    return (this.room?.state as unknown as StateView) ?? null;
  }

  get me(): PlayerView | null {
    const s = this.state;
    if (!s || !this.room) return null;
    return s.players.get(this.room.sessionId) ?? null;
  }

  dispose(): void {
    if (this.sendTimer) clearInterval(this.sendTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.room?.leave().catch(() => undefined);
    this.room = null;
  }

  // ---------------- prediction ----------------

  /** called from the render loop each frame so the heartbeat can stand down */
  markFrame(): void {
    this.lastFrameAt = performance.now();
  }

  /** advance local prediction with fixed steps; call each frame with wall dt */
  update(frameDt: number, input: { mx: number; mz: number; jump: boolean; hold: boolean }): void {
    const me = this.me;
    const s = this.state;
    if (!me || !s || s.phase !== "running") return;

    // adopt server room on transition
    if (me.roomCoord !== this.lastRoomCoord) {
      this.lastRoomCoord = me.roomCoord;
      this.sim = { x: me.x, y: me.y, z: me.z, vy: 0 };
      this.pending = [];
      this.accumulator = 0;
      playSfx("transition", { t: "transition" });
    }
    if (me.downed) {
      this.sim = { x: me.x, y: 0, z: me.z, vy: 0 };
      return;
    }

    const yaw = useGame.getState().yaw;
    this.accumulator = Math.min(this.accumulator + frameDt, 0.2);
    while (this.accumulator >= CLIENT_SIM_DT) {
      this.accumulator -= CLIENT_SIM_DT;
      const step: PendingStep = {
        seq: this.seq++,
        mx: input.mx,
        mz: input.mz,
        yaw,
        jump: input.jump,
        hold: input.hold,
      };
      const ctx = this.moveContext(me);
      if (ctx) {
        const res = stepPlayer(this.sim, step, CLIENT_SIM_DT, ctx, this.speedMult(me));
        this.sim = res.state;
      }
      this.pending.push(step);
      this.outbox.push(step);
      if (this.pending.length > 240) this.pending.shift();
    }
    useGame.getState().setPredicted(this.sim.x, this.sim.y, this.sim.z);
  }

  private flush(): void {
    if (!this.room || this.outbox.length === 0) return;
    while (this.outbox.length > 0) {
      const steps = this.outbox.splice(0, 8);
      this.room.send("input", { steps });
    }
  }

  private reconcile(): void {
    const me = this.me;
    if (!me || me.roomCoord !== this.lastRoomCoord) return;
    const ack = me.lastProcessedSeq;
    this.pending = this.pending.filter((p) => p.seq > ack);
    // rewind to server state and replay unacked inputs
    let sim = { x: me.x, y: me.y, z: me.z, vy: 0 };
    const ctx = this.moveContext(me);
    if (!ctx) return;
    for (const step of this.pending) {
      sim = stepPlayer(sim, step, CLIENT_SIM_DT, ctx, this.speedMult(me)).state;
    }
    const divergence = Math.hypot(sim.x - this.sim.x, sim.z - this.sim.z);
    useGame.getState().setLastCorrection(divergence);
    if (divergence > 0.08) {
      // smooth small corrections, snap big ones
      if (divergence > 1.5) {
        this.sim = sim;
      } else {
        this.sim.x += (sim.x - this.sim.x) * 0.35;
        this.sim.z += (sim.z - this.sim.z) * 0.35;
      }
    }
  }

  private speedMult(me: PlayerView): number {
    const def = CHARACTERS[(me.charId || "scout") as CharId];
    return def?.speedMult ?? 1;
  }

  moveContext(me: PlayerView): MoveContext | null {
    const s = this.state;
    if (!s) return null;
    const room = s.rooms.get(me.roomCoord);
    if (!room) return null;
    let tiles = this.tileCache.get(room.templateId);
    if (!tiles) {
      tiles = parseTiles(getTemplate(room.templateId));
      this.tileCache.set(room.templateId, tiles);
    }
    let props = this.propCache.get(room.templateId);
    if (!props) {
      props = new Set(
        getTemplate(room.templateId)
          .props.filter((p) => SOLID_PROP_TYPES.has(p.type))
          .map((p) => `${p.cell[0]},${p.cell[1]}`),
      );
      this.propCache.set(room.templateId, props);
    }
    const openDoors: MoveContext["openDoors"] = {};
    room.doors.forEach((d) => {
      if (d.open && (d.face === "N" || d.face === "E" || d.face === "S" || d.face === "W")) {
        openDoors[d.face as Face] = [d.cellX, d.cellZ] as const;
      }
    });
    return {
      tiles,
      solidProps: props,
      walkableOverrides: new Set(room.walkableOverrides),
      openDoors,
      ignorePits: me.grappleUntil > s.tick,
    };
  }

  // ---------------- intents ----------------

  interact(): void {
    this.room?.send("interact", {});
  }
  ability(slot: number): void {
    this.room?.send("ability", { slot });
  }
  selectChar(charId: string): void {
    this.room?.send("select", { charId });
  }
  ready(v: boolean): void {
    this.room?.send("ready", { ready: v });
  }
  ping(kind: string, x: number, z: number): void {
    this.room?.send("ping", { kind, x, z });
  }
  emote(kind: string): void {
    this.room?.send("emote", { kind });
  }
}
