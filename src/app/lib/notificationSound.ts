const preferenceKey = (account: string) => `360logistics.notificationSound.${encodeURIComponent(account.toLowerCase())}`;

/** A browser-only preference, scoped to the signed-in account on this device. */
export function notificationSoundEnabled(account: string): boolean {
  try { return localStorage.getItem(preferenceKey(account)) !== 'false'; }
  catch { return true; }
}

export function setNotificationSoundEnabled(account: string, enabled: boolean): void {
  try { localStorage.setItem(preferenceKey(account), String(enabled)); }
  catch { /* The current session can still use the toggle if storage is unavailable. */ }
}

export function newNotificationIds(seen: ReadonlySet<string>, current: Iterable<string>): Set<string> {
  return new Set([...current].filter((id) => id && !seen.has(id)));
}

let audioContext: AudioContext | null = null;
let gestureUnlock: Promise<boolean> | null = null;
const UNLOCK_TIMEOUT_MS = 1600;

export type NotificationSoundResult = 'started' | 'blocked' | 'unsupported' | 'failed';

function audioApiAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  } catch { return false; }
}

function getAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContextConstructor();
      gestureUnlock = null;
    }
    return audioContext;
  } catch { return null; }
}

/** Read the browser's actual state; it may change when a phone locks or a tab is backgrounded. */
export function notificationAudioReady(): boolean {
  return audioContext?.state === 'running';
}

export function isAudioUnlockGesture(event: Pick<Event, 'type' | 'isTrusted'> & { key?: string }): boolean {
  if (!event.isTrusted) return false;
  if (event.type === 'keydown') return event.key === 'Enter' || event.key === ' ';
  return event.type === 'pointerdown' || event.type === 'touchend' || event.type === 'click';
}

/** Start a silent one-sample source inside the gesture for WebKit's audio activation path. */
function startSilentSource(context: AudioContext): void {
  try {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.onended = () => source.disconnect();
    source.start(0);
  } catch { /* resume() remains the supported fallback. */ }
}

/** Safari may leave resume() pending while interrupted; always release the retry slot. */
function waitForRunning(context: AudioContext, resumed: Promise<void>): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      context.removeEventListener?.('statechange', check);
      resolve(ready);
    };
    const check = () => {
      if (context.state === 'running') finish(true);
      else if (context.state === 'closed') finish(false);
    };
    context.addEventListener?.('statechange', check);
    timer = setTimeout(() => finish(context.state === 'running'), UNLOCK_TIMEOUT_MS);
    Promise.resolve(resumed).then(check, () => finish(false));
    check();
  });
}

/** Call directly from a trusted tap, click, or key action, before awaiting other work. */
export function unlockNotificationAudio(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return Promise.resolve(false);
  if (context.state === 'running') return Promise.resolve(true);
  if (gestureUnlock) return gestureUnlock;
  try {
    // Both calls begin synchronously while the browser still has user activation.
    const resumed = context.resume();
    startSilentSource(context);
    const pending = waitForRunning(context, resumed)
      .finally(() => { if (gestureUnlock === pending) gestureUnlock = null; });
    gestureUnlock = pending;
    return pending;
  } catch { return Promise.resolve(false); }
}

/** A foreground return may resume an already unlocked context without playing old alerts. */
export async function restoreNotificationAudio(): Promise<boolean> {
  if (!audioContext || audioContext.state === 'closed') return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  if (notificationAudioReady()) return true;
  try {
    return await waitForRunning(audioContext, audioContext.resume());
  } catch { return false; }
}

/** Schedule both tones synchronously so a direct mobile tap can activate Web Audio. */
function scheduleChime(context: AudioContext): { cancel: () => void } | null {
  const nodes: Array<{ oscillator: OscillatorNode; gain: GainNode }> = [];
  const cancel = () => {
    for (const { oscillator, gain } of nodes) {
      oscillator.onended = null;
      oscillator.disconnect();
      gain.disconnect();
    }
  };
  try {
    const start = context.currentTime + 0.02;
    for (const { frequency, offset, duration } of [
      { frequency: 660, offset: 0, duration: 0.15 },
      { frequency: 880, offset: 0.22, duration: 0.17 },
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      nodes.push({ oscillator, gain });
      const toneStart = start + offset;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0, toneStart);
      gain.gain.linearRampToValueAtTime(0.19, toneStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(toneStart);
      oscillator.stop(toneStart + duration);
    }
    return { cancel };
  } catch {
    cancel();
    return null;
  }
}

/** "started" means scheduled in a running context, not that a speaker was audible. */
export async function playNotificationSound(userInitiated = false): Promise<NotificationSoundResult> {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'blocked';
  if (userInitiated) {
    if (!audioApiAvailable()) return 'unsupported';
    const context = getAudioContext();
    if (!context) return 'failed';
    // Start resume and the tones before the first await, inside the trusted click.
    const unlocked = unlockNotificationAudio();
    const chime = scheduleChime(context);
    if (!chime) return 'failed';
    if (!await unlocked || context.state !== 'running') {
      chime.cancel();
      return 'blocked';
    }
    return 'started';
  }
  const context = audioContext;
  if (!context || context.state !== 'running') return 'blocked';
  return scheduleChime(context) ? 'started' : 'failed';
}
