/**
 * The screen at the end of a run.
 *
 * Built on the same idea as the waking scene at the other end: it holds the
 * world, it is driven from the game loop rather than from CSS timers, and
 * there is exactly one way out of it. Where the opening fades UP out of black
 * onto the Coliseum, this one fades down out of it - and then hands the player
 * a page of text they can sit with rather than a line that times out, because
 * the thing they have just done took them an hour to get to.
 *
 * Which page it is depends on how much of Jakindur's channel they found. The
 * game never says which of the three they got.
 */
import type { Epilogue } from '../core/ending';

/** How long the world takes to go white and then dark behind the text. */
const FLASH_SECONDS = 0.9;
const SETTLE_SECONDS = 1.6;

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

export class EndingScene {
  private readonly root: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly card: HTMLElement;

  private elapsed = 0;
  private running = false;
  private onDone: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'ending');
    this.root.dataset.ui = '';
    this.root.hidden = true;
    this.flash = el('div', 'eflash');
    this.card = el('div', 'ecard');
    this.root.append(this.flash, this.card);
    host.append(this.root);
  }

  /** True while it owns the screen; the game loop holds still for it. */
  get active(): boolean {
    return this.running;
  }

  play(epilogue: Epilogue, summary: string, onDone: () => void): void {
    this.running = true;
    this.onDone = onDone;
    this.elapsed = 0;
    this.root.hidden = false;

    this.card.replaceChildren();
    this.card.style.opacity = '0';
    this.card.append(el('h1', undefined, epilogue.title));
    // Paragraph breaks are authored in the content as blank lines, because the
    // difference between three paragraphs and one wall of text is most of
    // whether anybody reads it.
    for (const para of epilogue.text.split('\n\n')) {
      if (para.trim()) this.card.append(el('p', undefined, para.trim()));
    }
    this.card.append(el('p', 'esummary', summary));

    const out = el('button', 'tbtn primary', 'Close');
    out.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.finish();
    });
    out.addEventListener('click', () => this.finish());
    this.card.append(out);

    this.render();
  }

  update(dt: number): void {
    if (!this.running) return;
    this.elapsed += dt;
    this.render();
  }

  private finish(): void {
    if (!this.running) return;
    const done = this.onDone;
    this.running = false;
    this.onDone = null;
    this.root.hidden = true;
    this.card.replaceChildren();
    done?.();
  }

  private render(): void {
    // White, then down to black: a rendering coming apart, seen from inside.
    const flash = Math.max(0, 1 - this.elapsed / FLASH_SECONDS);
    this.flash.style.background = `rgba(255,255,255,${flash.toFixed(3)})`;
    const dark = Math.min(1, this.elapsed / SETTLE_SECONDS);
    // Near-opaque rather than 0.93: at 0.93 the title screen's own headline
    // ghosted through behind the epilogue, which is a distracting thing to put
    // under the one page of text the game wants read carefully.
    this.root.style.background = `rgba(6,5,10,${(dark * 0.985).toFixed(3)})`;
    // The text arrives after the flash has gone, not under it.
    this.card.style.opacity = String(Math.max(0, Math.min(1, (this.elapsed - FLASH_SECONDS) / 0.8)));
  }
}
