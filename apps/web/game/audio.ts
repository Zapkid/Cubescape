"use client";

/** WebAudio-synthesized sfx — zero assets, tiny, good enough juice. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  durMs: number,
  type: OscillatorType = "sine",
  gain = 0.5,
  glideTo?: number,
): void {
  const a = ac();
  if (!a || !master) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, glideTo),
      a.currentTime + durMs / 1000,
    );
  }
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + durMs / 1000);
  osc.connect(g).connect(master);
  osc.start();
  osc.stop(a.currentTime + durMs / 1000 + 0.02);
}

function noise(durMs: number, gain = 0.3, lowpass = 1200): void {
  const a = ac();
  if (!a || !master) return;
  const len = Math.floor((a.sampleRate * durMs) / 1000);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = gain;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lowpass;
  src.connect(f).connect(g).connect(master);
  src.start();
}

const lastPlayed = new Map<string, number>();

export function playSfx(kind: string, e?: Record<string, unknown>): void {
  const now = Date.now();
  const throttle = kind === "hit" ? 60 : 120;
  if (now - (lastPlayed.get(kind) ?? 0) < throttle) return;
  lastPlayed.set(kind, now);

  switch (kind) {
    case "doorOpen":
      tone(90, 450, "square", 0.25, 45);
      noise(400, 0.2, 500);
      break;
    case "transition":
      tone(220, 250, "sine", 0.3, 440);
      break;
    case "keyPickup":
      tone(660, 120, "triangle", 0.4);
      setTimeout(() => tone(880, 160, "triangle", 0.4), 90);
      setTimeout(() => tone(1320, 220, "triangle", 0.3), 180);
      break;
    case "hit": {
      const isPlayer = e && "playerId" in e;
      if (isPlayer) {
        tone(140, 180, "sawtooth", 0.4, 70);
        noise(150, 0.25, 700);
      } else {
        tone(320, 90, "square", 0.3, 200);
      }
      break;
    }
    case "mobDie":
      tone(400, 300, "sawtooth", 0.3, 60);
      noise(250, 0.3, 900);
      break;
    case "downed":
      tone(300, 700, "sawtooth", 0.4, 50);
      break;
    case "revived":
      tone(330, 160, "sine", 0.4);
      setTimeout(() => tone(495, 220, "sine", 0.4), 130);
      break;
    case "objective":
      tone(523, 140, "triangle", 0.4);
      setTimeout(() => tone(659, 140, "triangle", 0.4), 120);
      setTimeout(() => tone(784, 260, "triangle", 0.4), 240);
      break;
    case "matchComplete":
      [523, 659, 784, 1046].forEach((f, i) =>
        setTimeout(() => tone(f, 350, "triangle", 0.4), i * 160),
      );
      break;
    case "ability":
      tone(500, 140, "sine", 0.25, 900);
      break;
    case "breach":
      noise(500, 0.5, 300);
      tone(60, 500, "square", 0.4, 30);
      break;
    case "propBreak":
      noise(280, 0.45, 1400);
      tone(180, 160, "square", 0.3, 90);
      break;
    case "propSink":
      tone(110, 350, "sine", 0.4, 40);
      noise(300, 0.3, 400);
      break;
    case "propPickup":
      tone(320, 90, "triangle", 0.3, 420);
      noise(60, 0.08, 900);
      break;
    case "propPlace":
      tone(220, 120, "triangle", 0.32, 140);
      noise(90, 0.1, 600);
      break;
    case "doorClose":
      tone(140, 260, "square", 0.3, 70);
      noise(200, 0.2, 500);
      break;
    case "ping":
      tone(980, 120, "sine", 0.3);
      break;
    case "footstep":
      noise(60, 0.06, 400);
      break;
    case "denied":
      tone(180, 160, "square", 0.25, 120);
      break;
    default:
      break;
  }
}
