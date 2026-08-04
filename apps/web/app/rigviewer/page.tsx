"use client";

// Dev model viewer: /rigviewer
// Orbit/pan/zoom camera, animation buttons (idle/walk/strike/down), all three
// character rigs plus enemies and dynamic props on one stage.

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { Suspense, useRef, useState } from "react";
import * as THREE from "three";
import { CHARACTERS, type CharId } from "@cubescape/shared";
import {
  BarrelMesh,
  CharacterModel,
  CrateMesh,
  LockboxMesh,
  SlimeMesh,
  TurretMesh,
  poseRig,
  type RigRefs,
} from "../../game/CharacterModel";

type Anim = "idle" | "walk" | "strike" | "down";
const ANIMS: Anim[] = ["idle", "walk", "strike", "down"];

const CHARS: CharId[] = ["brute", "scout", "tinker"];

function AnimatedChar({ id, anim, spin }: { id: CharId; anim: Anim; spin: boolean }) {
  const refs: RigRefs = {
    torso: useRef<THREE.Group>(null),
    armL: useRef<THREE.Group>(null),
    armR: useRef<THREE.Group>(null),
    elbowL: useRef<THREE.Group>(null),
    elbowR: useRef<THREE.Group>(null),
    legL: useRef<THREE.Group>(null),
    legR: useRef<THREE.Group>(null),
    kneeL: useRef<THREE.Group>(null),
    kneeR: useRef<THREE.Group>(null),
  };
  const body = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * Math.PI * 2);

  useFrame(({ clock }, dt) => {
    const moving = anim === "walk";
    phase.current += dt * (moving ? 9.5 : 1.6);
    // strike retriggers on a 0.9s loop
    const strikeAge = (clock.elapsedTime * 1000) % 900;
    const attackT = anim === "strike" && strikeAge < 240 ? 1 - strikeAge / 240 : 0;
    poseRig(refs, { phase: phase.current, moving, attackT });
    if (body.current) {
      body.current.position.y =
        anim === "down"
          ? 0.22
          : moving
            ? Math.abs(Math.sin(phase.current * 2)) * 0.045
            : Math.sin(phase.current * 0.9) * 0.015;
      body.current.rotation.x =
        anim === "down" ? Math.PI / 2 : attackT * 0.24 + (moving ? 0.08 : 0);
    }
    if (spinner.current) {
      spinner.current.rotation.y += spin ? dt * 0.6 : 0;
    }
  });

  return (
    <group ref={spinner}>
      <group ref={body}>
        <CharacterModel charId={id} color={CHARACTERS[id].color} refs={refs} />
      </group>
    </group>
  );
}

function AnimatedSlime() {
  const blob = useRef<THREE.Mesh>(null);
  const hop = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (blob.current) {
      const squash = 1 + Math.sin(t * 6) * 0.12;
      blob.current.scale.set(1 / squash, squash, 1 / squash);
    }
    if (hop.current) hop.current.position.y = Math.abs(Math.sin(t * 3)) * 0.08;
  });
  return (
    <group ref={hop}>
      <SlimeMesh blobRef={blob} />
    </group>
  );
}

function AnimatedTurret({ friendly }: { friendly: boolean }) {
  const head = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (head.current) head.current.rotation.y = clock.elapsedTime * 0.7;
  });
  return <TurretMesh headRef={head} friendly={friendly} />;
}

function Label({ text, y = 2.1 }: { text: string; y?: number }) {
  return (
    <Text position={[0, y, 0]} fontSize={0.18} color="#8b93b0" anchorX="center">
      {text}
    </Text>
  );
}

function Stage({ anim, spin }: { anim: Anim; spin: boolean }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#cfe8ff", "#1a1d2e", 0.7]} />
      <directionalLight position={[3, 6, 4]} intensity={1.4} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial color="#232736" roughness={0.9} />
      </mesh>
      <gridHelper args={[16, 16, "#39415e", "#2a2f45"]} position={[0, 0.01, 0]} />

      {/* characters, front row */}
      {CHARS.map((id, i) => (
        <group key={id} position={[(i - 1) * 1.9, 0, 0.6]} rotation={[0, 0.4, 0]}>
          <AnimatedChar id={id} anim={anim} spin={spin} />
          <Label text={CHARACTERS[id].name} />
        </group>
      ))}

      {/* enemies, left flank */}
      <group position={[-4.6, 0, -0.6]}>
        <AnimatedSlime />
        <Label text="slime" y={1.1} />
      </group>
      <group position={[-6, 0, -0.6]}>
        <AnimatedTurret friendly={false} />
        <Label text="turret" y={1.5} />
      </group>
      <group position={[-6, 0, 1.4]}>
        <AnimatedTurret friendly={true} />
        <Label text="turret (ally)" y={1.5} />
      </group>

      {/* props, right flank */}
      <group position={[4.4, 0, -0.6]}>
        <CrateMesh />
        <Label text="crate" y={1.15} />
      </group>
      <group position={[5.8, 0, -0.6]}>
        <BarrelMesh />
        <Label text="barrel" y={1.15} />
      </group>
      <group position={[5.1, 0, 1.4]}>
        <LockboxMesh />
        <Label text="lockbox" y={1.15} />
      </group>

      <OrbitControls
        makeDefault
        target={[0, 1, 0]}
        enablePan
        minDistance={1.5}
        maxDistance={14}
        maxPolarAngle={Math.PI * 0.52}
      />
    </>
  );
}

const btn = (active: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  fontFamily: "monospace",
  fontSize: 13,
  letterSpacing: 1,
  textTransform: "uppercase",
  cursor: "pointer",
  color: active ? "#0b0e1a" : "#c7cfe8",
  background: active ? "#38d6f0" : "#1a1f33",
  border: "1px solid #39415e",
  borderRadius: 4,
});

export default function RigViewerPage() {
  const [anim, setAnim] = useState<Anim>("idle");
  const [spin, setSpin] = useState(false);
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#101322", position: "relative" }}>
      <Canvas camera={{ position: [0, 2.2, 5.6], fov: 50 }}>
        <Suspense fallback={null}>
          <Stage anim={anim} spin={spin} />
        </Suspense>
      </Canvas>
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
          {ANIMS.map((a) => (
            <button key={a} style={btn(anim === a)} onClick={() => setAnim(a)}>
              {a}
            </button>
          ))}
          <button style={btn(spin)} onClick={() => setSpin((v) => !v)}>
            spin
          </button>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          color: "#8b93b0",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        rig viewer — drag orbit · right-drag pan · scroll zoom
      </div>
    </div>
  );
}
