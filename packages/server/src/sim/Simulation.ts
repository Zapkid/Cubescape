import {
  CHARACTERS,
  CLIENT_SIM_DT,
  DOWNED_DURATION,
  DEPLOY_TURRET_DMG,
  DEPLOY_TURRET_HP,
  DEPLOY_TURRET_RATE,
  FIELDKIT_HEAL_PER_SEC,
  FIELDKIT_RADIUS,
  INTERACT_RANGE,
  MAX_INPUT_STEPS_PER_SEC,
  MOB_DEFS,
  REVIVE_HOLD,
  RESPAWN_HP_FRACTION,
  STAT_DOOR_RANGE,
  TICK_DT,
  TICK_RATE,
  calculateExp,
  canOpenGate,
  coordId,
  doorSlotToSpawnPosition,
  executeAbility,
  getTemplate,
  neighborCoord,
  parseCoordId,
  parseTiles,
  stepMob,
  stepPlayer,
  ROOM_LOGIC,
  OPPOSITE_FACE,
  FACE_INDEX,
  SOLID_PROP_TYPES,
  EXP,
  type AbilityCtx,
  type CubeSpec,
  type DoorInfo,
  type Effect,
  type Face,
  type Gate,
  type InputStepMsg,
  type MobSim,
  type MobTargetView,
  type MoveContext,
  type RoomEvent,
  type RulePlayer,
  type ServerEvent,
  type TileType,
  type CharId,
  type MobKind,
} from "@cubescape/shared";
import {
  Deployable,
  DoorState,
  MatchState,
  MobState,
  PlayerState,
  RoomState,
} from "../schema/MatchState.js";

const STEP_BUDGET_CAPACITY = 15;

interface QueuedInput extends InputStepMsg {}

/** All authoritative game logic. The MatchRoom is just transport + lifecycle. */
export class Simulation {
  readonly state: MatchState;
  spec: CubeSpec | null = null;

  private inputQueues = new Map<string, QueuedInput[]>();
  private stepBudget = new Map<string, number>();
  private holdFlags = new Map<string, boolean>();
  private events: ServerEvent[] = [];
  private logicScratch = new Map<string, Record<string, unknown>>();
  private roomEvents = new Map<string, RoomEvent[]>();
  private tileCache = new Map<string, TileType[][]>();
  private propCache = new Map<string, Set<string>>();
  private idCounter = 0;

  constructor(state: MatchState) {
    this.state = state;
  }

  // ---------------- world construction ----------------

  buildWorld(spec: CubeSpec): void {
    this.spec = spec;
    this.state.seed = spec.seed;
    this.state.spawn = spec.spawn;
    this.state.exit = spec.exit;
    for (const [id, roomSpec] of Object.entries(spec.rooms)) {
      const rs = new RoomState();
      rs.coordId = id;
      rs.templateId = roomSpec.templateId;
      rs.keyColor = roomSpec.keyColor ?? "";
      for (const d of roomSpec.doors) {
        const ds = new DoorState();
        ds.face = d.face;
        ds.gateType = d.gate.type;
        ds.open = d.gate.type === "open";
        if (d.gate.type === "key") ds.gateParam = d.gate.color;
        if (d.gate.type === "stat") {
          ds.gateParam = d.gate.stat;
          ds.gateValue = d.gate.threshold;
        }
        if (d.gate.type === "plates") ds.gateValue = d.gate.count;
        ds.cellX = d.cell[0];
        ds.cellZ = d.cell[1];
        ds.ownerCoord = d.ownerCoord ?? "";
        ds.edgeId = edgeIdFor(id, d.face);
        rs.doors.push(ds);
      }
      this.state.rooms.set(id, rs);
    }
  }

  spawnPlayerAtStart(p: PlayerState): void {
    const room = this.state.rooms.get(this.state.spawn);
    if (!room) return;
    const template = getTemplate(room.templateId);
    const idx = this.state.players.size % template.spawnCells.length;
    const cell = template.spawnCells[idx]!;
    p.roomCoord = this.state.spawn;
    p.x = cell[0] + 0.5;
    p.z = cell[1] + 0.5;
    p.y = 0;
    p.anchorCoord = this.state.spawn;
    const def = CHARACTERS[(p.charId || "scout") as CharId];
    p.maxHp = def.hp;
    p.hp = def.hp;
    this.markVisited(room, p);
  }

  // ---------------- message intake ----------------

