/**
 * The HUD and the one menu.
 *
 * Canon describes a single place where the player works with what they hold -
 * there is no separate inventory screen, because the orbs already give the
 * at-a-glance view. Crafting and alchemy are two tabs of that one menu.
 *
 * The menu pauses the world, which is a deliberate departure from canon at the
 * author's request - GDD 6.1 wanted wave pressure to keep biting. The
 * requirement it puts on this file survives the pause either way: every row has
 * to be readable and actionable at a glance, because a menu that demands
 * sustained attention is a menu that gets closed rather than used.
 *
 * Kept apart from the canvas renderer on purpose: text, scrolling lists and tap
 * targets are things the browser is already good at.
 */
import { drawIcon, iconPad } from './icons';
import type { Content } from '../core/content';
import type { Inventory } from '../core/inventory';
import type { Crafting } from '../core/crafting';
import type { Alchemy } from '../core/alchemy';
import type { Progression } from '../core/progression';
import type { CombinationId, ElementId, Hand, MaterialId, RecipeId, TutorialStep } from '../core/types';
import type { Screen } from './screen';
import type { Install } from './install';
import type { Sound } from './sound';
import { renderSettings } from './pages';
import { accuracyHeld, channel, pairings } from '../core/notes';
import type { ArchetypeDef } from '../core/telemetry';

export interface HudState {
  inventory: Inventory;
  crafting: Crafting;
  alchemy: Alchemy;
  progression: Progression;
  /** Which notes, from either channel, the player is holding. */
  notesHeld: ReadonlySet<string>;
  /** What the telemetry has decided so far, or null before it has decided it. */
  rune: ArchetypeDef | null;
  archetype: ArchetypeDef | null;
  /** The combinations on the arc, in the order they sit there. */
  carried: readonly CombinationId[];
  /** How many fit, so the menu can say "full" rather than just refusing. */
  slots: number;
}

export interface UiHooks {
  onCraft(id: RecipeId): void;
  /** Put a combination on the arc, or take it off. */
  onToggleCarry(id: CombinationId): void;
  onAttack(): void;
  onSkill(id: CombinationId): void;
  onTogglePull(): void;
  /** Walk or run. The Game owns the state; this just asks for the other one. */
  onToggleRun(): void;
  /** Returns the new muted state, so the button can label itself from truth. */
  onToggleMute(): boolean;
  /** Stop the world and open the pause menu. */
  onPause(): void;
}

/** Where the objective toggle remembers itself. */
const QUEST_KEY = 'maelstrom.quest.v1';

/**
 * The objective icon, in the typeface this repository generates.
 *
 * Named rather than written inline at both use sites, because a bare
 * '\ue000' in the middle of a DOM call is unreadable and impossible to grep
 * for - and this one needs grepping for, since it is the only character in
 * the game whose meaning depends on our font being the one that draws it.
 */
const ICON_OBJECTIVE = '\ue000';

type Tone = 'info' | 'good' | 'bad' | 'big';
type Tab = 'craft' | 'alchemy' | 'log' | 'screen';

