// ---------------------------------------------------------------------------
// Pure presentation constants for the Phaser rendering layer.
// Palettes, timing, depth bands. NO business logic lives here — these are
// look-up tables consumed by the texture generator and the scene.
// ---------------------------------------------------------------------------

import type { AvatarId, Department } from "@pixeloffice/shared";
import { TILE } from "@pixeloffice/shared";

export { TILE };

// --- Timing -----------------------------------------------------------------

/** Milliseconds to walk a single tile (Pokémon Emerald grid step feel). */
export const STEP_MS = 150;
/** Camera zoom level. */
export const CAMERA_ZOOM = 1.4;
/** How long a chat bubble stays on screen. */
export const BUBBLE_MS = 4000;
/** Max characters shown in a chat bubble. */
export const BUBBLE_MAX_CHARS = 60;

// --- Depth bands ------------------------------------------------------------
// Floors at the bottom, then walls, then y-sorted entities, then UI on top.

export const DEPTH_FLOOR = 0;
export const DEPTH_RUG = 1;
export const DEPTH_AREA_LABEL = 2;
export const DEPTH_WALL = 5;
/** y-sorted entities (furniture + characters) get setDepth(pixelY + this). */
export const DEPTH_ENTITY_BASE = 10;
/** Bubbles / badges that should float above everything in the world. */
export const DEPTH_OVERLAY = 100000;

// --- Background -------------------------------------------------------------

export const BG_COLOR = "#0e1116";
export const BG_COLOR_NUM = 0x0e1116;

// --- Avatar palettes --------------------------------------------------------
// GBA-style 4-tone-ish palette per avatar id. Drawing code is data-driven:
// one routine reads this table, never six copies.

export interface AvatarPalette {
  /** Main shirt / hair accent colour. */
  shirt: string;
  /** Darker shade of the shirt for shading. */
  shirtDark: string;
  /** Hair colour. */
  hair: string;
  /** Trousers colour. */
  pants: string;
  /** Shoe colour. */
  shoes: string;
  /** Skin tone. */
  skin: string;
  /** Outline colour (near-black). */
  outline: string;
}

const SKIN = "#e8b58c";
const SKIN_ALT = "#d49a6a";
const OUTLINE = "#1a1a22";

export const AVATAR_PALETTES: Record<AvatarId, AvatarPalette> = {
  ruby: {
    shirt: "#d8324b",
    shirtDark: "#9c1f33",
    hair: "#3a2a26",
    pants: "#36405a",
    shoes: "#22262e",
    skin: SKIN,
    outline: OUTLINE,
  },
  sapphire: {
    shirt: "#2f6fd0",
    shirtDark: "#1e4a93",
    hair: "#231f2e",
    pants: "#2b3346",
    shoes: "#22262e",
    skin: SKIN,
    outline: OUTLINE,
  },
  emerald: {
    shirt: "#2faa5e",
    shirtDark: "#1c7741",
    hair: "#2c2420",
    pants: "#384055",
    shoes: "#22262e",
    skin: SKIN_ALT,
    outline: OUTLINE,
  },
  amber: {
    shirt: "#e08a2a",
    shirtDark: "#a85f17",
    hair: "#4a3220",
    pants: "#3a3548",
    shoes: "#22262e",
    skin: SKIN,
    outline: OUTLINE,
  },
  violet: {
    shirt: "#8a52d8",
    shirtDark: "#5f339c",
    hair: "#2a2230",
    pants: "#33304a",
    shoes: "#22262e",
    skin: SKIN_ALT,
    outline: OUTLINE,
  },
  slate: {
    shirt: "#73808f",
    shirtDark: "#4d5764",
    hair: "#2a2e34",
    pants: "#363b44",
    shoes: "#22262e",
    skin: SKIN,
    outline: OUTLINE,
  },
};

// --- Floor / department palettes -------------------------------------------
// Each area type maps to a base floor + a carpet tint per department.

export interface FloorStyle {
  /** Lighter checker tone. */
  light: string;
  /** Darker checker tone. */
  dark: string;
  /** Subtle grain fleck colour. */
  fleck: string;
}

export const HALLWAY_FLOOR: FloorStyle = {
  light: "#c9c2b2",
  dark: "#bdb6a6",
  fleck: "#d3ccbc",
};

export const RECEPTION_FLOOR: FloorStyle = {
  light: "#d8cba6",
  dark: "#cbbd95",
  fleck: "#e2d6b4",
};

export const MEETING_FLOOR: FloorStyle = {
  light: "#b9c2cf",
  dark: "#aab4c3",
  fleck: "#c6cedb",
};

export const COFFEE_FLOOR: FloorStyle = {
  light: "#c8a98a",
  dark: "#b9987a",
  fleck: "#d6baa0",
};

export const LOUNGE_FLOOR: FloorStyle = {
  light: "#b8a7c4",
  dark: "#a896b6",
  fleck: "#c7b8d2",
};

/** Department carpet tints (used for DEPARTMENT areas). */
export const DEPARTMENT_FLOOR: Record<Department, FloorStyle> = {
  Engineering: { light: "#9fb6c9", dark: "#8fa8bd", fleck: "#b0c4d4" },
  Product: { light: "#c2a9b8", dark: "#b298a8", fleck: "#d0bac8" },
  Design: { light: "#aecaa6", dark: "#9cba94", fleck: "#bdd6b6" },
  HR: { light: "#cabf9c", dark: "#bbb08c", fleck: "#d6ccae" },
};

// --- Wall palette -----------------------------------------------------------

export const WALL_TOP = "#7f8a99"; // top highlight face
export const WALL_FRONT = "#565f6c"; // front shaded face
export const WALL_FRONT_DARK = "#434b56";
export const WALL_OUTLINE = "#2e333b";
