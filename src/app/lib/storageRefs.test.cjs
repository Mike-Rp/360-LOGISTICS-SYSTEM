const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function loadTypeScript(file, resolve = require) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

const refs = loadTypeScript(join(__dirname, 'storageRefs.ts'));
const BUCKET = 'make-ee4d169c-media';
const PATH = 'photos/ASN12345/pickup_front_1729512345678.jpg';
const OLD_LINK = `https://yeyfmyojdlqtgoqlwhsv.supabase.co/storage/v1/object/sign/${BUCKET}/${PATH}?token=eyJhbGciOi.x.y`;

test('an old 10-year signed link gives back its path', () => {
  assert.equal(refs.storagePathOf(OLD_LINK, BUCKET), PATH);
});

test('a stored path is already a path', () => {
  assert.equal(refs.storagePathOf(PATH, BUCKET), PATH);
  assert.equal(refs.storagePathOf('docs/ASN1/Delivery Receipt_1.jpg', BUCKET), 'docs/ASN1/Delivery Receipt_1.jpg');
});

test('encoded characters in a link are decoded (spaces in document names)', () => {
  const link = `https://x.supabase.co/storage/v1/object/sign/${BUCKET}/docs/ASN1/Delivery%20Receipt_1.jpg?token=t`;
  assert.equal(refs.storagePathOf(link, BUCKET), 'docs/ASN1/Delivery Receipt_1.jpg');
});

test('not ours: empty, inline images, placeholders, other buckets, other sites', () => {
  for (const v of [null, undefined, '', '   ', 42, 'data:image/jpeg;base64,AAAA', '[image-data-stripped]',
    'https://example.com/photo.jpg',
    `https://x.supabase.co/storage/v1/object/sign/other-bucket/${PATH}?token=t`,
    `https://x.supabase.co/storage/v1/object/sign/${BUCKET}/secret/other.jpg?token=t`,
    'avatars/me.png']) {
    assert.equal(refs.storagePathOf(v, BUCKET), null, String(v));
  }
});

test('writes store the path, never the link', () => {
  assert.equal(refs.storedFileRef(OLD_LINK, BUCKET), PATH);
  assert.equal(refs.storedFileRef(PATH, BUCKET), PATH);
  assert.equal(refs.storedFileRef(null, BUCKET), null);
  assert.equal(refs.storedFileRef('[image-data-stripped]', BUCKET), '[image-data-stripped]');
});

test('a fresh short link and the stored path are the same file', () => {
  const fresh = `https://x.supabase.co/storage/v1/object/sign/${BUCKET}/${PATH}?token=new-one`;
  assert.equal(refs.sameStoredFile(fresh, PATH, BUCKET), true);
  assert.equal(refs.sameStoredFile(fresh, OLD_LINK, BUCKET), true);
  assert.equal(refs.sameStoredFile(fresh, 'photos/ASN12345/other.jpg', BUCKET), false);
  assert.equal(refs.sameStoredFile(null, null, BUCKET), true);
  assert.equal(refs.sameStoredFile(PATH, null, BUCKET), false);
});
