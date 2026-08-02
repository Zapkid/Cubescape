import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "shared",
      root: "packages/shared",
      include: ["test/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "server",
      root: "packages/server",
      include: ["test/**/*.test.ts"],
      environment: "node",
      testTimeout: 20000,
      hookTimeout: 20000,
      // colyseus registers process-level IPC/signal handlers that break the forks pool
      pool: "threads",
      poolOptions: { threads: { singleThread: true } },
    },
  },
]);
