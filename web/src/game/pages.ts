/**
 * The pages that more than one menu needs.
 *
 * Settings can be reached from three places - the title screen before a run,
 * the pause menu during one, and the Screen tab of the gauntlet menu - and the
 * only thing worse than not being able to find a setting is finding two of it
 * that disagree. So there is one of each page and the menus borrow them.
 *
 * Everything here writes into a host element and calls back when something
 * changed, rather than owning any chrome of its own. That is what lets the same
 * rows sit inside a title card, a pause overlay and a tabbed sheet without
 * knowing which one they are in.
 */
import { VIEW_LABELS, VIEW_ORDER, VIEW_SPANS, type Screen } from './screen';
import type { Install } from './install';
import type { Sound } from './sound';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Fire on pointerdown, not click.
 *
 * A browser does not synthesise a `click` for a touch that belongs to a
 * multi-touch sequence, so a click-bound control does nothing while the other
 * thumb is on the stick - which is exactly when a pause button gets pressed.
 * The click handler stays as the keyboard and mouse path, guarded so a real
 * click following a pointerdown does not fire twice.
 */
export function onPress(target: HTMLElement, handler: () => void): void {
  let lastPress = 0;
  target.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      lastPress = event.timeStamp;
      handler();
    },
    { passive: false },
  );
  target.addEventListener('click', (event) => {
    if (event.timeStamp - lastPress < 700) return;
    handler();
  });
}

export interface SettingsDeps {
  screen: Screen;
  install: Install;
  sound: Sound;
  /** Called when a setting changed and the page should be drawn again. */
  onChange: () => void;
}

function row(host: HTMLElement, label: string): HTMLElement {
  const node = el('div', 'setrow');
  node.append(el('b', undefined, label));
  host.append(node);
  return node;
}

function choices<T>(
  host: HTMLElement,
  options: { id: T; label: string; sub: string }[],
  current: T,
  pick: (id: T) => void,
): void {
  const group = el('div', 'choices');
  for (const option of options) {
    const button = el('button', 'setchip', option.label);
    button.append(el('span', 'sub', option.sub));
    button.classList.toggle('on', current === option.id);
    onPress(button, () => pick(option.id));
    group.append(button);
  }
  host.append(group);
}

/** Every setting the game has, in one place, wherever that place happens to be. */
export function renderSettings(host: HTMLElement, deps: SettingsDeps): void {
  const { screen, install, sound, onChange } = deps;

  host.append(
    el('p', 'note', 'How much of the world fits on screen, and which way the game sits.'),
  );

  choices(
    row(host, 'View'),
    VIEW_ORDER.map((size) => ({
      id: size,
      label: VIEW_LABELS[size],
      sub: `${VIEW_SPANS[size]} units`,
    })),
    screen.view,
    (size) => {
      screen.setView(size);
      onChange();
    },
  );

  choices(
    row(host, 'Play sideways'),
    [
      { id: true, label: 'On', sub: 'Turn the phone' },
      { id: false, label: 'Off', sub: 'Follow the device' },
    ],
    screen.landscape,
    (on) => {
      screen.setLandscape(on);
      onChange();
    },
  );

  /*
   * Which way to turn, offered only while we are the ones doing the turning.
   *
   * When the device rotates itself there is nothing to choose - the phone
   * already knows which way up it is. It is only the transform fallback that
   * has to guess, and guessing wrong is the difference between a game that
   * reads upside down and one that does not, so the player gets to say.
   */
  if (screen.landscape && screen.selfRotated) {
    choices(
      row(host, 'Turn'),
      [
        { id: 'cw' as const, label: '↻ Right', sub: 'Top edge goes right' },
        { id: 'ccw' as const, label: '↺ Left', sub: 'Top edge goes left' },
      ],
      screen.turn,
      (id) => {
        screen.setTurn(id);
        onChange();
      },
    );
    host.append(
      el(
        'p',
        'note',
        'Your phone is refusing to rotate, so the game is turning itself. ' +
          'Unlock rotation in your device settings and this row disappears.',
      ),
    );
  }

  choices(
    row(host, 'Sound'),
    [
      { id: false, label: 'On', sub: 'Synthesised, no files' },
      { id: true, label: 'Off', sub: 'Silent' },
    ],
    sound.isMuted,
    (muted) => {
      // Unlock first: the context may never have been created, and unmuting one
      // that does not exist does nothing at all.
      sound.unlock();
      if (sound.isMuted !== muted) sound.toggleMute();
      onChange();
    },
  );

  renderInstall(host, install, onChange);
}

