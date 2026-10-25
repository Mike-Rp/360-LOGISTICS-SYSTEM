const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = ts.transpileModule(readFileSync(join(__dirname, 'TestSoundButton.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const TestSoundButton = loaded.exports.default;
const labels = { idle: 'Test Sound', playing: 'Playing…', started: 'Playback started', retry: 'Sound unavailable — Try again' };
const render = (state) => renderToStaticMarkup(React.createElement(TestSoundButton, { state, labels, onTest() {} }));

test('Test Sound exposes busy and playback feedback without a false success label', () => {
  const idle = render('idle');
  assert.match(idle, /Test Sound/);
  assert.doesNotMatch(idle, /disabled=""/);
  assert.match(idle, /active:scale-\[0\.97\]/);

  const playing = render('playing');
  assert.match(playing, /aria-busy="true"/);
  assert.match(playing, /disabled=""/);
  assert.match(playing, /Playing…/);
  assert.match(playing, /motion-reduce:animate-none/);

  assert.match(render('started'), /Playback started/);
  for (const state of ['blocked', 'unsupported', 'failed']) {
    const failed = render(state);
    assert.match(failed, /Sound unavailable — Try again/);
    assert.doesNotMatch(failed, /Playback started/);
    assert.doesNotMatch(failed, /disabled=""/);
  }
});
