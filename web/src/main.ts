import './style.css';
import { Game } from './game/game';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const uiRoot = document.querySelector<HTMLElement>('#ui');
// The box the game is drawn into, which is what gets turned sideways when the
// device will not turn itself. Everything else is positioned inside it.
const app = document.querySelector<HTMLElement>('#app');

if (!canvas || !uiRoot || !app) throw new Error('game shell is missing #stage, #ui or #app');

const game = new Game(canvas, uiRoot, app);
game.start();

// Handy for poking at state from the browser console while developing.
(window as unknown as { maelstrom: Game }).maelstrom = game;

/*
 * Register the service worker, in production only.
 *
 * Relative, not absolute: the site is served from a repository subpath on
 * GitHub Pages, and "/sw.js" would 404 there while working perfectly on
 * localhost - which is the kind of bug that only ever shows up in the deploy.
 *
 * A failure here is silent on purpose. Offline support is a bonus; a browser
 * that declines to register a worker (private mode, an insecure origin, a
 * policy) must still get a playable game.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* no offline support here, which is not worth telling the player about */
    });
  });
}
