// ---------------------------------------------------------------------------
// Runtime texture + animation generation. NO external asset files.
// Everything is drawn into Phaser CanvasTextures via the 2D context, then
// registered in the texture manager. Drawing is data-driven (palette tables
// in constants.ts) so the six avatars share a single draw routine.
//
// Pure presentation: this module knows nothing about presence/meetings/etc.
// ---------------------------------------------------------------------------

import Phaser from "phaser";
import type { AreaType, Department, FurnitureKind } from "@pixeloffice/shared";
import { AVATAR_IDS, type AvatarId } from "@pixeloffice/shared";
import {
  AVATAR_PALETTES,
  COFFEE_FLOOR,
  DEPARTMENT_FLOOR,
  type FloorStyle,
  HALLWAY_FLOOR,
  LOUNGE_FLOOR,
  MEETING_FLOOR,
  RECEPTION_FLOOR,
  TILE,
  WALL_FRONT,
  WALL_FRONT_DARK,
  WALL_OUTLINE,
  WALL_TOP,
} from "./constants";

// ---------------------------------------------------------------------------
// Texture key helpers (stable, referenced by the scene).
// ---------------------------------------------------------------------------

export const TEX = {
  hallwayFloor: "floor:hallway",
  receptionFloor: "floor:reception",
  meetingFloor: "floor:meeting",
  coffeeFloor: "floor:coffee",
  loungeFloor: "floor:lounge",
  departmentFloor: (d: Department) => `floor:dept:${d}`,
  wall: "tile:wall",
  furniture: (kind: FurnitureKind) => `furn:${kind}`,
  avatarSheet: (id: AvatarId) => `avatar:${id}`,
} as const;

/** Resolve the floor texture key for an area. */
export function floorTextureForArea(type: AreaType, department?: Department): string {
  switch (type) {
    case "RECEPTION":
      return TEX.receptionFloor;
    case "MEETING_ROOM":
      return TEX.meetingFloor;
    case "COFFEE":
      return TEX.coffeeFloor;
    case "LOUNGE":
      return TEX.loungeFloor;
    case "DEPARTMENT":
      return department ? TEX.departmentFloor(department) : TEX.hallwayFloor;
    default:
      return TEX.hallwayFloor;
  }
}

// ---------------------------------------------------------------------------
// Low-level canvas helpers.
// ---------------------------------------------------------------------------

function makeCanvas(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
): { tex: Phaser.Textures.CanvasTexture; ctx: CanvasRenderingContext2D } {
  // Re-creating with the same key (e.g. hot reload) would throw; guard it.
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h) as Phaser.Textures.CanvasTexture;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  return { tex, ctx };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Deterministic pseudo-random so the floor grain is stable across redraws. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Floors: 2-tone checker with subtle grain flecks so they don't look flat.
// ---------------------------------------------------------------------------

function drawFloor(scene: Phaser.Scene, key: string, style: FloorStyle, seed: number): void {
  const { tex, ctx } = makeCanvas(scene, key, TILE, TILE);
  // Base fill.
  px(ctx, 0, 0, TILE, TILE, style.light);
  // 4x4 checker grid for a tiled carpet feel.
  const cell = TILE / 4;
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      if ((cx + cy) % 2 === 0) {
        px(ctx, cx * cell, cy * cell, cell, cell, style.dark);
      }
    }
  }
  // Grain flecks: a sprinkle of lighter pixels, deterministic per tile.
  for (let y = 0; y < TILE; y += 2) {
    for (let x = 0; x < TILE; x += 2) {
      if (hash(x, y, seed) % 11 === 0) {
        px(ctx, x, y, 1, 1, style.fleck);
      }
    }
  }
  // Faint inner border to imply a seam between tiles.
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  tex.refresh();
}

// ---------------------------------------------------------------------------
// Wall tile: Pokémon-style block with a lit top face and a shaded front face.
// ---------------------------------------------------------------------------