  queueInput(sessionId: string, steps: InputStepMsg[]): void {
    const q = this.inputQueues.get(sessionId) ?? [];
    for (const s of steps) q.push(s);
    // hard cap queue so a burst can't build a teleport backlog
    while (q.length > 30) q.shift();
    this.inputQueues.set(sessionId, q);
  }

  interact(sessionId: string, propId?: string): void {
    const p = this.state.players.get(sessionId);
    if (!p || this.state.phase !== "running" || p.downed) return;
    const room = this.state.rooms.get(p.roomCoord);
    if (!room) return;
    const template = getTemplate(room.templateId);

    // 1. key pickup
    if (room.keyColor && !room.keyTaken) {
      const pedestal = template.props.find((pr) => pr.type === "key_pedestal");
      const kx = pedestal ? pedestal.cell[0] + 0.5 : 4.5;
      const kz = pedestal ? pedestal.cell[1] + 0.5 : 4.5;
      if (Math.hypot(p.x - kx, p.z - kz) <= INTERACT_RANGE) {
        room.keyTaken = true;
        p.keys.push(room.keyColor);
        this.emit({ t: "keyPickup", color: room.keyColor, by: p.name, room: room.coordId });
        return;
      }
    }

    // 2. levers
    for (const prop of template.props) {
      if (prop.type !== "lever") continue;
      if (propId && prop.id !== propId) continue;
      const d = Math.hypot(p.x - (prop.cell[0] + 0.5), p.z - (prop.cell[1] + 0.5));
      if (d <= INTERACT_RANGE) {
        const evs = this.roomEvents.get(room.coordId) ?? [];
        evs.push({ type: "leverPull", leverId: prop.id ?? "", playerId: sessionId });
        this.roomEvents.set(room.coordId, evs);
        return;
      }
    }

    // 3. NESW doors
    const door = this.nearestDoor(p, room, ["N", "E", "S", "W"], false);
    if (door) {
      const check = canOpenGate(this.gateOf(door), this.gateCtx(p, room, door));
      if (check.ok) {
        this.openDoorBothSides(room, door);
        this.emit({ t: "doorOpen", room: room.coordId, face: door.face });
      } else {
        this.emit({ t: "message", text: check.reason, only: sessionId });
      }
      return;
    }

    // 4. U hatch (per-use lift check, door never latches)
    const uDoor = room.doors.find((d) => d.face === "U");
    if (uDoor) {
      const d = Math.hypot(p.x - (uDoor.cellX + 0.5), p.z - (uDoor.cellZ + 0.5));
      if (d <= INTERACT_RANGE) {
        const check = canOpenGate({ type: "lift" }, this.gateCtx(p, room, uDoor));
        if (check.ok) {
          this.transition(p, "U");
        } else {
          this.emit({ t: "message", text: check.reason, only: sessionId });
        }
        return;
      }
    }

    // 5. D hatch — always usable
    const dDoor = room.doors.find((d) => d.face === "D");
    if (dDoor) {
      const d = Math.hypot(p.x - (dDoor.cellX + 0.5), p.z - (dDoor.cellZ + 0.5));
      if (d <= INTERACT_RANGE) {
        this.transition(p, "D");
        return;
      }
    }
  }

  useAbility(sessionId: string, slot: number, aimYaw?: number): void {
    const p = this.state.players.get(sessionId);
    if (!p || this.state.phase !== "running") return;
    const room = this.state.rooms.get(p.roomCoord);
    if (!room) return;
    const charDef = CHARACTERS[p.charId as CharId];
    if (!charDef) return;
    const abilityId =
      slot === 3 ? ("punch" as const) : charDef.abilities[slot as 0 | 1 | 2];
    if (!abilityId) return;

    const template = getTemplate(room.templateId);
    const tiles = this.tilesOf(room.templateId);
    const crackedCells: [number, number][] = [];
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) {
        if (tiles[z]![x] === "cracked" && !room.breachHoles.includes(`${x},${z}`)) {
          crackedCells.push([x, z]);
        }
      }
    void template;