/**
 * Keeping a copy.
 *
 * Deliberately ignores the title screen's dismissal: somebody who opened a
 * settings page is looking for the thing rather than being sold it, and this is
 * the only route back for a player who tapped Not now and changed their mind.
 */
function renderInstall(host: HTMLElement, install: Install, onChange: () => void): void {
  const state = install.state;
  const node = row(host, 'Keep a copy');

  if (state === 'installed') {
    node.append(el('p', 'note', 'Installed. It runs from your home screen and plays offline.'));
    return;
  }

  if (state === 'ready') {
    const group = el('div', 'choices');
    const button = el('button', 'setchip', 'Install');
    button.append(el('span', 'sub', 'Home screen, works offline'));
    onPress(button, () => {
      void install.prompt().then(onChange);
    });
    group.append(button);
    node.append(group);
    return;
  }

  // No prompt to raise. On iOS there never will be one, and elsewhere the
  // browser has decided the moment is wrong - either way the only honest thing
  // to show is the route the player can take themselves.
  node.append(
    el(
      'p',
      'note',
      `Add it to your home screen and it plays with no signal at all. ${install.manualSteps}`,
    ),
  );
}

/**
 * The controls, written down.
 *
 * The guide teaches these by making you do them, which is the right way round
 * and no help at all to somebody who put the game down for a fortnight. This is
 * the reference, not the lesson.
 */
export function renderHowTo(host: HTMLElement): void {
  host.append(el('p', 'note', 'Two thumbs. The left half walks, the right half acts.'));

  for (const [name, text] of [
    ['Move', 'Press and drag anywhere on the left of the screen. The stick appears where your thumb lands, so there is nothing to find.'],
    ['Gather', 'Nothing. The gauntlets pull whatever you walk past, at walking pace. PULL is a toggle that starts on — the button is there to turn it off.'],
    ['Attack', 'The large button under your right thumb. It turns you to face the nearest thing before it swings. Staying on one target builds the hit; backing off resets it.'],
    ['Skills', 'Arced above the attack. Four of them, and the workshop is where you choose which four. The cost is on the face and the cooldown sweeps up from the bottom.'],
    ['Transmute', 'Crafting and alchemy in one menu, with a live count of what you could actually make right now. The world holds still while it is open.'],
    ['Reading', 'There is paper lying about in every region, and the gauntlets take it the same way they take everything else. Some of it is printed. Some of it is not, and the two do not agree. The Log tab keeps everything you have picked up.'],
    ['Getting out', 'There is a way out of the Coliseum. Nothing in the opening will tell you what it is, and one of the things lying on the ground will.'],
    ['Being read', 'You are never asked what you are. Something is watching how you play and will decide, twice, and tell you afterwards. It is in the Log with everything else you are not supposed to have.'],
    ['Keyboard', 'WASD or the arrow keys walk, which is handy in a desktop browser. Everything else is a tap.'],
  ] as const) {
    const item = el('div', 'howrow');
    item.append(el('b', undefined, name), el('p', undefined, text));
    host.append(item);
  }
}

/** Who made it and what it is, for the one person who taps About. */
export function renderAbout(host: HTMLElement, facts: [string, string][]): void {
  host.append(
    el(
      'p',
      'abouttext',
      'A touch-first build of Project Maelstrom. You wake at the centre of a ' +
        'bounded arena you did not choose, with two half-orbs above your hands ' +
        'and no memory of how you got here. Nothing explains why.',
    ),
    el(
      'p',
      'abouttext',
      'There are no image files and no sound files in this game. Every sprite, ' +
        'creature, icon and noise it makes is drawn or synthesised by code while ' +
        'you play, which is why the whole thing is smaller than one photograph ' +
        'and why it works with no signal.',
    ),
  );

  const table = el('div', 'aboutfacts');
  for (const [key, value] of facts) {
    table.append(el('b', undefined, key), el('span', undefined, value));
  }
  host.append(table);

  host.append(
    el(
      'p',
      'note',
      'World, elements, factions and progression designed by Michamm79. All code, ' +
        'and all generated art and sound, written for this build.',
    ),
  );
}