function drawWall(scene: Phaser.Scene): void {
  const { tex, ctx } = makeCanvas(scene, TEX.wall, TILE, TILE);
  const topH = Math.floor(TILE * 0.28);
  // Front face (lower, darker).
  px(ctx, 0, 0, TILE, TILE, WALL_FRONT);
  // Vertical brick shading on the front face.
  for (let y = topH; y < TILE; y += 8) {
    px(ctx, 0, y, TILE, 1, WALL_FRONT_DARK);
  }
  for (let x = 0; x < TILE; x += 16) {
    px(ctx, x, topH, 1, TILE - topH, WALL_FRONT_DARK);
  }
  for (let x = 8; x < TILE; x += 16) {
    px(ctx, x, topH + 8, 1, 8, WALL_FRONT_DARK);
  }
  // Top highlight face.
  px(ctx, 0, 0, TILE, topH, WALL_TOP);
  px(ctx, 0, topH - 1, TILE, 1, "#9aa6b5"); // bright lip
  // Outline for crisp tile separation.
  ctx.strokeStyle = WALL_OUTLINE;
  ctx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  tex.refresh();
}

// ---------------------------------------------------------------------------
// Furniture textures. Each kind draws into a w*TILE x h*TILE canvas.
// ---------------------------------------------------------------------------

function transparent(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
}

function outlineRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline = "#20242c",
): void {
  px(ctx, x, y, w, h, outline);
  px(ctx, x + 1, y + 1, w - 2, h - 2, fill);
}

interface FurnSpec {
  w: number; // tiles
  h: number; // tiles
  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void;
}

