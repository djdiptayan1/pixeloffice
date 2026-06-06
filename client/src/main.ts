// ---------------------------------------------------------------------------
// Client composition root. Wires the four layers together and contains NO
// business logic itself (presence/meeting rules live server-side; the game
// renders; the HUD displays; this file just bridges network <-> game/HUD).
//
// Flow: show login -> connect (dev auth profile) -> on WELCOME boot the Phaser
// game and the HUD -> translate every S2C message into game-handle / store
// mutations, and forward explicit user actions as C2S messages. Human agency:
// nothing here auto-teleports — Join buttons send JOIN_* only on user click.
// ---------------------------------------------------------------------------

import "./styles.css";
import {
  C2S,
  S2C,
  type ChatBroadcastPayload,
  type EventCreatedPayload,
  type EventEndedPayload,
  type EventUpdatedPayload,
  type JoinOptions,
  type MeetingEndedPayload,
  type MeetingStartedPayload,
  type PlayerJoinedPayload,
  type PlayerLeftPayload,
  type PlayerMovedPayload,
  type PlayerTeleportedPayload,
  type PresencePayload,
  type SetStatusPayload,
  type ToastPayload,
  type WelcomePayload,
} from "@pixeloffice/shared";
import { Connection } from "./net/connection";
import { createOfficeGame, type OfficeGameHandle } from "./game";
import { Store } from "./ui/state";
import { createLogin } from "./ui/login";
import { createHud } from "./ui/hud";
import { Toasts } from "./ui/toasts";
import { createAdmin } from "./ui/admin";

const gameRoot = document.getElementById("game-root")!;
const hudRoot = document.getElementById("hud-root")!;
const loginRoot = document.getElementById("login-root")!;

const toasts = new Toasts(hudRoot);

const login = createLogin({
  parent: loginRoot,
  onSubmit: (opts) => void start(opts),
});

async function start(opts: JoinOptions): Promise<void> {
  const conn = new Connection();
  try {
    await conn.connect(opts);
  } catch (err) {
    login.showError(serverDownMessage(err));
    return;
  }

  const selfId = conn.sessionId;
  const store = new Store(selfId);

  // Register the WELCOME handler synchronously right after connect so we never
  // miss it (colyseus.js delivers room messages once a handler exists).
  let booted = false;
  conn.on<WelcomePayload>(S2C.WELCOME, (welcome) => {
    if (booted) return;
    booted = true;
    void boot(conn, store, welcome);
  });

  conn.onError((code, message) => {
    toasts.show(`Connection error (${code})${message ? `: ${message}` : ""}`, "broadcast");
  });
  conn.onLeave(() => {
    toasts.show("Disconnected from the office.", "broadcast");
    login.show();
  });
}

