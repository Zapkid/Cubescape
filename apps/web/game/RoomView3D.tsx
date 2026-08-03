"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Sparkles, Text } from "@react-three/drei";
import * as THREE from "three";
import {
  ARCHETYPE_LIGHTING,
  getTemplate,
  parseTiles,
  spikeRowActive,
  TICK_DT,
  type RoomTemplate,
  type TileType,
} from "@cubescape/shared";
import type { NetClient, RoomView } from "./net";

const WALL_H = 2.6;

const TILE_COLORS: Record<TileType, string> = {
  floor: "#2a2a3a",
  void: "#05050a",
  pit: "#07070d",
  spike: "#3a2028",
  plate: "#1f4a44",
  lift: "#1d3f5e",
  gas_vent: "#2c3a22",
  cracked: "#3a3226",
  gasVent: "#2c3a22",
} as Record<TileType, string> & { gasVent: string };

function gateLabel(d: { gateType: string; gateParam: string; gateValue: number }): string {
  switch (d.gateType) {
    case "key":
      return `${d.gateParam} key`;
    case "plates":
      return `plates ×${d.gateValue}`;
    case "stat":
      return `${d.gateParam} ${d.gateValue}`;
    case "objective":
      return "objective";
    case "lift":
      return "lift";
    default:
      return "";
  }
}

const GATE_COLORS: Record<string, string> = {
  ruby: "#e2504c",
  sapphire: "#4c7ee2",
  amber: "#e2a44c",
  jade: "#4ce27e",
};

function doorTint(d: { gateType: string; gateParam: string }): string {
  if (d.gateType === "key") return GATE_COLORS[d.gateParam] ?? "#cccccc";
  if (d.gateType === "stat") return d.gateParam === "might" ? "#e2574c" : "#a78bfa";
  if (d.gateType === "plates") return "#2dd4bf";
  if (d.gateType === "objective") return "#f59e0b";
  if (d.gateType === "lift") return "#38bdf8";
  return "#8a8a9a";
}

/** Static + animated geometry for one room, driven by template data. */
export function RoomView3D({
  net,
  room,
  myCharId,
}: {
  net: NetClient;
  room: RoomView;
  myCharId: string;
}) {
  const template = getTemplate(room.templateId);
  const tiles = useMemo(() => parseTiles(template), [template]);
  const lighting = ARCHETYPE_LIGHTING[template.archetype] ?? {
    ambient: "#1a1a2e",
    point: "#8888aa",
  };

  return (
    <group>
      {/* darker base — the emissives + bloom carry the light, teaser-style */}
      <ambientLight color="#ffffff" intensity={0.24} />
      <hemisphereLight args={[lighting.ambient, "#07070e", 2.6]} />
      <directionalLight position={[6, 10, 4]} color="#ccd4ff" intensity={0.55} />
      <pointLight
        position={[4.5, 3.2, 4.5]}
        color={lighting.point}
        intensity={template.lighting.intensity * 40}
        distance={18}
        decay={1.3}
      />
      {/* drifting dust motes catch the room light */}
      <Sparkles
        count={34}
        scale={[8.4, 2.3, 8.4]}
        position={[4.5, 1.3, 4.5]}
        size={1.6}
        speed={0.22}
        opacity={0.3}
        color={lighting.point}
      />
      <Floor tiles={tiles} room={room} net={net} accent={lighting.point} />
      <Walls room={room} accent={lighting.point} />
      <CornerDressing />
      <CeilingCircuits room={room} accent={lighting.point} />
      <Doors room={room} myCharId={myCharId} />
      <Props template={template} room={room} myCharId={myCharId} net={net} />
      <Spikes template={template} tiles={tiles} room={room} net={net} />
      <Deployables room={room} net={net} />
    </group>
  );
}

/** neutral connector rooms get the signature cyan lanes; mood rooms keep their accent */
function laneColor(accent: string): string {
  return accent === "#8888aa" ? "#38d6f0" : accent;
}

/** deterministic tiny tint variation so floors don't read as one flat slab */
function cellShade(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return 0.9 + (h - Math.floor(h)) * 0.14 + ((x + z) % 2) * 0.05;
}

