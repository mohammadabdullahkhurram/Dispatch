"use client";

/**
 * Browser-side notification helpers for new chat sessions — a generated
 * ding (no audio file) plus optional desktop notifications. All guarded
 * so they no-op on the server or when APIs/permission are unavailable.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Short two-tone "ding" via the Web Audio API. */
export function playDing() {
  if (typeof window === "undefined") return;
  try {
    const Ctor =
      window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.setValueAtTime(1318.5, now + 0.1); // E6
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.start(now);
    osc.stop(now + 0.45);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // Audio can throw before a user gesture — ignore.
  }
}

/** Ask once for desktop-notification permission (no-op if already set). */
export function requestNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined")
    return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** Show a desktop notification if the user has granted permission. */
export function notifyBrowser(title: string, body: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined")
    return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Some browsers require a ServiceWorker for notifications — ignore.
  }
}
