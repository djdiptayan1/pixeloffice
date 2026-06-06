// ---------------------------------------------------------------------------
// Top-center stacked toast notifications. Pure presentation: a caller pushes a
// message + kind, we slide it in, auto-dismiss after 6s, and cap the stack at 4.
// ---------------------------------------------------------------------------

import type { ToastPayload } from "@pixeloffice/shared";

const AUTO_DISMISS_MS = 6000;
const MAX_STACK = 4;

type ToastKind = ToastPayload["kind"];

const KIND_ACCENT: Record<ToastKind, string> = {
  info: "#2e6fd8",
  event: "#e8a13c",
  meeting: "#e5544b",
  broadcast: "#8e44ad",
};

const KIND_ICON: Record<ToastKind, string> = {
  info: "•",
  event: "☕",
  meeting: "📅",
  broadcast: "📣",
};

export class Toasts {
  private container: HTMLElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "toast-stack";
    parent.appendChild(this.container);
  }

  show(message: string, kind: ToastKind = "info"): void {
    // Enforce the stack cap by evicting the oldest before adding.
    while (this.container.children.length >= MAX_STACK) {
      this.container.firstElementChild?.remove();
    }

    const el = document.createElement("div");
    el.className = "toast";
    el.style.setProperty("--toast-accent", KIND_ACCENT[kind]);

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = KIND_ICON[kind];

    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;

    el.appendChild(icon);
    el.appendChild(text);
    this.container.appendChild(el);

    // Trigger slide-in on the next frame.
    requestAnimationFrame(() => el.classList.add("toast-in"));

    const dismiss = () => {
      el.classList.remove("toast-in");
      el.classList.add("toast-out");
      window.setTimeout(() => el.remove(), 250);
    };
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    el.addEventListener("click", () => {
      window.clearTimeout(timer);
      dismiss();
    });
  }
}