function Floor({
  tiles,
  room,
  net,
  accent,
}: {
  tiles: TileType[][];
  room: RoomView;
  net: NetClient;
  accent: string;
}) {
  const overrides = new Set(room.walkableOverrides);
  const holes = new Set(room.breachHoles);
  const cells = useMemo(() => {
    const out: { x: number; z: number; t: TileType; key: string }[] = [];
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) {
        out.push({ x, z, t: tiles[z]![x]!, key: `${x},${z}` });
      }
    return out;
  }, [tiles]);

  return (
    <group>
      {cells.map((c) => {
        const bridged = overrides.has(c.key);
        const breached = holes.has(c.key);
        if ((c.t === "pit" || c.t === "void") && !bridged) {
          return (
            <group key={c.key}>
              <mesh position={[c.x + 0.5, -0.9, c.z + 0.5]}>
                <boxGeometry args={[1, 1.6, 1]} />
                <meshStandardMaterial color="#04040a" />
              </mesh>
              {/* hazard rim so the drop reads from a distance */}
              <mesh position={[c.x + 0.5, 0.005, c.z + 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.42, 0.5, 4]} />
                <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.5} transparent opacity={0.5} />
              </mesh>
            </group>
          );
        }
        if (breached) return null; // open hole
        const shade = cellShade(c.x, c.z);
        const base = new THREE.Color(bridged ? "#4a3f2e" : TILE_COLORS[c.t] ?? "#2a2a3a");
        base.multiplyScalar(shade);
        const isAccent = c.t !== "floor" && !bridged;
        // glowing walkway lanes between the doors — the teaser's lit floor path
        const isLane = c.t === "floor" && (c.x === 4 || c.z === 4);
        return (
          <group key={c.key}>
            <mesh position={[c.x + 0.5, -0.1, c.z + 0.5]} receiveShadow>
              <boxGeometry args={[0.96, 0.2, 0.96]} />
              <meshStandardMaterial
                color={isLane ? "#10141f" : base}
                emissive={isAccent ? TILE_COLORS[c.t] : "#000000"}
                emissiveIntensity={isAccent ? 0.4 : 0}
                roughness={0.85}
              />
            </mesh>
            {isLane ? (
              <mesh position={[c.x + 0.5, 0.005, c.z + 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.56, 0.56]} />
                <meshStandardMaterial
                  color={laneColor(accent)}
                  emissive={laneColor(accent)}
                  emissiveIntensity={0.75}
                  transparent
                  opacity={0.6}
                />
              </mesh>
            ) : null}
            {c.t === "plate" ? <PlateDisc x={c.x} z={c.z} room={room} net={net} /> : null}
            {c.t === "lift" ? (
              <mesh position={[c.x + 0.5, 0.03, c.z + 0.5]}>
                <cylinderGeometry args={[0.36, 0.4, 0.06, 16]} />
                <meshStandardMaterial color="#173049" emissive="#38bdf8" emissiveIntensity={0.25} />
              </mesh>
            ) : null}
            {c.t === "gas_vent" ? (
              <mesh position={[c.x + 0.5, 0.015, c.z + 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.3, 8]} />
                <meshStandardMaterial color="#1c2a12" emissive="#66a832" emissiveIntensity={0.9} />
              </mesh>
            ) : null}
          </group>
        );
      })}
      {/* lift glow ring when powered */}
      <LiftGlow tiles={tiles} room={room} />
    </group>
  );
}

/** pressure plate that physically depresses when someone stands on it */
function PlateDisc({
  x,
  z,
  room,
  net,
}: {
  x: number;
  z: number;
  room: RoomView;
  net: NetClient;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current) return;
    let pressed = false;
    net.state?.players.forEach((p) => {
      if (p.roomCoord !== room.coordId) return;
      if (Math.floor(p.x) === x && Math.floor(p.z) === z) pressed = true;
    });
    const targetY = pressed ? 0.015 : 0.055;
    ref.current.position.y += (targetY - ref.current.position.y) * 0.3;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = pressed ? 1.6 : 0.5;
  });
  return (
    <mesh ref={ref} position={[x + 0.5, 0.055, z + 0.5]}>
      <cylinderGeometry args={[0.3, 0.34, 0.07, 16]} />
      <meshStandardMaterial color="#134238" emissive="#2dd4bf" emissiveIntensity={0.5} />
    </mesh>
  );
}

function LiftGlow({ tiles, room }: { tiles: TileType[][]; room: RoomView }) {
  const ref = useRef<THREE.Mesh>(null);
  const liftCells = useMemo(() => {
    const out: [number, number][] = [];
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) if (tiles[z]![x] === "lift") out.push([x, z]);
    return out;
  }, [tiles]);
  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = room.liftPowered
        ? 1.6 + Math.sin(clock.elapsedTime * 6) * 0.6
        : 0.15;
    }
  });
  if (liftCells.length === 0) return null;
  const [x, z] = liftCells[0]!;
  return (
    <mesh ref={ref} position={[x + 0.5, 0.02, z + 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.28, 0.46, 24]} />
      <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.2} />
    </mesh>
  );
}

