// ---------------------------------------------------------------------------
// The Phaser office scene — pure rendering layer (plan rule: NO business logic).
//
// It renders the shared office map (floors, walls, furniture), draws every
// avatar (local + remote), runs Pokémon-Emerald-style grid-locked movement for
// the LOCAL avatar from keyboard input, and exposes imperative methods the UI
// bridge calls for remote players (add/remove/move/teleport/presence/bubble).
//
// The scene knows nothing about presence rules, meetings, the network, or the
// HUD. It receives facts (a presence STATE to pick an animation, a tile to walk
// to) and renders them. All callbacks back to the UI go through the options.
// ---------------------------------------------------------------------------

import Phaser from "phaser";
import {
  EMOTE_EMOJI,
  PresenceState,
  areaAt,
  buildOfficeMap,
  isWalkable,
  type Direction,
  type Emote,
  type FurnitureKind,
  type OfficeMap,
  type PlayerSnapshot,
} from "@pixeloffice/shared";
import {
  BUBBLE_MAX_CHARS,
  BUBBLE_MS,
  CAMERA_ZOOM,
  DEPTH_AREA_LABEL,
  DEPTH_ENTITY_BASE,
  DEPTH_FLOOR,
  DEPTH_OVERLAY,
  DEPTH_RUG,
  DEPTH_WALL,
  EMOTE_MS,
  PAN_MS,
  PAN_RESUME_MS,
  STEP_MS,
  TILE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_TWEEN_MS,
} from "./constants";
import {
  TEX,
  animKey,
  buildAllTextures,
  floorTextureForArea,
  floorVariantForTile,
  frameIndex,
  furnitureFlickers,
  type SheetDir,
} from "./textures";

/** Direction -> (dx,dy) in tiles. */
const DIR_VEC: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Presence states that should play the idle ("anchored") pose, never walk. */
function poseDirFor(dir: Direction): SheetDir {
  return dir as SheetDir;
}

interface Avatar {
  snap: PlayerSnapshot;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image; // soft ellipse under the feet
  nameTag: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Container; // presence icon on a dark pill
  badgeBg: Phaser.GameObjects.Graphics;
  badgeIcon: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Container;
  bubbleTimer?: Phaser.Time.TimerEvent;
  /** Active emote bubble (capped at one per avatar; replaced on a new emote). */
  emote?: Phaser.GameObjects.Container;
  emoteTimer?: Phaser.Time.TimerEvent;
  /** In-flight grid step tween, if any (remote interpolation / local step). */
  stepTween?: Phaser.Tweens.Tween;
  presence: PresenceState;
  /** Whether the avatar is mid-step (controls walk vs idle anim). */
  walking: boolean;
}

export interface SceneCallbacks {
  onLocalMove(x: number, y: number, dir: Direction, moving: boolean): void;
  onAreaChange(areaName: string): void;
  onAvatarClick(sessionId: string): void;
}

const BADGE_FOR: Record<PresenceState, string> = {
  [PresenceState.AVAILABLE]: "",
  [PresenceState.IN_MEETING]: "📅",
  [PresenceState.FOCUS]: "🎧",
  [PresenceState.BREAK]: "☕",
  [PresenceState.AWAY]: "💤",
  [PresenceState.OFFLINE]: "",
};

