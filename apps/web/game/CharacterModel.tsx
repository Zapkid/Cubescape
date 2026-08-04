"use client";
import type { RefObject } from "react";
import type * as THREE from "three";
import type { CharId } from "@cubescape/shared";

export interface RigRefs {
  torso?: RefObject<THREE.Group>;
  armL?: RefObject<THREE.Group>;
  armR?: RefObject<THREE.Group>;
  elbowL?: RefObject<THREE.Group>;
  elbowR?: RefObject<THREE.Group>;
  legL?: RefObject<THREE.Group>;
  legR?: RefObject<THREE.Group>;
  kneeL?: RefObject<THREE.Group>;
  kneeR?: RefObject<THREE.Group>;
}

/**
 * Pure articulated humanoid (~1.7 units tall). PlayerRig animates it through
 * the optional joint refs; the rig viewer renders it bare.
 */
export function CharacterModel({
  charId,
  color,
  glow = false,
  refs = {},
}: {
  charId: CharId;
  color: string;
  glow?: boolean;
  refs?: RigRefs;
}) {
  return (
    <group
      scale={
        charId === "brute"
          ? [1.16, 0.98, 1.1]
          : charId === "scout"
            ? [0.9, 1.02, 0.92]
            : [1, 1, 1]
      }
    >
      {/* ---- legs (hip pivot → knee pivot → boot) ---- */}
      {[-1, 1].map((side) => (
        <group
          key={side}
          ref={side < 0 ? refs.legL : refs.legR}
          position={[side * 0.13, 0.82, 0]}
          rotation={[0, 0, side * 0.03]}
        >
          <mesh position={[0, -0.19, 0]}>
            <capsuleGeometry args={[0.085, 0.26, 4, 10]} />
            <meshStandardMaterial color={color} roughness={0.65} />
          </mesh>
          <group ref={side < 0 ? refs.kneeL : refs.kneeR} position={[0, -0.4, 0]}>
            <mesh position={[0, -0.13, 0]}>
              <capsuleGeometry args={[0.068, 0.2, 4, 10]} />
              <meshStandardMaterial color="#3a4160" roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.28, 0.045]}>
              <boxGeometry args={[0.15, 0.1, 0.26]} />
              <meshStandardMaterial color="#2c3350" roughness={0.5} metalness={0.1} />
            </mesh>
          </group>
        </group>
      ))}

      <group ref={refs.torso} position={[0, 0.82, 0]}>
        {/* pelvis + belt */}
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[0.33, 0.18, 0.21]} />
          <meshStandardMaterial color="#3a4160" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.13, 0]}>
          <boxGeometry args={[0.35, 0.05, 0.23]} />
          <meshStandardMaterial color="#4d5578" metalness={0.15} roughness={0.5} />
        </mesh>
        {/* chest */}
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[0.4, 0.44, 0.25]} />
          <meshStandardMaterial
            color={color}
            roughness={0.62}
            emissive={color}
            emissiveIntensity={glow ? 0.7 : 0.05}
          />
        </mesh>
        {/* chest plate + status light */}
        <mesh position={[0, 0.42, 0.135]}>
          <boxGeometry args={[0.2, 0.16, 0.03]} />
          <meshStandardMaterial color="#4d5578" roughness={0.35} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.42, 0.155]}>
          <boxGeometry args={[0.07, 0.04, 0.01]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} />
        </mesh>
        {/* life-support backpack */}
        <mesh position={[0, 0.36, -0.19]}>
          <boxGeometry args={[0.3, 0.38, 0.13]} />
          <meshStandardMaterial color="#363c58" roughness={0.55} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.5, -0.23]}>
          <boxGeometry args={[0.1, 0.05, 0.04]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} />
        </mesh>

        {/* ---- arms (shoulder pivot → elbow pivot → glove) ---- */}
        {[-1, 1].map((side) => (
          <group
            key={side}
            ref={side < 0 ? refs.armL : refs.armR}
            position={[side * 0.27, 0.55, 0]}
            rotation={[0, 0, side * 0.09]}
          >
            <mesh>
              <sphereGeometry args={[0.095, 10, 8]} />
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
            {charId === "brute" ? (
              <mesh position={[side * 0.045, 0.05, 0]}>
                <boxGeometry args={[0.2, 0.13, 0.26]} />
                <meshStandardMaterial color="#8a2f28" roughness={0.55} />
              </mesh>
            ) : null}
            <mesh position={[0, -0.15, 0]}>
              <capsuleGeometry args={[0.065, 0.2, 4, 10]} />
              <meshStandardMaterial color={color} roughness={0.65} />
            </mesh>
            <group ref={side < 0 ? refs.elbowL : refs.elbowR} position={[0, -0.3, 0]}>
              <mesh position={[0, -0.1, 0]}>
                <capsuleGeometry args={[0.055, 0.16, 4, 10]} />
                <meshStandardMaterial color="#3a4160" roughness={0.7} />
              </mesh>
              <mesh position={[0, -0.23, 0]}>
                <sphereGeometry args={[0.075, 8, 8]} />
                <meshStandardMaterial color="#2c3350" roughness={0.5} metalness={0.1} />
              </mesh>
            </group>
          </group>
        ))}

        {/* ---- head ---- */}
        <group position={[0, 0.72, 0]}>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.07, 0.09, 0.08, 8]} />
            <meshStandardMaterial color="#3a4160" />
          </mesh>
          <mesh position={[0, 0.17, 0]}>
            <sphereGeometry args={[0.16, 14, 12]} />
            <meshStandardMaterial color={color} roughness={0.55} />
          </mesh>
          {/* the face is a glowing visor */}
          <mesh position={[0, 0.17, 0.1]} rotation={[-0.06, 0, 0]}>
            <capsuleGeometry args={[0.085, 0.1, 6, 12]} />
            <meshStandardMaterial
              color="#0a1a22"
              emissive="#8ae8ff"
              emissiveIntensity={1.5}
              roughness={0.15}
            />
          </mesh>
          {charId === "scout" ? (
            <mesh position={[0, 0.26, -0.06]} rotation={[0.7, 0, 0]}>
              <coneGeometry args={[0.09, 0.24, 6]} />
              <meshStandardMaterial color="#2a7d92" />
            </mesh>
          ) : null}
          {charId === "tinker" ? (
            <>
              <mesh position={[0.12, 0.3, 0]}>
                <cylinderGeometry args={[0.012, 0.012, 0.24, 4]} />
                <meshStandardMaterial color="#c0c0d0" />
              </mesh>
              <mesh position={[0.12, 0.44, 0]}>
                <sphereGeometry args={[0.03, 6, 6]} />
                <meshStandardMaterial
                  color="#e2c94c"
                  emissive="#e2c94c"
                  emissiveIntensity={2.4}
                />
              </mesh>
            </>
          ) : null}
        </group>
      </group>
    </group>
  );
}

