/**
 * The main menu.
 *
 * It sits over the live world rather than a static image: the game loop keeps
 * running behind the scrim, so the first thing you see is the place you are
 * about to walk into.
 *
 * Four pages rather than one card, because the card was doing three jobs badly.
 * Settings were only reachable from inside a run, so anyone who wanted the game
 * the other way up had to start one first; the controls were only ever taught
 * by the guide, which is no use at all to somebody coming back after a
 * fortnight; and there was nowhere to say what the thing is.
 *
 * The pages themselves live in `pages.ts` and are shared with the pause menu,
 * so there is one settings panel in the game rather than three that drift.
 */
import { renderAbout, renderHowTo, renderSettings, el, onPress } from './pages';
import type { Install } from './install';
import type { Screen } from './screen';
import type { Sound } from './sound';

export interface TitleChoice {
  /** Continue an existing save instead of starting over. */
  onContinue: () => void;
  /** Begin a new run. `guided` starts the opening tutorial. */
  onNewGame: (guided: boolean) => void;
}

export interface MenuDeps {
  install: Install;
  screen: Screen;
  sound: Sound;
  /** Rows for the About page, so the menu never states a number itself. */
  facts: [string, string][];
}

type Page = 'home' | 'settings' | 'howto' | 'about';

export class TitleScreen {
  private readonly root: HTMLElement;
  private shown = false;
  private page: Page = 'home';
  private resumable = false;
  private summary: string | null = null;
  /** Set while the player is confirming that yes, they meant to erase it. */
  private confirming = false;

  constructor(
    host: HTMLElement,
    private readonly deps: MenuDeps,
    private readonly choice: TitleChoice,
  ) {
    this.root = el('div', 'title');
    this.root.dataset.ui = '';
    this.root.hidden = true;
    host.append(this.root);

    /*
     * The install offer arrives late, or not at all.
     *
     * `beforeinstallprompt` fires when the browser decides the moment is right,
     * which is routinely after the title screen has already drawn itself. Built
     * once at show() time, the offer simply never appeared - the card was
     * already on screen by the time there was anything to offer.
     */
    this.deps.install.onChange(() => {
      if (this.shown) this.render();
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  /**
   * @param resumable whether a save worth continuing exists. When it does,
   *   Continue is the primary button and starting over is the deliberate one.
   */
  show(resumable: boolean, summary: string | null): void {
    this.resumable = resumable;
    this.summary = summary;
    this.page = 'home';
    this.confirming = false;
    this.root.hidden = false;
    this.shown = true;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.shown = false;
  }

  private go(page: Page): void {
    this.page = page;
    this.confirming = false;
    this.render();
  }

  private render(): void {
    this.root.replaceChildren();
    const card = el('div', 'tcard');
    if (this.page !== 'home') card.classList.add('sub');

    if (this.page === 'home') this.renderHome(card);
    else this.renderSubPage(card);

    this.root.append(card);
  }

  // ------------------------------------------------------------------ home

  private renderHome(card: HTMLElement): void {
    card.append(el('p', 'teyebrow', 'Project'), el('h1', undefined, 'Maelstrom'));
    card.append(
      el(
        'p',
        'tblurb',
        'You wake at the centre of a bounded arena you did not choose, with two ' +
          'half-orbs above your hands and no memory of how you got here. Nobody ' +
          'explains why. Only what to do, and where to go.',
      ),
    );

    const actions = el('div', 'tactions');

    if (this.confirming) {
      actions.append(el('p', 'twarn', 'This deletes your current run. There is no undo.'));
      actions.append(
        this.button('Yes, start over', null, 'tbtn danger', () => {
          this.hide();
          this.choice.onNewGame(true);
        }),
      );
      actions.append(
        this.button('Keep my run', null, 'tbtn', () => {
          this.confirming = false;
          this.render();
        }),
      );
    } else if (this.resumable) {
      actions.append(
        this.button('Continue', this.summary, 'tbtn primary', () => {
          this.hide();
          this.choice.onContinue();
        }),
      );
      actions.append(
        this.button('Start over', 'Erases the run above', 'tbtn', () => {
          this.confirming = true;
          this.render();
        }),
      );
    } else {
      actions.append(
        this.button('Begin', 'With a short guide', 'tbtn primary', () => {
          this.hide();
          this.choice.onNewGame(true);
        }),
      );
      actions.append(
        this.button('Skip the guide', 'Straight into the Coliseum', 'tbtn', () => {
          this.hide();
          this.choice.onNewGame(false);
        }),
      );
    }

    card.append(actions);

    // The three quieter doors, as one row: none of them is why anyone opened
    // the game, and stacking them like the real choices would say otherwise.
    const nav = el('div', 'tnav');
    for (const [label, page] of [
      ['Settings', 'settings'],
      ['How to play', 'howto'],
      ['About', 'about'],
    ] as const) {
      const button = el('button', 'tnavbtn', label);
      onPress(button, () => this.go(page));
      nav.append(button);
    }
    card.append(nav);

    this.buildInstall(card);
  }

  private button(
    label: string,
    sub: string | null,
    className: string,
    action: () => void,
  ): HTMLElement {
    const node = el('button', className, label);
    if (sub) node.append(el('span', 'tsub', sub));
    onPress(node, action);
    return node;
  }

  // ------------------------------------------------------------- sub-pages

  private renderSubPage(card: HTMLElement): void {
    const header = el('div', 'tsubhead');
    const back = el('button', 'tback', '‹ Back');
    onPress(back, () => this.go('home'));
    header.append(
      back,
      el('h2', undefined, this.page === 'settings' ? 'Settings' : this.page === 'howto' ? 'How to play' : 'About'),
    );
    card.append(header);

    const body = el('div', 'tsubbody');
    if (this.page === 'settings') {
      renderSettings(body, {
        screen: this.deps.screen,
        install: this.deps.install,
        sound: this.deps.sound,
        onChange: () => this.render(),
      });
    } else if (this.page === 'howto') {
      renderHowTo(body);
    } else {
      renderAbout(body, this.deps.facts);
    }
    card.append(body);
  }

  // --------------------------------------------------------------- install

  /**
   * The offer to keep it.
   *
   * On the title screen rather than mid-run, because installing is a decision
   * about the game rather than a move inside it, and this is the one moment the
   * player is already choosing something.
   *
   * It is a single dismissible line and it never comes back once waved away -
   * the settings page keeps it for anyone who changes their mind. A prompt that
   * reappears every launch is how people learn to ignore the whole corner of
   * the screen it lives in.
   */
  private buildInstall(card: HTMLElement): void {
    const state = this.deps.install.state;
    if (state === 'installed' || state === 'unavailable') return;
    if (this.deps.install.dismissed) return;

    const row = el('div', 'tinstall');

    if (state === 'ready') {
      const button = el('button', 'tbtn ghost', 'Install');
      button.append(el('span', 'tsub', 'Keeps it on your home screen, offline'));
      onPress(button, () => {
        void this.deps.install.prompt().then(() => this.render());
      });
      row.append(button);
    } else {
      // No button: nothing in a page can open Safari's share sheet, and a
      // button that does nothing is worse than a sentence that is true.
      row.append(
        el('p', 'thint', `Add it to your home screen to play offline. ${this.deps.install.manualSteps}`),
      );
    }

    const no = el('button', 'tdismiss', 'Not now');
    onPress(no, () => {
      this.deps.install.dismiss();
      this.render();
    });
    row.append(no);

    card.append(row);
  }
}