/** deterministic per-room hash for varied-but-stable wall decoration */
function roomHash(coordId: string, salt: number): number {
  let h = salt * 374761393;
  for (const ch of coordId) h = Math.imul(h ^ ch.charCodeAt(0), 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967295;
}

function Walls({ room, accent }: { room: RoomView; accent: string }) {
  const segments = useMemo(() => {
    const segs: { x: number; z: number; w: number; d: number }[] = [];
    const doorCells: Record<string, number> = {};
    room.doors.forEach((d) => {
      if (d.face === "N" || d.face === "S") doorCells[d.face] = d.cellX;
      if (d.face === "E" || d.face === "W") doorCells[d.face] = d.cellZ;
    });
    const addRun = (
      face: "N" | "S" | "E" | "W",
      from: number,
      to: number, // cell range [from, to)
    ) => {
      if (to <= from) return;
      const len = to - from;
      if (face === "N") segs.push({ x: from + len / 2, z: -0.15, w: len, d: 0.3 });
      if (face === "S") segs.push({ x: from + len / 2, z: 9.15, w: len, d: 0.3 });
      if (face === "W") segs.push({ x: -0.15, z: from + len / 2, w: 0.3, d: len });
      if (face === "E") segs.push({ x: 9.15, z: from + len / 2, w: 0.3, d: len });
    };
    (["N", "S", "E", "W"] as const).forEach((face) => {
      const door = doorCells[face];
      if (door === undefined) {
        addRun(face, 0, 9);
      } else {
        addRun(face, 0, door);
        addRun(face, door + 1, 9);
      }
    });
    return segs;
  }, [room]);

  return (
    <group>
      {segments.map((s, i) => {
        const horizontal = s.w > s.d;
        const len = horizontal ? s.w : s.d;
        const inward = s.z < 1 ? 0.18 : s.z > 8 ? -0.18 : s.x < 1 ? 0.18 : -0.18;
        // beveled panel insets along the wall face, teaser-style
        const panelCount = Math.max(1, Math.round(len / 1.6));
        const panels = Array.from({ length: panelCount }, (_, pi) => {
          const off = ((pi + 0.5) / panelCount - 0.5) * len;
          const lit = roomHash(room.coordId, i * 31 + pi) > 0.78;
          return { off, lit };
        });
        return (
          <group key={i}>
            <mesh position={[s.x, WALL_H / 2, s.z]}>
              <boxGeometry args={[s.w, WALL_H, s.d]} />
              <meshStandardMaterial color="#191924" roughness={0.9} />
            </mesh>
            {panels.map((p, pi) => (
              <group key={pi}>
                <mesh
                  position={[
                    horizontal ? s.x + p.off : s.x + inward * 0.75,
                    1.3,
                    horizontal ? s.z + inward * 0.75 : s.z + p.off,
                  ]}
                >
                  <boxGeometry
                    args={
                      horizontal
                        ? [len / panelCount - 0.24, 1.5, 0.1]
                        : [0.1, 1.5, len / panelCount - 0.24]
                    }
                  />
                  <meshStandardMaterial color="#222230" roughness={0.85} />
                </mesh>
                {p.lit ? (
                  <mesh
                    position={[
                      horizontal ? s.x + p.off : s.x + inward,
                      1.72,
                      horizontal ? s.z + inward : s.z + p.off,
                    ]}
                  >
                    <boxGeometry
                      args={horizontal ? [0.5, 0.16, 0.04] : [0.04, 0.16, 0.5]}
                    />
                    <meshStandardMaterial
                      color="#dff4ff"
                      emissive="#bfe9ff"
                      emissiveIntensity={2.2}
                    />
                  </mesh>
                ) : null}
              </group>
            ))}
            {/* skirting + glow trim line */}
            <mesh position={[s.x, 0.14, s.z]}>
              <boxGeometry args={[s.w + 0.02, 0.28, s.d + 0.02]} />
              <meshStandardMaterial color="#22222f" />
            </mesh>
            <mesh position={[s.x, 2.18, s.z]}>
              <boxGeometry args={[s.w + 0.02, 0.05, s.d + 0.02]} />
              <meshStandardMaterial
                color={accent}
                emissive={accent}
                emissiveIntensity={0.55}
              />
            </mesh>
          </group>
        );
      })}
      {/* ceiling */}
      <mesh position={[4.5, WALL_H + 0.1, 4.5]}>
        <boxGeometry args={[9.6, 0.2, 9.6]} />
        <meshStandardMaterial color="#0e0e18" />
      </mesh>
    </group>
  );
}

/** corner columns + pipe runs along the wall tops — the teaser's industrial relief */
function CornerDressing() {
  const corners: [number, number][] = [
    [0.42, 0.42],
    [8.58, 0.42],
    [0.42, 8.58],
    [8.58, 8.58],
  ];
  return (
    <group>
      {corners.map(([x, z], i) => (
        <group key={i}>
          <mesh position={[x, WALL_H / 2, z]}>
            <boxGeometry args={[0.42, WALL_H, 0.42]} />
            <meshStandardMaterial color="#20202e" roughness={0.85} />
          </mesh>
          <mesh position={[x, WALL_H / 2, z]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[0.34, WALL_H, 0.34]} />
            <meshStandardMaterial color="#262636" roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* pipe runs just under the ceiling on the N and S walls */}
      <mesh position={[4.5, WALL_H - 0.18, 0.34]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 8.4, 8]} />
        <meshStandardMaterial color="#2b2b3c" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[4.5, WALL_H - 0.34, 0.34]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.045, 0.045, 8.4, 8]} />
        <meshStandardMaterial color="#232330" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[4.5, WALL_H - 0.18, 8.66]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 8.4, 8]} />
        <meshStandardMaterial color="#2b2b3c" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}