const FURNITURE_SPECS: Record<FurnitureKind, FurnSpec> = {
  desk: {
    w: 2,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      // Wooden desk top.
      outlineRect(ctx, 1, 6, W - 2, H - 10, "#9c6b3f");
      px(ctx, 2, 7, W - 4, 2, "#b98a55"); // top sheen
      // Monitor.
      const mx = Math.floor(W / 2) - 10;
      outlineRect(ctx, mx, 2, 20, 14, "#2a2e36"); // bezel
      px(ctx, mx + 2, 4, 16, 9, "#5fd0e8"); // screen glow
      px(ctx, mx + 3, 5, 7, 3, "#9fe6f5"); // reflection
      outlineRect(ctx, mx + 8, 16, 4, 3, "#3a3f48"); // stand
      // Keyboard hint.
      px(ctx, mx - 2, H - 5, 24, 3, "#3a3f48");
    },
  },
  chair: {
    w: 1,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      const cx = Math.floor(W / 2);
      outlineRect(ctx, cx - 7, 4, 14, 7, "#3a4252"); // backrest
      outlineRect(ctx, cx - 8, 12, 16, 6, "#4a5468"); // seat
      px(ctx, cx - 1, 18, 2, 7, "#2a2e36"); // post
      px(ctx, cx - 6, H - 4, 12, 2, "#22262e"); // base
    },
  },
  table: {
    w: 3,
    h: 2,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      // Meeting table: rounded wood slab with legs.
      outlineRect(ctx, 4, 8, W - 8, H - 18, "#7d5536");
      px(ctx, 6, 10, W - 12, 3, "#9c6b45"); // sheen
      // Legs.
      px(ctx, 8, H - 12, 4, 8, "#5a3d26");
      px(ctx, W - 12, H - 12, 4, 8, "#5a3d26");
      // A couple of paper/cup details on top.
      px(ctx, 12, 14, 8, 5, "#e8e2d4");
      px(ctx, W - 22, 16, 5, 5, "#d8d0c0");
    },
  },
  sofa: {
    w: 3,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      outlineRect(ctx, 1, 4, W - 2, H - 6, "#5a6e8c"); // body
      // Backrest.
      px(ctx, 3, 5, W - 6, 5, "#6c82a4");
      // Cushions.
      const seats = Math.max(1, Math.floor((W - 6) / 18));
      for (let i = 0; i < seats; i++) {
        const sx = 4 + i * Math.floor((W - 8) / seats);
        outlineRect(ctx, sx, 11, Math.floor((W - 8) / seats) - 2, H - 16, "#7990b2");
      }
      // Armrests.
      px(ctx, 1, 6, 3, H - 9, "#48597040");
    },
  },
  plant: {
    w: 1,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      const cx = Math.floor(W / 2);
      // Pot.
      outlineRect(ctx, cx - 6, H - 11, 12, 9, "#9a5b3a");
      px(ctx, cx - 5, H - 10, 10, 2, "#b87248"); // rim
      // Foliage.
      ctx.fillStyle = "#2f8a47";
      ctx.beginPath();
      ctx.arc(cx, H - 16, 9, 0, Math.PI * 2);
      ctx.fill();
      px(ctx, cx - 6, H - 22, 4, 4, "#3fa258");
      px(ctx, cx + 2, H - 20, 4, 4, "#3fa258");
      px(ctx, cx - 2, H - 26, 4, 4, "#46b562");
      // Outline-ish dark base of leaves.
      px(ctx, cx - 9, H - 14, 18, 1, "#1f5e30");
    },
  },
  counter: {
    w: 11,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      outlineRect(ctx, 0, 6, W, H - 8, "#6b4a30"); // cabinet
      px(ctx, 0, 4, W, 4, "#c9c2b2"); // light countertop
      px(ctx, 0, 4, W, 1, "#e2dccb"); // counter sheen
      // Cabinet door seams.
      for (let x = 16; x < W; x += 16) {
        px(ctx, x, 9, 1, H - 13, "#4d3420");
      }
    },
  },
  "coffee-machine": {
    w: 1,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      outlineRect(ctx, 6, 1, W - 12, H - 8, "#2c2f36"); // body sits on the counter
      px(ctx, 9, 4, W - 18, 5, "#4a4f59"); // panel
      px(ctx, 10, 5, 3, 2, "#e5544b"); // power light
      px(ctx, 14, 5, 3, 2, "#3ecf6e");
      px(ctx, Math.floor(W / 2) - 2, H - 11, 4, 3, "#1a1c20"); // spout
      // A little steam.
      px(ctx, Math.floor(W / 2) - 1, 0, 1, 2, "#ffffff80");
    },
  },
  "reception-desk": {
    w: 4,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      outlineRect(ctx, 1, 5, W - 2, H - 7, "#8a5a34"); // desk body
      px(ctx, 1, 3, W - 2, 4, "#d8cba6"); // top
      px(ctx, 1, 3, W - 2, 1, "#ece2c4"); // sheen
      // Front panel logo band.
      px(ctx, 6, 12, W - 12, 4, "#a86f40");
      // Small monitor on the counter.
      outlineRect(ctx, W - 26, 1, 16, 7, "#2a2e36");
      px(ctx, W - 24, 2, 12, 4, "#5fd0e8");
    },
  },
  rug: {
    w: 4,
    h: 3,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      // Soft round lounge rug.
      ctx.fillStyle = "#7a5f96";
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W / 2 - 2, H / 2 - 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#9c83b8";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W / 2 - 7, H / 2 - 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#5f4878";
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W / 2 - 13, H / 2 - 12, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  "door-mat": {
    w: 2,
    h: 1,
    draw(ctx, W, H) {
      transparent(ctx, W, H);
      outlineRect(ctx, 2, 4, W - 4, H - 8, "#3a4a3a", "#243024"); // mat
      // Welcome stripes.
      for (let y = 7; y < H - 5; y += 4) {
        px(ctx, 4, y, W - 8, 1, "#52684f");
      }
    },
  },
};

function drawFurniture(scene: Phaser.Scene, kind: FurnitureKind): void {
  const spec = FURNITURE_SPECS[kind];
  const W = spec.w * TILE;
  const H = spec.h * TILE;
  const { tex, ctx } = makeCanvas(scene, TEX.furniture(kind), W, H);
  spec.draw(ctx, W, H);
  tex.refresh();
}

