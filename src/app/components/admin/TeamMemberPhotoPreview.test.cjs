const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const source = readFileSync(join(__dirname, 'TeamMemberPhotoPreview.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (name) => name === './useModalFocus' ? { useModalFocus() {} } : require(name), loaded, loaded.exports,
);
const { default: TeamMemberPhotoPreview, memberInitials } = loaded.exports;
const member = { id: 'csr-1', name: 'María Ñ. Santos', role: 'csr', avatarPath: 'private/path' };

test('preview shows the selected member, actual image URL, and role', () => {
  const html = renderToStaticMarkup(React.createElement(TeamMemberPhotoPreview, {
    member, photoUrl: 'https://example.test/signed-photo', onClose() {},
  }));
  assert.match(html, /src="https:\/\/example\.test\/signed-photo"/);
  assert.match(html, /María Ñ\. Santos/);
  assert.match(html, />CSR</);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="Close profile photo"/);
});

test('missing photo uses existing initials fallback and actual role', () => {
  const html = renderToStaticMarkup(React.createElement(TeamMemberPhotoPreview, {
    member: { ...member, role: 'viewer' }, onClose() {},
  }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, />MÑ</);
  assert.match(html, />Viewer</);
  assert.equal(memberInitials('María Ñ. Santos'), 'MÑ');
});

test('failed image replaces the photo with initials and keeps close options', () => {
  assert.match(source, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(source, /useModalFocus\(true, modalRef, onClose\)/);
  assert.match(source, /onClick=\{onClose\} aria-hidden="true"/);
});