/** glowing circuit traces across the ceiling — the cube is a machine */
function CeilingCircuits({ room, accent }: { room: RoomView; accent: string }) {
  const strips = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const along = roomHash(room.coordId, 7 + i) > 0.5;
      const pos = 1.5 + roomHash(room.coordId, 13 + i) * 6;
      const start = roomHash(room.coordId, 23 + i) * 3;
      const len = 3 + roomHash(room.coordId, 41 + i) * 5;
      if (along) out.push({ x: start + len / 2, z: pos, w: len, d: 0.07 });
      else out.push({ x: pos, z: start + len / 2, w: 0.07, d: len });
    }
    return out;
  }, [room.coordId]);
  return (
    <group>
      {strips.map((s, i) => (
        <group key={i}>
          <mesh position={[Math.min(8.6, s.x), WALL_H - 0.02, Math.min(8.6, s.z)]}>
            <boxGeometry args={[s.w, 0.03, s.d]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.9}
              transparent
              opacity={0.85}
            />
          </mesh>
          {/* node at the strip end */}
          <mesh
            position={[
              Math.min(8.6, s.x + (s.w > 1 ? s.w / 2 : 0)),
              WALL_H - 0.02,
              Math.min(8.6, s.z + (s.d > 1 ? s.d / 2 : 0)),
            ]}
          >
            <boxGeometry args={[0.16, 0.05, 0.16]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Doors({ room, myCharId }: { room: RoomView; myCharId: string }) {
  return (
    <group>
      {room.doors.map((d) => (
        <Door key={d.face} d={d} myCharId={myCharId} />
      ))}
    </group>
  );
}

function Door({
  d,
  myCharId,
}: {
  d: RoomView["doors"][number];
  myCharId: string;
}) {
  const panelRef = useRef<THREE.Mesh>(null);
  const openness = useRef(d.open ? 1 : 0);

  useFrame((_, dt) => {
    const target = d.open ? 1 : 0;
    openness.current += (target - openness.current) * Math.min(1, dt * 6);
    if (panelRef.current) {
      panelRef.current.position.y = 1.1 + openness.current * 2.1;
    }
  });

  if (d.face === "U" || d.face === "D") {
    const y = d.face === "U" ? WALL_H : 0.01;
    return (
      <group position={[d.cellX + 0.5, y, d.cellZ + 0.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.55, 4]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#38bdf8"
            emissiveIntensity={0.8}
          />
        </mesh>
        <Text
          position={[0, d.face === "U" ? -0.35 : 0.35, 0]}
          fontSize={0.18}
          color="#7dd3fc"
          anchorX="center"
          rotation={[-Math.PI / 2, 0, 0]}
        >
          {d.face === "U" ? "▲ lift hatch [E]" : "▼ drop hatch [E]"}
        </Text>
      </group>
    );
  }

  // NESW: frame + sliding panel at the wall opening
  const horizontal = d.face === "N" || d.face === "S";
  const pos: [number, number, number] =
    d.face === "N"
      ? [d.cellX + 0.5, 0, -0.15]
      : d.face === "S"
        ? [d.cellX + 0.5, 0, 9.15]
        : d.face === "W"
          ? [-0.15, 0, d.cellZ + 0.5]
          : [9.15, 0, d.cellZ + 0.5];
  const tint = doorTint(d);
  const label = gateLabel(d);
  const labelVisible = !d.open && label;
  const scoutSees = myCharId === "scout"; // Scout sense: gates readable from anywhere

  return (
    <group position={pos}>
      {/* chunky portal posts */}
      <mesh position={horizontal ? [-0.62, WALL_H / 2, 0] : [0, WALL_H / 2, -0.62]}>
        <boxGeometry args={horizontal ? [0.22, WALL_H, 0.42] : [0.42, WALL_H, 0.22]} />
        <meshStandardMaterial color="#20202e" />
      </mesh>
      <mesh position={horizontal ? [0.62, WALL_H / 2, 0] : [0, WALL_H / 2, 0.62]}>
        <boxGeometry args={horizontal ? [0.22, WALL_H, 0.42] : [0.42, WALL_H, 0.22]} />
        <meshStandardMaterial color="#20202e" />
      </mesh>
      {/* glowing inner frame strips */}
      <mesh position={horizontal ? [-0.5, WALL_H / 2, 0] : [0, WALL_H / 2, -0.5]}>
        <boxGeometry args={horizontal ? [0.06, WALL_H - 0.2, 0.44] : [0.44, WALL_H - 0.2, 0.06]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.9} />
      </mesh>
      <mesh position={horizontal ? [0.5, WALL_H / 2, 0] : [0, WALL_H / 2, 0.5]}>
        <boxGeometry args={horizontal ? [0.06, WALL_H - 0.2, 0.44] : [0.44, WALL_H - 0.2, 0.06]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.9} />
      </mesh>
      {/* lit lintel across the top */}
      <mesh position={[0, WALL_H - 0.14, 0]}>
        <boxGeometry args={horizontal ? [1.46, 0.24, 0.42] : [0.42, 0.24, 1.46]} />
        <meshStandardMaterial color="#20202e" />
      </mesh>
      <mesh position={[0, WALL_H - 0.3, 0]}>
        <boxGeometry args={horizontal ? [1.1, 0.07, 0.44] : [0.44, 0.07, 1.1]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={1.2} />
      </mesh>
      {/* sliding panel */}
      <mesh ref={panelRef} position={[0, 1.1, 0]}>
        <boxGeometry args={horizontal ? [1.0, 2.2, 0.18] : [0.18, 2.2, 1.0]} />
        <meshStandardMaterial
          color="#2e2e40"
          emissive={tint}
          emissiveIntensity={d.open ? 0 : 0.18}
        />
      </mesh>
      {/* light spills through an open doorway onto the floor */}
      {d.open ? (
        <mesh
          position={
            d.face === "N"
              ? [0, 0.012, 0.75]
              : d.face === "S"
                ? [0, 0.012, -0.75]
                : d.face === "W"
                  ? [0.75, 0.012, 0]
                  : [-0.75, 0.012, 0]
          }
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={horizontal ? [1.15, 1.5] : [1.5, 1.15]} />
          <meshBasicMaterial
            color={tint}
            transparent
            opacity={0.11}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ) : null}
      {labelVisible ? (
        <Text
          position={horizontal ? [0, 2.05, d.face === "N" ? 0.35 : -0.35] : [d.face === "W" ? 0.35 : -0.35, 2.05, 0]}
          rotation={[0, d.face === "N" ? 0 : d.face === "S" ? Math.PI : d.face === "W" ? Math.PI / 2 : -Math.PI / 2, 0]}
          fontSize={scoutSees ? 0.3 : 0.22}
          color={tint}
          anchorX="center"
          outlineWidth={0.012}
          outlineColor="#000000"
        >
          {label}
        </Text>
      ) : null}
    </group>
  );
}

function Props({
  template,
  room,
  myCharId,
  net,
}: {
  template: RoomTemplate;
  room: RoomView;
  myCharId: string;
  net: NetClient;
}) {
  return (
    <group>
      {template.props.map((p, i) => {
        const key = p.id ?? `prop${i}`;
        const x = p.cell[0] + 0.5;
        const z = p.cell[1] + 0.5;
        switch (p.type) {
          case "pillar":
            return (
              <mesh key={key} position={[x, 1.2, z]}>
                <cylinderGeometry args={[0.32, 0.4, 2.4, 8]} />
                <meshStandardMaterial color="#262636" />
              </mesh>
            );
          case "crate":
            return (
              <mesh key={key} position={[x, 0.35, z]} rotation={[0, p.rotY, 0]}>
                <boxGeometry args={[0.7, 0.7, 0.7]} />
                <meshStandardMaterial color="#3d3226" />
              </mesh>
            );
          case "lever":
            return <Lever key={key} x={x} z={z} p={p} room={room} />;
          case "key_pedestal":
            return <KeyPedestal key={key} x={x} z={z} room={room} />;
          case "vent_terminal":
          case "exit_terminal":
            return <Terminal key={key} x={x} z={z} kind={p.type} room={room} net={net} />;
          case "beacon":
            return <Beacon key={key} x={x} z={z} />;
          case "wire_trace":
            return myCharId === "tinker" ? (
              <mesh key={key} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.85, 0.16]} />
                <meshStandardMaterial
                  color="#e2c94c"
                  emissive="#e2c94c"
                  emissiveIntensity={1.2}
                  transparent
                  opacity={0.85}
                />
              </mesh>
            ) : null;
          case "mob_spawn":
            return null;
          default:
            return null;
        }
      })}
      <CrackedOverlays template={template} room={room} myCharId={myCharId} />
    </group>
  );
}

function CrackedOverlays({
  template,
  room,
  myCharId,
}: {
  template: RoomTemplate;
  room: RoomView;
  myCharId: string;
}) {
  const tiles = useMemo(() => parseTiles(template), [template]);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current && myCharId === "brute") {
      ref.current.children.forEach((c) => {
        const mesh = c as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.7 + Math.sin(clock.elapsedTime * 3) * 0.4;
      });
    }
  });
  const cells: [number, number][] = [];
  for (let z = 0; z < 9; z++)
    for (let x = 0; x < 9; x++) {
      if (tiles[z]![x] === "cracked" && !room.breachHoles.includes(`${x},${z}`)) {
        cells.push([x, z]);
      }
    }
  // Brute sense: cracked floors glow
  return (
    <group ref={ref}>
      {cells.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x + 0.5, 0.02, z + 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.8, 0.8]} />
          <meshStandardMaterial
            color="#7c5c34"
            emissive={myCharId === "brute" ? "#e2884c" : "#40342a"}
            emissiveIntensity={myCharId === "brute" ? 0.9 : 0.2}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

function Lever({
  x,
  z,
  p,
  room,
}: {
  x: number;
  z: number;
  p: RoomTemplate["props"][number];
  room: RoomView;
}) {
  const lamp = typeof p.meta.lamp === "number" ? p.meta.lamp : 0;
  const handle = useRef<THREE.Group>(null);
  const lampRef = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    // pulled when this lever's sequence position has been locked in;
    // wrong pulls reset logicProgress and every handle springs back up
    const pulled = lamp > 0 && room.logicProgress >= lamp;
    if (handle.current) {
      const target = pulled ? 1.15 : -0.6;
      handle.current.rotation.x +=
        (target - handle.current.rotation.x) * Math.min(1, dt * 10);
    }
    if (lampRef.current) {
      const mat = lampRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity +=
        ((pulled ? 2.2 : 0.12) - mat.emissiveIntensity) * Math.min(1, dt * 8);
    }
  });

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.42, 0.9, 0.42]} />
        <meshStandardMaterial color="#33334a" />
      </mesh>
      {/* hinged handle: pivots at the top of the housing */}
      <group ref={handle} position={[0, 0.9, 0]} rotation={[-0.6, 0, 0]}>
        <mesh position={[0, 0.26, 0]}>
          <cylinderGeometry args={[0.04, 0.05, 0.52, 6]} />
          <meshStandardMaterial color="#c0c0d0" />
        </mesh>
        <mesh position={[0, 0.54, 0]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color="#e2574c" />
        </mesh>
      </group>
      <Text position={[0, 1.5, 0]} fontSize={0.34} color="#2dd4bf" anchorX="center">
        {String(lamp)}
      </Text>
      <mesh ref={lampRef} position={[0, 1.02, 0.24]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color="#0f3d33" emissive="#2dd4bf" emissiveIntensity={0.12} />
      </mesh>
    </group>
  );
}

