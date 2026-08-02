import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Bot, type BotReport } from "./bot.js";
import type { CharId } from "@cubescape/shared";

/**
 * Bot soak: spawns a fresh server, connects N bots, runs for --seconds,
 * asserts zero errors + input convergence (+ exit reached with --solve).
 *
 *   pnpm soak -- --bots 4 --seconds 60 --seed 7 --solve
 */

interface Args {
  bots: number;
  seconds: number;
  seed: number;
  solve: boolean;
  url: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
  };
  return {
    bots: Number(get("bots") ?? 4),
    seconds: Number(get("seconds") ?? 60),
    seed: Number(get("seed") ?? Math.floor(Math.random() * 100000)),
    solve: argv.includes("--solve"),
    url: get("url"),
  };
}

const CHARS: CharId[] = ["brute", "scout", "tinker"];

async function main(): Promise<void> {
  const args = parseArgs();
  const port = 2599;
  let serverProc: ChildProcess | null = null;
  let serverErrors = 0;

  if (!args.url) {
    const here = dirname(fileURLToPath(import.meta.url));
    const serverDir = resolve(here, "../../server");
    serverProc = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc.stdout?.on("data", (d: Buffer) => {
      const line = d.toString();
      if (process.env.SOAK_VERBOSE) process.stdout.write(`[server] ${line}`);
    });
    serverProc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString();
      if (line.startsWith("npm warn")) return; // npx noise, not a server error
      serverErrors++;
      process.stderr.write(`[server:err] ${line}`);
    });
    // wait for the port
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        up = res.ok;
      } catch {
        await delay(500);
      }
    }
    if (!up) {
      console.error("FAIL: server did not come up");
      serverProc.kill();
      process.exit(1);
    }
  }

  const url = args.url ?? `ws://localhost:${port}`;
  console.log(
    `soak: ${args.bots} bots vs ${url}, seed ${args.seed}, ${args.seconds}s, solve=${args.solve}`,
  );

  const bots: Bot[] = [];
  for (let i = 0; i < args.bots; i++) {
    const bot = new Bot({
      url,
      code: `soak-${args.seed}`,
      seed: args.seed,
      name: `Bot-${i}-${CHARS[i % 3]}`,
      charId: CHARS[i % 3]!,
      solve: args.solve,
    });
    await bot.join();
    bots.push(bot);
    await delay(150);
  }
  bots.forEach((b) => b.start());

  const deadline = Date.now() + args.seconds * 1000;
  let lastLog = 0;
  let done = false;
  while (Date.now() < deadline && !done) {
    await delay(1000);
    if (Date.now() - lastLog > 10000) {
      lastLog = Date.now();
      console.log(`  t-${Math.round((deadline - Date.now()) / 1000)}s ...`);
    }
    if (args.solve) {
      done = bots.some((b) => b.hasReachedExit);
    }
  }

  const reports: BotReport[] = bots.map((b) => b.stop());
  serverProc?.kill();

  let failed = false;
  for (const r of reports) {
    console.log(
      `  ${r.name}: rooms=${r.roomsVisited} exit=${r.reachedExit} seq=${r.finalSeq} errors=${r.errors.length}`,
    );
    for (const e of r.errors.slice(0, 3)) console.log(`    ! ${e}`);
    if (r.errors.length > 0) failed = true;
    if (r.finalSeq < 60) {
      console.log(`    ! bot barely moved (seq ${r.finalSeq})`);
      failed = true;
    }
  }
  const anyExit = reports.some((r) => r.reachedExit);
  const roomsSum = reports.reduce((s, r) => s + r.roomsVisited, 0);
  if (roomsSum < args.bots * 2) {
    console.log("FAIL: bots did not traverse rooms");
    failed = true;
  }
  if (args.solve && !anyExit) {
    console.log("FAIL: no bot reached the exit in solve mode");
    failed = true;
  }
  if (serverErrors > 0) {
    console.log(`FAIL: server logged ${serverErrors} stderr chunks`);
    failed = true;
  }
  console.log(failed ? "SOAK FAILED" : "SOAK OK");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
