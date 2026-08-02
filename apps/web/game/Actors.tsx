"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { CHARACTERS, type CharId } from "@cubescape/shared";
import type { MobView, NetClient, PlayerView } from "./net";
import { useGame } from "./store";

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
    </group>
  );
}

function PlayerRig({ net, sessionId }: { net: NetClient; sessionId: string }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
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
    if (isLocal) {
      const g = useGame.getState();
      tx = g.px;
      tz = g.pz;
      ty = g.py;
      tyaw = g.yaw;
      group.current.position.set(tx, ty, tz);
      if (body.current) body.current.rotation.y = tyaw;
    } else {
      if (!smoothed.current) smoothed.current = { x: tx, z: tz, yaw: tyaw };
      const sm = smoothed.current;
      const k = Math.min(1, dt * 12);
      sm.x += (tx - sm.x) * k;
      sm.z += (tz - sm.z) * k;
      let dyaw = tyaw - sm.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      sm.yaw += dyaw * k;
      group.current.position.set(sm.x, pl.y, sm.z);
      if (body.current) body.current.rotation.y = sm.yaw;
    }

    // walk bobbing
    const moving = isLocal
      ? true
      : smoothed.current
        ? Math.hypot(tx - smoothed.current.x, tz - smoothed.current.z) > 0.01
        : false;
    walkPhase.current += dt * (moving ? 10 : 2);
    if (body.current) {
      body.current.position.y = pl.downed
        ? 0.3
        : 0.62 + Math.abs(Math.sin(walkPhase.current)) * 0.05;
      body.current.rotation.x = pl.downed ? Math.PI / 2 : 0;
    }
  });

  if (!p) return null;
  const grappling = (net.state?.tick ?? 0) < p.grappleUntil;

  return (
    <group ref={group}>
      <group ref={body} position={[0, 0.62, 0]}>
        {/* torso capsule */}
        <mesh castShadow>
          <capsuleGeometry args={[0.26, 0.55, 6, 12]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={grappling ? 0.8 : 0.15}
          />
        </mesh>
        {/* visor showing facing */}
        <mesh position={[0, 0.32, 0.2]}>
          <boxGeometry args={[0.3, 0.1, 0.12]} />
          <meshStandardMaterial color="#0e1016" emissive="#7dd3fc" emissiveIntensity={0.6} />
        </mesh>
        {/* char silhouette accent */}
        {charId === "brute" ? (
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[0.72, 0.34, 0.4]} />
            <meshStandardMaterial color={color} />
          </mesh>
        ) : charId === "tinker" ? (
          <mesh position={[0, 0.48, -0.22]}>
            <boxGeometry args={[0.34, 0.3, 0.18]} />
            <meshStandardMaterial color="#8a7a3a" />
          </mesh>
        ) : (
          <mesh position={[0, 0.5, -0.15]} rotation={[0.4, 0, 0]}>
            <coneGeometry args={[0.16, 0.4, 6]} />
            <meshStandardMaterial color={color} />
          </mesh>
        )}
      </group>
      {/* name + status */}
      <Billboard position={[0, 1.75, 0]}>
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
      {/* hp pip bar */}
      <HpBar getRatio={() => {
        const pl = net.state?.players.get(sessionId);
        return pl ? pl.hp / Math.max(1, pl.maxHp) : 0;
      }} y={1.5} width={0.8} color={color} />
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
    <group ref={ref} position={[0, 2.15, 0]}>
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

    if (blob.current) {
      const mat = blob.current.material as THREE.MeshStandardMaterial;
      const windup = mob.ai === "windup";
      mat.emissiveIntensity = windup
        ? 1.2 + Math.sin(clock.elapsedTime * 20) * 0.8
        : 0.3;
      if (kind === "slime") {
        const squash = 1 + Math.sin(clock.elapsedTime * 6 + sm.x) * 0.12;
        blob.current.scale.set(1 / squash, squash, 1 / squash);
      }
    }
  });

  if (!m) return null;

  return (
    <group ref={group}>
      {kind === "slime" ? (
        <mesh ref={blob} position={[0, 0.32, 0]} castShadow>
          <sphereGeometry args={[0.34, 12, 10]} />
          <meshStandardMaterial
            color="#68b043"
            emissive="#8adf5a"
            emissiveIntensity={0.3}
            transparent
            opacity={0.92}
          />
        </mesh>
      ) : (
        <group>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.3, 0.38, 0.6, 8]} />
            <meshStandardMaterial color={friendly ? "#8a7a3a" : "#4a3a4e"} />
          </mesh>
          <mesh ref={blob} position={[0, 0.72, 0]}>
            <boxGeometry args={[0.34, 0.26, 0.5]} />
            <meshStandardMaterial
              color={friendly ? "#e2c94c" : "#a05a72"}
              emissive={friendly ? "#e2c94c" : "#f43f5e"}
              emissiveIntensity={0.3}
            />
          </mesh>
        </group>
      )}
      <HpBar
        getRatio={() => {
          const mob = net.state?.rooms.get(roomCoord)?.mobs.get(mobId);
          return mob ? mob.hp / Math.max(1, mob.maxHp) : 0;
        }}
        y={kind === "slime" ? 0.95 : 1.2}
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
