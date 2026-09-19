/**
 * Stopping, mid-run.
 *
 * Before this there was no way out of a run except closing the tab, and no way
 * to change a setting without first starting one. On a phone that is worse than
 * it sounds: a run is something you get interrupted in the middle of, and a
 * game that cannot be put down is a game that gets closed.
 *
 * It borrows its pages from `pages.ts`, so the settings here and the settings
 * on the title screen are the same rows rather than two that drift apart.
 *
 * Quitting is deliberately not the same as starting over. It saves and returns
 * to the menu with the run intact, because "I want to stop" and "I want this
 * erased" are different sentences and only one of them is reversible.
 */
import { renderHowTo, renderSettings, el, onPress } from './pages';
import type { MenuDeps } from './title';

type Page = 'root' | 'settings' | 'howto';

export interface PauseChoice {
  onResume: () => void;
  /** Save and go back to the menu. The run survives. */
  onQuit: () => void;
}

export class PauseMenu {
  private readonly root: HTMLElement;
  private shown = false;
  private page: Page = 'root';

  constructor(
    host: HTMLElement,
    private readonly deps: MenuDeps,
    private readonly choice: PauseChoice,
  ) {
    this.root = el('div', 'pause');
    this.root.dataset.ui = '';
    this.root.hidden = true;
    host.append(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  open(): void {
    this.page = 'root';
    this.shown = true;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.shown = false;
    this.root.hidden = true;
    /*
     * Emptied rather than just hidden.
     *
     * A closed menu has no business keeping a live subtree of buttons and
     * their listeners around, and it is rebuilt from scratch on every open
     * anyway - so leaving it there only creates something for a stray query,
     * a screen reader or a test to find and believe in.
     */
    this.root.replaceChildren();
  }

  toggle(): void {
    if (this.shown) this.resume();
    else this.open();
  }

  private resume(): void {
    this.close();
    this.choice.onResume();
  }

  private render(): void {
    this.root.replaceChildren();
    const card = el('div', 'pcard');

    if (this.page === 'root') {
      card.append(el('h2', undefined, 'Paused'));
      card.append(
        el('p', 'note', 'The world is holding still. Nothing is hunting you while this is open.'),
      );

      const actions = el('div', 'tactions');
      actions.append(this.button('Resume', null, 'tbtn primary', () => this.resume()));
      actions.append(this.button('Settings', null, 'tbtn', () => this.go('settings')));
      actions.append(this.button('How to play', null, 'tbtn', () => this.go('howto')));
      actions.append(
        this.button('Quit to menu', 'Your run is saved', 'tbtn', () => {
          this.close();
          this.choice.onQuit();
        }),
      );
      card.append(actions);
    } else {
      const header = el('div', 'tsubhead');
      const back = el('button', 'tback', '‹ Back');
      onPress(back, () => this.go('root'));
      header.append(back, el('h2', undefined, this.page === 'settings' ? 'Settings' : 'How to play'));
      card.append(header);

      const body = el('div', 'tsubbody');
      if (this.page === 'settings') {
        renderSettings(body, {
          screen: this.deps.screen,
          install: this.deps.install,
          sound: this.deps.sound,
          onChange: () => this.render(),
        });
      } else {
        renderHowTo(body);
      }
      card.append(body);
    }

    this.root.append(card);
  }

  private go(page: Page): void {
    this.page = page;
    this.render();
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
}
