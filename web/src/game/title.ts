/**
 * The title screen.
 *
 * It sits over the live world rather than a static image: the game loop keeps
 * running behind the scrim, so the first thing you see is the place you are
 * about to walk into. Choosing the guide here is the only place it is offered,
 * and skipping it costs nothing later - the bench and codex still explain
 * themselves.
 */

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
    private readonly choice: TitleChoice,
  ) {
    this.root = el('div', 'title');
    this.root.dataset.ui = '';
    this.root.hidden = true;
    host.append(this.root);
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
        'Two orbs, one pair of hands. Gather what the land gives up, fuse it into ' +
          'something it was never meant to be, and carry that further in.',
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
      skip.append(el('span', 'tsub', 'Straight into the Hollow Verge'));
      skip.addEventListener('click', () => {
        this.hide();
        this.choice.onNewGame(false);
      });

      actions.append(guided, skip);
    }

    card.append(actions);
    this.root.append(card);
    this.root.hidden = false;
    this.shown = true;
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
