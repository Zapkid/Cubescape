"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getTemplate, INTERACT_RANGE } from "@cubescape/shared";
import type { NetClient } from "./net";
import { RoomView3D } from "./RoomView3D";
import { Actors, Pings } from "./Actors";
import { attachInput, sampleInput } from "./input";
import { useGame } from "./store";
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
      <fog attach="fog" args={["#05050a", 10, 26]} />
      <GameScene net={net} />
    </Canvas>
  );
}

function GameScene({ net }: { net: NetClient }) {
  const [roomCoord, setRoomCoord] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [phase, setPhase] = useState("lobby");

  // pointer lock + mouse look
  const { gl } = useThree();
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
      // universal strike on left click while locked
      if (document.pointerLockElement === el && e.button === 0) {
        net.ability(3);
      }
    };
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    const detachKeys = attachInput();
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      detachKeys();
    };
  }, [gl, net]);

  // main loop: input → prediction → intents → camera
  const stepSfxAt = useRef(0);
  useFrame(({ camera, clock }, dt) => {
    const s = net.state;
    if (!s) return;
    if (s.phase !== phase) setPhase(s.phase);
    const me = net.me;
    if (!me) return;
    if (me.roomCoord !== roomCoord) {
      setRoomCoord(me.roomCoord);
      const r = s.rooms.get(me.roomCoord);
      if (r && r.templateId !== templateId) setTemplateId(r.templateId);
    }

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

    // third-person camera rig — stays INSIDE the room shell (walls/ceiling occlude)
    const target = new THREE.Vector3(g.px, 1.3, g.pz);
    const back = 3.4;
    const dir = new THREE.Vector3(
      -Math.sin(g.yaw) * Math.cos(g.pitch),
      -Math.sin(g.pitch),
      -Math.cos(g.yaw) * Math.cos(g.pitch),
    );
    const desired = target.clone().addScaledVector(dir, back);
    desired.y = Math.min(2.25, Math.max(0.5, desired.y + 0.6));
    desired.x = Math.min(8.55, Math.max(0.45, desired.x));
    desired.z = Math.min(8.55, Math.max(0.45, desired.z));
    camera.position.lerp(desired, Math.min(1, dt * 14));
    camera.lookAt(target);
  });

  const s = net.state;
  if (!s || !roomCoord || s.phase === "lobby") return null;
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
  if (!hint) {
    for (const d of room.doors) {
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
  if (g.interactHint !== hint) g.setInteractHint(hint);
}
