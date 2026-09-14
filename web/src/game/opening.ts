/**
 * The waking scene.
 *
 * Canon opens with the player coming round at the centre of an arena they did
 * not choose, with no memory and no explanation - so the run starts on black,
 * fades up onto the Coliseum, and says three true things before handing over to
 * the guide. It deliberately withholds why.
 *
 * Timing is driven from the game loop rather than from CSS transitions and
 * timers: the loop already owns the clock, so the scene cannot drift out of
 * step with a paused world, and a test can step it deterministically.
 *
 * It holds the world still while it runs, which makes it the one thing on
 * screen that can strand a player if it goes wrong. Hence: a tap skips it, the
 * durations are validated at build time, and finishing is a single path that
 * runs whether it ended on its own or was skipped.
 */
import type { OpeningScript } from '../core/types';

/** How long the last line takes to clear once the script is done. */
const TAIL_SECONDS = 0.7;
/** Of each line's slot, the share spent fading in and out. */
const LINE_IN = 0.34;
const LINE_OUT = 0.26;
/** How dark the world stays behind the text, once the opening fade is done. */
const RESTING_SCRIM = 0.46;

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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class OpeningScene {
  private readonly root: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly lineHost: HTMLElement;
  private readonly skipHint: HTMLElement;

  private script: OpeningScript | null = null;
  private elapsed = 0;
  private onDone: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'opening');
    // Marked as UI so the floating stick is not placed by the tap that skips.
    this.root.dataset.ui = '';
    this.root.hidden = true;

    this.scrim = el('div', 'oscrim');
    this.lineHost = el('p', 'oline');
    this.skipHint = el('span', 'oskip', 'tap to skip');

    this.root.append(this.scrim, this.lineHost, this.skipHint);
    this.root.addEventListener('pointerdown', () => this.skip());
    host.append(this.root);
  }

  /** True while the scene owns the screen - the game loop holds still for it. */
  get active(): boolean {
    return this.script !== null;
  }

  play(script: OpeningScript, onDone: () => void): void {
    // An empty script is a no-op rather than a black screen nobody can leave.
    if (script.lines.length === 0) {
      onDone();
      return;
    }
    this.script = script;
    this.onDone = onDone;
    this.elapsed = 0;
    this.root.hidden = false;
    this.lineHost.textContent = script.lines[0] ?? '';
    this.render();
  }

  update(dt: number): void {
    const script = this.script;
    if (!script) return;
    this.elapsed += dt;
    if (this.elapsed >= script.lineSeconds * script.lines.length + TAIL_SECONDS) {
      this.finish();
      return;
    }
    this.render();
  }

  skip(): void {
    if (this.script) this.finish();
  }

  private finish(): void {
    const done = this.onDone;
    this.script = null;
    this.onDone = null;
    this.root.hidden = true;
    this.scrim.style.opacity = '0';
    this.lineHost.style.opacity = '0';
    // Cleared last: the callback starts the run, and anything it throws must
    // not leave the scene half-dismissed on top of a playable game.
    done?.();
  }

  private render(): void {
    const script = this.script;
    if (!script) return;

    // The fade from black runs underneath the first line rather than before it,
    // so the words arrive while the world is still resolving.
    const fade = clamp01(this.elapsed / script.fadeSeconds);
    this.scrim.style.opacity = String(1 - (1 - RESTING_SCRIM) * fade);

    const index = Math.min(script.lines.length - 1, Math.floor(this.elapsed / script.lineSeconds));
    const within = (this.elapsed - index * script.lineSeconds) / script.lineSeconds;
    const line = script.lines[index] ?? '';
    if (this.lineHost.textContent !== line) this.lineHost.textContent = line;

    let opacity = 1;
    if (within < LINE_IN) opacity = within / LINE_IN;
    else if (within > 1 - LINE_OUT) opacity = (1 - within) / LINE_OUT;
    this.lineHost.style.opacity = String(clamp01(opacity));

    // Offered only once the player has had a moment to see anything at all.
    this.skipHint.style.opacity = this.elapsed > script.lineSeconds * 0.6 ? '1' : '0';
  }
}
