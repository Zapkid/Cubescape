"use client";

// Dev-only model viewer: /rigviewer?yaw=0.6
// Shows all three character rigs plus the dynamic props on a plain stage so
// art passes can be verified without joining a match.

import { Canvas } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CHARACTERS, type CharId } from "@cubescape/shared";
import { BarrelMesh, CharacterModel, CrateMesh } from "../../game/CharacterModel";

const CHARS: CharId[] = ["brute", "scout", "tinker"];

function Stage() {
  const params = useSearchParams();
  const yaw = Number(params.get("yaw") ?? "0.5");
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#cfe8ff", "#1a1d2e", 0.7]} />
      <directionalLight position={[3, 6, 4]} intensity={1.4} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial color="#232736" roughness={0.9} />
      </mesh>
      {CHARS.map((id, i) => (
        <group key={id} position={[(i - 1) * 1.7, 0, 0]} rotation={[0, yaw, 0]}>
          <CharacterModel charId={id} color={CHARACTERS[id].color} />
          <Text position={[0, 2.05, 0]} fontSize={0.2} color="#e2e8f0" anchorX="center">
            {CHARACTERS[id].name}
          </Text>
        </group>
      ))}
      <group position={[3.4, 0, 0.4]} rotation={[0, yaw, 0]}>
        <CrateMesh />
      </group>
      <group position={[-3.4, 0, 0.4]}>
        <BarrelMesh />
      </group>
    </>
  );
}

export default function RigViewerPage() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#101322" }}>
      <Canvas camera={{ position: [0, 1.5, 4.6], fov: 50 }}>
        <Suspense fallback={null}>
          <Stage />
        </Suspense>
      </Canvas>
    </div>
  );
}
