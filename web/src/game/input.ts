/**
 * Touch and keyboard movement.
 *
 * The joystick is floating rather than fixed: the first touch anywhere on the
 * play surface places it, which is what makes one-thumb play comfortable on a
 * phone without forcing the player to hunt for a control.
 *
 * Everything here works in the game box's own coordinates rather than the
 * viewport's, because the two stop agreeing the moment the box is rotated into
 * a portrait screen to force landscape.
 *
 * Keyboard is kept alongside it so the game is playable (and automatable) on a
 * desktop browser.
 */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Whatever knows where the game box is and which way up it is.
 *
 * Touches arrive in viewport coordinates. Those are the same numbers as the
 * box's own only while the box is untransformed, so the stick cannot subtract a
 * bounding rect and call it done - a rotated element reports its axis-aligned
 * cover, and the axes come out swapped. `Screen` implements this; the fallback
 * below is the untransformed case, which is what the tests and a desktop
 * browser use.
 */
export interface PointerSpace {
  toLocal(clientX: number, clientY: number): Vector2;
  /** Box width, for the side-of-screen test. Also in the box's own axes. */
  readonly width: number;
}

/** Distance in CSS pixels at which the stick reads as fully deflected. */
const STICK_RADIUS = 58;

/** A press that moves less than this, for less than this long, counts as a tap. */
const TAP_SLOP = 12;
const TAP_MS = 320;

/**
 * Fraction of the screen width that drives movement. ARPG convention: the left
 * thumb steers, the right thumb acts. Keeping the stick off the right side stops
 * a stray drag near the action button from walking the player somewhere.
 */
const STICK_ZONE = 0.62;

export class InputController {
  /** Movement vector, magnitude 0..1. */
  readonly vector: Vector2 = { x: 0, y: 0 };

  /** Where the joystick was placed, for the renderer. Null when idle. */
  origin: Vector2 | null = null;
  knob: Vector2 | null = null;

  private pointerId: number | null = null;
  /** A press on the action side: still eligible to be a tap, never a stick. */
  private tapOnlyPointer: number | null = null;
  private pointerStart: { x: number; y: number; time: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly taps = new Map<string, () => void>();
  private readonly disposers: (() => void)[] = [];
  private readonly space: PointerSpace;

  /**
   * @param onTap fired when a pointer goes down and up in roughly the same place,
   *   which is how tapping a node in the world is told apart from steering.
   */
  constructor(
    private readonly surface: HTMLElement,
    space?: PointerSpace,
    private readonly onTap?: (x: number, y: number) => void,
  ) {
    this.space = space ?? {
      toLocal: (clientX, clientY) => {
        const rect = surface.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
      },
      get width() {
        return surface.getBoundingClientRect().width;
      },
    };
    this.bind(surface, 'pointerdown', this.onPointerDown);
    this.bind(surface, 'pointermove', this.onPointerMove);
    this.bind(surface, 'pointerup', this.onPointerUp);
    this.bind(surface, 'pointercancel', this.onPointerUp);
    this.bind(window, 'blur', this.onBlur);
    this.bind(window, 'keydown', this.onKeyDown);
    this.bind(window, 'keyup', this.onKeyUp);
  }

  private bind<K extends keyof WindowEventMap>(
    target: HTMLElement | Window,
    type: K | string,
    handler: (event: never) => void,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, { passive: false });
    this.disposers.push(() => target.removeEventListener(type, listener));
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    // Buttons and panels sit above the surface; let them have their own taps.
    if ((event.target as HTMLElement)?.closest('[data-ui]')) return;

    // Right side is the action thumb's territory - a drag there should not steer.
    const at = this.space.toLocal(event.clientX, event.clientY);
    if (at.x > this.space.width * STICK_ZONE) {
      this.pointerStart = { x: at.x, y: at.y, time: performance.now() };
      this.tapOnlyPointer = event.pointerId;
      return;
    }

    event.preventDefault();
    this.pointerId = event.pointerId;
    try {
      this.surface.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is an optimisation - it keeps the stick tracking a thumb that
      // slides off the canvas. If the pointer is already gone the stick still
      // works, so never let this take the rest of the handler down with it.
    }
    this.origin = { x: at.x, y: at.y };
    this.knob = { ...this.origin };
    this.pointerStart = { x: at.x, y: at.y, time: performance.now() };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.origin) return;
    event.preventDefault();

    const at = this.space.toLocal(event.clientX, event.clientY);
    const dx = at.x - this.origin.x;
    const dy = at.y - this.origin.y;
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(distance, STICK_RADIUS);

    if (distance > 0.001) {
      this.knob = {
        x: this.origin.x + (dx / distance) * clamped,
        y: this.origin.y + (dy / distance) * clamped,
      };
      this.vector.x = (dx / distance) * (clamped / STICK_RADIUS);
      this.vector.y = (dy / distance) * (clamped / STICK_RADIUS);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const isStick = event.pointerId === this.pointerId;
    const isTapOnly = event.pointerId === this.tapOnlyPointer;
    if (!isStick && !isTapOnly) return;

    const start = this.pointerStart;
    if (start && this.onTap) {
      const at = this.space.toLocal(event.clientX, event.clientY);
      const moved = Math.hypot(at.x - start.x, at.y - start.y);
      const held = performance.now() - start.time;
      if (moved < TAP_SLOP && held < TAP_MS) this.onTap(at.x, at.y);
    }

    if (isTapOnly) {
      this.tapOnlyPointer = null;
      this.pointerStart = null;
      return;
    }
    this.release();
  };

  private onBlur = (): void => {
    this.release();
    this.keys.clear();
  };

  private release(): void {
    if (this.pointerId !== null) {
      try {
        this.surface.releasePointerCapture?.(this.pointerId);
      } catch {
        // The pointer may already be gone; capture release is best-effort.
      }
    }
    this.pointerId = null;
    this.tapOnlyPointer = null;
    this.pointerStart = null;
    this.origin = null;
    this.knob = null;
    this.vector.x = 0;
    this.vector.y = 0;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    this.keys.add(key);
    /*
     * Auto-repeat is a held key, not a second press.
     *
     * A key held down fires keydown again every few tens of milliseconds, and
     * a one-shot handler bound to it would run dozens of times for one press.
     * On a toggle that is not a near-miss: holding Shift would flip run on and
     * off continuously and settle on whichever side the key-up happened to
     * land, which reads as the button being broken. The held-key set above
     * still wants every one of these, so the guard is on the dispatch only.
     */
    const handler = this.taps.get(key);
    if (handler && !event.repeat) {
      event.preventDefault();
      handler();
    }
  };

  /**
   * A key that does something once, delivered as an event.
   *
   * Not polled. A keypress is down and up again inside a few milliseconds, and
   * the frame that would have noticed it routinely happens after the keyup has
   * already removed it - so a polled one-shot key works intermittently, which
   * is worse than not working. The held keys above are a different question and
   * polling is exactly right for those.
   */
  onKey(key: string, handler: () => void): void {
    this.taps.set(key.toLowerCase(), handler);
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  /** Combined stick + keyboard direction. */
  read(): Vector2 {
    let x = this.vector.x;
    let y = this.vector.y;

    if (this.keys.has('arrowleft') || this.keys.has('a')) x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) x += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) y -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) y += 1;

    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    return { x, y };
  }

  isKeyDown(key: string): boolean {
    return this.keys.has(key);
  }

  destroy(): void {
    this.release();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }
}
