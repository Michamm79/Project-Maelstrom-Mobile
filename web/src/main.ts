import './style.css';
import { Game } from './game/game';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const uiRoot = document.querySelector<HTMLElement>('#ui');

if (!canvas || !uiRoot) throw new Error('game shell is missing #stage or #ui');

const game = new Game(canvas, uiRoot);
game.start();

// Handy for poking at state from the browser console while developing.
(window as unknown as { maelstrom: Game }).maelstrom = game;
