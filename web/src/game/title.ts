/**
 * The title screen.
 *
 * It sits over the live world rather than a static image: the game loop keeps
 * running behind the scrim, so the first thing you see is the place you are
 * about to walk into. Choosing the guide here is the only place it is offered,
 * and skipping it costs nothing later - the bench and codex still explain
 * themselves.
 */

import type { Install } from './install';

export interface TitleChoice {
  /** Continue an existing save instead of starting over. */
  onContinue: () => void;
  /** Begin a new run. `guided` starts the opening tutorial. */
  onNewGame: (guided: boolean) => void;
}

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

export class TitleScreen {
  private readonly root: HTMLElement;
  private shown = false;

  constructor(
    host: HTMLElement,
    private readonly install: Install,
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
    this.install.onChange(() => {
      if (this.shown) this.refreshInstall();
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
    this.root.replaceChildren();

    const card = el('div', 'tcard');
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

    if (resumable) {
      const resume = el('button', 'tbtn primary', 'Continue');
      if (summary) resume.append(el('span', 'tsub', summary));
      resume.addEventListener('click', () => {
        this.hide();
        this.choice.onContinue();
      });

      const fresh = el('button', 'tbtn', 'Start over');
      fresh.append(el('span', 'tsub', 'Erases the run above'));
      fresh.addEventListener('click', () => this.confirmRestart(actions));

      actions.append(resume, fresh);
    } else {
      const guided = el('button', 'tbtn primary', 'Begin');
      guided.append(el('span', 'tsub', 'With a short guide'));
      guided.addEventListener('click', () => {
        this.hide();
        this.choice.onNewGame(true);
      });

      const skip = el('button', 'tbtn', 'Skip the guide');
      skip.append(el('span', 'tsub', 'Straight into the Coliseum'));
      skip.addEventListener('click', () => {
        this.hide();
        this.choice.onNewGame(false);
      });

      actions.append(guided, skip);
    }

    card.append(actions);
    this.buildInstall(card);
    this.root.append(card);
    this.root.hidden = false;
    this.shown = true;
  }

  /**
   * The offer to keep it.
   *
   * On the title screen rather than mid-run, because installing is a decision
   * about the game rather than a move inside it, and this is the one moment the
   * player is already choosing something.
   *
   * It is a single dismissible line and it never comes back once waved away -
   * the Screen tab keeps it for anyone who changes their mind. A prompt that
   * reappears every launch is how people learn to ignore the whole corner of
   * the screen it lives in.
   */
  private buildInstall(card: HTMLElement): void {
    const state = this.install.state;
    if (state === 'installed' || state === 'unavailable') return;
    if (this.install.dismissed) return;

    const row = el('div', 'tinstall');

    if (state === 'ready') {
      const button = el('button', 'tbtn ghost', 'Install');
      button.append(el('span', 'tsub', 'Keeps it on your home screen, offline'));
      button.addEventListener('click', () => {
        void this.install.prompt().then(() => this.refreshInstall());
      });
      row.append(button);
    } else {
      // No button: nothing in a page can open Safari's share sheet, and a
      // button that does nothing is worse than a sentence that is true.
      row.append(
        el('p', 'thint', `Add it to your home screen to play offline. ${this.install.manualSteps}`),
      );
    }

    const no = el('button', 'tdismiss', 'Not now');
    no.addEventListener('click', () => {
      this.install.dismiss();
      this.refreshInstall();
    });
    row.append(no);

    card.append(row);
  }

  private refreshInstall(): void {
    const card = this.root.querySelector('.tcard');
    const existing = this.root.querySelector('.tinstall');
    existing?.remove();
    if (card) this.buildInstall(card as HTMLElement);
  }

  /** Starting over throws away a save, so it asks once rather than on a mis-tap. */
  private confirmRestart(actions: HTMLElement): void {
    actions.replaceChildren();

    const warn = el('p', 'twarn', 'This deletes your current run. There is no undo.');
    const yes = el('button', 'tbtn danger', 'Yes, start over');
    yes.addEventListener('click', () => {
      this.hide();
      this.choice.onNewGame(true);
    });
    const no = el('button', 'tbtn', 'Keep my run');
    no.addEventListener('click', () => {
      this.hide();
      this.choice.onContinue();
    });

    actions.append(warn, yes, no);
  }

  hide(): void {
    this.root.hidden = true;
    this.shown = false;
  }
}