function KeyPedestal({ x, z, room }: { x: number; z: number; room: RoomView }) {
  const gem = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (gem.current) {
      gem.current.rotation.y = clock.elapsedTime * 1.5;
      gem.current.position.y = 1.15 + Math.sin(clock.elapsedTime * 2) * 0.08;
    }
  });
  const color = GATE_COLORS[room.keyColor] ?? "#cccccc";
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.22, 0.34, 0.9, 8]} />
        <meshStandardMaterial color="#2c2440" />
      </mesh>
      {room.keyColor && !room.keyTaken ? (
        <>
          <mesh ref={gem} position={[0, 1.15, 0]}>
            <octahedronGeometry args={[0.22]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} />
          </mesh>
          <pointLight position={[0, 1.2, 0]} color={color} intensity={3.5} distance={4.5} />
          <Sparkles count={12} scale={[0.9, 1, 0.9]} position={[0, 1.15, 0]} size={2} speed={0.5} color={color} />
        </>
      ) : null}
    </group>
  );
}

function Terminal({
  x,
  z,
  kind,
  room,
  net,
}: {
  x: number;
  z: number;
  kind: string;
  room: RoomView;
  net: NetClient;
}) {
  const screen = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [progress, setProgress] = useState(0);

  useFrame(({ clock }) => {
    const liveRoom = net.state?.rooms.get(room.coordId) ?? room;
    const pct = liveRoom.cleared ? 100 : liveRoom.logicProgress;
    if (pct !== progress) setProgress(pct);
    if (screen.current) {
      const mat = screen.current.material as THREE.MeshStandardMaterial;
      const active = !liveRoom.cleared;
      const channeling = active && pct > 0;
      mat.emissiveIntensity = channeling
        ? 1.6 + Math.sin(clock.elapsedTime * 14) * 0.7
        : active
          ? 1 + Math.sin(clock.elapsedTime * 5) * 0.5
          : 0.25;
      mat.emissive.set(
        liveRoom.cleared || kind === "exit_terminal" ? "#4ade80" : "#f43f5e",
      );
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = -Math.PI / 2; // start at 12 o'clock
      ringRef.current.visible = pct > 0 && !liveRoom.cleared;
    }
  });

  const frac = Math.max(0.001, Math.min(1, progress / 100));
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.6, 1.1, 0.5]} />
        <meshStandardMaterial color="#20202e" />
      </mesh>
      <mesh ref={screen} position={[0, 0.95, 0]}>
        <boxGeometry args={[0.5, 0.36, 0.55]} />
        <meshStandardMaterial color="#0a0a12" emissive="#f43f5e" emissiveIntensity={1} />
      </mesh>
      {/* channel progress ring on the floor around the terminal */}
      <mesh
        ref={ringRef}
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <ringGeometry args={[0.75, 0.92, 48, 1, 0, Math.PI * 2 * frac]} />
        <meshStandardMaterial
          color="#4ade80"
          emissive="#4ade80"
          emissiveIntensity={1.6}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
        />
      </mesh>
      {!room.cleared ? (
        <Text position={[0, 1.6, 0]} fontSize={0.2} color="#ffffff" anchorX="center">
          {progress > 0
            ? `${kind === "exit_terminal" ? "ESCAPING" : "VENTING"} ${progress}%`
            : kind === "exit_terminal"
              ? "hold [E] to escape"
              : "hold [E] to vent"}
        </Text>
      ) : null}
    </group>
  );
}

