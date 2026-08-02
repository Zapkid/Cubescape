"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
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
      {/* white ambient for base visibility; archetype mood rides the hemisphere + point */}
      <ambientLight color="#ffffff" intensity={0.38} />
      <hemisphereLight args={[lighting.ambient, "#0a0a12", 3.2]} />
      <directionalLight position={[6, 10, 4]} color="#ccd4ff" intensity={0.9} />
      <pointLight
        position={[4.5, 3.2, 4.5]}
        color={lighting.point}
        intensity={template.lighting.intensity * 42}
        distance={18}
        decay={1.3}
      />
      <Floor tiles={tiles} room={room} />
      <Walls room={room} />
      <Doors room={room} myCharId={myCharId} />
      <Props template={template} room={room} myCharId={myCharId} net={net} />
      <Spikes template={template} tiles={tiles} room={room} net={net} />
      <Deployables room={room} net={net} />
    </group>
  );
}

function Floor({ tiles, room }: { tiles: TileType[][]; room: RoomView }) {
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
            <mesh key={c.key} position={[c.x + 0.5, -0.9, c.z + 0.5]}>
              <boxGeometry args={[1, 1.6, 1]} />
              <meshStandardMaterial color="#04040a" />
            </mesh>
          );
        }
        if (breached) return null; // open hole
        const color = bridged ? "#4a3f2e" : TILE_COLORS[c.t] ?? "#2a2a3a";
        const isAccent = c.t !== "floor";
        return (
          <mesh key={c.key} position={[c.x + 0.5, -0.1, c.z + 0.5]} receiveShadow>
            <boxGeometry args={[0.98, 0.2, 0.98]} />
            <meshStandardMaterial
              color={color}
              emissive={isAccent ? color : "#000000"}
              emissiveIntensity={isAccent ? 0.45 : 0}
            />
          </mesh>
        );
      })}
      {/* lift glow ring when powered */}
      <LiftGlow tiles={tiles} room={room} />
    </group>
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

function Walls({ room }: { room: RoomView }) {
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
      {segments.map((s, i) => (
        <mesh key={i} position={[s.x, WALL_H / 2, s.z]}>
          <boxGeometry args={[s.w, WALL_H, s.d]} />
          <meshStandardMaterial color="#1c1c28" />
        </mesh>
      ))}
      {/* ceiling */}
      <mesh position={[4.5, WALL_H + 0.1, 4.5]}>
        <boxGeometry args={[9.6, 0.2, 9.6]} />
        <meshStandardMaterial color="#131320" />
      </mesh>
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
      {/* frame posts */}
      <mesh position={horizontal ? [-0.55, WALL_H / 2, 0] : [0, WALL_H / 2, -0.55]}>
        <boxGeometry args={horizontal ? [0.14, WALL_H, 0.36] : [0.36, WALL_H, 0.14]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={horizontal ? [0.55, WALL_H / 2, 0] : [0, WALL_H / 2, 0.55]}>
        <boxGeometry args={horizontal ? [0.14, WALL_H, 0.36] : [0.36, WALL_H, 0.14]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.35} />
      </mesh>
      {/* sliding panel */}
      <mesh ref={panelRef} position={[0, 1.1, 0]}>
        <boxGeometry args={horizontal ? [1.0, 2.2, 0.18] : [0.18, 2.2, 1.0]} />
        <meshStandardMaterial
          color="#3a3a4c"
          emissive={tint}
          emissiveIntensity={d.open ? 0 : 0.12}
        />
      </mesh>
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
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.42, 0.9, 0.42]} />
        <meshStandardMaterial color="#33334a" />
      </mesh>
      <mesh position={[0, 1.0, 0]} rotation={[0.5, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.6, 6]} />
        <meshStandardMaterial color="#c0c0d0" />
      </mesh>
      <Text position={[0, 1.5, 0]} fontSize={0.34} color="#2dd4bf" anchorX="center">
        {String(lamp)}
      </Text>
      {room.logicProgress >= lamp && lamp > 0 ? (
        <mesh position={[0, 1.22, 0]}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={2} />
        </mesh>
      ) : null}
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
        <mesh ref={gem} position={[0, 1.15, 0]}>
          <octahedronGeometry args={[0.22]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} />
        </mesh>
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
  useFrame(({ clock }) => {
    if (!screen.current) return;
    const mat = screen.current.material as THREE.MeshStandardMaterial;
    const s = net.state;
    const active = !room.cleared;
    mat.emissiveIntensity = active ? 1 + Math.sin(clock.elapsedTime * 5) * 0.5 : 0.25;
    mat.emissive.set(room.cleared ? "#4ade80" : kind === "exit_terminal" ? "#4ade80" : "#f43f5e");
    void s;
  });
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
      {!room.cleared ? (
        <Text position={[0, 1.6, 0]} fontSize={0.2} color="#ffffff" anchorX="center">
          {kind === "exit_terminal" ? "hold [E] to escape" : "hold [E] to vent"}
        </Text>
      ) : null}
    </group>
  );
}

function Beacon({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.4 + Math.sin(clock.elapsedTime * 2.4) * 0.6;
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
    <group ref={group}>
      {spikeCells.map((c) => (
        <mesh
          key={`${c.x},${c.z}`}
          position={[c.x + 0.5, -0.5, c.z + 0.5]}
          userData={{ z: c.z }}
        >
          <coneGeometry args={[0.3, 0.9, 6]} />
          <meshStandardMaterial color="#8a3040" emissive="#f43f5e" emissiveIntensity={0.35} />
        </mesh>
      ))}
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