// ---------------------------------------------------------------------------
// Avatar spritesheets. One data-driven routine renders all six palettes.
// 12 frames: 4 directions (down, left, right, up) x 3 poses (idle, stepL, stepR).
// 32x32 frames, GBA-ish proportions: head ~40% height, 2px outline.
// ---------------------------------------------------------------------------

const FRAME = TILE; // 32
const DIRS_ORDER = ["down", "left", "right", "up"] as const;
type SheetDir = (typeof DIRS_ORDER)[number];
const POSES = ["idle", "stepL", "stepR"] as const;
type Pose = (typeof POSES)[number];

/** Frame index in the 12-frame sheet for a (dir, pose) pair. */
export function frameIndex(dir: SheetDir, pose: Pose): number {
  return DIRS_ORDER.indexOf(dir) * 3 + POSES.indexOf(pose);
}

function drawAvatarFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  pal: typeof AVATAR_PALETTES[AvatarId],
  dir: SheetDir,
  pose: Pose,
): void {
  // Local pixel helper offset into this frame.
  const p = (x: number, y: number, w: number, h: number, c: string) => px(ctx, ox + x, oy + y, w, h, c);

  // Leg bob for stepping poses: shift one foot down/up.
  const legL = pose === "stepL" ? 1 : 0;
  const legR = pose === "stepR" ? 1 : 0;
  // Idle has a tiny breathing offset on the body.
  const bodyY = pose === "idle" ? 0 : 0;

  const OUT = pal.outline;

  // --- Shadow ---
  px(ctx, ox + 9, oy + 29, 14, 2, "rgba(0,0,0,0.25)");

  // --- Legs / shoes (behind body) ---
  // Pants block.
  p(11, 22 + bodyY, 10, 5, pal.pants);
  // Left/right leg split with outline gap.
  p(15, 22 + bodyY, 2, 5, OUT);
  // Shoes.
  p(11, 27 - legL, 4, 2 + legL, pal.shoes);
  p(17, 27 - legR, 4, 2 + legR, pal.shoes);

  // --- Body / shirt ---
  // Outline silhouette of torso.
  p(9, 14 + bodyY, 14, 9, OUT);
  p(10, 15 + bodyY, 12, 7, pal.shirt);
  // Shading on the lower torso.
  p(10, 20 + bodyY, 12, 2, pal.shirtDark);

  // Arms depend on facing.
  if (dir === "down" || dir === "up") {
    p(8, 15 + bodyY, 3, 6, OUT);
    p(21, 15 + bodyY, 3, 6, OUT);
    p(9, 16 + bodyY, 1, 4, pal.shirtDark);
    p(22, 16 + bodyY, 1, 4, pal.shirtDark);
    // Hands.
    p(8, 20 + bodyY, 2, 2, pal.skin);
    p(22, 20 + bodyY, 2, 2, pal.skin);
  } else if (dir === "left") {
    p(9, 15 + bodyY, 3, 6, OUT);
    p(10, 16 + bodyY, 1, 4, pal.shirtDark);
    p(9, 20 + bodyY, 2, 2, pal.skin);
  } else {
    p(20, 15 + bodyY, 3, 6, OUT);
    p(21, 16 + bodyY, 1, 4, pal.shirtDark);
    p(21, 20 + bodyY, 2, 2, pal.skin);
  }

  // --- Head (big, ~13px tall ≈ 40% of 32) ---
  // Outline.
  p(8, 2, 16, 14, OUT);
  // Skin face.
  p(9, 3, 14, 12, pal.skin);

  // Hair + face features by direction.
  if (dir === "down") {
    // Hair cap.
    p(9, 3, 14, 5, pal.hair);
    p(9, 7, 2, 2, pal.hair);
    p(21, 7, 2, 2, pal.hair);
    // Eyes.
    p(12, 9, 2, 3, OUT);
    p(18, 9, 2, 3, OUT);
    // Mouth hint.
    p(15, 13, 2, 1, "#8a5a44");
  } else if (dir === "up") {
    // Back of head: mostly hair.
    p(9, 3, 14, 9, pal.hair);
    p(9, 11, 14, 2, pal.hair);
  } else if (dir === "left") {
    p(9, 3, 14, 5, pal.hair);
    p(9, 7, 2, 3, pal.hair); // sideburn
    // One visible eye.
    p(11, 9, 2, 3, OUT);
    // Nose hint at the facing edge.
    p(9, 11, 1, 2, "#c98f66");
  } else {
    // right
    p(9, 3, 14, 5, pal.hair);
    p(21, 7, 2, 3, pal.hair);
    p(19, 9, 2, 3, OUT);
    p(22, 11, 1, 2, "#c98f66");
  }
}

