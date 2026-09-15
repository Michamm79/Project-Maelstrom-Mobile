/**
 * Which way up the game sits, and how much world it shows.
 *
 * Two player-facing settings live here because they are the same problem: the
 * shape of the box the game is drawn into.
 *
 * ## Landscape
 *
 * There is no single web API that turns a phone sideways, so this tries three
 * things in order of how well they work, and the first one that takes wins:
 *
 * 1. `screen.orientation.lock('landscape')`. The real thing - the OS rotates
 *    and every inset, keyboard and system bar comes along with it. It needs a
 *    user gesture and either fullscreen or an installed app, and Safari does
 *    not implement it at all.
 * 2. Fullscreen first, then the same lock. That is the Android-browser path.
 * 3. Rotating the app box ourselves with a transform.
 *
 * Only the third works on an iPhone, and - the case that actually matters -
 * only the third works on ANY phone whose owner has rotation lock switched on,
 * which is the one situation where "just turn your phone" is not advice, it is
 * a dead end. So it is a real fallback rather than a nicety, and everything
 * downstream has to cope with it: `toLocal` is the whole reason this class is
 * passed around rather than being a few lines in main.ts.
 *
 * The rotation is decided from the VIEWPORT, never from the element's own box.
 * Reading back a box we just resized is how this kind of code ends up
 * oscillating between two states forever inside a ResizeObserver.
 *
 * ## View size
 *
 * The camera anchors its zoom to the longer screen axis, so the span below is
 * how much world that axis shows and the short axis follows from the aspect
 * ratio. It is a setting rather than a constant because "cramped" depends on
 * the phone and the eyes: the same 900 that is comfortable on a 6.7" screen is
 * not on a 5.4" one.
 */

export type Turn = 'cw' | 'ccw';
export type ViewSize = 'close' | 'normal' | 'wide';

/**
 * World units across the long screen axis.
 *
 * `normal` was 700, which put 700x315 units on a phone held sideways and made
 * the playfield a letterbox with a character 63px tall standing in it. 900
 * shows about two thirds more ground in each direction and still draws the
 * character at 49px, which is above the 44px a tap target is allowed to be.
 */
export const VIEW_SPANS: Record<ViewSize, number> = {
  close: 760,
  normal: 900,
  wide: 1080,
};

export const VIEW_ORDER: ViewSize[] = ['close', 'normal', 'wide'];

export const VIEW_LABELS: Record<ViewSize, string> = {
  close: 'Close',
  normal: 'Normal',
  wide: 'Wide',
};

interface Prefs {
  /** Present the game horizontally, by whatever means the device allows. */
  landscape: boolean;
  /** Which way the player turns the phone, when we are rotating it ourselves. */
  turn: Turn;
  view: ViewSize;
}

const STORAGE_KEY = 'maelstrom.screen.v1';

const DEFAULTS: Prefs = { landscape: true, turn: 'cw', view: 'normal' };

export interface Point {
  x: number;
  y: number;
}

/**
 * The shape and orientation of the game box, given a viewport and the prefs.
 *
 * Pure, and separated from the class, because this is the part that has to be
 * right: everything downstream - the backing store, the stick, which half of
 * the screen steers - is derived from it, and none of that is testable through
 * a DOM. The class is then only the part that writes it to elements.
 */
export interface BoxLayout {
  /** Null when the device is holding the game the right way up already. */
  rotate: Turn | null;
  width: number;
  height: number;
  /** Enough width to stop the HUD stretching across a tablet. */
  wide: boolean;
  /** Short and wide: every band of HUD costs twice what it does in portrait. */
  squat: boolean;
}

/**
 * @param touch whether this is a device someone holds. Turning the picture
 *   sideways only makes sense if the screen can be turned back: a desktop
 *   window that happens to be taller than it is wide - a docked inspector, a
 *   split screen - would otherwise get the game rotated 90 degrees with no way
 *   to read it.
 */
export function layoutFor(
  viewportWidth: number,
  viewportHeight: number,
  prefs: { landscape: boolean; turn: Turn },
  nativeLock: boolean,
  touch = true,
): BoxLayout {
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  /*
   * Decided from the VIEWPORT, never from the element's own box.
   *
   * The box is the thing we are about to resize; reading it back to decide
   * whether to resize it is how this kind of code ends up flipping between two
   * states forever inside a ResizeObserver.
   */
  const rotate = prefs.landscape && vh > vw && !nativeLock && touch ? prefs.turn : null;
  const width = rotate ? vh : vw;
  const height = rotate ? vw : vh;
  return { rotate, width, height, wide: width >= 720, squat: height <= 560 && width > height };
}

/**
 * A viewport point, in the box's own coordinates.
 *
 * Derived from the transform rather than measured. A rotated element's bounding
 * rect is its axis-aligned cover, so subtracting it - which is what the stick
 * used to do - silently swaps the axes: dragging left walks the player up.
 */
