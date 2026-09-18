/**
 * Getting the game onto a home screen.
 *
 * The build is already a working PWA: installed, it gets an icon, runs without
 * browser chrome, plays offline, and picks up every push silently the next time
 * it opens with a signal. That is the whole distribution story for a project
 * with no store account, so the part that matters is whether anyone ever finds
 * the install - and by default it is buried in a browser menu nobody opens.
 *
 * Three states, because the platforms genuinely differ:
 *
 * - **ready** - Chromium fired `beforeinstallprompt`, so there is a real prompt
 *   we can raise from a button.
 * - **manual** - iOS has no such event and never will; Safari only installs
 *   from Share -> Add to Home Screen. Nothing here can trigger that, so the
 *   honest move is to say so rather than show a button that does nothing.
 * - **installed** - already on the home screen, or running from it. Offering an
 *   install to someone who has installed it is how a prompt loses its meaning.
 */

export type InstallState = 'unavailable' | 'ready' | 'manual' | 'installed';

/**
 * The deferred prompt, parked by the snippet in index.html.
 *
 * `beforeinstallprompt` fires once and early - often before a module script has
 * finished evaluating. Listening from here alone loses the race on a cold load
 * over a slow connection, and the install button then never appears for exactly
 * the players most likely to want an offline copy. The inline snippet catches
 * it; this reads whatever it caught.
 */
interface DeferredPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __maelstromInstall?: DeferredPrompt | null;
  }
}

const DISMISSED_KEY = 'maelstrom.install.dismissed';

/** Running from a home screen icon rather than inside a browser tab. */
export function isStandalone(): boolean {
  if (typeof matchMedia === 'function') {
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui']) {
      if (matchMedia(`(display-mode: ${mode})`).matches) return true;
    }
  }
  // Safari's own flag, which predates display-mode and is still the only one
  // an installed iOS web app sets.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, and the touch points are what give it away.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Which of the three situations we are in.
 *
 * Pure, and separated from the class, because the interesting part is the
 * precedence: installed beats everything, a real prompt beats instructions, and
 * instructions are only worth showing on a platform that can actually follow
 * them. Getting that order wrong shows a button to someone who already has the
 * app, which is the one outcome that makes the feature look broken.
 */
export function installState(opts: {
  standalone: boolean;
  deferred: boolean;
  ios: boolean;
}): InstallState {
  if (opts.standalone) return 'installed';
  if (opts.deferred) return 'ready';
  if (opts.ios) return 'manual';
  return 'unavailable';
}

export class Install {
  private deferred: DeferredPrompt | null = null;
  private installed = false;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.deferred = window.__maelstromInstall ?? null;
    this.installed = isStandalone();

    window.addEventListener('beforeinstallprompt', this.onDeferred);
    window.addEventListener('appinstalled', this.onInstalled);
  }

  private readonly onDeferred = (event: Event): void => {
    event.preventDefault();
    this.deferred = event as DeferredPrompt;
    this.notify();
  };

  private readonly onInstalled = (): void => {
    this.installed = true;
    this.deferred = null;
    window.__maelstromInstall = null;
    this.notify();
  };

  get state(): InstallState {
    return installState({
      standalone: this.installed || isStandalone(),
      deferred: this.deferred !== null,
      ios: isIos(),
    });
  }

  /** What to tell someone whose platform has no prompt to raise. */
  get manualSteps(): string {
    return isIos()
      ? 'Tap the Share button, then Add to Home Screen.'
      : 'Open your browser menu and choose Install, or Add to Home Screen.';
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Raise the real prompt. Must be called from a gesture.
   *
   * The deferred event is single-use: once it has been shown the browser will
   * not let it be shown again, so it is dropped either way. A player who says
   * no gets the settings row rather than the same button a second time.
   */
  async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const deferred = this.deferred;
    if (!deferred) return 'unavailable';
    this.deferred = null;
    window.__maelstromInstall = null;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') this.installed = true;
      this.notify();
      return outcome;
    } catch {
      // A browser that refuses to show it leaves everything as it was, minus
      // the spent event. Never worth interrupting the title screen for.
      this.notify();
      return 'unavailable';
    }
  }

  /**
   * Whether the player has waved this away.
   *
   * Only the title screen honours it. The Screen tab keeps offering the install
   * regardless, because a setting somebody went looking for is not a nag.
   */
  get dismissed(): boolean {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  dismiss(): void {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not remembering the dismissal is a smaller failure than refusing to
      // accept it, so this carries on either way.
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    window.removeEventListener('beforeinstallprompt', this.onDeferred);
    window.removeEventListener('appinstalled', this.onInstalled);
    this.listeners.clear();
  }
}
