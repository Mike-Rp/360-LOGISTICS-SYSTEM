const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/admin/useFloatingPanelPresence.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(t, immediate = false) {
  const oldWindow = global.window; const slots = [], effects = [], frames = new Map(), timers = new Map();
  let cursor = 0, id = 0, open = false;
  global.window = {
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    matchMedia: () => ({ matches: immediate }),
  };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useEffect(fn, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => name === 'react' ? react : undefined, mod, mod.exports);
  const render = () => { cursor = 0; const result = mod.exports.useFloatingPanelPresence(open); while (effects.length) effects.shift()(); return result; };
  const run = collection => { const items = [...collection.values()]; collection.clear(); for (const item of items) (typeof item === 'function' ? item : item.fn)(); };
  t.after(() => { slots.forEach(slot => slot?.cleanup?.()); global.window = oldWindow; });
  return { render, timers, frames, setOpen(value) { open = value; return render(); }, frame: () => run(frames), timeout: () => run(timers) };
}

test('mobile panel mounts before entering and remains mounted through a 200ms exit', t => {
  const app = setup(t); assert.deepEqual(app.render(), { mounted: false, visible: false });
  app.setOpen(true); assert.equal(app.render().mounted, true); assert.equal(app.render().visible, false);
  app.frame(); assert.equal(app.render().visible, true);
  assert.deepEqual(app.setOpen(false), { mounted: true, visible: false });
  assert.equal([...app.timers.values()][0].ms, 200);
  app.timeout(); assert.equal(app.render().mounted, false);
});

test('rapid reopen cancels the old exit and does not unmount the open panel', t => {
  const app = setup(t); app.render(); app.setOpen(true); app.frame(); app.render();
  app.setOpen(false); assert.equal(app.timers.size, 1);
  app.setOpen(true); assert.equal(app.timers.size, 0); app.frame();
  assert.deepEqual(app.render(), { mounted: true, visible: true });
});

test('reduced motion and desktop do not wait for the mobile exit animation', t => {
  const app = setup(t, true); app.render(); app.setOpen(true); app.frame(); app.render(); app.setOpen(false);
  assert.equal([...app.timers.values()][0].ms, 0); app.timeout(); assert.equal(app.render().mounted, false);
});
