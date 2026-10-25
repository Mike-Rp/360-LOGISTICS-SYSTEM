const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'notificationSound.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadSound() {
  const loaded = { exports: {} };
  new Function('module', 'exports', source)(loaded, loaded.exports);
  return loaded.exports;
}
const loaded = { exports: loadSound() };
const { newNotificationIds, notificationSoundEnabled, setNotificationSoundEnabled, playNotificationSound } = loaded.exports;

test('new IDs are detected even when the notification count stays the same', () => {
  const seen = new Set(['old-a', 'old-b']);
  assert.deepEqual([...newNotificationIds(seen, ['old-b', 'new-c'])], ['new-c']);
  assert.equal(newNotificationIds(seen, ['old-a', 'old-b']).size, 0);
  assert.equal(newNotificationIds(seen, ['new-c', 'new-d']).size, 2);
});

test('sound preference is scoped to each account on this browser', () => {
  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    assert.equal(notificationSoundEnabled('staff:opm@example.com'), true);
    setNotificationSoundEnabled('staff:opm@example.com', false);
    assert.equal(notificationSoundEnabled('staff:opm@example.com'), false);
    assert.equal(notificationSoundEnabled('staff:csr@example.com'), true);
    assert.equal(notificationSoundEnabled('driver:DR123'), true);
  } finally {
    delete global.localStorage;
  }
});

test('blocked Web Audio is silent; a direct test click schedules the two quiet tones', async () => {
  let allowed = false;
  const tones = [];
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 10;
    destination = {};
    resume() {
      if (!allowed) return Promise.reject(new Error('interaction required'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const tone = {
        frequency: { setValueAtTime: value => { tone.hz = value; } },
        connect() {}, disconnect() {}, start(time) { tone.startAt = time; },
        stop(time) { tone.stopAt = time; },
      };
      tones.push(tone);
      return tone;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() {} };
    }
  }
  global.window = { AudioContext: FakeAudioContext };
  try {
    await playNotificationSound();
    assert.equal(tones.length, 0);
    allowed = true;
    await playNotificationSound(true);
    assert.deepEqual(tones.map(tone => tone.hz), [660, 880]);
    assert.ok(tones[1].startAt > tones[0].stopAt);
    assert.ok(tones[1].stopAt - tones[0].startAt < 0.5);
  } finally {
    delete global.window;
  }
});

test('only trusted tap, click, and activation keys qualify for unlocking', () => {
  const { isAudioUnlockGesture } = loadSound();
  for (const type of ['pointerdown', 'touchend', 'click']) {
    assert.equal(isAudioUnlockGesture({ type, isTrusted: true }), true);
  }
  assert.equal(isAudioUnlockGesture({ type: 'keydown', key: 'Enter', isTrusted: true }), true);
  assert.equal(isAudioUnlockGesture({ type: 'keydown', key: ' ', isTrusted: true }), true);
  assert.equal(isAudioUnlockGesture({ type: 'keydown', key: 'Tab', isTrusted: true }), false);
  assert.equal(isAudioUnlockGesture({ type: 'click', isTrusted: false }), false);
});

test('automatic alerts do not create audio; a gesture synchronously resumes one context silently', async () => {
  const { unlockNotificationAudio, notificationAudioReady, playNotificationSound } = loadSound();
  let created = 0;
  let resumes = 0;
  let silentStarts = 0;
  let finishResume;
  const tones = [];
  class FakeAudioContext {
    constructor() { created++; }
    state = 'suspended'; currentTime = 1; sampleRate = 44100; destination = {};
    resume() {
      resumes++;
      return new Promise(resolve => { finishResume = () => { this.state = 'running'; resolve(); }; });
    }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() { silentStarts++; } }; }
    createOscillator() {
      const tone = { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} };
      tones.push(tone);
      return tone;
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  global.window = { AudioContext: FakeAudioContext };
  try {
    assert.equal(await playNotificationSound(), false);
    assert.equal(created, 0);
    const first = unlockNotificationAudio();
    const second = unlockNotificationAudio();
    assert.equal(first, second);
    assert.equal(created, 1);
    assert.equal(resumes, 1);
    assert.equal(silentStarts, 1);
    assert.equal(tones.length, 0);
    assert.equal(notificationAudioReady(), false);
    finishResume();
    assert.equal(await first, true);
    assert.equal(notificationAudioReady(), true);
    assert.equal(await playNotificationSound(), true);
    assert.equal(tones.length, 2);
  } finally { delete global.window; }
});

test('a blocked test reports failure and a later gesture retries without queuing an old chime', async () => {
  const { unlockNotificationAudio, notificationAudioReady, playNotificationSound } = loadSound();
  let permitted = false;
  let created = 0;
  let tones = 0;
  class FakeAudioContext {
    constructor() { created++; }
    state = 'suspended'; currentTime = 1; destination = {};
    resume() {
      if (!permitted) return Promise.reject(new Error('blocked'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() { tones++; return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  global.window = { AudioContext: FakeAudioContext };
  try {
    assert.equal(await playNotificationSound(true), false);
    assert.equal(notificationAudioReady(), false);
    assert.equal(await playNotificationSound(), false);
    permitted = true;
    assert.equal(await unlockNotificationAudio(), true);
    assert.equal(tones, 0);
    assert.equal(created, 1);
    assert.equal(await playNotificationSound(), true);
    assert.equal(tones, 2);
  } finally { delete global.window; }
});

test('foreground restoration plays no stale alert and hidden pages remain silent', async () => {
  const { unlockNotificationAudio, notificationAudioReady, playNotificationSound, restoreNotificationAudio } = loadSound();
  let context;
  let tones = 0;
  class FakeAudioContext {
    constructor() { context = this; }
    state = 'suspended'; currentTime = 1; destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() { tones++; return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  global.window = { AudioContext: FakeAudioContext };
  global.document = { visibilityState: 'visible' };
  try {
    assert.equal(await unlockNotificationAudio(), true);
    context.state = 'suspended';
    assert.equal(notificationAudioReady(), false);
    assert.equal(await playNotificationSound(), false);
    assert.equal(await restoreNotificationAudio(), true);
    assert.equal(tones, 0);
    document.visibilityState = 'hidden';
    assert.equal(await playNotificationSound(), false);
    assert.equal(tones, 0);
  } finally { delete global.window; delete global.document; }
});

test('WebKit AudioContext fallback unlocks without an audible initialization tone', async () => {
  const { unlockNotificationAudio, notificationAudioReady } = loadSound();
  let created = 0;
  let tones = 0;
  class FakeWebKitAudioContext {
    constructor() { created++; }
    state = 'suspended'; destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() { tones++; throw new Error('unlock must be silent'); }
  }
  global.window = { webkitAudioContext: FakeWebKitAudioContext };
  try {
    assert.equal(await unlockNotificationAudio(), true);
    assert.equal(notificationAudioReady(), true);
    assert.equal(created, 1);
    assert.equal(tones, 0);
  } finally { delete global.window; }
});
