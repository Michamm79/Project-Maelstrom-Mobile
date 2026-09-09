/**
 * DOM HUD: top bar, gather prompt, orb bar, nav, and the bottom sheets
 * (pack / alchemy / codex / zones / menu).
 *
 * Kept apart from the canvas renderer on purpose - text, scrolling lists and
 * tap targets are things the browser is already good at, and native scrolling
 * feels far better on a phone than anything hand-rolled into a canvas.
 */
import { drawIcon } from './icons';
import { shortfall } from '../core/alchemy';
import { levelProgress, xpAtLevelStart, xpAtNextLevel } from '../core/progression';
import type { Content } from '../core/content';
import type { OrbContainer } from '../core/orbContainer';
import type { AlchemyRecipe, Hand, MaterialId, ZoneId } from '../core/types';

export interface UiCallbacks {
  onGather: () => void;
  onTransmute: () => void;
  onUnloadOrb: (hand: Hand) => void;
  onDecomposeOrb: (hand: Hand) => void;
  onLoadFromPack: (material: MaterialId) => void;
  onAlchemize: (recipe: AlchemyRecipe) => void;
  onTravel: (zone: ZoneId) => void;
  onReset: () => void;
}

type SheetBuilder = (body: HTMLElement) => void;

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

export class Ui {
  private readonly gatherBtn: HTMLButtonElement;
  private readonly gatherIcon: HTMLElement;
  private readonly gatherName: HTMLElement;
  private readonly gatherHint: HTMLElement;

  private readonly zoneName: HTMLElement;
  private readonly zoneSub: HTMLElement;
  private readonly levelNum: HTMLElement;
  private readonly xpText: HTMLElement;
  private readonly xpFill: HTMLElement;

  private readonly orbEls: Record<Hand, { root: HTMLElement; icon: HTMLElement; name: HTMLElement; unload: HTMLButtonElement; decompose: HTMLButtonElement }>;
  private readonly craftBtn: HTMLButtonElement;
  private readonly navAlchemy: HTMLButtonElement;

  private readonly scrim: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly toasts: HTMLElement;

  private openBuilder: SheetBuilder | null = null;
  private gatherTarget: MaterialId | null = null;
  private codexTab: 'materials' | 'transmutation' | 'alchemy' = 'materials';

  constructor(
    root: HTMLElement,
    private readonly content: Content,
    private readonly callbacks: UiCallbacks,
  ) {
    root.innerHTML = '';

    // -------------------------------------------------------------- top bar
    const topbar = el('div', 'topbar');
    topbar.dataset.ui = '';

    const zoneBtn = el('button', 'zone-btn');
    this.zoneName = el('span', 'name');
    this.zoneSub = el('span', 'sub');
    zoneBtn.append(this.zoneName, this.zoneSub);
    zoneBtn.addEventListener('click', () => this.openZones());

    const level = el('div', 'level');
    const levelRow = el('div', 'row');
    this.levelNum = el('b', undefined, 'Lv 1');
    this.xpText = el('span', undefined, '0 / 0');
    levelRow.append(this.levelNum, this.xpText);
    const xpbar = el('div', 'xpbar');
    this.xpFill = el('i');
    xpbar.append(this.xpFill);
    level.append(levelRow, xpbar);

    topbar.append(zoneBtn, level);

    // -------------------------------------------------------------- gather
    const gatherWrap = el('div', 'gather-wrap');
    gatherWrap.dataset.ui = '';
    this.gatherBtn = el('button', 'gather');
    this.gatherIcon = el('span');
    const gatherLabel = el('span', 'label');
    this.gatherName = el('b', undefined, '');
    this.gatherHint = el('span', undefined, 'tap to gather');
    gatherLabel.append(this.gatherName, this.gatherHint);
    this.gatherBtn.append(this.gatherIcon, gatherLabel);
    this.gatherBtn.addEventListener('click', () => this.callbacks.onGather());
    gatherWrap.append(this.gatherBtn);

    // -------------------------------------------------------------- orb bar
    const orbbar = el('div', 'orbbar');
    orbbar.dataset.ui = '';
    this.orbEls = {
      left: this.buildOrb('left'),
      right: this.buildOrb('right'),
    };

    this.craftBtn = el('button', 'craft');
    this.craftBtn.addEventListener('click', () => this.callbacks.onTransmute());

    orbbar.append(this.orbEls.left.root, this.craftBtn, this.orbEls.right.root);

    // -------------------------------------------------------------- nav
    const nav = el('div', 'nav');
    nav.dataset.ui = '';
    const navPack = this.buildNav('Pack', '▤', () => this.openPack());
    this.navAlchemy = this.buildNav('Alchemy', '⚗', () => this.openAlchemy());
    const navCodex = this.buildNav('Codex', '☷', () => this.openCodex());
    const navMenu = this.buildNav('Menu', '≡', () => this.openMenu());
    nav.append(navPack, this.navAlchemy, navCodex, navMenu);

    // -------------------------------------------------------------- sheets
    this.scrim = el('div', 'scrim');
    this.scrim.dataset.ui = '';
    this.scrim.addEventListener('click', () => this.closeSheet());

    this.sheet = el('div', 'sheet');
    this.sheet.dataset.ui = '';
    const header = el('header');
    this.sheetTitle = el('h2', undefined, '');
    const close = el('button', 'close', '✕');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.closeSheet());
    header.append(this.sheetTitle, close);
    this.sheetBody = el('div', 'body');
    this.sheet.append(header, this.sheetBody);

