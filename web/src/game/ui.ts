/**
 * The HUD and the one menu.
 *
 * Canon describes a single place where the player works with what they hold -
 * there is no separate inventory screen, because the orbs already give the
 * at-a-glance view. Crafting and alchemy are two tabs of that one menu.
 *
 * The menu does not pause the world. Enemies keep moving and waves keep
 * arriving while it is open, which makes opening it a risk decision rather than
 * a free action - and puts a hard requirement on this file: every row has to be
 * readable and actionable at a glance, because a menu that demands sustained
 * attention while the world is trying to kill you is a menu that never gets
 * opened when it matters.
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

export interface HudState {
  inventory: Inventory;
  crafting: Crafting;
  alchemy: Alchemy;
  progression: Progression;
  selected: CombinationId | null;
}

export interface UiHooks {
  onCraft(id: RecipeId): void;
  onSelectCombination(id: CombinationId): void;
}

type Tone = 'info' | 'good' | 'bad' | 'big';
type Tab = 'craft' | 'alchemy';

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
  private readonly objective = el('div', 'objective');
  private readonly place = el('div', 'place');
  private readonly placeName = el('b');
  private readonly placeMood = el('span');
  private readonly vitals = el('div', 'vitals');
  private readonly hpFill = el('i');
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
  /** Counts what can be made or cast right now, so the menu is worth opening. */
  private readonly menuBadge = el('i', 'badge');
  private readonly sheet = el('div', 'sheet');
  private readonly sheetBody = el('div', 'body');
  private readonly tabs = el('div', 'tabs');
  private readonly castBar = el('div', 'castbar');

  private tab: Tab = 'craft';
  private open = false;
  private state: HudState | null = null;
  private lastHp = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly content: Content,
    private readonly hooks: UiHooks,
  ) {
    this.buildTopBar();
    this.buildOrbs();
    this.buildCastBar();
    this.buildSheet();
    this.root.append(this.toasts);
  }

  // ---------------------------------------------------------------- chrome

  private buildTopBar(): void {
    const bar = el('div', 'topbar');

    this.place.append(this.placeName, this.placeMood);

    const hp = el('div', 'hpbar');
    hp.append(this.hpFill);
    this.vitals.append(hp);

    const xp = el('div', 'xpbar');
    xp.append(this.xpFill);
    const levelRow = el('div', 'row');
    levelRow.append(this.levelText);
    this.levelChip.append(levelRow, xp);

    bar.append(this.place, this.vitals, this.levelChip);
    this.root.append(bar, this.objective);
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

  /** The two or three combinations the player actually has, as one row of buttons. */
  private buildCastBar(): void {
    this.root.append(this.castBar);
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
    ] as const) {
      const button = el('button', undefined, label);
      button.dataset.tab = id;
      onPress(button, () => {
        this.tab = id;
        this.renderSheet();
      });
      this.tabs.append(button);
    }

    // Canon: the world keeps running while this is open, and the player should
    // be told that rather than discovering it.
    const warn = el('p', 'note', 'The world does not stop while this is open.');

    this.sheet.append(header, this.tabs, warn, this.sheetBody);
    this.sheet.hidden = true;
    this.root.append(this.sheet);
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
    this.renderCastBar(state);
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
    this.vitals.classList.toggle('hurt', hp / maxHp < 0.35);
  }

  setPlace(name: string, mood: string): void {
    if (this.placeName.textContent === name) return;
    this.placeName.textContent = name;
    this.placeMood.textContent = mood;
  }

  setObjective(step: TutorialStep | null): void {
    this.objective.hidden = step === null;
    if (!step) return;
    this.objective.replaceChildren(el('b', undefined, step.title), el('span', undefined, step.hint));
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

  private renderCastBar(state: HudState): void {
    const level = state.progression.level;
    const available = state.alchemy
      .outlooks(state.inventory, level)
      .filter((o) => o.unlocked);

    this.castBar.replaceChildren();
    for (const outlook of available) {
      const button = el('button', 'cast');
      button.classList.toggle('on', state.selected === outlook.combination.id);
      button.classList.toggle('short', !outlook.can);
      button.append(el('b', undefined, outlook.combination.name));
      button.append(el('span', undefined, this.elementLine(outlook.combination.elements)));
      onPress(button, () => this.hooks.onSelectCombination(outlook.combination.id));
      this.castBar.append(button);
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
    else this.renderAlchemy(state);
  }

  private renderCraft(state: HudState): void {
    // What you can make now, then what you cannot, then what is already built.
    // A menu that does not pause has to answer "what can I do" at a glance.
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
    };
    return `${names[effect.stat] ?? effect.stat} +${effect.amount}`;
  }

  private renderAlchemy(state: HudState): void {
    const level = state.progression.level;

    if (!state.alchemy.menuInteractive(level)) {
      // Visible but non-interactive before Level 2, "so the player knows
      // something is coming". Showing a locked menu is the point; hiding it
      // would remove the anticipation canon is explicitly buying here.
      const locked = el('div', 'locked');
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
        row.append(el('span', 'tag', `Locked until level ${this.content.progression.alchemyUnlockLevel}`));
      } else {
        const readied = state.selected === outlook.combination.id;
        row.classList.toggle('on', readied);
        const button = el('button', 'go', readied ? 'Readied' : 'Ready this');
        button.disabled = readied;
        if (!outlook.can) {
          row.append(
            el('span', 'tag', `Short of ${Object.keys(outlook.shortfall)
              .map((id) => this.content.element(id).name)
              .join(' and ')}`),
          );
        }
        row.append(button);
        // The whole row is the target: a 40px button is a poor tap area when
        // the world may be moving behind the menu.
        onPress(row, () => this.hooks.onSelectCombination(outlook.combination.id));
      }
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
