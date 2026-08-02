import { Room, type Client } from "@colyseus/core";
import {
  AbilityMsg,
  CHARACTERS,
  EmoteMsg,
  InputBatchMsg,
  InteractMsg,
  PingMsg,
  ReadyMsg,
  SelectCharMsg,
  TICK_RATE,
  calculateExp,
  generateCube,
  renderCubeAscii,
  type CharId,
  type SolverCaps,
} from "@cubescape/shared";
import { MatchState, PlayerState } from "../schema/MatchState.js";
import { Simulation } from "../sim/Simulation.js";
import { persistence } from "../persistence/index.js";

interface JoinOptions {
  name?: string;
  charId?: string;
}

interface CreateOptions {
  code?: string;
  seed?: number;
}

const SCOREBOARD_SECONDS = 15;

export class MatchRoom extends Room<MatchState> {
  maxClients = 8;
  private sim!: Simulation;
  private requestedSeed: number | undefined;
  private completeSince = 0;
  private lastPingAt = new Map<string, number>();
  private resultsSaved = false;

  onCreate(options: CreateOptions): void {
    this.setState(new MatchState());
    this.sim = new Simulation(this.state);
    this.requestedSeed =
      typeof options.seed === "number" && Number.isFinite(options.seed)
        ? Math.floor(Math.abs(options.seed))
        : undefined;
    this.setMetadata({ code: options.code ?? "dev" });

    this.onMessage("input", (client, raw) => {
      const parsed = InputBatchMsg.safeParse(raw);
      if (!parsed.success) return;
      this.sim.queueInput(client.sessionId, parsed.data.steps);
    });
    this.onMessage("interact", (client, raw) => {
      const parsed = InteractMsg.safeParse(raw ?? {});
      if (!parsed.success) return;
      this.sim.interact(client.sessionId, parsed.data.propId);
    });
    this.onMessage("ability", (client, raw) => {
      const parsed = AbilityMsg.safeParse(raw);
      if (!parsed.success) return;
      this.sim.useAbility(client.sessionId, parsed.data.slot);
    });
    this.onMessage("select", (client, raw) => {
      const parsed = SelectCharMsg.safeParse(raw);
      if (!parsed.success || this.state.phase !== "lobby") return;
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.charId = parsed.data.charId;
        const def = CHARACTERS[parsed.data.charId];
        p.maxHp = def.hp;
        p.hp = def.hp;
      }
    });
    this.onMessage("ready", (client, raw) => {
      const parsed = ReadyMsg.safeParse(raw);
      if (!parsed.success || this.state.phase !== "lobby") return;
      const p = this.state.players.get(client.sessionId);
      if (p && p.charId) p.ready = parsed.data.ready;
      this.maybeStart();
    });
    this.onMessage("ping", (client, raw) => {
      const parsed = PingMsg.safeParse(raw);
      if (!parsed.success) return;
      const now = Date.now();
      if (now - (this.lastPingAt.get(client.sessionId) ?? 0) < 700) return;
      this.lastPingAt.set(client.sessionId, now);
      this.sim.ping(client.sessionId, parsed.data.kind, parsed.data.x, parsed.data.z);
    });
    this.onMessage("emote", (client, raw) => {
      const parsed = EmoteMsg.safeParse(raw);
      if (!parsed.success) return;
      const now = Date.now();
      if (now - (this.lastPingAt.get(client.sessionId) ?? 0) < 700) return;
      this.lastPingAt.set(client.sessionId, now);
      this.sim.emote(client.sessionId, parsed.data.kind);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  onJoin(client: Client, options: JoinOptions): void {
    const p = new PlayerState();
    p.sessionId = client.sessionId;
    p.name = sanitizeName(options.name) ?? `Runner-${client.sessionId.slice(0, 4)}`;
    if (
      options.charId === "brute" ||
      options.charId === "scout" ||
      options.charId === "tinker"
    ) {
      p.charId = options.charId;
      const def = CHARACTERS[options.charId];
      p.maxHp = def.hp;
      p.hp = def.hp;
    }
    this.state.players.set(client.sessionId, p);
    if (this.state.phase !== "lobby") {
      // late joiner drops into the running match at spawn
      if (!p.charId) {
        p.charId = "scout";
        p.maxHp = CHARACTERS.scout.hp;
        p.hp = p.maxHp;
      }
      this.sim.spawnPlayerAtStart(p);
    }
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    if (this.state.phase === "lobby" || consented) {
      this.state.players.delete(client.sessionId);
      this.maybeStart();
      return;
    }
    try {
      await this.allowReconnection(client, 60);
      const back = this.state.players.get(client.sessionId);
      if (back) back.connected = true;
    } catch {
      this.state.players.delete(client.sessionId);
    }
  }

  onDispose(): void {
    this.saveResults("disposed");
  }

  private maybeStart(): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.players.size === 0) return;
    let allReady = true;
    this.state.players.forEach((p) => {
      if (!p.ready || !p.charId) allReady = false;
    });
    if (!allReady) return;

    const caps = this.partyCaps();
    const seed = this.requestedSeed ?? Math.floor(Math.random() * 2 ** 31);
    const spec = generateCube(seed, caps);
    this.state.genCaps = JSON.stringify(caps);
    this.sim.buildWorld(spec);
    if (process.env.CUBE_DEBUG) {
      console.log(renderCubeAscii(spec));
    }
    this.state.phase = "running";
    this.state.startedTick = this.state.tick;
    this.state.players.forEach((p) => this.sim.spawnPlayerAtStart(p));
    this.broadcast("ev", [
      { t: "message", text: `Seed ${seed}. Find the exit at the far corner.` },
    ]);
  }