export function localPoint(clientX: number, clientY: number, layout: BoxLayout): Point {
  // rotate(-90deg) translateX(-100%) maps (x, y) -> (y, width - x).
  if (layout.rotate === 'cw') return { x: layout.width - clientY, y: clientX };
  // rotate(90deg) translateY(-100%) maps (x, y) -> (height - y, x).
  if (layout.rotate === 'ccw') return { x: clientY, y: layout.height - clientX };
  // Upright, the box is pinned to the viewport's own origin, so the two
  // coordinate systems are the same numbers and there is nothing to subtract.
  return { x: clientX, y: clientY };
}

export class Screen {
  private prefs: Prefs = { ...DEFAULTS };
  private box: BoxLayout = { rotate: null, width: 1, height: 1, wide: false, squat: false };
  private readonly listeners = new Set<() => void>();
  /** Set once the OS has agreed to hold the device in landscape for us. */
  private nativeLock = false;
  /** Something with a thumb on it, as opposed to a window someone resized. */
  private get handheld(): boolean {
    return typeof matchMedia !== 'function' || matchMedia('(pointer: coarse)').matches;
  }

  constructor(private readonly app: HTMLElement) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        this.prefs = {
          landscape: parsed.landscape ?? DEFAULTS.landscape,
          turn: parsed.turn === 'ccw' ? 'ccw' : DEFAULTS.turn,
          view: parsed.view && parsed.view in VIEW_SPANS ? parsed.view : DEFAULTS.view,
        };
      }
    } catch {
      // Blocked or corrupt storage just means the defaults. Never worth a throw
      // on the path that decides whether the game is visible at all.
    }

    this.apply();
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('orientationchange', this.onViewportChange);
    // Entering or leaving fullscreen changes the viewport by the height of the
    // browser chrome, which changes the box we have to draw into.
    document.addEventListener('fullscreenchange', this.onViewportChange);
    // Fires on the real rotation, including one the OS performs because our own
    // lock request was granted a moment ago.
    globalThis.screen?.orientation?.addEventListener?.('change', this.onViewportChange);
  }

  // ------------------------------------------------------------- the state

  /** The box the game is drawn into, which is not the viewport once rotated. */
  get width(): number {
    return this.box.width;
  }

  get height(): number {
    return this.box.height;
  }

  get layout(): BoxLayout {
    return this.box;
  }

  /** World units across the long axis, from the player's view setting. */
  get span(): number {
    return VIEW_SPANS[this.prefs.view];
  }

  get view(): ViewSize {
    return this.prefs.view;
  }

  get landscape(): boolean {
    return this.prefs.landscape;
  }

  get turn(): Turn {
    return this.prefs.turn;
  }

  /**
   * True while we are holding the game sideways with a transform - which is
   * also the only time the turn direction means anything to the player, so it
   * is what the settings row keys off.
   */
  get selfRotated(): boolean {
    return this.box.rotate !== null;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------------------------------------------------------------- coords

  /**
   * A viewport point, in the game box's own coordinates.
   *
   * Every touch arrives in viewport space. Untransformed those are the same
   * numbers, which is why the old code could subtract a bounding rect and get
   * away with it - but a rotated element's bounding rect is its axis-aligned
   * cover, so the same arithmetic silently swaps the axes and the stick walks
   * the player sideways. Derived from the transform rather than measured.
   */
  toLocal(clientX: number, clientY: number): Point {
    return localPoint(clientX, clientY, this.box);
  }

  // --------------------------------------------------------------- setting

  setView(view: ViewSize): void {
    if (!(view in VIEW_SPANS) || view === this.prefs.view) return;
    this.prefs.view = view;
    this.save();
    this.notify();
  }

  /** Steps through close -> normal -> wide and back to close. */
  cycleView(): ViewSize {
    const next = VIEW_ORDER[(VIEW_ORDER.indexOf(this.prefs.view) + 1) % VIEW_ORDER.length];
    this.setView(next ?? 'normal');
    return this.prefs.view;
  }

  setLandscape(on: boolean): void {
    if (on === this.prefs.landscape) return;
    this.prefs.landscape = on;
    this.save();
    if (!on) this.releaseNative();
    this.apply();
  }

  setTurn(turn: Turn): void {
    if (turn === this.prefs.turn) return;
    this.prefs.turn = turn;
    this.save();
    this.apply();
  }

  flipTurn(): Turn {
    this.setTurn(this.prefs.turn === 'cw' ? 'ccw' : 'cw');
    return this.prefs.turn;
  }

  // ------------------------------------------------------------ the OS ask

  /**
   * Ask the device to hold itself in landscape. Must be called from a real
   * gesture, so it hangs off the title screen's buttons.
   *
   * Every step is best-effort and silent. A browser that refuses the lock, or
   * has never heard of it, leaves `apply()` to rotate the box instead - which
   * is a worse experience only in that the player has to turn the phone
   * themselves, and is the normal path on iOS.
   */
  async requestNative(): Promise<void> {
    if (!this.prefs.landscape || this.nativeLock) return;
    // Nothing here is wanted on a desktop, where the window is already wide and
    // taking it fullscreen would be an ambush.
    if (!this.handheld) return;

    const orientation = globalThis.screen?.orientation as
      | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
      | undefined;
    if (!orientation?.lock) return;

    try {
      await orientation.lock('landscape');
      this.nativeLock = true;
      this.apply();
      return;
    } catch {
      // Chrome refuses outside fullscreen, which is the common case in a tab.
    }

    /*
     * Fullscreen on the DOCUMENT, never on the app box.
     *
     * A fullscreen element gets UA styles that pin it to the viewport at 100%
     * by 100%, and those beat the inline width and height `apply()` wrote. The
     * measured result of fullscreening the box itself: it kept the rotation and
     * lost the landscape shape, so the game drew sideways inside a portrait
     * frame - worse than never having asked.
     */
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    } catch {
      // Declined. The transform fallback is already handling this case.
      this.apply();
      return;
    }

    try {
      await orientation.lock('landscape');
      this.nativeLock = true;
    } catch {
      // Landscape is genuinely unavailable here, so we are holding the whole
      // screen for nothing. Give it back rather than keeping the ground we took.
      await this.exitFullscreen();
    }
    this.apply();
  }

  private async exitFullscreen(): Promise<void> {
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // Already gone, or the browser is mid-transition. Either is fine.
    }
  }

  private releaseNative(): void {
    if (!this.nativeLock) return;
    this.nativeLock = false;
    try {
      globalThis.screen?.orientation?.unlock?.();
    } catch {
      // Unlocking a lock the browser has already dropped is not an error worth
      // surfacing to someone who just wanted their phone back.
    }
    // The fullscreen was only ever taken to get the lock, so it goes with it.
    void this.exitFullscreen();
  }

  // ---------------------------------------------------------------- layout

  private readonly onViewportChange = (): void => {
    this.apply();
  };

  /**
   * Size and orient the app box, then tell everyone.
   *
   * Written in explicit pixels rather than `100vh`/`100vw` because those two
   * units disagree with `innerHeight` by the height of a mobile browser's
   * collapsing address bar, and a rotated box that is 60px too tall puts the
   * attack button under the chrome.
   */
  private apply(): void {
    this.box = layoutFor(
      window.innerWidth,
      window.innerHeight,
      this.prefs,
      this.nativeLock,
      this.handheld,
    );
    const { rotate } = this.box;

    const style = this.app.style;
    if (rotate) {
      style.width = `${this.box.width}px`;
      style.height = `${this.box.height}px`;
      style.transformOrigin = '0 0';
      style.transform =
        rotate === 'cw' ? 'rotate(-90deg) translateX(-100%)' : 'rotate(90deg) translateY(-100%)';
      this.app.dataset.rot = rotate;
    } else {
      style.width = '';
      style.height = '';
      style.transformOrigin = '';
      style.transform = '';
      delete this.app.dataset.rot;
    }

    /*
     * The HUD's compact layouts used to key off `@media (orientation:
     * landscape)`, which asks the VIEWPORT - and the viewport is still portrait
     * while we are holding a landscape-shaped box inside it. So the shape the
     * stylesheet reacts to is published here instead, measured on the box the
     * HUD is actually laid out in. Identical to the media query when nothing is
     * rotated, which is what keeps this from being a second layout to maintain.
     */
    /*
     * The box's own size, as CSS units.
     *
     * `vw` and `vh` measure the VIEWPORT, which is the phone - and the phone is
     * still portrait while we hold a landscape box inside it. A `max-height:
     * 94vh` on the menu therefore came out as 94% of 915px inside a box 412px
     * tall, so the menu ran off the bottom of the screen and its tabs could not
     * be pressed. Anything inside the box that wants a fraction of the screen
     * has to ask these instead.
     */
    style.setProperty('--box-w', `${this.box.width}px`);
    style.setProperty('--box-h', `${this.box.height}px`);

    const root = document.documentElement;
    root.dataset.shape = this.box.width > this.box.height ? 'landscape' : 'portrait';
    if (this.box.wide) root.dataset.wide = '';
    else delete root.dataset.wide;
    if (this.box.squat) root.dataset.squat = '';
    else delete root.dataset.squat;

    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // Not persisting a preference is survivable; failing to set it is not.
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('orientationchange', this.onViewportChange);
    document.removeEventListener('fullscreenchange', this.onViewportChange);
    globalThis.screen?.orientation?.removeEventListener?.('change', this.onViewportChange);
    this.listeners.clear();
  }
}
