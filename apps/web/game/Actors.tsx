"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { CHARACTERS, type CharId } from "@cubescape/shared";
import type { MobView, NetClient, PlayerView } from "./net";
import {
  BarrelMesh,
  CharacterModel,
  CrateMesh,
  LockboxMesh,
  SlimeMesh,
  TurretMesh,
  poseRig,
} from "./CharacterModel";
import { camInfo, useGame } from "./store";

/** Re-render list-y things only when membership changes. */
function useRoster(net: NetClient, roomCoord: string) {
  const [version, setVersion] = useState(0);
  const lastKey = useRef("");
  useFrame(() => {
    const s = net.state;
    if (!s) return;
    const players: string[] = [];
    s.players.forEach((p, id) => {
      if (p.roomCoord === roomCoord) players.push(id);
    });
    const room = s.rooms.get(roomCoord);
    const mobs: string[] = [];
    room?.mobs.forEach((_, id) => mobs.push(id));
    const key =
      players.sort().join(",") + "|" + mobs.sort().join(",") + "|" + (room?.deployables.length ?? 0);
    if (key !== lastKey.current) {
      lastKey.current = key;
      setVersion((v) => v + 1);
    }
  });
  return version;
}

export function Actors({ net, roomCoord }: { net: NetClient; roomCoord: string }) {
  useRoster(net, roomCoord);
  const s = net.state;
  if (!s) return null;
  const players: [string, PlayerView][] = [];
  s.players.forEach((p, id) => {
    if (p.roomCoord === roomCoord) players.push([id, p]);
  });
  const room = s.rooms.get(roomCoord);
  const mobs: [string, MobView][] = [];
  room?.mobs.forEach((m, id) => mobs.push([id, m]));

  return (
    <group>
      {players.map(([id]) => (
        <PlayerRig key={`rig-${id}`} net={net} sessionId={id} />
      ))}
      {mobs.map(([id]) => (
        <Mob key={id} net={net} roomCoord={roomCoord} mobId={id} />
      ))}
      <DeathBursts net={net} roomCoord={roomCoord} />
    </group>
  );
}

/** soft fake contact shadow — grounds actors on the floor */
function BlobShadow({ radius = 0.36 }: { radius?: number }) {
  return (
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 20]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.42} depthWrite={false} />
    </mesh>
  );
}

/** short-lived pop when a mob dies: expanding ring + flying shards */
function DeathBursts({ net, roomCoord }: { net: NetClient; roomCoord: string }) {
  const [, force] = useState(0);
  const lastCount = useRef(0);
  useFrame(() => {
    const n = net.bursts(roomCoord).length;
    if (n !== lastCount.current) {
      lastCount.current = n;
      force((v) => v + 1);
    }
  });
  const bursts = net.bursts(roomCoord);
  return (
    <group>
      {bursts.map((b) => (
        <Burst key={b.at} x={b.x} z={b.z} at={b.at} kind={b.kind} />
      ))}
    </group>
  );
}

const SHARD_ANGLES = [0.4, 1.5, 2.6, 3.7, 4.8, 5.9];

const BURST_COLORS: Record<string, { ring: string; shard: string; glow: string }> = {
  mob: { ring: "#8adf5a", shard: "#68b043", glow: "#8adf5a" },
  crate: { ring: "#c9a06a", shard: "#7a5c38", glow: "#e2b87a" },
  barrel: { ring: "#9aa4b8", shard: "#4a5468", glow: "#aab6d0" },
};

