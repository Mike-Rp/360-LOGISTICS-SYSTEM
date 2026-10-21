const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'notificationSound.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
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