function drawAvatarSheet(scene: Phaser.Scene, id: AvatarId): void {
  const pal = AVATAR_PALETTES[id];
  const cols = 3;
  const rows = 4;
  const { tex, ctx } = makeCanvas(scene, TEX.avatarSheet(id), cols * FRAME, rows * FRAME);
  for (let r = 0; r < rows; r++) {
    const dir = DIRS_ORDER[r];
    for (let c = 0; c < cols; c++) {
      const pose = POSES[c];
      drawAvatarFrame(ctx, c * FRAME, r * FRAME, pal, dir, pose);
    }
  }
  tex.refresh();
  // Register frame grid so the texture is usable as a spritesheet.
  const phaserTex = scene.textures.get(TEX.avatarSheet(id));
  // Phaser.Textures.Parsers requires manual frame add for canvas textures.
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      phaserTex.add(i, 0, c * FRAME, r * FRAME, FRAME, FRAME);
      i++;
    }
  }
}

// ---------------------------------------------------------------------------
// Animations: walk + idle per avatar + direction. Keys are stable.
// ---------------------------------------------------------------------------

export function animKey(id: AvatarId, dir: SheetDir, kind: "walk" | "idle"): string {
  return `${id}:${kind}:${dir}`;
}

function registerAnimations(scene: Phaser.Scene, id: AvatarId): void {
  const sheet = TEX.avatarSheet(id);
  for (const dir of DIRS_ORDER) {
    const idle = frameIndex(dir, "idle");
    const stepL = frameIndex(dir, "stepL");
    const stepR = frameIndex(dir, "stepR");

    if (!scene.anims.exists(animKey(id, dir, "walk"))) {
      scene.anims.create({
        key: animKey(id, dir, "walk"),
        frames: [
          { key: sheet, frame: stepL },
          { key: sheet, frame: idle },
          { key: sheet, frame: stepR },
          { key: sheet, frame: idle },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!scene.anims.exists(animKey(id, dir, "idle"))) {
      scene.anims.create({
        key: animKey(id, dir, "idle"),
        frames: [{ key: sheet, frame: idle }],
        frameRate: 1,
        repeat: -1,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint: build every texture + animation once at scene preload.
// ---------------------------------------------------------------------------

export function buildAllTextures(scene: Phaser.Scene): void {
  // Floors.
  drawFloor(scene, TEX.hallwayFloor, HALLWAY_FLOOR, 1);
  drawFloor(scene, TEX.receptionFloor, RECEPTION_FLOOR, 2);
  drawFloor(scene, TEX.meetingFloor, MEETING_FLOOR, 3);
  drawFloor(scene, TEX.coffeeFloor, COFFEE_FLOOR, 4);
  drawFloor(scene, TEX.loungeFloor, LOUNGE_FLOOR, 5);
  let deptSeed = 6;
  for (const dept of Object.keys(DEPARTMENT_FLOOR) as Department[]) {
    drawFloor(scene, TEX.departmentFloor(dept), DEPARTMENT_FLOOR[dept], deptSeed++);
  }

  // Walls.
  drawWall(scene);

  // Furniture.
  for (const kind of Object.keys(FURNITURE_SPECS) as FurnitureKind[]) {
    drawFurniture(scene, kind);
  }

  // Avatars + animations.
  for (const id of AVATAR_IDS) {
    drawAvatarSheet(scene, id);
    registerAnimations(scene, id);
  }
}

export type { SheetDir };