  private partyCaps(): SolverCaps {
    const chars: CharId[] = [];
    this.state.players.forEach((p) => {
      if (p.charId) chars.push(p.charId as CharId);
    });
    // top-2 combined stats: what a pair standing at a door can reach
    const mights = chars.map((c) => CHARACTERS[c].might).sort((a, b) => b - a);
    const wits = chars.map((c) => CHARACTERS[c].wits).sort((a, b) => b - a);
    const top2 = (arr: number[]) => (arr[0] ?? 0) + (arr.length > 1 ? arr[1]! : 0);
    return {
      might: top2(mights),
      wits: top2(wits),
      players: chars.length,
      hasBrute: chars.includes("brute"),
      hasScout: chars.includes("scout"),
      hasTinker: chars.includes("tinker"),
    };
  }

  private tick(): void {
    this.sim.tick();
    const events = this.sim.drainEvents();
    if (events.length > 0) {
      // deliver private messages only to their target
      const publicEvents = events.filter((e) => !e.only);
      if (publicEvents.length > 0) this.broadcast("ev", publicEvents);
      for (const e of events) {
        if (typeof e.only === "string") {
          const client = this.clients.find((c) => c.sessionId === e.only);
          client?.send("ev", [e]);
        }
      }
    }
    if (this.state.phase === "complete") {
      if (this.completeSince === 0) {
        this.completeSince = this.state.tick;
        this.saveResults(this.state.matchResult || "complete");
      }
      if (this.state.tick - this.completeSince > SCOREBOARD_SECONDS * TICK_RATE) {
        this.disconnect().catch(() => undefined);
      }
    }
  }

  private saveResults(result: string): void {
    if (this.resultsSaved || this.state.tick === 0) return;
    this.resultsSaved = true;
    const players: {
      name: string;
      charId: string;
      exp: number;
      kills: number;
      deaths: number;
    }[] = [];
    this.state.players.forEach((p) => {
      const exp =
        this.state.matchResult === "victory"
          ? p.exp
          : calculateExp({
              roomsVisited: p.roomsVisited,
              objectivesCleared: p.objectives,
              mobKills: p.kills,
              deaths: p.deaths,
              reachedExit: false,
              hazardRoomsClearedNoDeath: 0,
              finishedAlive: false,
            });
      players.push({ name: p.name, charId: p.charId, exp, kills: p.kills, deaths: p.deaths });
    });
    if (players.length === 0) return;
    persistence
      .saveMatchResult({
        seed: this.state.seed,
        result,
        durationTicks: this.state.endedTick - this.state.startedTick,
        players,
      })
      .catch((err) => console.error("persistence error", err));
  }
}

function sanitizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const cleaned = name.replace(/[^\w\- ]/g, "").trim().slice(0, 16);
  return cleaned.length >= 2 ? cleaned : null;
}
