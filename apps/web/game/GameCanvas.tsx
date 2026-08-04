"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  CARRY_RANGE,
  DYN_PROP_DEFS,
  getTemplate,
  INTERACT_RANGE,
  type DynPropKind,
} from "@cubescape/shared";
import type { NetClient } from "./net";
import { RoomView3D } from "./RoomView3D";
import { Actors, Pings } from "./Actors";
import { attachInput, sampleInput } from "./input";
import { camInfo, useGame } from "./store";
import { playSfx } from "./audio";

export function GameCanvas({ net }: { net: NetClient }) {
  return (
    <Canvas
      shadows={false}
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 68, near: 0.1, far: 60, position: [4.5, 4, 9] }}
      style={{ position: "absolute", inset: 0, background: "#05050a" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <fog attach="fog" args={["#04040a", 7, 22]} />
      <GameScene net={net} />
      {/* the teaser look: heavy bloom on emissives, vignette, film grain */}
      <EffectComposer>
        <Bloom
          mipmapBlur
          intensity={1.15}
          luminanceThreshold={0.35}
          luminanceSmoothing={0.2}
        />
        <Vignette eskil={false} offset={0.18} darkness={0.85} />
        <Noise opacity={0.045} />
      </EffectComposer>
    </Canvas>
  );
}

