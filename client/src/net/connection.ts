// ---------------------------------------------------------------------------
// Thin colyseus.js wrapper. Knows nothing about presence/meeting rules — it is
// pure transport. All message names flow through the C2S / S2C constants from
// the shared protocol so we never drift from the server's wire contract.
// ---------------------------------------------------------------------------

import { Client, Room } from "colyseus.js";
import {
  DEFAULT_SERVER_PORT,
  ROOM_NAME,
  type JoinOptions,
} from "@pixeloffice/shared";

/** Derive the server WebSocket endpoint from the page location so the same
 *  build works on localhost and over a LAN IP (phones, other machines). */
export function serverHttpBase(): string {
  const host = location.hostname || "localhost";
  return `http://${host}:${DEFAULT_SERVER_PORT}`;
}

function serverWsEndpoint(): string {
  const host = location.hostname || "localhost";
  // Colyseus 0.15 expects the ws(s) endpoint of the server.
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${host}:${DEFAULT_SERVER_PORT}`;
}

type MessageHandler<T> = (payload: T) => void;

export class Connection {
  private client: Client;
  private room: Room | null = null;

  constructor() {
    this.client = new Client(serverWsEndpoint());
  }

  /** Join the office room with the dev auth profile. Resolves once joined. */
  async connect(opts: JoinOptions): Promise<void> {
    this.room = await this.client.joinOrCreate(ROOM_NAME, opts);
  }

  /** This client's Colyseus session id (assigned after connect). */
  get sessionId(): string {
    if (!this.room) throw new Error("Connection.sessionId read before connect()");
    return this.room.sessionId;
  }

  /** Register a typed handler for a server -> client message (S2C constant). */
  on<T>(type: string, handler: MessageHandler<T>): void {
    if (!this.room) throw new Error("Connection.on() called before connect()");
    this.room.onMessage(type, (payload: T) => handler(payload));
  }

  /** Send a typed client -> server message (C2S constant). */
  send<T>(type: string, payload: T): void {
    if (!this.room) throw new Error("Connection.send() called before connect()");
    this.room.send(type, payload);
  }

  onLeave(handler: (code: number) => void): void {
    if (!this.room) throw new Error("Connection.onLeave() called before connect()");
    this.room.onLeave(handler);
  }

  onError(handler: (code: number, message?: string) => void): void {
    if (!this.room) throw new Error("Connection.onError() called before connect()");
    this.room.onError(handler);
  }
}