    this.toasts = el('div', 'toasts');

    root.append(topbar, this.toasts, gatherWrap, orbbar, nav, this.scrim, this.sheet);
  }

  private buildNav(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = el('button');
    button.append(el('span', 'ico', icon), el('span', undefined, label));
    button.addEventListener('click', onClick);
    return button;
  }

  private buildOrb(hand: Hand) {
    const root = el('div', 'orb');
    const icon = el('span');
    const name = el('span', 'nm', 'empty');
    const acts = el('div', 'acts');

    const unload = el('button', undefined, '↩');
    unload.title = 'Return to pack';
    unload.addEventListener('click', () => this.callbacks.onUnloadOrb(hand));

    const decompose = el('button', undefined, '⚗');
    decompose.title = 'Decompose into elements';
    decompose.addEventListener('click', () => this.callbacks.onDecomposeOrb(hand));

    acts.append(unload, decompose);
    root.append(icon, name, acts);
    return { root, icon, name, unload, decompose };
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
      drawIcon(ctx, def.shape, def.color, size * 0.92);
    }
    return canvas;
  }

  private setIcon(host: HTMLElement, material: MaterialId | null, size: number): void {
    host.replaceChildren(material ? this.icon(material, size) : el('span'));
  }

  private elementChip(element: string, count: number, missing = false): HTMLElement {
    const def = this.content.element(element);
    const chip = el('span', missing ? 'chip miss' : 'chip');
    const dot = el('i');
    dot.style.background = def.color;
    chip.append(dot, document.createTextNode(`${def.name} ${count}`));
    return chip;
  }

  // ---------------------------------------------------------------- refresh

  refresh(orb: OrbContainer): void {
    const { state } = orb;
    const zone = this.content.zone(state.zoneId);
    this.zoneName.textContent = zone.name;
    this.zoneSub.textContent = zone.subtitle;

    const config = this.content.progression;
    this.levelNum.textContent = `Lv ${state.level}`;
    const next = xpAtNextLevel(config, state.level);
    const start = xpAtLevelStart(config, state.level);
    this.xpText.textContent = next === null ? 'max' : `${state.xp - start} / ${next - start}`;
    this.xpFill.style.width = `${levelProgress(config, state.xp, state.level) * 100}%`;

    for (const hand of ['left', 'right'] as Hand[]) {
      const material = orb.orb(hand);
      const ui = this.orbEls[hand];
      ui.root.classList.toggle('filled', material !== null);
      this.setIcon(ui.icon, material, 40);
      ui.name.textContent = material ? this.content.material(material).name : 'empty';
      ui.unload.disabled = material === null;
      ui.decompose.disabled = material === null || !orb.alchemyUnlocked;
      ui.decompose.title = orb.alchemyUnlocked
        ? 'Decompose into elements'
        : `Unlocks at level ${config.alchemyUnlockLevel}`;
    }

    this.refreshCraftButton(orb);

    this.navAlchemy.disabled = !orb.alchemyUnlocked;
    const brewable = orb.alchemyUnlocked && orb.getAvailableAlchemyRecipes().length > 0;
    this.navAlchemy.querySelector('.dot')?.remove();
    if (brewable) this.navAlchemy.append(el('span', 'dot'));

    // A sheet left open (the pack, say) must follow the state that changed under it.
    if (this.openBuilder && this.sheet.classList.contains('on')) {
      this.sheetBody.replaceChildren();
      this.openBuilder(this.sheetBody);
    }
  }

  private refreshCraftButton(orb: OrbContainer): void {
    const button = this.craftBtn;
    button.replaceChildren();
    button.classList.remove('ready', 'locked');

    const recipe = orb.peekTransmutation();
    if (recipe) {
      button.classList.add('ready');
      button.disabled = false;
      button.append(el('span', 'verb', 'Transmute'));
      const icon = el('span');
      this.setIcon(icon, recipe.result, 30);
      button.append(icon, el('span', 'out', this.content.material(recipe.result).name));
      return;
    }

    const pair = orb.leftOrb && orb.rightOrb ? this.content.recipeByPair(orb.leftOrb, orb.rightOrb) : undefined;
    if (pair) {
      // A real recipe exists but is level-gated: say so rather than "no reaction",
      // which would read as a dead end the player should stop trying.
      button.classList.add('locked');
      button.disabled = true;
      button.append(el('span', 'verb', 'Locked'));
      button.append(el('span', 'out', `needs Lv ${pair.requiredLevel}`));
      return;
    }

    button.disabled = true;
    button.append(el('span', 'verb', 'Transmute'));
    button.append(
      el('span', 'out', !orb.leftOrb || !orb.rightOrb ? 'fill both orbs' : 'no reaction'),
    );
  }

  setGatherTarget(material: MaterialId | null): void {
    if (material === this.gatherTarget) return;
    this.gatherTarget = material;

    this.gatherBtn.classList.toggle('on', material !== null);
    if (!material) return;

    this.setIcon(this.gatherIcon, material, 30);
    this.gatherName.textContent = this.content.material(material).name;
  }

  // ---------------------------------------------------------------- sheets

  private openSheet(title: string, build: SheetBuilder): void {
    this.sheetTitle.textContent = title;
    this.openBuilder = build;
    this.sheetBody.replaceChildren();
    build(this.sheetBody);
    this.sheet.classList.add('on');
    this.scrim.classList.add('on');
    this.sheetBody.scrollTop = 0;
  }

  closeSheet(): void {
    this.sheet.classList.remove('on');
    this.scrim.classList.remove('on');
    this.openBuilder = null;
  }

  get sheetOpen(): boolean {
    return this.sheet.classList.contains('on');
  }

  /** Re-run the open sheet's builder. Used after an action changes its contents. */
  private orbRef: OrbContainer | null = null;

  bind(orb: OrbContainer): void {
    this.orbRef = orb;
  }

  private requireOrb(): OrbContainer {
    if (!this.orbRef) throw new Error('Ui.bind(orb) was never called');
    return this.orbRef;
  }

  openPack(): void {
    this.openSheet('Pack', (body) => {
      const orb = this.requireOrb();
      const items = orb.packContents();

      if (items.length === 0) {
        body.append(el('div', 'empty', 'Nothing stowed yet. Gather materials, then transmute them - results land here.'));
        return;
      }

      body.append(el('p', 'note', 'Tap an item to load it into a free orb.'));
      const grid = el('div', 'grid');

      for (const { material, count } of items) {
        const def = this.content.material(material);
        const cell = el('button', 'cell');
        cell.append(this.icon(material, 38), el('span', 'nm', def.name), el('span', 'ct', String(count)));
        const full = orb.leftOrb !== null && orb.rightOrb !== null;
        if (full) cell.classList.add('dim');
        cell.addEventListener('click', () => this.callbacks.onLoadFromPack(material));
        grid.append(cell);
      }
      body.append(grid);
    });
  }

  openAlchemy(): void {
    this.openSheet('Alchemy', (body) => {
      const orb = this.requireOrb();

      if (!orb.alchemyUnlocked) {
        body.append(
          el('div', 'empty', `Alchemy unlocks at level ${this.content.progression.alchemyUnlockLevel}.`),
        );
        return;
      }

      const pool = orb.state.elementPool;
      const held = Object.entries(pool).filter(([, count]) => count > 0);

      const poolBox = el('div', 'chips');
      if (held.length === 0) {
        body.append(
          el('div', 'empty', 'Your element pool is empty. Put a material in an orb and press ⚗ to break it down.'),
        );
      } else {
        for (const [element, count] of held) poolBox.append(this.elementChip(element, count));
        body.append(el('p', 'note', 'Element pool'), poolBox);
      }

      const recipes = this.content.alchemy.filter((r) => r.requiredLevel <= orb.playerLevel);
      if (recipes.length === 0) {
        body.append(el('div', 'empty', 'No alchemy recipes are within your level yet.'));
        return;
      }

      body.append(el('p', 'note', 'Recipes'));
      for (const recipe of recipes) {
        const affordable = orb.canAfford(recipe);
        const def = this.content.material(recipe.result);

        const row = el('div', affordable ? 'row-item' : 'row-item dim');
        row.append(this.icon(recipe.result, 36));

        const meta = el('div', 'meta');
        meta.append(el('b', undefined, def.name));
        const chips = el('div', 'chips');
        const missing = shortfall(recipe, pool);
        for (const [element, count] of Object.entries(recipe.requires)) {
          chips.append(this.elementChip(element, count, (missing[element] ?? 0) > 0));
        }
        meta.append(chips);
        row.append(meta);

        const go = el('button', 'go', 'Brew');
        go.disabled = !affordable;
        go.addEventListener('click', () => this.callbacks.onAlchemize(recipe));
        row.append(go);

        body.append(row);
      }
    });
  }

  openZones(): void {
    this.openSheet('Travel', (body) => {
      const orb = this.requireOrb();
      for (const zone of this.content.zones) {
        const unlocked = zone.requiredLevel <= orb.playerLevel;
        const current = zone.id === orb.state.zoneId;

        const row = el('div', unlocked ? 'row-item' : 'row-item dim');
        const meta = el('div', 'meta');
        meta.append(el('b', undefined, zone.name));
        meta.append(
          el('span', undefined, unlocked ? zone.description : `Unlocks at level ${zone.requiredLevel}`),
        );
        row.append(meta);

        const go = el('button', 'go', current ? 'Here' : 'Go');
        go.disabled = !unlocked || current;
        go.addEventListener('click', () => this.callbacks.onTravel(zone.id));
        row.append(go);

        body.append(row);
      }
    });
  }

  openCodex(): void {
    this.openSheet('Codex', (body) => {
      const orb = this.requireOrb();

      const tabs = el('div', 'tabs');
      tabs.style.padding = '0 0 12px';
      const makeTab = (key: typeof this.codexTab, label: string) => {
        const button = el('button', this.codexTab === key ? 'on' : undefined, label);
        button.addEventListener('click', () => {
          this.codexTab = key;
          this.openCodex();
        });
        return button;
      };
      tabs.append(
        makeTab('materials', 'Materials'),
        makeTab('transmutation', 'Transmutation'),
        makeTab('alchemy', 'Alchemy'),
      );
      body.append(tabs);

      if (this.codexTab === 'materials') {
        const seen = orb.state.seenMaterials;
        body.append(el('p', 'note', `${seen.size} of ${this.content.materials.length} materials seen.`));
        const grid = el('div', 'grid');
        for (const material of this.content.materials) {
          const known = seen.has(material.id);
          const cell = el('div', known ? 'cell' : 'cell dim');
          if (known) {
            cell.append(this.icon(material.id, 38), el('span', 'nm', material.name));
            const count = orb.countOf(material.id);
            if (count > 0) cell.append(el('span', 'ct', String(count)));
          } else {
            cell.append(el('span', 'nm', '???'));
            cell.style.minHeight = '68px';
          }
          grid.append(cell);
        }
        body.append(grid);
        return;
      }

      if (this.codexTab === 'transmutation') {
        const known = this.content.transmutation.filter((r) => orb.state.discovered.has(r.id));
        body.append(
          el('p', 'note', `${known.length} of ${this.content.transmutation.length} transmutations discovered.`),
        );
        for (const recipe of this.content.transmutation) {
          const found = orb.state.discovered.has(recipe.id);
          const row = el('div', found ? 'row-item' : 'row-item dim');
          if (found) {
            row.append(this.icon(recipe.result, 36));
            const meta = el('div', 'meta');
            meta.append(el('b', undefined, this.content.material(recipe.result).name));
            meta.append(
              el(
                'span',
                undefined,
                `${this.content.material(recipe.a).name} + ${this.content.material(recipe.b).name}`,
              ),
            );
            row.append(meta);
          } else {
            const meta = el('div', 'meta');
            meta.append(el('b', undefined, '?????'));
            meta.append(el('span', undefined, `unlocks at level ${recipe.requiredLevel}`));
            row.append(meta);
          }
          body.append(row);
        }
        return;
      }

      const known = this.content.alchemy.filter((r) => orb.state.discovered.has(r.id));
      body.append(el('p', 'note', `${known.length} of ${this.content.alchemy.length} alchemy recipes discovered.`));
      for (const recipe of this.content.alchemy) {
        const found = orb.state.discovered.has(recipe.id);
        const visible = found || recipe.requiredLevel <= orb.playerLevel;
        const row = el('div', found ? 'row-item' : 'row-item dim');
        if (visible) {
          row.append(this.icon(recipe.result, 36));
          const meta = el('div', 'meta');
          meta.append(el('b', undefined, this.content.material(recipe.result).name));
          const chips = el('div', 'chips');
          for (const [element, count] of Object.entries(recipe.requires)) {
            chips.append(this.elementChip(element, count));
          }
          meta.append(chips);
          row.append(meta);
        } else {
          const meta = el('div', 'meta');
          meta.append(el('b', undefined, '?????'));
          meta.append(el('span', undefined, `unlocks at level ${recipe.requiredLevel}`));
          row.append(meta);
        }
        body.append(row);
      }
    });
  }

  openMenu(): void {
    this.openSheet('Menu', (body) => {
      const orb = this.requireOrb();
      const { stats } = orb.state;

      const grid = el('div', 'stat-grid');
      const stat = (value: number, label: string) => {
        const box = el('div', 'stat');
        box.append(el('b', undefined, String(value)), el('span', undefined, label));
        return box;
      };
      grid.append(
        stat(stats.gathered, 'gathered'),
        stat(stats.transmuted, 'transmuted'),
        stat(stats.decomposed, 'decomposed'),
        stat(stats.alchemized, 'alchemised'),
      );
      body.append(grid);

      body.append(
        el(
          'p',
          'note',
          'Move with the left thumb - drag anywhere on the map. Walk near a node and tap Gather. Fill both orbs to transmute. Progress saves to this device automatically.',
        ),
      );

      const reset = el('button', 'danger', 'Erase save and start over');
      reset.addEventListener('click', () => {
        if (confirm('Erase your save? This cannot be undone.')) this.callbacks.onReset();
      });
      body.append(reset);
    });
  }

  // ---------------------------------------------------------------- toasts

  toast(text: string, tone: 'info' | 'good' | 'bad' | 'big' = 'info'): void {
    const node = el('div', `toast ${tone}`, text);
    this.toasts.append(node);

    // Cap the stack so a rapid burst can't fill the screen.
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();

    window.setTimeout(() => {
      node.style.transition = 'opacity 0.3s ease';
      node.style.opacity = '0';
      window.setTimeout(() => node.remove(), 320);
    }, tone === 'big' ? 2600 : 1700);
  }
}
