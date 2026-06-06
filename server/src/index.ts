// ---------------------------------------------------------------------------
// Server entry point: Express (admin REST + CORS) + Colyseus (the office room).
//
// The HTTP server is shared between Express and the Colyseus WebSocket
// transport so both live on one port. Services are constructed once in the
// container and injected into the room and routes.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_SERVER_PORT, ROOM_NAME } from "@pixeloffice/shared";
import { OfficeRoom } from "./rooms/office.room";
import { createAdminRouter } from "./http/admin.routes";

const PORT = readPort();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", createAdminRouter());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ROOM_NAME, OfficeRoom);

httpServer.listen(PORT, () => {
  console.log(
    `[PixelOffice] server listening on http://localhost:${PORT} ` +
      `(ws room "${ROOM_NAME}", REST under /api)`,
  );
});

function readPort(): number {
  const raw = process.env.PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SERVER_PORT;
}
