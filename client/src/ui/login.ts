// ---------------------------------------------------------------------------
// Login card. A dev sign-in stand-in for OAuth (plan forbids username/password).
// Collects the JoinOptions profile (name, department, avatar) and hands it back
// via onSubmit. Persists the last choices in localStorage. No business logic.
// ---------------------------------------------------------------------------

import {
  AVATAR_IDS,
  DEPARTMENTS,
  type AvatarId,
  type Department,
  type JoinOptions,
} from "@pixeloffice/shared";

const STORAGE_KEY = "pixeloffice.login";

/** Palette colors for each avatar swatch (matches the in-game avatar tints). */
const AVATAR_COLORS: Record<AvatarId, string> = {
  ruby: "#c0392b",
  sapphire: "#2e6fd8",
  emerald: "#27ae60",
  amber: "#e67e22",
  violet: "#8e44ad",
  slate: "#7f8c8d",
};

interface SavedProfile {
  name: string;
  department: Department;
  avatarId: AvatarId;
}

function loadSaved(): Partial<SavedProfile> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SavedProfile>) : {};
  } catch {
    return {};
  }
}

function save(profile: SavedProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage may be unavailable; profile persistence is best-effort */
  }
}

export interface LoginHandle {
  /** Hide the login card (after a successful join). */
  hide(): void;
  /** Show the card again (e.g. after a disconnect). */
  show(): void;
  /** Display an error and re-enable the form for a retry. */
  showError(message: string): void;
}

export interface LoginOptions {
  parent: HTMLElement;
  onSubmit(opts: JoinOptions): void;
}

export function createLogin(opts: LoginOptions): LoginHandle {
  const saved = loadSaved();
  let selectedAvatar: AvatarId =
    saved.avatarId && AVATAR_IDS.includes(saved.avatarId) ? saved.avatarId : AVATAR_IDS[0];

  const root = opts.parent;
  root.innerHTML = "";

  const card = document.createElement("div");
  card.className = "login-card";

  const title = document.createElement("h1");
  title.className = "login-title";
  title.textContent = "PixelOffice";

  const subtitle = document.createElement("p");
  subtitle.className = "login-subtitle";
  subtitle.textContent = "Step into the office";

  // Name field
  const nameLabel = document.createElement("label");
  nameLabel.className = "login-label";
  nameLabel.textContent = "Display name";
  const nameInput = document.createElement("input");
  nameInput.className = "login-input";
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.placeholder = "e.g. Aryan";
  nameInput.value = saved.name ?? "";
  nameLabel.appendChild(nameInput);

  // Department select
  const deptLabel = document.createElement("label");
  deptLabel.className = "login-label";
  deptLabel.textContent = "Department";
  const deptSelect = document.createElement("select");
  deptSelect.className = "login-select";
  for (const d of DEPARTMENTS) {
    const o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    deptSelect.appendChild(o);
  }
  if (saved.department && DEPARTMENTS.includes(saved.department)) {
    deptSelect.value = saved.department;
  }
  deptLabel.appendChild(deptSelect);

  // Avatar swatch picker
  const avatarLabel = document.createElement("span");
  avatarLabel.className = "login-label";
  avatarLabel.textContent = "Avatar";
  const swatches = document.createElement("div");
  swatches.className = "login-swatches";

  const swatchEls = new Map<AvatarId, HTMLButtonElement>();
  const syncSwatches = () => {
    for (const [id, el] of swatchEls) {
      el.classList.toggle("selected", id === selectedAvatar);
      el.setAttribute("aria-pressed", id === selectedAvatar ? "true" : "false");
    }
  };
  for (const id of AVATAR_IDS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "login-swatch";
    sw.style.background = AVATAR_COLORS[id];
    sw.title = id;
    sw.setAttribute("aria-label", id);
    sw.addEventListener("click", () => {
      selectedAvatar = id;
      syncSwatches();
    });
    swatchEls.set(id, sw);
    swatches.appendChild(sw);
  }
  syncSwatches();

  // Error line
  const errorLine = document.createElement("div");
  errorLine.className = "login-error";
  errorLine.hidden = true;

  // Submit button
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "login-submit";
  submit.textContent = "Enter Office";

  const footer = document.createElement("p");
  footer.className = "login-footer";
  footer.textContent = "Dev sign-in — Google/Microsoft OAuth in production";

  const form = document.createElement("form");
  form.className = "login-form";
  form.append(
    nameLabel,
    deptLabel,
    avatarLabel,
    swatches,
    errorLine,
    submit,
  );

  const setBusy = (busy: boolean) => {
    submit.disabled = busy;
    submit.textContent = busy ? "Connecting…" : "Enter Office";
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      errorLine.hidden = false;
      errorLine.textContent = "Please enter a display name.";
      nameInput.focus();
      return;
    }
    const department = deptSelect.value as Department;
    const profile: JoinOptions = { name, department, avatarId: selectedAvatar };
    save(profile);
    errorLine.hidden = true;
    setBusy(true);
    opts.onSubmit(profile);
  });

  card.append(title, subtitle, form, footer);
  root.appendChild(card);
  nameInput.focus();

  return {
    hide() {
      root.style.display = "none";
    },
    show() {
      root.style.display = "";
      setBusy(false);
    },
    showError(message: string) {
      errorLine.hidden = false;
      errorLine.textContent = message;
      setBusy(false);
    },
  };
}