async function boot(conn: Connection, store: Store, welcome: WelcomePayload): Promise<void> {
  const selfId = store.get().selfId;

  // Seed the store from WELCOME (self first, then others, events, meeting).
  store.upsertPlayer(welcome.self);
  for (const p of welcome.players) store.upsertPlayer(p);
  for (const ev of welcome.events) store.upsertEvent(ev);
  if (welcome.meeting) store.setMeeting(welcome.meeting);

  // Boot the Phaser game (it owns/controls the local avatar).
  const game: OfficeGameHandle = await createOfficeGame({
    parent: gameRoot,
    self: welcome.self,
    onLocalMove: (x, y, dir, moving) => {
      conn.send(C2S.MOVE, { x, y, dir, moving });
      // Mirror locally so the roster's "current area" tracks self movement.
      store.movePlayer(selfId, x, y, dir, moving);
    },
    onAreaChange: (areaName) => store.setSelfArea(areaName),
  });

  // Render existing remote players into the scene.
  for (const p of welcome.players) game.addPlayer(p);

  // Build the HUD now that we can wire its actions to the connection + game.
  const hud = createHud(hudRoot, store, {
    onSetStatus: (state: SetStatusPayload["state"]) => conn.send(C2S.SET_STATUS, { state }),
    onJoinEvent: (eventId) => conn.send(C2S.JOIN_EVENT, { eventId }),
    onLeaveEvent: (eventId) => conn.send(C2S.LEAVE_EVENT, { eventId }),
    onJoinMeeting: (meetingId) => {
      conn.send(C2S.JOIN_MEETING, { meetingId });
      store.markMeetingJoined();
    },
    onLeaveMeeting: (_meetingId) => {
      // LEAVE_MEETING takes no payload server-side (handleLeaveMeeting ignores args).
      conn.send(C2S.LEAVE_MEETING, {});
      store.markMeetingLeft();
    },
    onSendChat: (text) => conn.send(C2S.CHAT, { text }),
    onChatFocus: (focused) => game.setInputLocked(focused),
  });

  store.subscribe(() => hud.render());

  // Admin console (plain fetch to the REST API).
  createAdmin(hudRoot);

  login.hide();

  // ----------------------------------------------------------------------
  // S2C message bridge: translate wire facts into game + store mutations.
  // ----------------------------------------------------------------------

  conn.on<PlayerJoinedPayload>(S2C.PLAYER_JOINED, ({ player }) => {
    store.upsertPlayer(player);
    game.addPlayer(player);
    toasts.show(`${player.name} joined the office.`, "info");
  });

  conn.on<PlayerLeftPayload>(S2C.PLAYER_LEFT, ({ sessionId }) => {
    store.removePlayer(sessionId);
    game.removePlayer(sessionId);
  });

  conn.on<PlayerMovedPayload>(S2C.PLAYER_MOVED, ({ sessionId, x, y, dir, moving }) => {
    if (sessionId === selfId) return; // local avatar is authoritative client-side
    store.movePlayer(sessionId, x, y, dir, moving);
    game.movePlayer(sessionId, x, y, dir, moving);
  });

  conn.on<PlayerTeleportedPayload>(S2C.PLAYER_TELEPORTED, ({ sessionId, x, y }) => {
    store.teleportPlayer(sessionId, x, y);
    game.teleportPlayer(sessionId, x, y); // may target self (after a Join click)
  });

  conn.on<PresencePayload>(S2C.PRESENCE, ({ sessionId, state, source }) => {
    store.setPresence(sessionId, state, source);
    game.setPresence(sessionId, state);
  });

  conn.on<ChatBroadcastPayload>(S2C.CHAT, ({ sessionId, name, text }) => {
    game.showChatBubble(sessionId, text);
    if (sessionId !== selfId) toasts.show(`${name}: ${text}`, "info");
  });

  conn.on<EventCreatedPayload>(S2C.EVENT_CREATED, ({ event }) => {
    store.upsertEvent(event);
  });
  conn.on<EventUpdatedPayload>(S2C.EVENT_UPDATED, ({ event }) => {
    store.upsertEvent(event);
  });
  conn.on<EventEndedPayload>(S2C.EVENT_ENDED, ({ eventId }) => {
    store.removeEvent(eventId);
  });

  conn.on<MeetingStartedPayload>(S2C.MEETING_STARTED, ({ meeting }) => {
    // Agency rule: show the Join button, NEVER auto-teleport.
    store.setMeeting(meeting);
    toasts.show(`Meeting starting: ${meeting.title}. Click Join when ready.`, "meeting");
  });
  conn.on<MeetingEndedPayload>(S2C.MEETING_ENDED, ({ meetingId }) => {
    store.clearMeeting(meetingId);
    toasts.show("Your meeting has ended.", "meeting");
  });

  conn.on<ToastPayload>(S2C.TOAST, ({ message, kind }) => {
    toasts.show(message, kind);
  });
}

function serverDownMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/refused|failed|network|ECONNREFUSED|WebSocket/i.test(msg)) {
    return "Could not reach the office server. Is it running on :2567?";
  }
  return msg || "Could not join the office.";
}
