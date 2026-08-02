import { createServer } from "node:http";
import express from "express";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom.js";

const port = Number(process.env.PORT ?? 2567);

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("match", MatchRoom).filterBy(["code"]);

void matchMaker; // (reserved for a lobby listing endpoint later)

gameServer
  .listen(port)
  .then(() => console.log(`[cubescape] server listening on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
