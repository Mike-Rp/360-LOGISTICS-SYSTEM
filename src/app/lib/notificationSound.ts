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

/** A quiet, two-tone chime. Automatic calls skip blocked audio; a direct Test Sound click may resume it. */
export async function playNotificationSound(userInitiated = false): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    if (!audioContext || audioContext.state === 'closed') audioContext = new window.AudioContext();
    const context = audioContext;
    const isRunning = () => context.state === 'running';
    if (!isRunning()) {
      if (!userInitiated) {
        // A blocked notification is skipped. A later user gesture may unlock this
        // context, but the old notification must not play late.
        void context.resume().catch(() => {});
        return;
      }
      await context.resume();
      if (!isRunning()) return;
    }

    const start = context.currentTime + 0.02;
    for (const { frequency, offset, duration } of [
      { frequency: 660, offset: 0, duration: 0.15 },
      { frequency: 880, offset: 0.22, duration: 0.17 },
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
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
  } catch {
    // Unsupported or blocked audio must never interrupt notifications.
  }
}