/** static crate mesh — RoomView3D wraps it with net-driven motion */
export function CrateMesh({ flashRef }: { flashRef?: RefObject<THREE.Mesh> }) {
  return (
    <>
      <mesh ref={flashRef} position={[0, 0.34, 0]} castShadow>
        <boxGeometry args={[0.68, 0.68, 0.68]} />
        <meshStandardMaterial
          color="#6b5333"
          roughness={0.85}
          emissive="#ffffff"
          emissiveIntensity={0}
        />
      </mesh>
      {[0.66, 0.03].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[0.71, 0.06, 0.71]} />
          <meshStandardMaterial color="#3d4354" metalness={0.2} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.34, 0.345]}>
        <boxGeometry args={[0.03, 0.62, 0.011]} />
        <meshStandardMaterial color="#46351f" />
      </mesh>
      <mesh position={[0.345, 0.34, 0]}>
        <boxGeometry args={[0.011, 0.62, 0.03]} />
        <meshStandardMaterial color="#46351f" />
      </mesh>
    </>
  );
}

/** indestructible sokoban lockbox: dark alloy cube with glowing seams */
export function LockboxMesh({ flashRef }: { flashRef?: RefObject<THREE.Mesh> }) {
  return (
    <>
      <mesh ref={flashRef} position={[0, 0.33, 0]} castShadow>
        <boxGeometry args={[0.66, 0.66, 0.66]} />
        <meshStandardMaterial
          color="#39415e"
          roughness={0.35}
          metalness={0.2}
          emissive="#ffffff"
          emissiveIntensity={0}
        />
      </mesh>
      {/* glowing seams */}
      {[0.1, 0.56].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[0.69, 0.045, 0.69]} />
          <meshStandardMaterial
            color="#0a2a30"
            emissive="#38d6f0"
            emissiveIntensity={1.5}
          />
        </mesh>
      ))}
      {/* corner armor */}
      {[-0.29, 0.29].map((x) =>
        [-0.29, 0.29].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.33, z]}>
            <boxGeometry args={[0.14, 0.7, 0.14]} />
            <meshStandardMaterial color="#262c42" roughness={0.45} metalness={0.15} />
          </mesh>
        )),
      )}
      {/* lock light */}
      <mesh position={[0, 0.4, 0.34]}>
        <boxGeometry args={[0.1, 0.1, 0.02]} />
        <meshStandardMaterial color="#38d6f0" emissive="#38d6f0" emissiveIntensity={2} />
      </mesh>
    </>
  );
}

/** static barrel mesh — RoomView3D wraps it with net-driven motion */
export function BarrelMesh({ flashRef }: { flashRef?: RefObject<THREE.Mesh> }) {
  return (
    <>
      <mesh ref={flashRef} position={[0, 0.36, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.3, 0.72, 12]} />
        <meshStandardMaterial
          color="#4c5670"
          roughness={0.6}
          metalness={0.15}
          emissive="#ffffff"
          emissiveIntensity={0}
        />
      </mesh>
      {[0.16, 0.56].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[0.31, 0.31, 0.05, 12]} />
          <meshStandardMaterial color="#333a4e" metalness={0.2} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[0, 0.73, 0]}>
        <cylinderGeometry args={[0.2, 0.26, 0.04, 12]} />
        <meshStandardMaterial color="#3a4258" />
      </mesh>
    </>
  );
}
