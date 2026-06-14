"use client";

/**
 * Browser-side notification helpers for new chat activity — a generated
 * ding (no audio file) plus optional desktop notifications. All guarded
 * so they no-op on the server or when APIs/permission are unavailable.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

// One shared AudioContext. Browsers start it "suspended" until a user
// gesture, so a ding fired from a realtime callback is silent unless we
// resume it. installAudioUnlock() resumes it on the first interaction.
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    return null;
  }
  return audioCtx;
}

/** Resume the audio context on the first user gesture (autoplay policy). */
export function installAudioUnlock() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Short notification tone via the Web Audio API. */
export function playDing() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch {
    // Ignore — audio not permitted yet.
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