function GameScene({ net }: { net: NetClient }) {
  const [roomCoord, setRoomCoord] = useState("");
  const [phase, setPhase] = useState("lobby");

  // pointer lock + mouse look
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    // merged into the page-level dev hook for e2e debugging
    const w = window as unknown as { __cubescape?: Record<string, unknown> };
    if (w.__cubescape) {
      w.__cubescape.scene = scene;
      w.__cubescape.camera = camera;
      w.__cubescape.gl = gl;
    }
  }, [scene, camera, gl]);
  useEffect(() => {
    const el = gl.domElement;
    const onClick = () => {
      if (document.pointerLockElement !== el) {
        el.requestPointerLock();
      }
    };
    const onLockChange = () => {
      useGame.getState().setPointerLocked(document.pointerLockElement === el);
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      const g = useGame.getState();
      const yaw = g.yaw - e.movementX * 0.0026;
      const pitch = Math.max(-1.2, Math.min(0.5, g.pitch - e.movementY * 0.0026));
      g.setLook(yaw, pitch);
    };
    const onMouseDown = (e: MouseEvent) => {
      // mouse buttons double as action keys while locked:
      // LMB strike · RMB interact (E) · MMB ping (V) · M4/M5 abilities 1/2
      if (document.pointerLockElement !== el) return;
      switch (e.button) {
        case 0:
          net.ability(3);
          break;
        case 2:
          net.interact();
          break;
        case 1: {
          e.preventDefault(); // no autoscroll
          const g = useGame.getState();
          const fx = Math.sin(g.yaw);
          const fz = Math.cos(g.yaw);
          const px = Math.max(0.2, Math.min(8.8, g.px + fx * 3));
          const pz = Math.max(0.2, Math.min(8.8, g.pz + fz * 3));
          net.ping("look", px, pz);
          break;
        }
        case 3:
          e.preventDefault(); // no history navigation
          net.ability(0);
          break;
        case 4:
          e.preventDefault();
          net.ability(1);
          break;
      }
    };
    const swallow = (e: Event) => {
      if (document.pointerLockElement === el) e.preventDefault();
    };
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("contextmenu", swallow);
    el.addEventListener("auxclick", swallow);
    el.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    const detachKeys = attachInput();
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("contextmenu", swallow);
      el.removeEventListener("auxclick", swallow);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      detachKeys();
    };
  }, [gl, net]);

  // room/phase tracking runs on a plain interval: setState from inside useFrame
  // can starve under throttled/virtualized schedulers and the scene never appears
  useEffect(() => {
    const t = setInterval(() => {
      const s = net.state;
      const me = net.me;
      if (!s || !me) return;
      setPhase((p) => (p === s.phase ? p : s.phase));
      if (me.roomCoord) {
        setRoomCoord((rc) => (rc === me.roomCoord ? rc : me.roomCoord));
      }
    }, 120);
    return () => clearInterval(t);
  }, [net]);

  // main loop: input → prediction → intents → camera
  const stepSfxAt = useRef(0);
  const camState = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
    boom: number;
    room: string;
  } | null>(null);
  useFrame(({ camera, clock }, dt) => {
    const s = net.state;
    if (!s) return;
    const me = net.me;
    if (!me) return;

    const g = useGame.getState();
    const input = sampleInput(g.yaw);
    net.markFrame();

    if (s.phase === "running") {
      const drive = net.autoInput ?? input;
      net.update(dt, {
        mx: drive.mx,
        mz: drive.mz,
        jump: drive.jump,
        hold: drive.hold,
      });
      if (input.interactTap) net.interact();
      if (input.ability !== null) net.ability(input.ability);
      if (input.emote) net.emote(input.emote);
      if (input.ping) {
        const fx = Math.sin(g.yaw);
        const fz = Math.cos(g.yaw);
        const px = Math.max(0.2, Math.min(8.8, g.px + fx * 3));
        const pz = Math.max(0.2, Math.min(8.8, g.pz + fz * 3));
        net.ping("look", px, pz);
      }
      // footsteps
      const moving = Math.hypot(input.mx, input.mz) > 0.3;
      if (moving && clock.elapsedTime - stepSfxAt.current > 0.34) {
        stepSfxAt.current = clock.elapsedTime;
        playSfx("footstep");
      }
      updateInteractHint(net);
    }

    // ---- third-person camera rig ----
    // damped spring follow + grid raymarch so the boom never buries the view
    // inside a wall, corner, or column; snaps clean on room transitions.
    const desiredTarget = new THREE.Vector3(g.px, 1.3, g.pz);
    const MAX_BOOM = 3.4;
    const dir = new THREE.Vector3(
      -Math.sin(g.yaw) * Math.cos(g.pitch),
      -Math.sin(g.pitch),
      -Math.cos(g.yaw) * Math.cos(g.pitch),
    );

    // shorten the boom against walls/columns: march the shared grid from the
    // player's head toward the desired camera spot (pits don't block a camera)
    const ctx = net.moveContext(me);
    let boomLimit = MAX_BOOM;
    if (ctx) {
      const solidForCam = (tx: number, tz: number) =>
        tx < 0 || tx >= 9 || tz < 0 || tz >= 9 || ctx.solidProps.has(`${tx},${tz}`);
      for (let t = 0.4; t <= MAX_BOOM; t += 0.12) {
        const sx = desiredTarget.x + dir.x * t;
        const sz = desiredTarget.z + dir.z * t;
        // pad toward the sample direction so the near plane clears the surface
        if (
          solidForCam(Math.floor(sx), Math.floor(sz)) ||
          solidForCam(Math.floor(sx + dir.x * 0.22), Math.floor(sz + dir.z * 0.22))
        ) {
          boomLimit = Math.max(0.55, t - 0.28);
          break;
        }
      }
    }

    const cs =
      camState.current ??
      (camState.current = {
        pos: desiredTarget.clone().addScaledVector(dir, boomLimit),
        target: desiredTarget.clone(),
        boom: boomLimit,
        room: me.roomCoord,
      });
    if (cs.room !== me.roomCoord) {
      // hard snap on room transition — never sweep through the wall
      cs.room = me.roomCoord;
      cs.target.copy(desiredTarget);
      cs.boom = boomLimit;
      cs.pos.copy(desiredTarget).addScaledVector(dir, boomLimit);
    }

    // boom pulls IN fast (avoid clipping) and eases back OUT slowly
    const boomK = 1 - Math.exp(-dt * (boomLimit < cs.boom ? 30 : 5));
    cs.boom += (boomLimit - cs.boom) * boomK;
    cs.target.lerp(desiredTarget, 1 - Math.exp(-dt * 22));
    const desired = cs.target.clone().addScaledVector(dir, cs.boom);
    desired.y = Math.min(2.25, Math.max(0.5, desired.y + 0.6));
    desired.x = Math.min(8.55, Math.max(0.45, desired.x));
    desired.z = Math.min(8.55, Math.max(0.45, desired.z));
    cs.pos.lerp(desired, 1 - Math.exp(-dt * 13));
    camera.position.copy(cs.pos);
    // impact shake, decaying over 300ms
    const shakeAge = Date.now() - g.shakeAt;
    if (shakeAge < 300) {
      const k = (1 - shakeAge / 300) * 0.06;
      camera.position.x += (Math.random() - 0.5) * k;
      camera.position.y += (Math.random() - 0.5) * k;
      camera.position.z += (Math.random() - 0.5) * k;
    }
    camera.lookAt(cs.target);
    // expose camera-to-player distance so the local rig can fade out
    camInfo.dist = cs.pos.distanceTo(desiredTarget);
  });

  const s = net.state;
  if (!s || !roomCoord || phase === "lobby") return null;
  const room = s.rooms.get(roomCoord);
  if (!room) return null;
  const myChar = net.me?.charId ?? "";

  return (
    <group>
      <RoomView3D key={roomCoord} net={net} room={room} myCharId={myChar} />
      <Actors net={net} roomCoord={roomCoord} />
      <Pings roomCoord={roomCoord} />
    </group>
  );
}

