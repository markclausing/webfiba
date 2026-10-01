// The key bindings, checked without a browser.
//
//   node tools/controlstest.js

import { Controls, keyLabel, padLabel, PRESETS } from '../src/controls.js';

let failures = 0;
function ok(what, passed) {
  if (!passed) failures++;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what}`);
}

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

{
  const c = new Controls(memory());
  ok('it starts on the default preset', c.presetName() === 'wasd');
  c.bindKey('shoot', 0, 'KeyE');
  ok('binding a key in use takes it from the other action', c.keys.shoot[0] === 'KeyE' && !c.keys.pass.includes('KeyE'));
  ok('and the other action keeps its second key, moved up', c.keys.pass[0] === 'KeyK');
  ok('and it is no longer a preset', c.presetName() === null);
  ok('Escape cannot be bound', c.bindKey('lob', 0, 'Escape') === false);
}

{
  const store = memory();
  const c = new Controls(store);
  c.bindKey('sprint', 0, 'KeyR');
  c.bindPad('shoot', 0, 1);
  const again = new Controls(store);
  ok('bindings survive a reload', again.keys.sprint[0] === 'KeyR' && again.pad.shoot[0] === 1);
  ok('a pad button in use moves too', again.pad.lob.every((b) => b !== 1));
  again.preset('arrows');
  ok('a preset replaces the keys', again.presetName() === 'arrows' && again.keys.shoot[0] === PRESETS.arrows.keys.shoot[0]);
}

{
  const c = new Controls(memory());
  c.bindKey('camera', 0, null);
  ok('an action with no key is reported', c.unbound().includes('camera'));
  const broken = memory();
  broken.setItem('webfiba.controls.v1', '{not json');
  ok('a broken save falls back to the defaults', new Controls(broken).presetName() === 'wasd');
}

ok('keys have readable names', keyLabel('KeyW') === 'W' && keyLabel('ShiftLeft') === 'L SHIFT' && keyLabel('ArrowUp') === '↑' && keyLabel('Numpad5') === 'NUM 5');
ok('pad buttons too', padLabel(0) === 'A' && padLabel(7) === 'RT' && padLabel(null) === '—');

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
