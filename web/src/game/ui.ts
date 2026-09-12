/**
 * DOM HUD: top bar, gather prompt, orb bar, nav, and the bottom sheets
 * (pack / alchemy / codex / zones / menu).
 *
 * Kept apart from the canvas renderer on purpose - text, scrolling lists and
 * tap targets are things the browser is already good at, and native scrolling
 * feels far better on a phone than anything hand-rolled into a canvas.
 */
import { drawIcon } from './icons';
import { findRecipeForSelection, selectionSize, shortfall } from '../core/alchemy';
import { levelProgress, xpAtLevelStart, xpAtNextLevel } from '../core/progression';
import type { Content } from '../core/content';
import type { OrbContainer } from '../core/orbContainer';
import type { AlchemyRecipe, ElementId, Hand, MaterialId, ZoneId } from '../core/types';

export type ActionMode = 'attack' | 'gather' | 'idle';

export interface UiCallbacks {
  /** The single context action button: attacks if it can, otherwise gathers. */
  onAction: () => void;
  onSkipTutorial: () => void;
  onReplayTutorial: () => void;
  onBenchOpened: () => void;
  onGather: () => void;
  onTransmute: () => void;
  onUnloadOrb: (hand: Hand) => void;
  onDecomposeOrb: (hand: Hand) => void;
  onLoadFromPack: (material: MaterialId) => void;
  /** Bench: put a material into a specific slot, replacing what's there. */
  onPlaceInSlot: (hand: Hand, material: MaterialId) => void;
  onAlchemize: (recipe: AlchemyRecipe) => void;
  /** Table: mix a hand-picked set of elements. */
  onMixSelection: (selection: Record<ElementId, number>) => void;
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
  private readonly actionBtn: HTMLButtonElement;
  private readonly actionGlyph: HTMLElement;
  private readonly actionLabel: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectiveTitle: HTMLElement;
  private readonly objectiveHint: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;

  private readonly zoneName: HTMLElement;
  private readonly zoneSub: HTMLElement;
  private readonly levelNum: HTMLElement;
  private readonly xpText: HTMLElement;
  private readonly xpFill: HTMLElement;

  private readonly orbEls: Record<Hand, { root: HTMLElement; icon: HTMLElement; name: HTMLElement }>;
  private readonly craftBtn: HTMLButtonElement;
  private readonly navAlchemy: HTMLButtonElement;

  private readonly scrim: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly toasts: HTMLElement;

  private openBuilder: SheetBuilder | null = null;
  private actionMode: ActionMode = 'idle';
  private shownHp = -1;
  private shownMaxHp = -1;
  private actionSubject: string | null = null;
  private codexTab: 'materials' | 'transmutation' | 'alchemy' = 'materials';

  /** Which bench slot the next tapped material goes into. */
  private benchSlot: Hand = 'left';
  /** Elements the player has dialled up on the alchemy table, not yet spent. */
  private mix: Record<ElementId, number> = {};

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

    // -------------------------------------------------------------- vitals
    const vitals = el('div', 'vitals');
    vitals.dataset.ui = '';
    this.hpFill = el('i');
    const hpBar = el('div', 'hpbar');
    hpBar.append(this.hpFill);
    this.hpText = el('span', 'hptext', '');
    vitals.append(hpBar, this.hpText);

    // -------------------------------------------------------------- guide banner
    this.objective = el('div', 'objective');
    this.objective.dataset.ui = '';
    this.objective.hidden = true;
    this.objectiveTitle = el('b');
    this.objectiveHint = el('span');
    const skipGuide = el('button', 'oskip', 'Skip');
    skipGuide.setAttribute('aria-label', 'Skip the guide');
    skipGuide.addEventListener('click', () => this.callbacks.onSkipTutorial());
    const objectiveText = el('div', 'otext');
    objectiveText.append(this.objectiveTitle, this.objectiveHint);
    this.objective.append(objectiveText, skipGuide);