function updateInteractHint(net: NetClient): void {
  const s = net.state;
  const me = net.me;
  if (!s || !me) return;
  const room = s.rooms.get(me.roomCoord);
  if (!room) return;
  const g = useGame.getState();
  let hint = "";
  const near = (x: number, z: number, r = INTERACT_RANGE) =>
    Math.hypot(g.px - x, g.pz - z) <= r;

  // hands full: E always sets the load down
  if (me.carryProp) {
    const fx = Math.sin(g.yaw);
    const fz = Math.cos(g.yaw);
    const cx = Math.floor(g.px + fx * 1.1);
    const cz = Math.floor(g.pz + fz * 1.1);
    const tiles = net.moveContext(me)?.tiles;
    const onPlate = tiles?.[cz]?.[cx] === "plate";
    hint = onPlate
      ? `E — set the ${me.carryProp} on the plate`
      : `E — set down the ${me.carryProp}`;
    if (g.interactHint !== hint) g.setInteractHint(hint);
    return;
  }

  // downed teammate?
  s.players.forEach((p, id) => {
    if (id === me.sessionId || !p.downed || p.roomCoord !== me.roomCoord) return;
    if (near(p.x, p.z, 1.6)) hint = `hold E — revive ${p.name}`;
  });
  if (!hint && room.keyColor && !room.keyTaken) {
    const template = getTemplate(room.templateId);
    const ped = template.props.find((pr) => pr.type === "key_pedestal");
    const kx = ped ? ped.cell[0] + 0.5 : 4.5;
    const kz = ped ? ped.cell[1] + 0.5 : 4.5;
    if (near(kx, kz)) hint = `E — take the ${room.keyColor} key`;
  }
  if (!hint) {
    const template = getTemplate(room.templateId);
    for (const p of template.props) {
      if (p.type === "lever" && near(p.cell[0] + 0.5, p.cell[1] + 0.5)) {
        hint = "E — pull lever";
        break;
      }
      if (
        (p.type === "exit_terminal" || p.type === "vent_terminal") &&
        !room.cleared &&
        near(p.cell[0] + 0.5, p.cell[1] + 0.5, 2.1)
      ) {
        const verb = p.type === "exit_terminal" ? "escape" : "vent the room";
        hint =
          room.logicProgress > 0
            ? `keep holding E — ${room.logicProgress}%`
            : `hold E — ${verb}`;
        break;
      }
    }
  }
  // nearest carryable prop (E acts on the closest thing: prop vs door)
  let propHint = "";
  let propD = Infinity;
  room.dynProps.forEach((d) => {
    if (!DYN_PROP_DEFS[d.kind as DynPropKind]?.carryable) return;
    const dist = Math.hypot(g.px - d.x, g.pz - d.z);
    if (dist <= CARRY_RANGE && dist < propD) {
      propD = dist;
      propHint = `E — pick up the ${d.kind}`;
    }
  });
  if (!hint) {
    for (const d of room.doors) {
      const doorD = Math.hypot(g.px - (d.cellX + 0.5), g.pz - (d.cellZ + 0.5));
      if (propHint && propD < doorD) continue;
      if (d.face === "U") {
        if (near(d.cellX + 0.5, d.cellZ + 0.5))
          hint = room.liftPowered ? "E — ride lift up" : "lift unpowered (plate / kit / grapple)";
      } else if (d.face === "D") {
        if (near(d.cellX + 0.5, d.cellZ + 0.5)) hint = "E — drop down";
      } else if (!d.open && near(d.cellX + 0.5, d.cellZ + 0.5)) {
        switch (d.gateType) {
          case "key":
            hint = `E — open (needs ${d.gateParam} key)`;
            break;
          case "stat":
            hint = `E — open (${d.gateParam} ${d.gateValue} near the door)`;
            break;
          case "plates":
            hint = `hold ${d.gateValue} plate${d.gateValue > 1 ? "s" : ""} to open`;
            break;
          case "objective":
            hint =
              d.ownerCoord === me.roomCoord
                ? "sealed — clear this room's objective"
                : "sealed by an objective on the far side";
            break;
          default:
            hint = "E — open door";
        }
      }
      if (hint) break;
    }
  }
  // lowest priority: pick up a crate/barrel/lockbox
  if (!hint) hint = propHint;
  if (g.interactHint !== hint) g.setInteractHint(hint);
}