/** the teaser's EKG pulse, built from thin emissive box segments */
const EKG_POINTS: [number, number][] = [
  [-0.55, 0],
  [-0.22, 0],
  [-0.14, 0.09],
  [-0.02, -0.2],
  [0.1, 0.3],
  [0.2, -0.06],
  [0.28, 0],
  [0.55, 0],
];

function EkgPulse({ color = "#4ade80", scale = 1 }: { color?: string; scale?: number }) {
  const group = useRef<THREE.Group>(null);
  const segments = useMemo(() => {
    const out: { cx: number; cy: number; len: number; angle: number }[] = [];
    for (let i = 0; i < EKG_POINTS.length - 1; i++) {
      const [x1, y1] = EKG_POINTS[i]!;
      const [x2, y2] = EKG_POINTS[i + 1]!;
      out.push({
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
        len: Math.hypot(x2 - x1, y2 - y1) + 0.02,
        angle: Math.atan2(y2 - y1, x2 - x1),
      });
    }
    return out;
  }, []);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const beat = Math.max(0, Math.sin(clock.elapsedTime * 3.4));
    group.current.children.forEach((c) => {
      const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.9 + beat * beat * 1.8;
    });
  });
  return (
    <group ref={group} scale={scale}>
      {segments.map((s, i) => (
        <mesh key={i} position={[s.cx, s.cy, 0]} rotation={[0, 0, s.angle]}>
          <boxGeometry args={[s.len, 0.035, 0.035]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
        </mesh>
      ))}
    </group>
  );
}