export class OfficeScene extends Phaser.Scene {
  private map: OfficeMap = buildOfficeMap();
  private avatars = new Map<string, Avatar>();
  private selfId = "";
  private selfStart!: PlayerSnapshot;
  private cb!: SceneCallbacks;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  /** While true the local avatar ignores keyboard (chat input focused). */
  private inputLocked = false;
  private lastArea = "Hallway";
  /** Furniture pieces that flip between base/alt textures for a glow flicker. */
  private flickerPieces: { img: Phaser.GameObjects.Image; kind: FurnitureKind }[] = [];
  private flickerOn = false;
  /** When true, decorative tweens/particles are skipped (accessibility). */
  private reducedMotion = false;
  /** Whether ambient NPC avatars are currently visible. */
  private npcVisible = true;
  /** Coffee-machine steam emitters, tracked so reduced-motion can pause them. */
  private steamEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  /** Timer that resumes following the local avatar after a pan-to-player. */
  private panResumeTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: "office" });
  }

  init(data: { self: PlayerSnapshot; cb: SceneCallbacks }): void {
    this.selfStart = data.self;
    this.selfId = data.self.sessionId;
    this.cb = data.cb;
  }

  preload(): void {
    // All textures are generated at runtime (no asset files).
    buildAllTextures(this);
  }

  create(): void {
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.setBackgroundColor("#0e1116");

    this.drawWorld();

    // Local avatar (the game owns and controls it — contract rule).
    this.spawnAvatar(this.selfStart, true);
    const self = this.avatars.get(this.selfId)!;
    this.cameras.main.startFollow(self.sprite, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, this.map.width * TILE, this.map.height * TILE);

    // Input.
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Announce initial area.
    this.reportArea(self);

    // Signal the handle factory that the scene is fully live (self avatar built).
    this.game.events.emit("office-ready");
  }

  update(): void {
    if (this.inputLocked) return;
    const self = this.avatars.get(this.selfId);
    if (!self || self.walking) return;

    const dir = this.pollDirection();
    if (!dir) return;

    // Any local movement input cancels a pan-to-player and snaps the camera
    // back to following the local avatar (human agency: the user is in control).
    if (this.panResumeTimer) this.resumeFollowSelf();

    // Face that way even if blocked (Emerald turn-in-place feel).
    self.snap.dir = dir;
    this.applyFacing(self);

    const { dx, dy } = DIR_VEC[dir];
    const nx = self.snap.x + dx;
    const ny = self.snap.y + dy;
    if (!isWalkable(this.map, nx, ny) || this.tileOccupied(nx, ny)) {
      // Blocked: still tell the server we turned (moving:false) so others see facing.
      this.cb.onLocalMove(self.snap.x, self.snap.y, dir, false);
      return;
    }

    this.stepLocal(self, nx, ny, dir);
  }

  // -------------------------------------------------------------------------
  // World rendering
  // -------------------------------------------------------------------------

  private drawWorld(): void {
    // Floors: paint each area's floor, hallway elsewhere. Pick one of the
    // deterministic variant tiles per position so large floors don't band.
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const area = areaAt(this.map, x, y);
        const base = area
          ? floorTextureForArea(area.type, area.department)
          : TEX.hallwayFloor;
        const key = floorVariantForTile(base, x, y);
        const img = this.add.image(x * TILE, y * TILE, key).setOrigin(0, 0);
        img.setDepth(DEPTH_FLOOR);
      }
    }

    // Area labels: pixel-font styling (caps, letter-spacing, outline).
    for (const a of this.map.areas) {
      const label = this.add.text(
        (a.x + a.w / 2) * TILE,
        (a.y + 0.45) * TILE,
        a.name.toUpperCase(),
        {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#eef2f6",
          stroke: "#11151b",
          strokeThickness: 3,
        },
      );
      label.setLetterSpacing?.(2);
      label.setOrigin(0.5, 0.5).setAlpha(0.62).setDepth(DEPTH_AREA_LABEL);
    }

    // Walls. Outer north wall tiles (y === 0, excluding corners) deterministically
    // become windows showing the sky — a few, not all, to keep it charming.
    const lastX = this.map.width - 1;
    for (const w of this.map.walls) {
      const northOuter = w.y === 0 && w.x > 1 && w.x < lastX - 1;
      const isWindow = northOuter && (w.x * 7 + w.y * 13) % 3 === 0;
      const tex = isWindow ? TEX.wallWindow : TEX.wall;
      this.add.image(w.x * TILE, w.y * TILE, tex).setOrigin(0, 0).setDepth(DEPTH_WALL);
    }

    // Furniture (y-sorted so taller pieces overlap correctly).
    for (const f of this.map.furniture) {
      const img = this.add.image(f.x * TILE, f.y * TILE, TEX.furniture(f.kind)).setOrigin(0, 0);
      if (f.kind === "rug") {
        img.setDepth(DEPTH_RUG);
      } else {
        const footY = (f.y + f.h) * TILE;
        img.setDepth(DEPTH_ENTITY_BASE + footY);
      }
      if (furnitureFlickers(f.kind)) this.flickerPieces.push({ img, kind: f.kind });
      if (f.kind === "coffee-machine") this.spawnSteam(f.x, f.y);
    }

    // Drive the cheap 2-frame glow flicker on a slow shared timer.
    this.time.addEvent({
      delay: 480,
      loop: true,
      callback: () => this.tickFlicker(),
    });
  }

  /** Toggle glowing-screen / LED furniture between its base + alt texture. */
  private tickFlicker(): void {
    this.flickerOn = !this.flickerOn;
    for (const f of this.flickerPieces) {
      f.img.setTexture(this.flickerOn ? TEX.furnitureAlt(f.kind) : TEX.furniture(f.kind));
    }
  }

  /** Tiny capped steam wisps rising from a coffee machine tile. */
  private spawnSteam(fx: number, fy: number): void {
    const x = fx * TILE + TILE / 2;
    const y = fy * TILE - 2;
    const emitter = this.add.particles(x, y, TEX.steam, {
      speedY: { min: -14, max: -8 },
      speedX: { min: -3, max: 3 },
      lifespan: 1400,
      frequency: 700, // capped + cheap: ~2 live wisps at a time
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 0.55, end: 0 },
      quantity: 1,
    });
    emitter.setDepth(DEPTH_ENTITY_BASE + (fy + 1) * TILE + 2);
    this.steamEmitters.push(emitter);
    if (this.reducedMotion) emitter.stop();
  }

  /** One-shot dust puff burst at a tile centre (teleport feedback). */
  private dustPuff(tileX: number, tileY: number): void {
    if (this.reducedMotion) return; // decorative only
    const x = tileX * TILE + TILE / 2;
    const y = tileY * TILE + TILE / 2 + 6;
    const emitter = this.add.particles(x, y, TEX.dust, {
      speed: { min: 20, max: 50 },
      angle: { min: 200, max: 340 },
      lifespan: 420,
      scale: { start: 1, end: 0.2 },
      alpha: { start: 0.9, end: 0 },
      gravityY: 30,
      quantity: 8,
      emitting: false,
    });
    emitter.setDepth(DEPTH_ENTITY_BASE + (tileY + 1) * TILE + 3);
    emitter.explode(8);
    // Free the emitter shortly after its particles die.
    this.time.delayedCall(700, () => emitter.destroy());
  }

  // -------------------------------------------------------------------------
  // Avatars
  // -------------------------------------------------------------------------

  private spawnAvatar(snap: PlayerSnapshot, isSelf: boolean): Avatar {
    const px = snap.x * TILE + TILE / 2;
    const py = snap.y * TILE + TILE / 2;

    // Soft drop shadow sits just below the feet, under the sprite.
    const shadow = this.add.image(px, py + 5, TEX.shadow);
    shadow.setOrigin(0.5, 0.5);

    const sprite = this.add.sprite(px, py, TEX.avatarSheet(snap.avatarId));
    sprite.setOrigin(0.5, 0.75); // feet near the tile centre
    sprite.setFrame(frameIndex(poseDirFor(snap.dir)));

    // Clicking an avatar (self included) opens the UI profile card. Generous
    // 32x32 hit area centred on the sprite frame; hand cursor on hover. Pure
    // delegation to the UI — the scene holds no profile/business logic.
    const hit = new Phaser.Geom.Rectangle(0, 0, TILE, TILE);
    sprite.setInteractive({
      hitArea: hit,
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    sprite.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.cb.onAvatarClick(snap.sessionId);
    });

    const nameTag = this.add.text(px, py - TILE * 0.95, isSelf ? `${snap.name} (you)` : snap.name, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: isSelf ? "#ffe9a8" : "#e6ecf2",
      stroke: "#11151b",
      strokeThickness: 3,
    });
    nameTag.setOrigin(0.5, 1).setDepth(DEPTH_OVERLAY);

    // Presence badge: an icon on a small dark pill for readability.
    const badgeIcon = this.add.text(0, 0, BADGE_FOR[snap.presence], { fontSize: "12px" });
    badgeIcon.setOrigin(0.5, 0.5);
    const badgeBg = this.add.graphics();
    const badge = this.add.container(px + nameTag.displayWidth / 2 + 10, py - TILE * 0.95 - 6, [badgeBg, badgeIcon]);
    badge.setDepth(DEPTH_OVERLAY);

    const avatar: Avatar = {
      snap: { ...snap },
      sprite,
      shadow,
      nameTag,
      badge,
      badgeBg,
      badgeIcon,
      presence: snap.presence,
      walking: false,
    };
    this.drawBadgePill(avatar);
    this.avatars.set(snap.sessionId, avatar);
    this.applyDepth(avatar);
    this.applyPresenceAnim(avatar);
    // Newly joined NPCs respect the current hide-NPCs flag immediately.
    if (avatar.snap.isNpc && !this.npcVisible) this.applyAvatarVisibility(avatar, false);
    return avatar;
  }

  /** Show/hide every visual part of one avatar (sprite, shadow, tags, bubbles). */
  private applyAvatarVisibility(a: Avatar, visible: boolean): void {
    a.sprite.setVisible(visible);
    a.shadow.setVisible(visible);
    a.nameTag.setVisible(visible);
    // The badge has its own empty-state visibility; only force-show when the
    // presence actually has an icon, otherwise keep it hidden.
    a.badge.setVisible(visible && BADGE_FOR[a.presence] !== "");
    a.bubble?.setVisible(visible);
    a.emote?.setVisible(visible);
  }

  /** Redraw the dark pill behind the presence icon, or hide it when empty. */
  private drawBadgePill(a: Avatar): void {
    a.badgeBg.clear();
    const icon = BADGE_FOR[a.presence];
    // A hidden NPC's badge must stay hidden even when presence (and thus the
    // pill) is redrawn; otherwise it would reappear above an invisible avatar.
    const hiddenNpc = a.snap.isNpc === true && !this.npcVisible;
    a.badge.setVisible(icon !== "" && !hiddenNpc);
    if (icon === "") return;
    const w = a.badgeIcon.width + 8;
    const h = a.badgeIcon.height + 4;
    a.badgeBg.fillStyle(0x11151b, 0.78);
    a.badgeBg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    a.badgeBg.lineStyle(1, 0x2a323d, 0.9);
    a.badgeBg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  }

  private applyDepth(a: Avatar): void {
    a.sprite.setDepth(DEPTH_ENTITY_BASE + a.sprite.y);
    a.shadow.setDepth(DEPTH_ENTITY_BASE + a.sprite.y - 1);
  }

  private applyFacing(a: Avatar): void {
    if (a.walking) return;
    a.sprite.anims.stop();
    a.sprite.setFrame(frameIndex(poseDirFor(a.snap.dir)));
    this.applyPresenceAnim(a);
  }

  /** Idle posture by presence: FOCUS/BREAK/MEETING play their loop, else static. */
  private applyPresenceAnim(a: Avatar): void {
    if (a.walking) return;
    // Presence is purely cosmetic here; the scene plays the avatar idle anim.
    a.sprite.play(animKey(a.snap.avatarId, poseDirFor(a.snap.dir), "idle"), true);
  }

  private moveTags(a: Avatar): void {
    const px = a.sprite.x;
    const py = a.sprite.y;
    a.shadow.setPosition(px, py + 5);
    a.nameTag.setPosition(px, py - TILE * 0.95);
    a.badge.setPosition(px + a.nameTag.displayWidth / 2 + 10, py - TILE * 0.95 - 6);
    if (a.bubble) a.bubble.setPosition(px, py - TILE * 1.35);
    if (a.emote) a.emote.setPosition(px, py - TILE * 1.3);
  }

  // -------------------------------------------------------------------------
  // Local movement (grid-locked stepping)
  // -------------------------------------------------------------------------

  private pollDirection(): Direction | null {
    if (this.cursors.up.isDown || this.wasd.up.isDown) return "up";
    if (this.cursors.down.isDown || this.wasd.down.isDown) return "down";
    if (this.cursors.left.isDown || this.wasd.left.isDown) return "left";
    if (this.cursors.right.isDown || this.wasd.right.isDown) return "right";
    return null;
  }

  private stepLocal(a: Avatar, nx: number, ny: number, dir: Direction): void {
    a.snap.x = nx;
    a.snap.y = ny;
    a.snap.dir = dir;
    a.walking = true;
    a.sprite.play(animKey(a.snap.avatarId, poseDirFor(dir), "walk"), true);

    const tx = nx * TILE + TILE / 2;
    const ty = ny * TILE + TILE / 2;

    // Tell the server we committed a step (TILE coords on the wire).
    this.cb.onLocalMove(nx, ny, dir, true);

    a.stepTween = this.tweens.add({
      targets: a.sprite,
      x: tx,
      y: ty,
      duration: STEP_MS,
      ease: "Linear",
      onUpdate: () => {
        this.applyDepth(a);
        this.moveTags(a);
      },
      onComplete: () => {
        a.walking = false;
        a.stepTween = undefined;
        this.applyDepth(a);
        this.moveTags(a);
        this.reportArea(a);
        // If a movement key is still held the next update() continues walking;
        // otherwise settle to idle and tell the server we stopped.
        if (!this.inputLocked && this.pollDirection()) {
          // keep walking on next update()
        } else {
          this.applyFacing(a);
          this.cb.onLocalMove(a.snap.x, a.snap.y, a.snap.dir, false);
        }
      },
    });
  }

  private reportArea(a: Avatar): void {
    if (a.snap.sessionId !== this.selfId) return;
    const area = areaAt(this.map, a.snap.x, a.snap.y);
    const name = area?.name ?? "Hallway";
    if (name !== this.lastArea) {
      this.lastArea = name;
      this.cb.onAreaChange(name);
    }
  }

  private tileOccupied(x: number, y: number): boolean {
    for (const a of this.avatars.values()) {
      if (a.snap.x === x && a.snap.y === y) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Public API for the UI bridge (remote players + self teleport/presence)
  // -------------------------------------------------------------------------

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
  }

  apiAddPlayer(snap: PlayerSnapshot): void {
    if (snap.sessionId === this.selfId) return; // self is owned by the scene
    const existing = this.avatars.get(snap.sessionId);
    if (existing) {
      existing.snap = { ...snap };
      this.placeInstant(existing, snap.x, snap.y);
      this.setPresenceBadge(existing, snap.presence);
      this.applyAvatarVisibility(existing, !existing.snap.isNpc || this.npcVisible);
      return;
    }
    this.spawnAvatar(snap, false);
  }

  apiRemovePlayer(sessionId: string): void {
    const a = this.avatars.get(sessionId);
    if (!a) return;
    a.stepTween?.stop();
    a.bubbleTimer?.remove();
    a.bubble?.destroy();
    a.emoteTimer?.remove();
    a.emote?.destroy();
    a.sprite.destroy();
    a.shadow.destroy();
    a.nameTag.destroy();
    a.badge.destroy(); // destroys child graphics + icon
    this.avatars.delete(sessionId);
  }

  apiMovePlayer(sessionId: string, x: number, y: number, dir: Direction, moving: boolean): void {
    if (sessionId === this.selfId) return; // never override local input
    const a = this.avatars.get(sessionId);
    if (!a) return;
    a.snap.dir = dir;

    if (a.snap.x === x && a.snap.y === y) {
      // Pure facing change / stop.
      a.walking = false;
      a.stepTween?.stop();
      a.stepTween = undefined;
      this.applyFacing(a);
      return;
    }

    a.snap.x = x;
    a.snap.y = y;
    a.walking = true;
    a.sprite.play(animKey(a.snap.avatarId, poseDirFor(dir), "walk"), true);

    const tx = x * TILE + TILE / 2;
    const ty = y * TILE + TILE / 2;
    a.stepTween?.stop();
    a.stepTween = this.tweens.add({
      targets: a.sprite,
      x: tx,
      y: ty,
      duration: STEP_MS,
      ease: "Linear",
      onUpdate: () => {
        this.applyDepth(a);
        this.moveTags(a);
      },
      onComplete: () => {
        a.stepTween = undefined;
        a.walking = false;
        this.applyDepth(a);
        this.moveTags(a);
        if (!moving) this.applyFacing(a);
      },
    });
  }

  apiTeleportPlayer(sessionId: string, x: number, y: number): void {
    const a = this.avatars.get(sessionId);
    if (!a) return;
    a.stepTween?.stop();
    a.stepTween = undefined;
    a.walking = false;
    // Dust puff at the departure tile and the arrival tile for a "poof" feel.
    this.dustPuff(a.snap.x, a.snap.y);
    a.snap.x = x;
    a.snap.y = y;
    this.placeInstant(a, x, y);
    this.dustPuff(x, y);
    if (sessionId === this.selfId) {
      this.lastArea = "__force__";
      this.reportArea(a);
    }
  }

  private placeInstant(a: Avatar, x: number, y: number): void {
    a.sprite.setPosition(x * TILE + TILE / 2, y * TILE + TILE / 2);
    this.applyDepth(a);
    this.moveTags(a);
    this.applyFacing(a);
  }

  apiSetPresence(sessionId: string, state: PresenceState): void {
    const a = this.avatars.get(sessionId);
    if (!a) return;
    this.setPresenceBadge(a, state);
  }

  private setPresenceBadge(a: Avatar, state: PresenceState): void {
    a.presence = state;
    a.snap.presence = state;
    a.badgeIcon.setText(BADGE_FOR[state]);
    this.drawBadgePill(a);
  }

  apiShowBubble(sessionId: string, text: string): void {
    const a = this.avatars.get(sessionId);
    if (!a) return;
    a.bubbleTimer?.remove();
    a.bubble?.destroy();

    const clipped = text.length > BUBBLE_MAX_CHARS ? text.slice(0, BUBBLE_MAX_CHARS - 1) + "…" : text;
    const label = this.add.text(0, 0, clipped, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#16202b",
      wordWrap: { width: 160 },
      align: "center",
    });
    label.setOrigin(0.5, 0.5);
    const pad = 5;
    const bg = this.add.graphics();
    const w = label.width + pad * 2;
    const h = label.height + pad * 2;
    bg.fillStyle(0xf4f6f8, 0.96);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 5);
    bg.fillTriangle(-5, h / 2 - 1, 5, h / 2 - 1, 0, h / 2 + 6);

    const container = this.add.container(a.sprite.x, a.sprite.y - TILE * 1.35, [bg, label]);
    container.setDepth(DEPTH_OVERLAY + 1);
    a.bubble = container;
    a.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => {
      container.destroy();
      a.bubble = undefined;
      a.bubbleTimer = undefined;
    });
  }

  // -------------------------------------------------------------------------
  // Emotes — small round bouncy bubble above the name tag (distinct from chat)
  // -------------------------------------------------------------------------

  apiShowEmote(sessionId: string, emote: string): void {
    const a = this.avatars.get(sessionId);
    if (!a) return;
    const glyph = EMOTE_EMOJI[emote as Emote];
    if (!glyph) return; // unknown emote — ignore (defensive; UI sends valid ones)

    // Cap one active emote per avatar: replace any in-flight one.
    a.emoteTimer?.remove();
    a.emote?.destroy();

    const r = 13; // bubble radius
    const bg = this.add.graphics();
    bg.fillStyle(0xf4f6f8, 0.97);
    bg.fillCircle(0, 0, r);
    bg.lineStyle(1, 0xc6ccd2, 0.9);
    bg.strokeCircle(0, 0, r);
    bg.fillStyle(0xf4f6f8, 0.97);
    bg.fillTriangle(-4, r - 2, 4, r - 2, 0, r + 5); // little tail toward the head

    const glyphText = this.add.text(0, -1, glyph, { fontSize: "15px" });
    glyphText.setOrigin(0.5, 0.5);

    const container = this.add.container(a.sprite.x, a.sprite.y - TILE * 1.3, [bg, glyphText]);
    container.setDepth(DEPTH_OVERLAY + 2); // above chat bubbles
    if (a.snap.isNpc && !this.npcVisible) container.setVisible(false);
    a.emote = container;

    const settle = () => {
      a.emoteTimer = this.time.delayedCall(EMOTE_MS, () => {
        if (this.reducedMotion) {
          container.destroy();
          a.emote = undefined;
          a.emoteTimer = undefined;
          return;
        }
        this.tweens.add({
          targets: container,
          alpha: 0,
          duration: 250,
          ease: "Sine.easeIn",
          onComplete: () => {
            container.destroy();
            if (a.emote === container) a.emote = undefined;
            a.emoteTimer = undefined;
          },
        });
      });
    };

    if (this.reducedMotion) {
      // Instant show — no decorative bounce.
      settle();
      return;
    }
    container.setScale(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 320,
      ease: "Back.easeOut",
      onComplete: settle,
    });
  }

  // -------------------------------------------------------------------------
  // Camera: pan-to-player, zoom, reduced-motion, NPC visibility
  // -------------------------------------------------------------------------

  /** Smooth-pan the camera to an avatar, then resume following self. Never moves avatars. */
  apiPanToPlayer(sessionId: string): void {
    const a = this.avatars.get(sessionId);
    if (!a) return;
    const cam = this.cameras.main;

    // Stop following so the manual pan is not fought by the follow lerp.
    cam.stopFollow();
    this.panResumeTimer?.remove();

    const tx = a.sprite.x;
    const ty = a.sprite.y;
    if (this.reducedMotion) {
      cam.centerOn(tx, ty); // instant jump
    } else {
      cam.pan(tx, ty, PAN_MS, "Sine.easeInOut", true);
    }

    // Resume following the LOCAL avatar after a short dwell. A held movement
    // key cancels this early (see update()).
    this.panResumeTimer = this.time.delayedCall(PAN_RESUME_MS, () => {
      this.resumeFollowSelf();
    });
  }

  private resumeFollowSelf(): void {
    this.panResumeTimer?.remove();
    this.panResumeTimer = undefined;
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    this.cameras.main.startFollow(self.sprite, true, 0.15, 0.15);
  }

  /** Set the camera zoom (clamped) with a smooth tween (instant in reduced motion). */
  apiSetZoom(zoom: number): void {
    const z = Phaser.Math.Clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    const cam = this.cameras.main;
    if (this.reducedMotion) {
      cam.setZoom(z);
    } else {
      cam.zoomTo(z, ZOOM_TWEEN_MS, "Sine.easeInOut", true);
    }
  }

  /** Show/hide every NPC avatar; joining/leaving NPCs respect this flag. */
  apiSetNpcVisibility(visible: boolean): void {
    this.npcVisible = visible;
    for (const a of this.avatars.values()) {
      if (a.snap.isNpc) this.applyAvatarVisibility(a, visible);
    }
  }

  /** Toggle reduced motion: skip decorative tweens; pause/resume steam. */
  apiSetReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    for (const e of this.steamEmitters) {
      if (on) e.stop();
      else e.start();
    }
  }
}