    const below = neighborCoord(parseCoordId(p.roomCoord), "D");
    const ctx: AbilityCtx = {
      caster: this.rulePlayer(p),
      yaw: aimYaw ?? p.yaw,
      tick: this.state.tick,
      cooldownUntil: p.cooldowns[slot] ?? 0,
      doors: room.doors
        .filter((d) => d.face !== "U" && d.face !== "D")
        .map((d) => this.doorInfo(d)),
      crackedCells,
      mobs: [...room.mobs.values()]
        .filter((m) => !m.friendly && m.hp > 0)
        .map((m) => ({ id: m.id, x: m.x, z: m.z, hp: m.hp })),
      bypassUsedInRoom: room.bypassUsed,
      belowExists: this.state.rooms.has(coordId(below)),
    };
    const result = executeAbility(abilityId, ctx);
    if (!result.ok) {
      this.emit({ t: "message", text: result.reason, only: sessionId });
      return;
    }
    p.cooldowns[slot] = result.cooldownUntil;
    this.applyEffects(result.effects, room, sessionId);
    this.emit({ t: "ability", ability: abilityId, by: p.name, sid: sessionId, room: room.coordId });
  }

  ping(sessionId: string, kind: string, x: number, z: number): void {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    this.emit({ t: "ping", kind, x, z, room: p.roomCoord, by: p.name, charId: p.charId });
  }

  emote(sessionId: string, kind: string): void {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    p.emote = kind;
    p.emoteUntil = this.state.tick + 2 * TICK_RATE;
    this.emit({ t: "emote", kind, by: p.name, room: p.roomCoord });
  }

  // ---------------- tick ----------------

  tick(): void {
    this.state.tick++;
    if (this.state.phase !== "running") return;
    const tick = this.state.tick;

    // refill input budgets
    for (const [id] of this.state.players) {
      const budget = Math.min(
        STEP_BUDGET_CAPACITY,
        (this.stepBudget.get(id) ?? STEP_BUDGET_CAPACITY) +
          MAX_INPUT_STEPS_PER_SEC * TICK_DT,
      );
      this.stepBudget.set(id, budget);
    }

    // 1. movement
    this.state.players.forEach((p, id) => {
      this.processMovement(p, id);
    });

    // 2. per-room updates (only rooms with players stay hot)
    const hotRooms = new Set<string>();
    this.state.players.forEach((p) => hotRooms.add(p.roomCoord));

    for (const coord of hotRooms) {
      const room = this.state.rooms.get(coord);
      if (!room) continue;
      this.updateRoom(room, tick);
    }

    // expire deployables & emotes everywhere (cheap)
    this.state.rooms.forEach((room) => {
      for (let i = room.deployables.length - 1; i >= 0; i--) {
        if (room.deployables[i]!.untilTick <= tick) room.deployables.splice(i, 1);
      }
      room.mobs.forEach((m, key) => {
        if (m.friendly && m.stateUntil <= tick && m.targetId === "expire") {
          room.mobs.delete(key);
        }
      });
    });

    // 3. downed timers / deaths / revives
    this.state.players.forEach((p, id) => {
      this.updateVitals(p, id, tick);
    });
  }

  private processMovement(p: PlayerState, sessionId: string): void {
    const q = this.inputQueues.get(sessionId);
    if (!q || q.length === 0) return;
    const room = this.state.rooms.get(p.roomCoord);
    if (!room) return;
    let budget = this.stepBudget.get(sessionId) ?? 0;
    const charDef = CHARACTERS[p.charId as CharId];
    const speedMult = charDef?.speedMult ?? 1;

    while (q.length > 0 && budget >= 1) {
      const step = q.shift()!;
      budget -= 1;
      p.yaw = step.yaw;
      this.holdFlags.set(sessionId, step.hold);
      if (p.downed) {
        p.lastProcessedSeq = step.seq;
        continue;
      }
      const ctx = this.moveContext(room, p);
      const res = stepPlayer(
        { x: p.x, y: p.y, z: p.z, vy: 0 },
        { seq: step.seq, mx: step.mx, mz: step.mz, yaw: step.yaw, jump: step.jump },
        CLIENT_SIM_DT,
        ctx,
        speedMult,
      );
      p.x = res.state.x;
      p.z = res.state.z;
      p.lastProcessedSeq = step.seq;
      if (res.exitFace) {
        this.transition(p, res.exitFace);
        q.length = 0; // drop the rest; client reconciles in the new room
        break;
      }
      // breach holes: fall through
      const holeKey = `${Math.floor(p.x)},${Math.floor(p.z)}`;
      if (room.breachHoles.includes(holeKey)) {
        this.transition(p, "D");
        this.damagePlayer(p, sessionId, 5, "fall");
        q.length = 0;
        break;
      }
    }
    this.stepBudget.set(sessionId, budget);
  }

  private updateRoom(room: RoomState, tick: number): void {
    const template = getTemplate(room.templateId);
    const playersHere = this.playersIn(room.coordId);

    // lift power: any plate held, any token, any fieldkit
    const tiles = this.tilesOf(room.templateId);
    const plateCells: [number, number][] = [];
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) if (tiles[z]![x] === "plate") plateCells.push([x, z]);
    const standing = this.platePressCount(room, plateCells);
    const fieldkitActive = room.deployables.some(
      (dep) => dep.kind === "fieldkit" && dep.untilTick > tick,
    );
    room.liftPowered = standing > 0 || fieldkitActive;

    // auto-open plates-gated doors
    for (const door of room.doors) {
      if (door.gateType === "plates" && !door.open) {
        if (standing >= door.gateValue) {
          this.openDoorBothSides(room, door);
          this.emit({ t: "doorOpen", room: room.coordId, face: door.face });
        }
      }
    }

    // room logic
    if (template.logicId) {
      const mod = ROOM_LOGIC.get(template.logicId);
      if (mod) {
        const scratch = this.logicScratch.get(room.coordId) ?? {};
        this.logicScratch.set(room.coordId, scratch);
        const events = this.roomEvents.get(room.coordId) ?? [];
        this.roomEvents.set(room.coordId, []);
        const elapsed =
          room.enteredTick >= 0 ? (tick - room.enteredTick) * TICK_DT : 0;
        const result = mod.tick({
          params: template.logicParams,
          tick,
          dt: TICK_DT,
          elapsedSeconds: elapsed,
          cleared: room.cleared,
          playersInRoom: playersHere.map(([, p]) => this.rulePlayer(p)),
          platePressCount: (cells) => this.platePressCount(room, cells),
          mobsAlive: [...room.mobs.values()].filter((m) => !m.friendly && m.hp > 0)
            .length,
          mobsSpawned: room.mobsSpawned,
          events,
          state: scratch,
          holdingNear: (playerId, cell, range) => {
            const pl = this.state.players.get(playerId);
            if (!pl || !this.holdFlags.get(playerId)) return false;
            return (
              Math.hypot(pl.x - (cell[0] + 0.5), pl.z - (cell[1] + 0.5)) <= range
            );
          },
        });
        if (typeof scratch.progress === "number") {
          room.logicProgress = scratch.progress;
        }
        // channel rooms publish hold progress as a 0-100 percentage for the HUD
        if (template.logicId === "exit_terminal" || template.logicId === "gas_room") {
          const holdTicks = (scratch.holdTicks ?? {}) as Record<string, number>;
          const needed =
            ((template.logicParams.channelSeconds as number) ?? 5) * TICK_RATE;
          const best = Math.max(0, ...Object.values(holdTicks));
          room.logicProgress = room.cleared
            ? 100
            : Math.min(99, Math.round((best / needed) * 100));
        }
        this.applyEffects(result.effects, room, null);
      }
    }

    // mobs
    const solid = this.solidFn(room);
    const targets: MobTargetView[] = [
      ...playersHere.map(([id, p]) => ({
        id,
        x: p.x,
        z: p.z,
        downed: p.downed,
        isTurretDecoy: false,
      })),
      ...[...room.mobs.values()]
        .filter((m) => m.friendly && m.hp > 0)
        .map((m) => ({ id: m.id, x: m.x, z: m.z, downed: false, isTurretDecoy: true })),
    ];
    room.mobs.forEach((mob) => {
      if (mob.friendly) {
        this.friendlyTurretFire(room, mob, tick);
        return;
      }
      if (mob.hp <= 0) return;
      const sim: MobSim = {
        id: mob.id,
        kind: mob.kind as MobKind,
        x: mob.x,
        z: mob.z,
        hp: mob.hp,
        ai: mob.ai as MobSim["ai"],
        stateUntil: mob.stateUntil,
        targetId: mob.targetId,
        slowMult: mob.slowMult,
        slowUntil: mob.slowUntil,
        staggerUntil: mob.staggerUntil,
      };
      const { mob: next, effects } = stepMob(sim, targets, solid, tick, TICK_DT);
      mob.x = next.x;
      mob.z = next.z;
      mob.ai = next.ai;
      mob.stateUntil = next.stateUntil;
      mob.targetId = next.targetId;
      this.applyEffects(effects, room, null);
    });

    // fieldkit healing pulses
    if (tick % 10 === 0) {
      for (const dep of room.deployables) {
        if (dep.kind !== "fieldkit") continue;
        for (const [id, p] of playersHere) {
          void id;
          if (Math.hypot(p.x - dep.x, p.z - dep.z) <= FIELDKIT_RADIUS) {
            p.hp = Math.min(p.maxHp, p.hp + FIELDKIT_HEAL_PER_SEC / 2);
          }
        }
      }
    }
  }

  private updateVitals(p: PlayerState, sessionId: string, tick: number): void {
    if (p.downed) {
      // revive by teammates holding interact nearby
      let reviving = false;
      this.state.players.forEach((mate, mateId) => {
        if (mateId === sessionId || mate.downed) return;
        if (mate.roomCoord !== p.roomCoord) return;
        if (!this.holdFlags.get(mateId)) return;
        if (Math.hypot(mate.x - p.x, mate.z - p.z) <= 1.6) reviving = true;
      });
      if (reviving) {
        p.reviveProgress += 1;
        if (p.reviveProgress >= REVIVE_HOLD * TICK_RATE) {
          p.downed = false;
          p.reviveProgress = 0;
          p.hp = Math.round(p.maxHp * 0.4);
          this.emit({ t: "revived", who: p.name, room: p.roomCoord });
        }
      } else {
        p.reviveProgress = Math.max(0, p.reviveProgress - 2);
      }
      if (p.downed && tick >= p.downedUntil) {
        // bleed out → respawn at anchor
        p.deaths += 1;
        p.downed = false;
        p.reviveProgress = 0;
        p.hp = Math.round(p.maxHp * RESPAWN_HP_FRACTION);
        const anchor = this.state.rooms.get(p.anchorCoord) ?? this.state.rooms.get(this.state.spawn);
        if (anchor) {
          const t = getTemplate(anchor.templateId);
          const cell = t.spawnCells[0]!;
          p.roomCoord = anchor.coordId;
          p.x = cell[0] + 0.5;
          p.z = cell[1] + 0.5;
        }
        this.emit({ t: "message", text: `${p.name} bled out and wakes at the anchor.` });
      }
    }
  }

  // ---------------- effects ----------------

  applyEffects(effects: Effect[], room: RoomState, actorId: string | null): void {
    for (const e of effects) {
      switch (e.type) {
        case "damagePlayer": {
          const p = this.state.players.get(e.playerId);
          if (p) this.damagePlayer(p, e.playerId, e.amount, e.cause);
          break;
        }
        case "healPlayer": {
          const p = this.state.players.get(e.playerId);
          if (p && !p.downed) p.hp = Math.min(p.maxHp, p.hp + e.amount);
          break;
        }
        case "damageMob": {
          const mob = [...room.mobs.values()].find((m) => m.id === e.mobId);
          if (!mob || mob.hp <= 0) break;
          mob.hp -= e.amount;
          if (e.staggerSeconds)
            mob.staggerUntil = this.state.tick + Math.round(e.staggerSeconds * TICK_RATE);
          if (e.slowMult && e.slowSeconds) {
            mob.slowMult = e.slowMult;
            mob.slowUntil = this.state.tick + Math.round(e.slowSeconds * TICK_RATE);
          }
          this.emit({ t: "hit", mobId: mob.id, room: room.coordId, amount: e.amount });
          if (mob.hp <= 0) {
            this.emit({ t: "mobDie", mobId: mob.id, kind: mob.kind, room: room.coordId });
            if (actorId && !mob.friendly) {
              const killer = this.state.players.get(actorId);
              if (killer) {
                killer.kills += 1;
                killer.exp += EXP.mobKill;
              }
            }
            room.mobs.delete(mob.id);
          }
          break;
        }
        case "openDoorFace": {
          const door = room.doors.find((d) => d.face === e.face);
          if (door && !door.open) {
            this.openDoorBothSides(room, door);
            this.emit({ t: "doorOpen", room: room.coordId, face: e.face });
          }
          break;
        }
        case "setWalkable": {
          for (const c of e.cells) {
            if (e.on && !room.walkableOverrides.includes(c)) {
              room.walkableOverrides.push(c);
            }
          }
          break;
        }
        case "clearObjective": {
          if (!room.cleared) {
            room.cleared = true;
            this.emit({ t: "objective", room: room.coordId });
            for (const [, p] of this.playersIn(room.coordId)) {
              p.objectives += 1;
              p.exp += EXP.objectiveCleared;
            }
            if (room.coordId === this.state.exit) this.completeMatch();
          }
          break;
        }
        case "spawnTriggeredMobs":
          this.spawnMobs(room, true);
          break;
        case "revealAdjacent": {
          const c = parseCoordId(room.coordId);
          for (const face of ["N", "E", "S", "W", "U", "D"] as Face[]) {
            const n = coordId(neighborCoord(c, face));
            const nRoom = this.state.rooms.get(n);
            if (nRoom) this.reveal(nRoom);
          }
          this.emit({ t: "message", text: "Adjacent rooms scouted." });
          break;
        }
        case "breachFloor": {
          const key = `${e.cell[0]},${e.cell[1]}`;
          if (!room.breachHoles.includes(key)) room.breachHoles.push(key);
          this.emit({ t: "breach", room: room.coordId, cell: key });
          break;
        }
        case "placeHoldfast":
        case "placeFieldkit": {
          const dep = new Deployable();
          dep.id = `dep${++this.idCounter}`;
          dep.kind = e.type === "placeHoldfast" ? "token" : "fieldkit";
          dep.x = e.x;
          dep.z = e.z;
          dep.untilTick = e.untilTick;
          dep.ownerId = actorId ?? "";
          room.deployables.push(dep);
          break;
        }
        case "deployTurret": {
          const m = new MobState();
          m.id = `fturret${++this.idCounter}`;
          m.kind = "turret";
          m.friendly = true;
          m.x = e.x;
          m.z = e.z;
          m.hp = DEPLOY_TURRET_HP;
          m.maxHp = DEPLOY_TURRET_HP;
          m.stateUntil = e.untilTick;
          m.targetId = "expire";
          room.mobs.set(m.id, m);
          break;
        }
        case "setGrapple": {
          const p = this.state.players.get(e.playerId);
          if (p) p.grappleUntil = e.untilTick;
          break;
        }
        case "message":
          this.emit({ t: "message", text: e.text });
          break;
      }
    }
  }

  private damagePlayer(p: PlayerState, sessionId: string, amount: number, cause: string): void {
    if (p.downed || this.state.phase !== "running") return;
    p.hp -= amount;
    this.emit({ t: "hit", playerId: sessionId, amount, cause });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.reviveProgress = 0;
      p.downedUntil = this.state.tick + DOWNED_DURATION * TICK_RATE;
      this.emit({ t: "downed", who: p.name, room: p.roomCoord });
    }
  }

  // ---------------- transitions & doors ----------------

  private transition(p: PlayerState, face: Face): void {
    const targetCoord = coordId(neighborCoord(parseCoordId(p.roomCoord), face));
    const target = this.state.rooms.get(targetCoord);
    if (!target) return;
    const arrivalFace = OPPOSITE_FACE[face];
    const arrivalDoor = target.doors.find((d) => d.face === arrivalFace);
    const template = getTemplate(target.templateId);
    let cell: readonly [number, number];
    if (arrivalDoor) {
      cell = [arrivalDoor.cellX, arrivalDoor.cellZ];
    } else {
      const slot = template.doorSlots[FACE_INDEX[arrivalFace]];
      cell = slot?.cell ?? template.spawnCells[0]!;
    }
    const pos = doorSlotToSpawnPosition(arrivalFace, cell);
    p.roomCoord = targetCoord;
    p.x = pos.x;
    p.z = pos.z;
    p.y = 0;
    this.markVisited(target, p);
    this.emit({ t: "transition", who: p.sessionId, room: targetCoord, face });
  }

  private markVisited(room: RoomState, enteringPlayer: PlayerState): void {
    if (!room.visited) {
      room.visited = true;
      room.enteredTick = this.state.tick;
      enteringPlayer.roomsVisited += 1;
      enteringPlayer.exp += EXP.roomFirstVisit;
      this.spawnMobs(room, false);
      this.reveal(room);
    }
    const template = getTemplate(room.templateId);
    if (template.archetype === "sanctuary") {
      enteringPlayer.anchorCoord = room.coordId;
    }
  }

  private spawnMobs(room: RoomState, triggered: boolean): void {
    const template = getTemplate(room.templateId);
    let any = false;
    // don't swarm small parties
    let connectedPlayers = 0;
    this.state.players.forEach((pl) => {
      if (pl.connected) connectedPlayers++;
    });
    const maxHostiles = 1 + Math.max(1, connectedPlayers);
    let spawned = 0;
    for (const prop of template.props) {
      if (prop.type !== "mob_spawn") continue;
      const isTriggered = prop.meta?.trigger === "objective";
      if (isTriggered !== triggered) continue;
      if (!triggered && ++spawned > maxHostiles) continue;
      const kind = (prop.meta?.kind ?? "slime") as MobKind;
      const m = new MobState();
      m.id = `${room.coordId}:${prop.id ?? `mob${++this.idCounter}`}`;
      m.kind = kind;
      m.x = prop.cell[0] + 0.5;
      m.z = prop.cell[1] + 0.5;
      m.hp = MOB_DEFS[kind].hp;
      m.maxHp = MOB_DEFS[kind].hp;
      room.mobs.set(m.id, m);
      any = true;
    }
    if (any) room.mobsSpawned = true;
  }

  private openDoorBothSides(room: RoomState, door: DoorState): void {
    door.open = true;
    const other = this.twinDoor(room, door);
    if (other) other.open = true;
  }

  private twinDoor(room: RoomState, door: DoorState): DoorState | null {
    const nCoord = coordId(
      neighborCoord(parseCoordId(room.coordId), door.face as Face),
    );
    const nRoom = this.state.rooms.get(nCoord);
    if (!nRoom) return null;
    return (
      nRoom.doors.find((d) => d.face === OPPOSITE_FACE[door.face as Face]) ?? null
    );
  }

  private reveal(room: RoomState): void {
    if (this.state.revealed.has(room.coordId)) return;
    const template = getTemplate(room.templateId);
    const gates = room.doors
      .map((d) => `${d.face}:${d.gateType}${d.gateParam ? ":" + d.gateParam : ""}`)
      .join(",");
    this.state.revealed.set(
      room.coordId,
      `${room.templateId}|${template.archetype}|${gates}`,
    );
  }

  private completeMatch(): void {
    this.state.phase = "complete";
    this.state.matchResult = "victory";
    this.state.endedTick = this.state.tick;
    this.state.players.forEach((p) => {
      const finalExp = calculateExp({
        roomsVisited: p.roomsVisited,
        objectivesCleared: p.objectives,
        mobKills: p.kills,
        deaths: p.deaths,
        reachedExit: true,
        // risk bonus proxy: flawless runners get their objectives counted again
        hazardRoomsClearedNoDeath: p.deaths === 0 ? p.objectives : 0,
        finishedAlive: !p.downed,
      });
      p.exp = finalExp;
    });
    this.emit({ t: "matchComplete", result: "victory" });
  }

  // ---------------- helpers ----------------

  drainEvents(): ServerEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(e: ServerEvent): void {
    this.events.push(e);
  }

  private playersIn(coord: string): [string, PlayerState][] {
    const out: [string, PlayerState][] = [];
    this.state.players.forEach((p, id) => {
      if (p.roomCoord === coord && p.connected) out.push([id, p]);
    });
    return out;
  }

  private platePressCount(
    room: RoomState,
    cells: readonly (readonly [number, number])[],
  ): number {
    let count = 0;
    for (const [, p] of this.playersIn(room.coordId)) {
      if (p.downed) continue;
      const px = Math.floor(p.x);
      const pz = Math.floor(p.z);
      if (cells.some((c) => c[0] === px && c[1] === pz)) count++;
    }
    // hold-fast tokens count toward any plate requirement in the room
    for (const dep of room.deployables) {
      if (dep.kind === "token" && dep.untilTick > this.state.tick) count++;
    }
    return count;
  }

  private tilesOf(templateId: string): TileType[][] {
    let tiles = this.tileCache.get(templateId);
    if (!tiles) {
      tiles = parseTiles(getTemplate(templateId));
      this.tileCache.set(templateId, tiles);
    }
    return tiles;
  }

  private solidPropsOf(templateId: string): Set<string> {
    let props = this.propCache.get(templateId);
    if (!props) {
      props = new Set(
        getTemplate(templateId)
          .props.filter((p) => SOLID_PROP_TYPES.has(p.type))
          .map((p) => `${p.cell[0]},${p.cell[1]}`),
      );
      this.propCache.set(templateId, props);
    }
    return props;
  }

  private moveContext(room: RoomState, p: PlayerState): MoveContext {
    const openDoors: MoveContext["openDoors"] = {};
    for (const d of room.doors) {
      if (d.open && (d.face === "N" || d.face === "E" || d.face === "S" || d.face === "W")) {
        openDoors[d.face] = [d.cellX, d.cellZ];
      }
    }
    return {
      tiles: this.tilesOf(room.templateId),
      solidProps: this.solidPropsOf(room.templateId),
      walkableOverrides: new Set(room.walkableOverrides),
      openDoors,
      ignorePits: p.grappleUntil > this.state.tick,
    };
  }

  private solidFn(room: RoomState): (tx: number, tz: number) => boolean {
    const ctx: MoveContext = {
      tiles: this.tilesOf(room.templateId),
      solidProps: this.solidPropsOf(room.templateId),
      walkableOverrides: new Set(room.walkableOverrides),
      openDoors: {},
      ignorePits: false,
    };
    return (tx, tz) => {
      if (tx < 0 || tx >= 9 || tz < 0 || tz >= 9) return true;
      if (ctx.solidProps.has(`${tx},${tz}`)) return true;
      const tile = ctx.tiles[tz]![tx]!;
      if (tile === "pit" || tile === "void") {
        return !ctx.walkableOverrides.has(`${tx},${tz}`);
      }
      return false;
    };
  }

  private friendlyTurretFire(room: RoomState, turret: MobState, tick: number): void {
    if (turret.hp <= 0) {
      room.mobs.delete(turret.id);
      return;
    }
    if (turret.slowUntil > tick) return; // reused as fire cooldown for friendly turrets
    let best: MobState | undefined;
    let bestD = 6.5;
    room.mobs.forEach((m) => {
      if (m.friendly || m.hp <= 0) return;
      const d = Math.hypot(m.x - turret.x, m.z - turret.z);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    });
    if (best) {
      this.applyEffects(
        [{ type: "damageMob", mobId: best.id, amount: DEPLOY_TURRET_DMG }],
        room,
        turret.targetId !== "expire" ? turret.targetId : null,
      );
      turret.slowUntil = tick + Math.round(TICK_RATE / DEPLOY_TURRET_RATE);
    }
  }

  private nearestDoor(
    p: PlayerState,
    room: RoomState,
    faces: Face[],
    includeOpen: boolean,
  ): DoorState | null {
    let best: DoorState | null = null;
    let bestD = INTERACT_RANGE;
    for (const d of room.doors) {
      if (!faces.includes(d.face as Face)) continue;
      if (!includeOpen && d.open) continue;
      const dist = Math.hypot(p.x - (d.cellX + 0.5), p.z - (d.cellZ + 0.5));
      if (dist <= bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  private gateOf(door: DoorState): Gate {
    switch (door.gateType) {
      case "key":
        return { type: "key", color: door.gateParam };
      case "plates":
        return { type: "plates", count: door.gateValue };
      case "stat":
        return {
          type: "stat",
          stat: door.gateParam as "might" | "wits",
          threshold: door.gateValue,
        };
      case "objective":
        return { type: "objective" };
      case "lift":
        return { type: "lift" };
      case "oneway":
        return { type: "oneway" };
      default:
        return { type: "open" };
    }
  }

  private gateCtx(p: PlayerState, room: RoomState, door: DoorState) {
    const playersNear: RulePlayer[] = [];
    for (const [, mate] of this.playersIn(room.coordId)) {
      if (mate.downed) continue;
      const d = Math.hypot(mate.x - (door.cellX + 0.5), mate.z - (door.cellZ + 0.5));
      if (d <= STAT_DOOR_RANGE) playersNear.push(this.rulePlayer(mate));
    }
    const owner = door.ownerCoord
      ? this.state.rooms.get(door.ownerCoord)
      : room;
    const tiles = this.tilesOf(room.templateId);
    const plateCells: [number, number][] = [];
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) if (tiles[z]![x] === "plate") plateCells.push([x, z]);
    return {
      playersNear,
      interactor: this.rulePlayer(p),
      activePlateCount: this.platePressCount(room, plateCells),
      roomCleared: owner?.cleared ?? false,
      liftPowered:
        room.liftPowered ||
        room.deployables.some(
          (dep) => dep.kind === "fieldkit" && dep.untilTick > this.state.tick,
        ),
      tick: this.state.tick,
    };
  }

  private doorInfo(d: DoorState): DoorInfo {
    return {
      face: d.face as Face,
      gate: this.gateOf(d),
      open: d.open,
      cell: [d.cellX, d.cellZ],
    };
  }

  private rulePlayer(p: PlayerState): RulePlayer {
    const def = CHARACTERS[p.charId as CharId];
    return {
      id: p.sessionId,
      charId: (p.charId || "scout") as CharId,
      x: p.x,
      z: p.z,
      might: def?.might ?? 3,
      wits: def?.wits ?? 3,
      keys: [...p.keys.values()],
      grappleActiveUntil: p.grappleUntil,
      downed: p.downed,
    };
  }
}

export function edgeIdFor(roomCoordId: string, face: string): string {
  const c = parseCoordId(roomCoordId);
  const n = neighborCoord(c, face as Face);
  const a = roomCoordId;
  const b = coordId(n);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