function el<K extends keyof HTMLElementTagNameMap>(
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
 * multi-touch sequence, so a click-bound HUD control does nothing while the
 * other thumb is on the stick - which is exactly when these get pressed. The
 * click handler stays as the keyboard and mouse path, guarded so a real click
 * following a pointerdown does not fire twice.
 */
function onPress(target: HTMLElement, handler: () => void): void {
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

export class Ui {
  private readonly toasts = el('div', 'toasts');
  private readonly fragment = el('div', 'fragment');
  private fragmentTimer = 0;
  private readonly objective = el('div', 'objective');
  private readonly breach = el('div', 'breachbar');
  private readonly breachFill = el('i');
  private readonly breachText = el('b');
  private readonly place = el('div', 'place');
  private readonly placeName = el('b');
  private readonly placeMood = el('span');
  private readonly vitals = el('div', 'vitals');
  private readonly hpFill = el('i');
  /** The number, written over the bar rather than beside it. */
  private readonly hpText = el('b', 'hpnum');
  private readonly levelChip = el('div', 'level');
  private readonly levelText = el('b');
  private readonly xpFill = el('i');
  private readonly orbBar = el('div', 'orbbar');
  private readonly orbs: Record<Hand, HTMLElement> = {
    left: el('div', 'orb'),
    right: el('div', 'orb'),
  };
  private readonly carry = el('div', 'carry');
  private readonly menuBtn = el('button', 'nav-btn');
  private readonly muteBtn = el('button', 'mute-btn');
  /**
   * Show or hide the objective banner.
   *
   * The tutorial line sat on screen permanently, and on a landscape phone it
   * covers the top third of the play area - which is where anything walking at
   * you comes from. The step it names does not go away when the banner does:
   * this hides the text, not the tutorial.
   *
   * \ue000 is the quest-log glyph in the game's own typeface rather than an
   * emoji, so it is the one chrome button that is actually on the pixel grid.
   */
  private readonly questBtn = el('button', 'quest-btn', ICON_OBJECTIVE);
  /** The step currently being shown, kept so the banner can be put back. */
  private step: TutorialStep | null = null;
  private questOpen = true;
  private readonly pauseBtn = el('button', 'pause-btn', '⏸');
  /** Counts what can be made or cast right now, so the menu is worth opening. */
  private readonly menuBadge = el('i', 'badge');
  private readonly sheet = el('div', 'sheet');
  private readonly sheetBody = el('div', 'body');
  private readonly tabs = el('div', 'tabs');
  private readonly skillArc = el('div', 'skillarc');
  private readonly pullBtn = el('button');
  private readonly runBtn = el('button');
  private readonly attackBtn = el('button');
  private readonly comboTag = el('i');
  private readonly skillNodes = new Map<CombinationId, HTMLElement>();
  private attackHeld = false;
  private skillSignature = '';

  private tab: Tab = 'craft';
  private open = false;
  private state: HudState | null = null;
  private lastHp = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly content: Content,
    private readonly screen: Screen,
    private readonly install: Install,
    private readonly sound: Sound,
    private readonly hooks: UiHooks,
  ) {
    this.buildTopBar();
    this.guardGlyph();
    this.buildOrbs();
    this.buildCluster();
    this.buildSheet();
    this.buildFragment();
    this.root.append(this.toasts);
  }

  // ---------------------------------------------------------------- chrome

  /**
   * Health and level along the top, the way an action game does it.
   *
   * Two long bars stacked in the top-left corner with the health value written
   * over the bar rather than beside it, the level in the top-right, and the two
   * chrome buttons as circles underneath. Laid out on a grid rather than a flex
   * row so the DOM order - which is the reading order, and is health first -
   * does not have to match the corner each piece sits in.
   */
  private buildTopBar(): void {
    const bar = el('div', 'topbar');

    this.place.append(this.placeName, this.placeMood);

    const gauges = el('div', 'gauges');
    const hp = el('div', 'hpbar');
    // The number sits inside the bar: a value in its own column costs width
    // that the bar wants, and reads as a separate thing to check.
    hp.append(this.hpFill, this.hpText);
    this.vitals.append(hp);

    const xp = el('div', 'xpbar');
    xp.append(this.xpFill);
    gauges.append(this.vitals, xp);

    this.levelChip.append(this.levelText);

    // Under the bars rather than beside the level: these are the two controls
    // a player reaches for in a hurry - one to stop, one when the room they
    // are in turns out not to be theirs - and the top-left corner is the one
    // place nothing else is competing for.
    onPress(this.muteBtn, () => this.setMuteLabel(this.hooks.onToggleMute()));
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    onPress(this.pauseBtn, () => this.hooks.onPause());
    const chrome = el('div', 'chrome');
    this.questBtn.setAttribute('aria-label', 'Hide the objective');
    onPress(this.questBtn, () => this.setQuestOpen(!this.questOpen));
    chrome.append(this.pauseBtn, this.muteBtn, this.questBtn);

    bar.append(gauges, this.levelChip, chrome, this.place);
    try {
      this.setQuestOpen(localStorage.getItem(QUEST_KEY) !== 'closed');
    } catch {
      this.setQuestOpen(true);
    }

    this.breach.append(this.breachText, this.breachFill);
    this.breach.hidden = true;

    // Under the top bar and above the objective, so a breach in progress never
    // covers the health bar it is the reason you are watching.
    this.root.append(bar, this.breach, this.objective);
    this.objective.hidden = true;
  }

  private buildOrbs(): void {
    for (const hand of ['left', 'right'] as const) this.orbBar.append(this.orbs[hand]);
    const wrap = el('div', 'orbwrap');

    this.menuBtn.append(el('span', 'label', 'Transmute'), this.menuBadge);
    this.menuBadge.hidden = true;
    onPress(this.menuBtn, () => this.toggleSheet());

    wrap.append(this.orbBar, this.carry, this.menuBtn);
    this.root.append(wrap);
  }

  /**
   * The right-hand cluster, laid out the way a mobile action MMO does it: one
   * large attack under the thumb, the skills arced above it within reach, and
   * the gathering toggle set apart so it is never hit by accident mid-fight.
   */
  private buildCluster(): void {
    const wrap = el('div', 'action-wrap');

    this.pullBtn.className = 'action pull';
    this.pullBtn.append(el('b', undefined, 'PULL'), el('span', 'sub', 'auto'));
    onPress(this.pullBtn, () => this.hooks.onTogglePull());

    /*
     * RUN, in the right-hand cluster rather than under the steering thumb.
     *
     * It is a movement control, so the left thumb is where it belongs by
     * rights - but the stick is FLOATING, placed wherever the first touch
     * lands, and the bottom-left corner it would sit in is exactly where that
     * touch goes. A button there would carve a dead patch out of the one part
     * of the screen the stick most wants. A toggle does not need to be under
     * the thumb that steers: it is pressed once and then forgotten, which is
     * the difference between this and a hold-to-run button.
     *
     * Same size and same idiom as PULL - a word and an on/off line - because
     * they are the same kind of control and the player should not have to
     * learn two.
     */
    this.runBtn.className = 'action run';
    this.runBtn.append(el('b', undefined, 'RUN'), el('span', 'sub', 'off'));
    onPress(this.runBtn, () => this.hooks.onToggleRun());

    this.attackBtn.className = 'action attack';
    this.attackBtn.append(el('b', undefined, 'ATTACK'), this.comboTag);
    this.comboTag.className = 'combo';
    this.comboTag.hidden = true;
    // Attack repeats while held, the way a basic attack chains - but a single
    // tap still lands one, so it never requires a hold.
    onPress(this.attackBtn, () => this.hooks.onAttack());
    this.attackBtn.addEventListener('pointerdown', () => {
      this.attackHeld = true;
    });
    for (const done of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.attackBtn.addEventListener(done, () => {
        this.attackHeld = false;
      });
    }

    wrap.append(this.skillArc, this.runBtn, this.pullBtn, this.attackBtn);
    this.root.append(wrap);
  }

  /**
   * If the typeface did not arrive, do not show a private-use character.
   *
   * U+E000 is in the Private Use Area, which is exactly what it sounds like:
   * no agreed meaning, and every font is free to put whatever it likes there.
   * While our own font is loaded that is a feature - it is how the game ships
   * an icon with no image to load. The moment it is NOT loaded, the browser
   * walks the fallback chain and renders some other font's idea of U+E000,
   * and icon fonts and legacy phone emoji sets both map that range. The
   * failure is a wrong symbol rather than a missing one, it is invisible on
   * any machine where the font works, and it differs by device - which is the
   * worst combination of properties a bug can have.
   *
   * `font-display: block` means a slow font is waited for rather than swapped,
   * so this only fires when the file genuinely did not arrive: blocked, 404,
   * a storage policy. Then the button says what it does in ASCII instead.
   */
  private guardGlyph(): void {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.load) return;
    fonts
      .load('16px "Maelstrom Pixel"', ICON_OBJECTIVE)
      .then(() => {
        if (fonts.check('16px "Maelstrom Pixel"', ICON_OBJECTIVE)) return;
        this.questBtn.textContent = '!';
      })
      .catch(() => {
        this.questBtn.textContent = '!';
      });
  }

  /** Draws the speaker from the real muted state rather than a local guess. */
  setMuteLabel(muted: boolean): void {
    this.muteBtn.textContent = muted ? '🔇' : '🔊';
    this.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    this.muteBtn.classList.toggle('off', muted);
  }

  /** True while the attack button is down, so the game can chain swings. */
  get attacking(): boolean {
    return this.attackHeld;
  }

  setPullActive(active: boolean): void {
    this.pullBtn.classList.toggle('on', active);
    const sub = this.pullBtn.querySelector('.sub');
    if (sub) sub.textContent = active ? 'on' : 'off';
  }

  /**
   * Draw RUN from the real state rather than a local guess, the same way the
   * mute button does - the toggle is restored from storage at startup and
   * flipped by a key as well as by the button, and a label keeping its own
   * count of that would drift.
   */
  setRunActive(active: boolean): void {
    this.runBtn.classList.toggle('on', active);
    const sub = this.runBtn.querySelector('.sub');
    if (sub) sub.textContent = active ? 'on' : 'off';
    this.runBtn.setAttribute('aria-label', active ? 'Running. Tap to walk' : 'Walking. Tap to run');
  }

  setCombo(combo: number): void {
    this.comboTag.hidden = combo <= 0;
    this.comboTag.textContent = combo > 0 ? `x${combo + 1}` : '';
  }

  /** Radial sweep on each skill, so what is ready is readable at a glance. */
  setCooldowns(remaining: ReadonlyMap<CombinationId, number>): void {
    for (const [id, node] of this.skillNodes) {
      const left = remaining.get(id) ?? 0;
      const total = this.content.combination(id).cooldownSeconds || 1;
      const sweep = node.querySelector<HTMLElement>('.sweep');
      if (sweep) sweep.style.height = `${Math.max(0, Math.min(1, left / total)) * 100}%`;
      node.classList.toggle('cooling', left > 0);
    }
  }

  private buildSheet(): void {
    // A real <header>, because the sheet CSS already styles `.sheet header`.
    const header = el('header');
    header.append(el('h2', undefined, 'Gauntlets'));
    const close = el('button', 'close', '×');
    onPress(close, () => this.closeSheet());
    header.append(close);

    for (const [id, label] of [
      ['craft', 'Craft'],
      ['alchemy', 'Alchemy'],
      ['log', 'Log'],
      ['screen', 'Screen'],
    ] as const) {
      const button = el('button', undefined, label);
      button.dataset.tab = id;
      onPress(button, () => {
        this.tab = id;
        this.renderSheet();
      });
      this.tabs.append(button);
    }

    // The world is held while this is open, so the note has to say so: it read
    // the other way round for as long as the menu did not pause, and a line
    // that contradicts what the game does teaches the wrong lesson twice.
    const warn = el('p', 'note', 'The world is paused while this is open.');

    this.sheet.append(header, this.tabs, warn, this.sheetBody);
    this.sheet.hidden = true;
    this.root.append(this.sheet);
  }

  /**
   * The world saying something about itself.
   *
   * Not a toast: a toast is a receipt for something the player just did and is
   * gone in two seconds. This is a sentence worth finishing, so it holds until
   * it is dismissed or until long enough has passed that it has been read, and
   * it is styled as a reading rather than as feedback.
   *
   * It never blocks. Nothing here pauses the world, because a wave clearing is
   * one of the moments it fires on and stopping the game to narrate that would
   * take the beat away from the thing it is narrating.
   */
  private buildFragment(): void {
    this.fragment.dataset.ui = '';
    this.fragment.hidden = true;
    onPress(this.fragment, () => this.hideFragment());
    /*
     * In the flow, directly under the objective banner.
     *
     * Floated at a fixed offset it landed on that banner - measured at 367x68
     * of overlap in portrait and 187px wide in landscape - because the banner
     * is three lines sometimes and one line others, and no constant is right
     * for both. Stacked, it cannot overlap whatever the banner turned out to
     * be. Landscape overrides this back to absolute, because there the banner
     * is overlaid and the right half of the screen is empty.
     */
    this.objective.after(this.fragment);
  }

  /**
   * @param channel marks the card as coming from one of the two note channels,
   *   so a bulletin never looks like something handwritten. Omitted for the
   *   opening fragments, which claim to be neither.
   */
  showFragment(title: string, text: string, channel?: string): void {
    this.fragment.replaceChildren(
      el('b', undefined, title),
      el('p', undefined, text),
      el('span', 'fdismiss', 'tap to dismiss'),
    );
    this.fragment.className = channel ? `fragment ${channel}` : 'fragment';
    this.fragment.hidden = false;
    this.fragment.classList.remove('going');
    // Long enough to read twice at a walking pace, since it arrives while the
    // player is doing something else.
    this.fragmentTimer = 9;
  }

  hideFragment(): void {
    if (this.fragment.hidden) return;
    this.fragmentTimer = 0;
    this.fragment.classList.add('going');
    this.fragment.hidden = true;
  }

  /**
   * The boundary, coming apart.
   *
   * Shown as soon as the player is standing somewhere it could happen, not
   * only once it has started - the whole reason the bar exists is that "walk
   * to the edge of the world and hold the pull" is not a thing anybody guesses
   * without being told. `blocked` says which of the three conditions is not
   * met, because nothing happening at the edge of the world with no
   * explanation is indistinguishable from a bug.
   */
  setBreach(progress: number | null, blocked: string | null): void {
    const show = progress !== null || blocked === 'recipe' || blocked === 'level';
    this.breach.hidden = !show;
    if (!show) return;

    this.breach.classList.toggle('waiting', blocked !== null);
    this.breachFill.style.width = `${Math.round((progress ?? 0) * 100)}%`;

    if (blocked === 'level') {
      this.breachText.textContent = `The boundary is code. Level ${this.content.ending.requires.level} first.`;
    } else if (blocked === 'recipe') {
      const recipe = this.content.crafting.recipes.find((r) => r.id === this.content.ending.requires.recipe);
      this.breachText.textContent = `The boundary is code. You need the ${recipe?.name ?? 'last gauntlet'}.`;
    } else if (blocked === 'distance') {
      this.breachText.textContent = 'Held. Go back to the edge.';
    } else {
      this.breachText.textContent =
        progress && progress > 0 ? `Breaching - ${Math.round(progress * 100)}%` : 'Hold the pull here.';
    }
  }

  /** Ticked from the game loop, so it does not expire while the game is paused. */
  tickFragment(dt: number): void {
    if (this.fragment.hidden || this.fragmentTimer <= 0) return;
    this.fragmentTimer -= dt;
    if (this.fragmentTimer <= 0) this.hideFragment();
  }

  // ---------------------------------------------------------------- state in

  bind(state: HudState): void {
    this.state = state;
    this.refresh(state);
  }

  refresh(state: HudState): void {
    this.state = state;
    this.renderOrbs(state);
    this.renderLevel(state);
    this.renderSkills(state);
    this.renderMenuBadge(state);
    if (this.open) this.renderSheet();
  }

  /**
   * How many things are actually doable in the menu right now. Without this the
   * player has no reason to open it, and the two systems the game is named for
   * stay invisible behind a button labelled with a noun.
   */
  private renderMenuBadge(state: HudState): void {
    const level = state.progression.level;
    const ready =
      state.crafting.outlooks(state.inventory).filter((o) => o.can).length +
      state.alchemy.outlooks(state.inventory, level).filter((o) => o.can).length;
    this.menuBadge.textContent = String(ready);
    this.menuBadge.hidden = ready === 0;
    this.menuBtn.classList.toggle('ready', ready > 0);
  }

  /** Called every frame, so it only touches the DOM when a number changed. */
  setVitals(hp: number, maxHp: number): void {
    const rounded = Math.ceil(hp);
    if (rounded === this.lastHp) return;
    this.lastHp = rounded;
    this.hpFill.style.width = `${Math.max(0, Math.min(1, hp / maxHp)) * 100}%`;
    this.hpText.textContent = `${rounded}/${Math.round(maxHp)}`;
    this.vitals.classList.toggle('hurt', hp / maxHp < 0.35);
  }

  setPlace(name: string, mood: string): void {
    if (this.placeName.textContent === name) return;
    this.placeName.textContent = name;
    this.placeMood.textContent = mood;
  }

  /**
   * Open or close the objective, and remember which.
   *
   * Stored rather than reset per run: a player who has turned the banner off
   * has told you they do not want it, and handing it back on the next load is
   * the setting not working. It is written through a try/catch because
   * localStorage throws outright in a private window, and losing a preference
   * is not worth losing a frame over.
   */
  setQuestOpen(open: boolean): void {
    this.questOpen = open;
    this.questBtn.classList.toggle('off', !open);
    this.questBtn.setAttribute('aria-label', open ? 'Hide the objective' : 'Show the objective');
    this.questBtn.setAttribute('aria-pressed', String(open));
    try {
      localStorage.setItem(QUEST_KEY, open ? 'open' : 'closed');
    } catch {
      // No storage: the toggle still works for this run.
    }
    this.setObjective(this.step);
  }

  setObjective(step: TutorialStep | null): void {
    this.step = step;
    /*
     * Closed hides the banner without ending the step.
     *
     * The early return matters: with the banner down there is no element to
     * measure, so `--banner-bottom` has to be cleared or the announcements go
     * on stacking below a banner that is not there any more - a gap of dead
     * space at the top of the screen with nothing above it.
     */
    if (!this.questOpen) {
      this.objective.hidden = true;
      this.root.classList.remove('banner');
      this.root.style.removeProperty('--banner-bottom');
      return;
    }
    this.objective.hidden = step === null;
    /*
     * The banner and the announcements both want the top-centre.
     *
     * The banner sits there because that is where a tutorial line belongs and
     * where the reference puts it; the toasts stack from there because there
     * is nowhere else on a landscape screen that is not a thumb. So the root
     * carries a flag and the toasts start below the banner while one is up.
     */
    this.root.classList.toggle('banner', step !== null);
    if (!step) {
      this.root.style.removeProperty('--banner-bottom');
      return;
    }
    this.objective.replaceChildren(el('b', undefined, step.title), el('span', undefined, step.hint));
    /*
     * Publish where the banner actually ends.
     *
     * A fixed offset was the first attempt and it does not survive a line
     * wrapping: a three-row banner ran seventeen pixels past where the
     * announcements had been told to start, and both are dark boxes of light
     * text, so they do not look broken when they collide - they look
     * unreadable. Costs one synchronous layout per tutorial step, which is a
     * handful of times in a run.
     */
    this.root.style.setProperty(
      '--banner-bottom',
      `${this.objective.offsetTop + this.objective.offsetHeight}px`,
    );
  }

  // ---------------------------------------------------------------- orbs

  /**
   * Canon: miniatures of held materials float and swirl inside the gauntlets,
   * reflecting real amounts - collect a little, see a little. The orbs are a
   * readout of the inventory and nothing is ever loaded into them.
   */
  private renderOrbs(state: HudState): void {
    for (const hand of ['left', 'right'] as const) {
      const host = this.orbs[hand];
      const held = state.inventory.orbView(hand);
      host.replaceChildren();

      const fill = el('i', 'fill');
      fill.style.height = `${state.inventory.fillFraction * 100}%`;
      host.append(fill);

      // Cap what is drawn: past a handful the orb reads as "a lot" anyway, and
      // sixty little canvases a frame is not worth the truth.
      for (const stack of held.slice(0, 6)) {
        const mote = el('span', 'mote');
        mote.append(this.icon(stack.material, 18));
        if (stack.quantity > 1) mote.append(el('em', undefined, String(stack.quantity)));
        host.append(mote);
      }
    }

    const { used, capacity } = state.inventory;
    this.carry.textContent = `${used} / ${capacity}`;
    this.carry.classList.toggle('full', state.inventory.full);
  }

  private renderLevel(state: HudState): void {
    this.levelText.textContent = `Lv ${state.progression.level}`;
    this.xpFill.style.width = `${state.progression.levelProgress * 100}%`;
  }

  // ---------------------------------------------------------------- casting

  /**
   * One button per combination the player actually has. Tapping fires it - there
   * is no separate "ready this" step, because a skill you have to arm before
   * using is a skill you forget you have.
   */
  private renderSkills(state: HudState): void {
    const level = state.progression.level;
    /*
     * The arc is the loadout, in the loadout's order.
     *
     * It used to be every unlocked combination, which was fine at three and
     * would not survive eleven: four circles is what fits up the side of a
     * phone held sideways before they start running over the menu button.
     * `unlocked` is still checked, because a bar restored from a save can name
     * something the player's current level has not opened.
     */
    const byId = new Map(state.alchemy.outlooks(state.inventory, level).map((o) => [o.combination.id, o]));
    const available = state.carried
      .map((id) => byId.get(id))
      .filter((o): o is NonNullable<typeof o> => !!o && o.unlocked);

    const wanted = available.map((o) => o.combination.id).join(',');
    if (wanted !== this.skillSignature) {
      this.skillSignature = wanted;
      this.skillArc.replaceChildren();
      this.skillNodes.clear();
      for (const outlook of available) {
        const id = outlook.combination.id;
        const button = el('button', 'skill');
        button.append(el('i', 'sweep'));
        button.append(el('b', undefined, outlook.combination.name));
        button.append(el('span', undefined, this.elementLine(outlook.combination.elements)));
        onPress(button, () => this.hooks.onSkill(id));
        this.skillArc.append(button);
        this.skillNodes.set(id, button);
      }
    }

    for (const outlook of available) {
      this.skillNodes.get(outlook.combination.id)?.classList.toggle('short', !outlook.can);
    }
  }

  private elementLine(elements: Record<string, number>): string {
    return Object.entries(elements)
      .map(([id, n]) => `${this.content.element(id).symbol}×${n}`)
      .join(' ');
  }

  // ---------------------------------------------------------------- the menu

  get sheetOpen(): boolean {
    return this.open;
  }

  toggleSheet(): void {
    this.open = !this.open;
    this.sheet.hidden = !this.open;
    this.sheet.classList.toggle('on', this.open);
    if (this.open) this.renderSheet();
  }

  closeSheet(): void {
    if (!this.open) return;
    this.toggleSheet();
  }

  private renderSheet(): void {
    const state = this.state;
    if (!state) return;

    for (const button of this.tabs.querySelectorAll('button')) {
      button.classList.toggle('on', button.dataset.tab === this.tab);
    }

    this.sheetBody.replaceChildren();
    if (this.tab === 'craft') this.renderCraft(state);
    else if (this.tab === 'alchemy') this.renderAlchemy(state);
    else if (this.tab === 'log') this.renderLog(state);
    else this.renderScreen();
  }

  /**
   * How the game sits on the device: how much world it shows, and which way up.
   *
   * In the crafting menu rather than a settings screen of its own because this
   * is the only menu the game has - canon puts everything the player works with
   * in one place - and because both settings are things you want to change
   * while looking at the world, not before starting.
   */
  private renderScreen(): void {
    renderSettings(this.sheetBody, {
      screen: this.screen,
      install: this.install,
      sound: this.sound,
      onChange: () => this.renderSheet(),
    });
  }

  private renderCraft(state: HudState): void {
    // What you can make now, then what you cannot, then what is already built.
    // The menu has to answer "what can I do" before it is read line by line.
    const rank = (o: { can: boolean; built: boolean }) => (o.built ? 2 : o.can ? 0 : 1);
    const rows = [...state.crafting.outlooks(state.inventory)].sort((a, b) => rank(a) - rank(b));
    for (const outlook of rows) {
      const row = el('div', 'row-item');
      row.classList.toggle('done', outlook.built);
      row.classList.toggle('short', !outlook.can && !outlook.built);

      const head = el('div', 'head');
      head.append(el('b', undefined, outlook.recipe.name));
      head.append(el('em', undefined, this.effectLabel(outlook.recipe.effect)));
      row.append(head);

      const cost = el('div', 'cost');
      for (const [id, qty] of Object.entries(outlook.recipe.cost)) {
        const have = state.inventory.count(id);
        const chip = el('span', have >= qty ? 'chip' : 'chip miss');
        chip.append(this.icon(id, 16));
        chip.append(document.createTextNode(`${have}/${qty}`));
        cost.append(chip);
      }
      row.append(cost);

      row.append(el('p', undefined, outlook.recipe.description));

      if (outlook.built) {
        row.append(el('span', 'tag', 'Built'));
      } else {
        const button = el('button', 'go', 'Craft');
        button.disabled = !outlook.can;
        onPress(button, () => {
          if (outlook.can) this.hooks.onCraft(outlook.recipe.id);
        });
        row.append(button);
      }
      this.sheetBody.append(row);
    }
  }

  private effectLabel(effect: { stat: string; amount: number }): string {
    const names: Record<string, string> = {
      carryCapacity: 'Carry',
      pullRadius: 'Pull radius',
      pullSpeed: 'Pull speed',
      strikeDamage: 'Strike',
      strikeReach: 'Reach',
      channelRate: 'Recovery',
    };
    // The only one that is a percentage rather than a flat amount, and a row
    // reading "Recovery +18" where every neighbour is in units would be read
    // as eighteen of something.
    const unit = effect.stat === 'channelRate' ? '%' : '';
    return `${names[effect.stat] ?? effect.stat} +${effect.amount}${unit}`;
  }

  private renderAlchemy(state: HudState): void {
    const level = state.progression.level;

    if (!state.alchemy.menuInteractive(level)) {
      // Visible but non-interactive before Level 2, "so the player knows
      // something is coming". Showing a locked menu is the point; hiding it
      // would remove the anticipation canon is explicitly buying here.
      // Its own class: the combination rows also carry `locked`, and a shared
      // name made the two indistinguishable to anything selecting them.
      const locked = el('div', 'locked-note');
      locked.append(el('b', undefined, 'The workshop is not open to you yet.'));
      locked.append(
        el(
          'p',
          undefined,
          `Level ${this.content.progression.alchemyUnlockLevel} opens it. Until then you have what you were handed.`,
        ),
      );
      this.sheetBody.append(locked);
    }

    const pool = state.inventory.elementPool();
    const poolRow = el('div', 'pool');
    for (const element of this.content.elements) {
      const n = pool[element.id] ?? 0;
      const chip = el('span', n > 0 ? 'chip' : 'chip miss');
      const dot = el('i');
      dot.style.background = element.color;
      chip.append(dot, document.createTextNode(`${element.symbol} ${n}`));
      chip.title = `${element.name} - ${element.domain}`;
      poolRow.append(chip);
    }
    this.sheetBody.append(poolRow);

    // What the bar is for, said once and near the top. Without it the Carry
    // buttons look like a second kind of crafting rather than the choice of
    // which four things end up under the right thumb.
    if (state.alchemy.menuInteractive(level)) {
      this.sheetBody.append(
        el(
          'p',
          'note',
          `Carrying ${state.carried.length} of ${state.slots}. These are the buttons above the attack.`,
        ),
      );
    }

    for (const outlook of state.alchemy.outlooks(state.inventory, level)) {
      const row = el('div', 'row-item');
      row.classList.toggle('short', !outlook.can);
      row.classList.toggle('locked', !outlook.unlocked);

      const head = el('div', 'head');
      head.append(el('b', undefined, outlook.combination.name));
      head.append(el('em', undefined, this.elementLine(outlook.combination.elements)));
      row.append(head);
      row.append(el('p', undefined, outlook.combination.description));

      if (!outlook.unlocked) {
        row.append(el('span', 'tag', `Locked until level ${state.alchemy.opensAt(outlook.combination)}`));
      } else {
        const carried = state.carried.includes(outlook.combination.id);
        const full = !carried && state.carried.length >= state.slots;
        row.classList.toggle('on', carried);
        if (!outlook.can) {
          row.append(
            el('span', 'tag', `Short of ${Object.keys(outlook.shortfall)
              .map((id) => this.content.element(id).name)
              .join(' and ')}`),
          );
        }
        // Take-off is offered on a carried row rather than hidden, because with
        // a full bar that is the only move available and a row with no button
        // reads as a row that is not listening.
        const button = el('button', 'go', carried ? 'Carrying' : full ? 'Bar full' : 'Carry');
        button.disabled = full;
        row.append(button);
        // The whole row is the target: a 40px button is a poor tap area when
        // the world may be moving behind the menu.
        onPress(row, () => this.hooks.onToggleCarry(outlook.combination.id));
      }
      this.sheetBody.append(row);
    }
  }

  /**
   * Everything the player has picked up off the ground, in two columns of one.
   *
   * The bulletins and the found notes are shown as separate channels rather
   * than as one chronological feed, because "plentiful and unreliable" against
   * "rare and accurate" is the distinction the whole system rests on and a
   * merged list would erase it. Where the player holds both halves of a
   * disagreement, the pairing is drawn under the note that disagrees - it is
   * not spelled out which side is right, because working that out is the only
   * thing this system asks the player to do.
   */
  private renderLog(state: HudState): void {
    this.renderAssessment(state);

    const all = this.content.notes;
    const held = state.notesHeld;
    const { found, total } = accuracyHeld(all, held);
    const pairs = pairings(all, held);

    this.sheetBody.append(
      el(
        'p',
        'note',
        `${held.size} of ${all.length} picked up. ` +
          (pairs.length
            ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'} of them contradict each other.`
            : 'Nothing you are holding disagrees with anything else you are holding.'),
      ),
    );

    if (!held.size) {
      this.sheetBody.append(
        el('p', 'note', 'There is paper lying about in every region. The gauntlets will take it if you walk near it with the pull on.'),
      );
      return;
    }

    const byId = new Map(all.map((note) => [note.id, note]));
    const contradictedBy = new Map(pairs.map((p) => [p.bulletin.id, p.found]));

    for (const which of ['jakindur', 'bulletin'] as const) {
      const rows = channel(all, which).filter((note) => held.has(note.id));
      if (!rows.length) continue;

      const meta = this.content.noteChannels[which];
      const head = el('div', 'logchan');
      head.append(el('b', undefined, meta?.name ?? which));
      head.append(
        el(
          'span',
          undefined,
          which === 'jakindur' ? `${found} of ${total} found` : `${rows.length} of ${channel(all, 'bulletin').length}`,
        ),
      );
      this.sheetBody.append(head);

      for (const note of rows) {
        const row = el('div', `row-item note ${which}`);
        row.append(el('b', undefined, note.title));
        row.append(el('p', undefined, note.text));

        const against = note.contradicts ? byId.get(note.contradicts) : contradictedBy.get(note.id);
        const bothHeld = against && held.has(against.id);
        if (bothHeld) {
          row.classList.add('disputed');
          row.append(el('span', 'tag', `Disagrees with ${against.title}`));
        } else if (note.contradicts) {
          // Said out loud, because a note that is arguing with something the
          // player has not read is doing half of nothing.
          row.append(el('span', 'tag', 'Arguing with something you have not found'));
        }
        this.sheetBody.append(row);
      }
    }
  }

  /**
   * What the system has decided about you.
   *
   * In the Log rather than on a character sheet, because that is what it is:
   * canon's section 10 reads the player continuously and grants a rune and a
   * class without ever asking, and the conclusion belongs next to the two
   * channels arguing about what the system is for. Nothing here is choosable,
   * and the page says so.
   */
  private renderAssessment(state: HudState): void {
    const { rune, archetype } = state;
    if (!rune && !archetype) return;

    const head = el('div', 'logchan');
    head.append(el('b', undefined, 'Assessment'));
    head.append(el('span', undefined, archetype ? 'Complete' : 'Provisional'));
    this.sheetBody.append(head);

    if (rune) {
      const row = el('div', 'row-item note assess');
      row.append(el('b', undefined, rune.rune));
      row.append(el('p', undefined, rune.runeDescription));
      row.append(el('span', 'tag', `Read as ${rune.name} during the opening`));
      this.sheetBody.append(row);
    }

    if (archetype) {
      const row = el('div', 'row-item note assess');
      row.append(el('b', undefined, archetype.name));
      row.append(el('p', undefined, archetype.description));
      // Said plainly, because a player looking at this will look for the menu
      // that let them pick it, and there is not one.
      row.append(el('span', 'tag', 'You were not asked'));
      this.sheetBody.append(row);
    }
  }

  // ---------------------------------------------------------------- toasts

  toast(text: string, tone: Tone = 'info'): void {
    const node = el('div', `toast ${tone}`, text);
    this.toasts.append(node);
    setTimeout(() => node.classList.add('out'), tone === 'big' ? 2200 : 1500);
    setTimeout(() => node.remove(), tone === 'big' ? 2700 : 2000);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
  }

  // ---------------------------------------------------------------- icons

  private icon(material: MaterialId, size: number): HTMLCanvasElement {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = el('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const def = this.content.material(material);
      ctx.scale(dpr, dpr);
      ctx.translate(size / 2, size / 2);
      // Divided by the pad so the whole composite - shadow included - lands
      // inside the box instead of being clipped at its edges.
      drawIcon(ctx, def.shape, def.color, size / iconPad);
    }
    return canvas;
  }

  /** Exposed for the codex-style lists the title screen shows. */
  elementColor(id: ElementId): string {
    return this.content.element(id).color;
  }
}
