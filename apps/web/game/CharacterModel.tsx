"use client";
import type { RefObject } from "react";
import type * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
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

export interface RigPose {
  /** walk-cycle phase (radians, keeps advancing while idle for breathing) */
  phase: number;
  moving: boolean;
  /** 1 at the instant a strike lands, decaying to 0 over ~240ms */
  attackT: number;
}

/**
 * THE walk/attack pose. Shared by the in-game PlayerRig and the rig viewer so
 * the animation is authored exactly once.
 */
export function poseRig(refs: RigRefs, pose: RigPose): void {
  const { phase: p2, moving, attackT } = pose;
  const attacking = attackT > 0;
  const swing = moving ? Math.sin(p2) : 0;
  if (refs.torso?.current) {
    // counter-twist against the stride
    refs.torso.current.rotation.y = moving ? Math.sin(p2) * 0.09 : 0;
  }
  // legs: hip swing + knee flex during the back-to-front swing
  if (refs.legL?.current) refs.legL.current.rotation.x = swing * 0.62;
  if (refs.legR?.current) refs.legR.current.rotation.x = -swing * 0.62;
  if (refs.kneeL?.current)
    refs.kneeL.current.rotation.x = moving ? Math.max(0, -Math.sin(p2 - 0.5)) * 0.85 : 0.04;
  if (refs.kneeR?.current)
    refs.kneeR.current.rotation.x = moving ? Math.max(0, Math.sin(p2 - 0.5)) * 0.85 : 0.04;
  // arms counter-swing; right arm jabs on attack
  if (refs.armL?.current) refs.armL.current.rotation.x = moving ? -swing * 0.5 : 0.06;
  if (refs.armR?.current) {
    refs.armR.current.rotation.x = attacking ? -1.7 * attackT : moving ? swing * 0.5 : 0.06;
  }
  if (refs.elbowL?.current) {
    refs.elbowL.current.rotation.x = moving ? -0.35 - Math.max(0, swing) * 0.3 : -0.25;
  }
  if (refs.elbowR?.current) {
    refs.elbowR.current.rotation.x = attacking
      ? -0.15
      : moving
        ? -0.35 - Math.max(0, -swing) * 0.3
        : -0.25;
  }
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
            <RoundedBox
              args={[0.15, 0.11, 0.27]}
              radius={0.04}
              smoothness={4}
              position={[0, -0.28, 0.045]}
            >
              <meshStandardMaterial color="#2c3350" roughness={0.5} metalness={0.1} />
            </RoundedBox>
          </group>
        </group>
      ))}

      <group ref={refs.torso} position={[0, 0.82, 0]}>
        {/* pelvis */}
        <RoundedBox args={[0.31, 0.2, 0.22]} radius={0.06} smoothness={4} position={[0, 0.05, 0]}>
          <meshStandardMaterial color="#3a4160" roughness={0.7} />
        </RoundedBox>
        {/* chest */}
        <RoundedBox args={[0.4, 0.46, 0.26]} radius={0.07} smoothness={4} position={[0, 0.38, 0]}>
          <meshStandardMaterial
            color={color}
            roughness={0.55}
            emissive={color}
            emissiveIntensity={glow ? 0.7 : 0.05}
          />
        </RoundedBox>
        {/* status light */}
        <mesh position={[0, 0.44, 0.13]}>
          <boxGeometry args={[0.09, 0.045, 0.012]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} />
        </mesh>
        {/* life-support backpack */}
        <RoundedBox args={[0.28, 0.36, 0.12]} radius={0.05} smoothness={4} position={[0, 0.36, -0.19]}>
          <meshStandardMaterial color="#363c58" roughness={0.55} metalness={0.1} />
        </RoundedBox>
        <mesh position={[0, 0.5, -0.24]}>
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
              <RoundedBox
                args={[0.2, 0.14, 0.27]}
                radius={0.05}
                smoothness={4}
                position={[side * 0.045, 0.05, 0]}
              >
                <meshStandardMaterial color="#8a2f28" roughness={0.55} />
              </RoundedBox>
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

/** jelly slime — Mob squashes it and drives the emissive via blobRef */
export function SlimeMesh({ blobRef }: { blobRef?: RefObject<THREE.Mesh> }) {
  return (
    <>
      <mesh ref={blobRef} position={[0, 0.32, 0]} castShadow>
        <sphereGeometry args={[0.34, 14, 12]} />
        <meshStandardMaterial
          color="#5da53c"
          emissive="#8adf5a"
          emissiveIntensity={0.3}
          transparent
          opacity={0.92}
          roughness={0.25}
        />
      </mesh>
      {/* inner core gives it a jelly read */}
      <mesh position={[0, 0.28, 0]}>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color="#3d7a24" transparent opacity={0.85} />
      </mesh>
      {/* eyes */}
      {[-0.11, 0.11].map((x) => (
        <mesh key={x} position={[x, 0.42, 0.26]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color="#0c1408" />
        </mesh>
      ))}
    </>
  );
}

/** tripod sentry turret — Mob rotates headRef and flashes blobRef */
export function TurretMesh({
  blobRef,
  headRef,
  friendly = false,
}: {
  blobRef?: RefObject<THREE.Mesh>;
  headRef?: RefObject<THREE.Group>;
  friendly?: boolean;
}) {
  return (
    <>
      {/* tripod legs */}
      {[0, 2.094, 4.189].map((a) => (
        <mesh
          key={a}
          position={[Math.sin(a) * 0.22, 0.16, Math.cos(a) * 0.22]}
          rotation={[0.5 * Math.cos(a), 0, -0.5 * Math.sin(a)]}
        >
          <cylinderGeometry args={[0.035, 0.05, 0.42, 6]} />
          <meshStandardMaterial color="#2c2c3a" />
        </mesh>
      ))}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.2, 0.26, 0.3, 8]} />
        <meshStandardMaterial color={friendly ? "#8a7a3a" : "#3a3444"} />
      </mesh>
      {/* rotating head + barrel + eye */}
      <group ref={headRef} position={[0, 0.68, 0]}>
        <mesh ref={blobRef}>
          <boxGeometry args={[0.3, 0.22, 0.42]} />
          <meshStandardMaterial
            color={friendly ? "#e2c94c" : "#8a4a62"}
            emissive={friendly ? "#e2c94c" : "#f43f5e"}
            emissiveIntensity={0.3}
          />
        </mesh>
        <mesh position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.26, 8]} />
          <meshStandardMaterial color="#1c1c28" />
        </mesh>
        <mesh position={[0, 0.08, 0.18]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial
            color={friendly ? "#fff7c2" : "#ff5a70"}
            emissive={friendly ? "#e2c94c" : "#f43f5e"}
            emissiveIntensity={2.4}
          />
        </mesh>
      </group>
    </>
  );
}
