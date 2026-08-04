import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

/** Colyseus schemas mirror shared types. Server writes, clients read. */

export class DoorState extends Schema {
  @type("string") face = "N";
  @type("string") gateType = "open";
  /** key color or stat name */
  @type("string") gateParam = "";
  /** plates count or stat threshold */
  @type("number") gateValue = 0;
  @type("boolean") open = false;
  @type("number") cellX = 4;
  @type("number") cellZ = 0;
  /** shared with the twin door on the other side */
  @type("string") edgeId = "";
  /** coordId whose objective controls this door (objective gates) */
  @type("string") ownerCoord = "";
}

export class MobState extends Schema {
  @type("string") id = "";
  @type("string") kind = "slime";
  @type("number") x = 4.5;
  @type("number") z = 4.5;
  @type("number") hp = 30;
  @type("number") maxHp = 30;
  @type("string") ai = "idle";
  /** deployed tinker turret */
  @type("boolean") friendly = false;
  @type("number") staggerUntil = 0;
  @type("number") slowUntil = 0;
  @type("number") slowMult = 1;
  /** internal AI timer, synced for telegraphs (windup flash) */
  @type("number") stateUntil = 0;
  @type("string") targetId = "";
}

/** pushable/breakable environment object (crate, barrel) */
export class DynProp extends Schema {
  @type("string") id = "";
  @type("string") kind = "crate";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") hp = 25;
  @type("number") maxHp = 25;
}

export class Deployable extends Schema {
  @type("string") id = "";
  /** holdfast token | fieldkit */
  @type("string") kind = "token";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") untilTick = 0;
  @type("string") ownerId = "";
}

export class RoomState extends Schema {
  @type("string") coordId = "";
  @type("string") templateId = "";
  @type([DoorState]) doors = new ArraySchema<DoorState>();
  @type({ map: MobState }) mobs = new MapSchema<MobState>();
  @type([Deployable]) deployables = new ArraySchema<Deployable>();
  @type({ map: DynProp }) dynProps = new MapSchema<DynProp>();
  @type("boolean") cleared = false;
  @type("boolean") visited = false;
  @type("string") keyColor = "";
  @type("boolean") keyTaken = false;
  @type(["string"]) walkableOverrides = new ArraySchema<string>();
  /** cells breached open by the Brute ("x,z") — fall-through shortcuts */
  @type(["string"]) breachHoles = new ArraySchema<string>();
  @type("boolean") liftPowered = false;
  @type("number") enteredTick = -1;
  @type("boolean") mobsSpawned = false;
  /** levers puzzle progress for lamp rendering */
  @type("number") logicProgress = 0;
  /** tinker bypass already spent in this room */
  @type("boolean") bypassUsed = false;
}

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("string") charId = "";
  @type("boolean") ready = false;
  @type("boolean") connected = true;

  @type("string") roomCoord = "0,0,0";
  @type("number") x = 4.5;
  @type("number") y = 0;
  @type("number") z = 4.5;
  @type("number") yaw = 0;
  @type("number") lastProcessedSeq = -1;

  @type("number") hp = 100;
  @type("number") maxHp = 100;
  @type("boolean") downed = false;
  @type("number") downedUntil = 0;
  @type("number") reviveProgress = 0;

  @type(["string"]) keys = new ArraySchema<string>();
  /** ability cooldown expiry ticks, slots 0..2 + universal strike at 3 */
  @type(["number"]) cooldowns = new ArraySchema<number>(0, 0, 0, 0);
  @type("number") grappleUntil = 0;

  @type("string") anchorCoord = "0,0,0";

  @type("number") exp = 0;
  @type("number") kills = 0;
  @type("number") deaths = 0;
  @type("number") roomsVisited = 0;
  @type("number") objectives = 0;

  @type("string") emote = "";
  @type("number") emoteUntil = 0;
}

export class MatchState extends Schema {
  @type("string") phase = "lobby"; // lobby | running | complete
  @type("number") seed = 0;
  @type("number") tick = 0;
  @type("string") spawn = "0,0,0";
  @type("string") exit = "2,2,2";
  @type({ map: RoomState }) rooms = new MapSchema<RoomState>();
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  /** team map knowledge: coordId -> "templateId|archetype|N:key,E:open,..." */
  @type({ map: "string" }) revealed = new MapSchema<string>();
  @type("string") matchResult = "";
  /** JSON SolverCaps used at generation — the ground truth for bots/replays */
  @type("string") genCaps = "";
  @type("number") startedTick = 0;
  @type("number") endedTick = 0;
}