function Burst({
  x,
  z,
  at,
  kind = "mob",
}: {
  x: number;
  z: number;
  at: number;
  kind?: string;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const shards = useRef<THREE.Group>(null);
  useFrame(() => {
    const age = (Date.now() - at) / 600; // 0..1
    const t = Math.min(1, age);
    if (ring.current) {
      ring.current.scale.setScalar(0.3 + t * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    }
    if (shards.current) {
      shards.current.children.forEach((c, i) => {
        const a = SHARD_ANGLES[i]!;
        const d = 0.2 + t * 1.1;
        c.position.set(Math.sin(a) * d, 0.35 + t * 0.9 - t * t * 1.3, Math.cos(a) * d);
        c.rotation.x = t * 7 + i;
        c.rotation.y = t * 5;
        c.scale.setScalar(Math.max(0.01, 1 - t));
      });
    }
  });
  const colors = BURST_COLORS[kind] ?? BURST_COLORS.mob!;
  return (
    <group position={[x, 0, z]}>
      <mesh ref={ring} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.62, 24]} />
        <meshBasicMaterial color={colors.ring} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <group ref={shards}>
        {SHARD_ANGLES.map((a) => (
          <mesh key={a}>
            <boxGeometry args={[0.11, 0.11, 0.11]} />
            <meshStandardMaterial
              color={colors.shard}
              emissive={colors.glow}
              emissiveIntensity={kind === "mob" ? 1.4 : 0.5}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function PlayerRig({ net, sessionId }: { net: NetClient; sessionId: string }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const carryRef = useRef<THREE.Group>(null);
  const walkPhase = useRef(0);
  const smoothed = useRef<{ x: number; z: number; yaw: number } | null>(null);
  const isLocal = net.room?.sessionId === sessionId;

  const p = net.state?.players.get(sessionId);
  const charId = (p?.charId || "scout") as CharId;
  const def = CHARACTERS[charId];
  const color = def?.color ?? "#cccccc";

  useFrame((_, dt) => {
    const s = net.state;
    const pl = s?.players.get(sessionId);
    if (!pl || !group.current) return;
    let tx = pl.x;
    let tz = pl.z;
    let ty = pl.y;
    let tyaw = pl.yaw;
    let moving = false;
    if (isLocal) {
      const g = useGame.getState();
      tx = g.px;
      tz = g.pz;
      ty = g.py;
      tyaw = g.yaw;
      if (smoothed.current) {
        moving = Math.hypot(tx - smoothed.current.x, tz - smoothed.current.z) > 0.004;
      }
      smoothed.current = { x: tx, z: tz, yaw: tyaw };
      group.current.position.set(tx, ty, tz);
      if (body.current) body.current.rotation.y = tyaw;
    } else {
      if (!smoothed.current) smoothed.current = { x: tx, z: tz, yaw: tyaw };
      const sm = smoothed.current;
      const k = Math.min(1, dt * 12);
      moving = Math.hypot(tx - sm.x, tz - sm.z) > 0.01;
      sm.x += (tx - sm.x) * k;
      sm.z += (tz - sm.z) * k;
      let dyaw = tyaw - sm.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      sm.yaw += dyaw * k;
      group.current.position.set(sm.x, pl.y, sm.z);
      if (body.current) body.current.rotation.y = sm.yaw;
    }

    walkPhase.current += dt * (moving ? 9.5 : 1.6);
    const p2 = walkPhase.current;
    const attackAge = Date.now() - (net.attackAnims.get(sessionId) ?? 0);
    const attackT = attackAge < 240 ? 1 - attackAge / 240 : 0;
    const idleBreath = Math.sin(p2 * 0.9) * 0.015;

    if (body.current) {
      // fade the local rig out when the camera is pulled in tight (backed
      // into a wall/corner) so the view never fills with model interior
      body.current.visible = !isLocal || camInfo.dist > 0.95;
      body.current.position.y = pl.downed
        ? 0.22
        : moving
          ? Math.abs(Math.sin(p2 * 2)) * 0.045
          : idleBreath;
      body.current.rotation.x = pl.downed
        ? Math.PI / 2
        : attackT * 0.24 + (moving ? 0.08 : 0);
    }
    poseRig(
      { torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR },
      { phase: p2, moving, attackT },
    );
    // carried prop hovers over the head; swap which mesh shows by kind
    if (carryRef.current) {
      for (const child of carryRef.current.children) {
        child.visible = child.name === pl.carryProp;
      }
      carryRef.current.visible = !!pl.carryProp && !pl.downed;
      carryRef.current.rotation.y += dt * 0.8;
    }
  });

  if (!p) return null;
  const grappling = (net.state?.tick ?? 0) < p.grappleUntil;

  return (
    <group ref={group}>
      <BlobShadow radius={0.38} />
      <group ref={body}>
        <CharacterModel
          charId={charId}
          color={color}
          glow={grappling}
          refs={{ torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR }}
        />
        {/* carried prop (visibility toggled per-frame by kind) */}
        <group ref={carryRef} position={[0, 1.72, 0]} scale={0.5} visible={false}>
          <group name="crate">
            <CrateMesh />
          </group>
          <group name="barrel">
            <BarrelMesh />
          </group>
          <group name="lockbox">
            <LockboxMesh />
          </group>
        </group>
      </group>
      {/* name + hp are for OTHER players — your own live in the HUD, and at
          point-blank camera range they'd fill the whole frame */}
      {!isLocal ? (
        <>
          <Billboard position={[0, 2.02, 0]}>
            <Text
              fontSize={0.22}
              color={p.downed ? "#f43f5e" : "#e2e8f0"}
              anchorX="center"
              outlineWidth={0.014}
              outlineColor="#000000"
            >
              {`${p.name}${p.downed ? " ▼DOWN" : ""}`}
            </Text>
          </Billboard>
          <HpBar getRatio={() => {
            const pl = net.state?.players.get(sessionId);
            return pl ? pl.hp / Math.max(1, pl.maxHp) : 0;
          }} y={1.86} width={0.8} color={color} />
        </>
      ) : null}
      {/* emote bubble */}
      <EmoteBubble net={net} sessionId={sessionId} />
      {/* revive ring while downed */}
      {p.downed ? <ReviveRing net={net} sessionId={sessionId} /> : null}
    </group>
  );
}

function EmoteBubble({ net, sessionId }: { net: NetClient; sessionId: string }) {
  const ref = useRef<THREE.Group>(null);
  const [emote, setEmote] = useState("");
  useFrame(() => {
    const s = net.state;
    const p = s?.players.get(sessionId);
    if (!p || !s) return;
    const active = p.emoteUntil > s.tick ? p.emote : "";
    if (active !== emote) setEmote(active);
    if (ref.current) ref.current.visible = !!active;
  });
  if (!emote) return null;
  return (
    <group ref={ref} position={[0, 2.4, 0]}>
      <Text fontSize={0.42} anchorX="center">
        {emote === "taunt" ? "😤" : "👉"}
      </Text>
    </group>
  );
}

function ReviveRing({ net, sessionId }: { net: NetClient; sessionId: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const p = net.state?.players.get(sessionId);
    if (!p || !ref.current) return;
    const progress = p.reviveProgress / 60; // REVIVE_HOLD * TICK_RATE
    ref.current.scale.setScalar(1 + Math.max(0, 1 - progress) * 0.2);
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.4 + progress * 2;
  });
  return (
    <mesh ref={ref} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5, 0.62, 24]} />
      <meshStandardMaterial color="#4ade80" emissive="#4ade80" emissiveIntensity={0.5} />
    </mesh>
  );
}

function HpBar({
  getRatio,
  y,
  width,
  color,
}: {
  getRatio: () => number;
  y: number;
  width: number;
  color: string;
}) {
  const fill = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!fill.current) return;
    const r = Math.max(0, Math.min(1, getRatio()));
    fill.current.scale.x = Math.max(0.001, r);
    fill.current.position.x = (-width / 2) * (1 - r);
    fill.current.parent?.lookAt(camera.position);
  });
  return (
    <group position={[0, y, 0]}>
      <mesh>
        <planeGeometry args={[width, 0.07]} />
        <meshBasicMaterial color="#111" transparent opacity={0.7} />
      </mesh>
      <mesh ref={fill} position={[0, 0, 0.001]}>
        <planeGeometry args={[width, 0.05]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function Mob({
  net,
  roomCoord,
  mobId,
}: {
  net: NetClient;
  roomCoord: string;
  mobId: string;
}) {
  const group = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Group>(null);
  const smoothed = useRef<{ x: number; z: number } | null>(null);
  const m = net.state?.rooms.get(roomCoord)?.mobs.get(mobId);
  const kind = m?.kind ?? "slime";
  const friendly = m?.friendly ?? false;

  useFrame(({ clock }, dt) => {
    const mob = net.state?.rooms.get(roomCoord)?.mobs.get(mobId);
    if (!mob || !group.current) return;
    if (!smoothed.current) smoothed.current = { x: mob.x, z: mob.z };
    const sm = smoothed.current;
    const k = Math.min(1, dt * 10);
    sm.x += (mob.x - sm.x) * k;
    sm.z += (mob.z - sm.z) * k;
    group.current.position.set(sm.x, 0, sm.z);
    // slimes face their movement, turrets track their target
    if (kind === "slime") {
      const vx = mob.x - sm.x;
      const vz = mob.z - sm.z;
      if (Math.hypot(vx, vz) > 0.005) {
        group.current.rotation.y = Math.atan2(vx, vz);
      }
    } else if (head.current) {
      const target = net.state?.players.get(mob.targetId);
      if (target) {
        head.current.rotation.y = Math.atan2(target.x - sm.x, target.z - sm.z);
      } else {
        head.current.rotation.y = clock.elapsedTime * 0.7; // idle scan
      }
    }

    if (blob.current) {
      const mat = blob.current.material as THREE.MeshStandardMaterial;
      const windup = mob.ai === "windup";
      const hitAge = Date.now() - (net.hitFlashes.get(mobId) ?? 0);
      if (hitAge < 130) {
        mat.emissive.set("#ffffff");
        mat.emissiveIntensity = 2.2;
      } else {
        mat.emissive.set(
          kind === "slime" ? "#8adf5a" : friendly ? "#e2c94c" : "#f43f5e",
        );
        mat.emissiveIntensity = windup
          ? 1.2 + Math.sin(clock.elapsedTime * 20) * 0.8
          : 0.3;
      }
      if (kind === "slime") {
        const squash = 1 + Math.sin(clock.elapsedTime * 6 + sm.x) * 0.12;
        blob.current.scale.set(1 / squash, squash, 1 / squash);
      }
    }
  });

  if (!m) return null;

  return (
    <group ref={group}>
      <BlobShadow radius={kind === "slime" ? 0.32 : 0.4} />
      {kind === "slime" ? (
        <group>
          <SlimeMesh blobRef={blob} />
        </group>
      ) : (
        <group>
          <TurretMesh blobRef={blob} headRef={head} friendly={friendly} />
        </group>
      )}
      <HpBar
        getRatio={() => {
          const mob = net.state?.rooms.get(roomCoord)?.mobs.get(mobId);
          return mob ? mob.hp / Math.max(1, mob.maxHp) : 0;
        }}
        y={kind === "slime" ? 0.95 : 1.25}
        width={0.6}
        color={friendly ? "#e2c94c" : "#f43f5e"}
      />
    </group>
  );
}

/** Ping markers floating in the room. */
export function Pings({ roomCoord }: { roomCoord: string }) {
  const pings = useGame((s) => s.pings);
  const relevant = useMemo(
    () => pings.filter((p) => p.room === roomCoord),
    [pings, roomCoord],
  );
  useEffect(() => {
    const t = setInterval(() => useGame.getState().prune(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <group>
      {relevant.map((p) => (
        <PingMarker key={p.id} x={p.x} z={p.z} kind={p.kind} />
      ))}
    </group>
  );
}

const PING_COLORS: Record<string, string> = {
  look: "#7dd3fc",
  danger: "#f43f5e",
  key: "#e2a44c",
  go: "#4ade80",
};

function PingMarker({ x, z, kind }: { x: number; z: number; kind: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = 1.6 + Math.sin(clock.elapsedTime * 4) * 0.15;
      ref.current.rotation.y = clock.elapsedTime * 2;
    }
  });
  const color = PING_COLORS[kind] ?? "#ffffff";
  return (
    <group position={[x, 0, z]}>
      <group ref={ref} position={[0, 1.6, 0]}>
        <mesh>
          <octahedronGeometry args={[0.2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} />
        </mesh>
      </group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.4, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}
