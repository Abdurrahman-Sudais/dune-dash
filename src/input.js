const keys = new Set();
const pressed = new Set(); // edge-triggered keys, cleared after each read

addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const any = (...codes) => codes.some((c) => keys.has(c));
const tapped = (...codes) => codes.some((c) => pressed.has(c));

export function readInput() {
  const input = {
    throttle: any('KeyW', 'ArrowUp'),
    brake: any('KeyS', 'ArrowDown'),
    steer: (any('KeyA', 'ArrowLeft') ? 1 : 0) - (any('KeyD', 'ArrowRight') ? 1 : 0),
    drift: any('Space', 'ShiftLeft', 'ShiftRight'),
    reset: tapped('KeyR'),
    use: tapped('KeyE', 'KeyF'),
    skill: tapped('KeyQ'),
    slam: tapped('KeyC'),
  };
  pressed.clear();
  return input;
}

export function anyKeyDown() {
  return keys.size > 0;
}