function Beacon({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.4 + Math.sin(clock.elapsedTime * 3.4) * 0.6;
    }
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.16, 0.28, 1.4, 6]} />
        <meshStandardMaterial color="#3a3020" />
      </mesh>
      <mesh ref={ref} position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={1.4} />
      </mesh>
      {/* floating heartbeat hologram — this room keeps you alive */}
      <Billboard position={[0, 2.15, 0]}>
        <EkgPulse color="#4ade80" scale={0.9} />
      </Billboard>
      <pointLight position={[0, 1.6, 0]} color="#fbbf24" intensity={4} distance={6} />
    </group>
  );
}

function Spikes({
  template,
  tiles,
  room,
  net,
}: {
  template: RoomTemplate;
  tiles: TileType[][];
  room: RoomView;
  net: NetClient;
}) {
  const group = useRef<THREE.Group>(null);
  const rows = useMemo(() => {
    if (template.logicId !== "spikes_pattern") return [];
    return (template.logicParams.rows ?? []) as { z: number; phase: number }[];
  }, [template]);
  const period = (template.logicParams.period as number) ?? 2.4;
  const activeFraction = (template.logicParams.activeFraction as number) ?? 0.45;

  const spikeCells = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) if (tiles[z]![x] === "spike") out.push({ x, z });
    return out;
  }, [tiles]);

  useFrame(() => {
    const s = net.state;
    if (!group.current || !s) return;
    const elapsed = room.enteredTick >= 0 ? (s.tick - room.enteredTick) * TICK_DT : 0;
    group.current.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      const cellZ = mesh.userData.z as number;
      const row = rows.find((r) => r.z === cellZ);
      const up = row ? spikeRowActive(elapsed, period, row.phase, activeFraction) : false;
      const targetY = up ? 0.45 : -0.5;
      mesh.position.y += (targetY - mesh.position.y) * 0.35;
    });
  });

  if (spikeCells.length === 0) return null;
  return (
    <group>
      {/* mechanical mounts stay put while the spikes piston */}
      {spikeCells.map((c) => (
        <mesh key={`m${c.x},${c.z}`} position={[c.x + 0.5, 0.05, c.z + 0.5]}>
          <cylinderGeometry args={[0.34, 0.4, 0.1, 8]} />
          <meshStandardMaterial color="#33222a" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}
      <group ref={group}>
        {spikeCells.map((c) => (
          <mesh
            key={`${c.x},${c.z}`}
            position={[c.x + 0.5, -0.5, c.z + 0.5]}
            userData={{ z: c.z }}
          >
            <coneGeometry args={[0.3, 0.9, 6]} />
            <meshStandardMaterial color="#c23048" emissive="#ff2f4e" emissiveIntensity={1.1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Deployables({ room, net }: { room: RoomView; net: NetClient }) {
  return (
    <group>
      {room.deployables.map((dep) => {
        if (dep.kind === "token") {
          return (
            <mesh key={dep.id} position={[dep.x, 0.12, dep.z]}>
              <cylinderGeometry args={[0.34, 0.4, 0.24, 8]} />
              <meshStandardMaterial color="#e2574c" emissive="#e2574c" emissiveIntensity={0.8} />
            </mesh>
          );
        }
        return <Fieldkit key={dep.id} x={dep.x} z={dep.z} net={net} />;
      })}
    </group>
  );
}

function Fieldkit({ x, z, net }: { x: number; z: number; net: NetClient }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) {
      const t = (clock.elapsedTime * 0.8) % 1;
      ring.current.scale.setScalar(0.5 + t * 2.5);
      (ring.current.material as THREE.MeshStandardMaterial).opacity = 0.6 * (1 - t);
    }
    void net;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.5, 0.4, 0.42]} />
        <meshStandardMaterial color="#e2c94c" emissive="#e2c94c" emissiveIntensity={0.6} />
      </mesh>
      <mesh ref={ring} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1, 32]} />
        <meshStandardMaterial color="#4ade80" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}