    // -------------------------------------------------------------- action button
    const actionWrap = el('div', 'action-wrap');
    actionWrap.dataset.ui = '';
    this.actionBtn = el('button', 'action');
    this.actionGlyph = el('span', 'aglyph', '');
    this.actionLabel = el('span', 'alabel', '');
    this.actionBtn.append(this.actionGlyph, this.actionLabel);
    this.actionBtn.addEventListener('click', () => this.callbacks.onAction());
    actionWrap.append(this.actionBtn);

    // -------------------------------------------------------------- orb bar
    const orbbar = el('div', 'orbbar');
    orbbar.dataset.ui = '';
    this.orbEls = {
      left: this.buildOrbChip('left'),
      right: this.buildOrbChip('right'),
    };

    this.craftBtn = el('button', 'craft');
    this.craftBtn.addEventListener('click', () => this.callbacks.onTransmute());
    orbbar.append(this.orbEls.left.root, this.craftBtn, this.orbEls.right.root);

    // -------------------------------------------------------------- nav
    const nav = el('div', 'nav');
    nav.dataset.ui = '';
    const navPack = this.buildNav('Bench', '▤', () => this.openBench());
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

    root.append(topbar, vitals, this.objective, this.toasts, actionWrap, orbbar, nav, this.scrim, this.sheet);
  }

  private buildNav(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = el('button');
    button.append(el('span', 'ico', icon), el('span', undefined, label));
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * A compact orb chip. The unload and decompose actions moved into the bench:
   * on a landscape phone the old card plus its two small buttons took a third of the
   * screen, and both actions already have room in the sheet.
   */
  private buildOrbChip(hand: Hand) {
    const root = el('button', 'orbchip');
    const icon = el('span', 'oicon');
    const name = el('span', 'onm', 'empty');
    root.title = hand === 'left' ? 'Left orb' : 'Right orb';
    root.append(icon, name);
    root.addEventListener('click', () => {
      this.benchSlot = hand;
      this.openBench();
    });
    return { root, icon, name };
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
      this.setIcon(ui.icon, material, 30);
      ui.name.textContent = material ? this.content.material(material).name : 'empty';
    }

    this.setVitals(orb.state.vitals.hp, orb.state.vitals.maxHp);

    this.refreshCraftButton(orb);

    this.navAlchemy.disabled = !orb.alchemyUnlocked;
    const brewable = orb.alchemyUnlocked && orb.getAvailableAlchemyRecipes().length > 0;
    this.navAlchemy.querySelector('.dot')?.remove();
    if (brewable) this.navAlchemy.append(el('span', 'dot'));

    // A sheet left open (the bench, say) must follow the state that changed under it.
    if (this.openBuilder && this.sheet.classList.contains('on')) this.rebuildSheet();
  }

  /**
   * Health, updated every frame. Kept apart from refresh() because that rebuilds
   * icons and any open sheet: health changes far too often to pay for that, and
   * before this split the bar only moved when some unrelated event forced a
   * refresh, so it sat a hit behind the damage it was meant to show.
   */
  /** Show the current guide step, or pass null to clear the banner. */
  setObjective(step: { title: string; hint: string } | null): void {
    if (!step) {
      this.objective.hidden = true;
      return;
    }
    this.objectiveTitle.textContent = step.title;
    this.objectiveHint.textContent = step.hint;
    this.objective.hidden = false;
  }

  setVitals(hp: number, maxHp: number): void {
    const shown = Math.ceil(Math.max(0, hp));
    if (shown === this.shownHp && maxHp === this.shownMaxHp) return;
    this.shownHp = shown;
    this.shownMaxHp = maxHp;

    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    this.hpFill.style.width = `${ratio * 100}%`;
    this.hpFill.classList.toggle('low', ratio <= 0.3);
    this.hpText.textContent = `${shown}/${maxHp}`;
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

  /** Empty the alchemy tray, after a successful mix consumes it. */
  clearMix(): void {
    this.mix = {};
    if (this.sheetOpen) this.rebuildSheet();
  }

  /**
   * Drive the one context button. Attack wins over gather whenever an enemy is
   * in reach, so a fight is never lost to picking up a stick by mistake.
   */
  setAction(mode: ActionMode, subject: string | null): void {
    if (mode === this.actionMode && subject === this.actionSubject) return;
    this.actionMode = mode;
    this.actionSubject = subject;

    this.actionBtn.classList.toggle('attack', mode === 'attack');
    this.actionBtn.classList.toggle('gather', mode === 'gather');
    this.actionBtn.disabled = mode === 'idle';

    if (mode === 'attack') {
      this.actionGlyph.textContent = '⚔';
      this.actionLabel.textContent = subject ?? 'Attack';
      this.actionBtn.setAttribute('aria-label', `Attack ${subject ?? ''}`.trim());
    } else if (mode === 'gather') {
      this.actionGlyph.textContent = '✋';
      this.actionLabel.textContent = subject ?? 'Gather';
      this.actionBtn.setAttribute('aria-label', `Gather ${subject ?? ''}`.trim());
    } else {
      // Still show a real glyph when there is nothing in range: an empty circle
      // reads as a broken button rather than an idle one.
      this.actionGlyph.textContent = '◎';
      this.actionLabel.textContent = 'nothing near';
      this.actionBtn.setAttribute('aria-label', 'No action available');
    }
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

  /**
   * Re-run the open sheet's builder in place, preserving scroll position.
   * The bench and the alchemy table both hold selection state that changes on
   * every tap, and rebuilding is simpler to keep correct than patching nodes.
   */
  private rebuildSheet(): void {
    if (!this.openBuilder) return;
    const scroll = this.sheetBody.scrollTop;
    this.sheetBody.replaceChildren();
    this.openBuilder(this.sheetBody);
    this.sheetBody.scrollTop = scroll;
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

  /**
   * The transmutation bench: both orb slots and everything you are carrying, in
   * one view. Tap a slot to target it, tap a material to place it there -
   * replacing whatever was in it, which goes back to the pack.
   */
  openBench(): void {
    this.callbacks.onBenchOpened();
    this.openSheet('Transmutation Bench', (body) => {
      const orb = this.requireOrb();

      // ---- the two slots, plus what they would make
      const slots = el('div', 'bench');
      for (const hand of ['left', 'right'] as Hand[]) {
        const material = orb.orb(hand);
        const slot = el('button', 'bslot');
        slot.classList.toggle('sel', this.benchSlot === hand);
        slot.classList.toggle('filled', material !== null);
        slot.setAttribute('aria-pressed', String(this.benchSlot === hand));

        const iconBox = el('span', 'bicon');
        this.setIcon(iconBox, material, 46);
        slot.append(
          el('span', 'blabel', hand === 'left' ? 'Left orb' : 'Right orb'),
          iconBox,
          el('span', 'bname', material ? this.content.material(material).name : 'empty'),
        );
        slot.addEventListener('click', () => {
          this.benchSlot = hand;
          this.rebuildSheet();
        });
        slots.append(slot);
      }
      body.append(slots);

      // ---- what you can do to the targeted slot
      // These moved off the HUD chips: two 30px buttons per orb ate a third of a
      // landscape screen for actions nobody takes mid-fight.
      const selected = orb.orb(this.benchSlot);
      const acts = el('div', 'bacts');
      const unload = el('button', 'ghost', 'Unload to pack');
      unload.disabled = selected === null;
      unload.addEventListener('click', () => {
        this.callbacks.onUnloadOrb(this.benchSlot);
        this.rebuildSheet();
      });
      const decompose = el('button', 'ghost', 'Decompose');
      decompose.disabled = selected === null;
      decompose.addEventListener('click', () => {
        this.callbacks.onDecomposeOrb(this.benchSlot);
        this.rebuildSheet();
      });
      acts.append(unload, decompose);
      body.append(acts);

      // ---- result preview
      const recipe = orb.peekTransmutation();
      const locked =
        !recipe && orb.leftOrb && orb.rightOrb
          ? this.content.recipeByPair(orb.leftOrb, orb.rightOrb)
          : undefined;

      const out = el('div', 'boutcome');
      if (recipe) {
        out.classList.add('ok');
        const icon = el('span');
        this.setIcon(icon, recipe.result, 34);
        out.append(icon);
        const meta = el('div', 'meta');
        meta.append(el('b', undefined, this.content.material(recipe.result).name));
        meta.append(el('span', undefined, `+${recipe.xp} XP on discovery`));
        out.append(meta);
        const go = el('button', 'go', 'Transmute');
        go.addEventListener('click', () => this.callbacks.onTransmute());
        out.append(go);
      } else if (locked) {
        out.classList.add('locked');
        out.append(el('b', undefined, `Locked — needs level ${locked.requiredLevel}`));
      } else if (orb.leftOrb && orb.rightOrb) {
        out.append(el('b', undefined, 'No reaction between these two.'));
      } else {
        out.append(el('b', undefined, 'Fill both orbs to see what they make.'));
      }
      body.append(out);

      // ---- carried materials
      const items = orb.packContents();
      body.append(
        el(
          'p',
          'note',
          items.length === 0
            ? 'You are carrying nothing yet.'
            : `Carrying ${items.length} kind${items.length === 1 ? '' : 's'} — tap one to place it in the ${this.benchSlot} orb.`,
        ),
      );

      if (items.length === 0) {
        body.append(
          el('div', 'empty', 'Gather materials in the world. Anything you craft lands here too.'),
        );
        return;
      }

      const grid = el('div', 'grid');
      for (const { material, count } of items) {
        const def = this.content.material(material);
        const cell = el('button', 'cell');
        cell.append(this.icon(material, 38), el('span', 'nm', def.name));
        // Only badge a stack: a lone item needs no "1" cluttering the grid.
        if (count > 1) cell.append(el('span', 'ct', String(count)));
        if (orb.orb(this.benchSlot) === material) cell.classList.add('here');
        cell.addEventListener('click', () => this.callbacks.onPlaceInSlot(this.benchSlot, material));
        grid.append(cell);
      }
      body.append(grid);
    });
  }

  /**
   * The alchemy table: every element laid out like a periodic table, those you
   * actually hold lit up. Dial quantities to mix a combination by hand, or pick
   * a known recipe from the list below to fill the selection in one tap.
   */
  openAlchemy(): void {
    this.openSheet('Alchemy Table', (body) => {
      const orb = this.requireOrb();

      if (!orb.alchemyUnlocked) {
        body.append(
          el('div', 'empty', `Alchemy unlocks at level ${this.content.progression.alchemyUnlockLevel}. Break a material down with ⚗ once it does.`),
        );
        return;
      }

      const pool = orb.state.elementPool;

      // ---- the table
      const cols = Math.max(...this.content.elements.map((e) => e.col));
      const rows = Math.max(...this.content.elements.map((e) => e.row));
      const table = el('div', 'ptable');
      table.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

      for (const element of this.content.elements) {
        const held = pool[element.id] ?? 0;
        const picked = this.mix[element.id] ?? 0;

        const cell = el('button', 'pcell');
        cell.style.gridRow = String(element.row);
        cell.style.gridColumn = String(element.col);
        cell.classList.toggle('has', held > 0);
        cell.classList.toggle('picked', picked > 0);
        cell.style.setProperty('--el', element.color);

        cell.append(
          el('span', 'pnum', String(element.number)),
          el('span', 'psym', element.symbol),
          el('span', 'pname', element.name),
          el('span', 'pheld', held > 0 ? `${picked}/${held}` : '—'),
        );

        cell.disabled = held === 0;
        cell.title = held > 0 ? `${element.name} — ${held} held` : `${element.name} — none held`;
        cell.addEventListener('click', () => {
          const have = pool[element.id] ?? 0;
          const next = ((this.mix[element.id] ?? 0) + 1) % (have + 1);
          if (next === 0) delete this.mix[element.id];
          else this.mix[element.id] = next;
          this.rebuildSheet();
        });
        table.append(cell);
      }
      // Fill the grid's empty cells so the stepped shape reads as deliberate.
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          if (this.content.elements.some((e) => e.row === r && e.col === c)) continue;
          const gap = el('span', 'pgap');
          gap.style.gridRow = String(r);
          gap.style.gridColumn = String(c);
          table.append(gap);
        }
      }
      body.append(table);

      // ---- the mixing tray
      const size = selectionSize(this.mix);
      const match = findRecipeForSelection(this.content, this.mix, orb.playerLevel);
      const tray = el('div', 'tray');
      tray.classList.toggle('ok', match !== null);

      const chips = el('div', 'chips');
      const entries = Object.entries(this.mix).filter(([, q]) => q > 0);
      if (entries.length === 0) {
        chips.append(el('span', 'trayhint', 'Tap elements above to add them. Tap again to add more, or past your total to clear.'));
      } else {
        for (const [element, qty] of entries) chips.append(this.elementChip(element, qty));
      }
      tray.append(chips);

      const trayBar = el('div', 'traybar');
      const status = el('span', 'traystatus');
      if (size === 0) status.textContent = 'Nothing selected';
      else if (match) status.textContent = `Forms ${this.content.material(match.result).name}`;
      else status.textContent = `${size} element${size === 1 ? '' : 's'} — unknown combination`;
      trayBar.append(status);

      const clear = el('button', 'ghost', 'Clear');
      clear.disabled = size === 0;
      clear.addEventListener('click', () => {
        this.mix = {};
        this.rebuildSheet();
      });

      const mixBtn = el('button', 'go', 'Combine');
      mixBtn.disabled = size === 0;
      mixBtn.addEventListener('click', () => {
        this.callbacks.onMixSelection({ ...this.mix });
      });
      trayBar.append(clear, mixBtn);
      tray.append(trayBar);
      body.append(tray);

      // ---- known recipes
      const known = this.content.alchemy.filter(
        (r) => r.requiredLevel <= orb.playerLevel && orb.state.discovered.has(r.id),
      );
      body.append(
        el('p', 'note', known.length === 0 ? 'No recipes discovered yet — mix and find out.' : 'Discovered recipes'),
      );

      for (const recipe of known) {
        const affordable = orb.canAfford(recipe);
        const row = el('div', affordable ? 'row-item' : 'row-item dim');
        row.append(this.icon(recipe.result, 36));

        const meta = el('div', 'meta');
        meta.append(el('b', undefined, this.content.material(recipe.result).name));
        const rchips = el('div', 'chips');
        const missing = shortfall(recipe, pool);
        for (const [element, count] of Object.entries(recipe.requires)) {
          rchips.append(this.elementChip(element, count, (missing[element] ?? 0) > 0));
        }
        meta.append(rchips);
        row.append(meta);

        const load = el('button', 'go', 'Load');
        load.title = 'Put this recipe into the tray';
        load.addEventListener('click', () => {
          this.mix = { ...recipe.requires };
          this.rebuildSheet();
        });
        row.append(load);
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
        stat(stats.slain, 'slain'),
        stat(stats.deaths, 'deaths'),
      );
      body.append(grid);

      body.append(
        el(
          'p',
          'note',
          'Drag on the left of the screen to walk. The button on the right does whatever is ' +
            'closest: it swings at an enemy in reach, otherwise it picks up what you are standing ' +
            'by. Carrying a weapon makes you hit harder - there is no equip slot. Fill both orbs ' +
            'to transmute. Progress saves to this device automatically.',
        ),
      );

      const replay = el('button', 'ghost wide', 'Replay the opening guide');
      replay.addEventListener('click', () => {
        this.callbacks.onReplayTutorial();
        this.closeSheet();
      });
      body.append(replay);

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
