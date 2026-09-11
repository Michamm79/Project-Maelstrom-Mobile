/**
 * Glue: owns the loop and wires the core systems to input, canvas and HUD.
 * Everything game-rule shaped lives in ../core; this file only translates
 * between that and the browser.
 */
import { content } from '../core/content';
import { createInitialState, OrbContainer } from '../core/orbContainer';
import { clearSave, load, save } from '../core/save';
import { InputController } from './input';
import { Renderer } from './renderer';
import { Ui } from './ui';
import { World } from './world';
import type { AlchemyRecipe, Hand, MaterialId, ZoneId } from '../core/types';

const AUTOSAVE_DELAY_MS = 900;
/** A long tab-away shouldn't fast-forward every respawn timer at once. */
const MAX_FRAME_SECONDS = 0.1;

export class Game {
  private readonly orb: OrbContainer;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly ui: Ui;
  private world: World;

  private lastFrame = 0;
  private frameHandle = 0;
  private saveHandle = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const state = load(content) ?? createInitialState(content);
    this.orb = new OrbContainer(content, state);
    this.world = new World(content, content.zone(state.zoneId));
    this.renderer = new Renderer(canvas, content);
    this.input = new InputController(canvas, (x, y) => this.onTap(x, y));

    this.ui = new Ui(uiRoot, content, {
      onGather: () => this.gatherNearest(),
      onTransmute: () => this.transmute(),
      onUnloadOrb: (hand) => this.unloadOrb(hand),
      onDecomposeOrb: (hand) => this.decompose(hand),
      onLoadFromPack: (material) => this.loadFromPack(material),
      onPlaceInSlot: (hand, material) => this.placeInSlot(hand, material),
      onAlchemize: (recipe) => this.alchemize(recipe),
      onMixSelection: (selection) => this.mixSelection(selection),
      onTravel: (zone) => this.travel(zone),
      onReset: () => this.reset(),
    });
    this.ui.bind(this.orb);

    this.wireEvents();
    this.ui.refresh(this.orb);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.flushSave);
  }

  // ---------------------------------------------------------------- events

  private wireEvents(): void {
    const events = this.orb.events;

    events.on('stateChanged', () => {
      this.ui.refresh(this.orb);
      this.scheduleSave();
    });
    events.on('orbsChanged', () => this.ui.refresh(this.orb));
    events.on('inventoryChanged', () => this.ui.refresh(this.orb));
    events.on('poolChanged', () => this.ui.refresh(this.orb));
    // XP can be awarded on its own, without any of the above firing. Without
    // this the level and XP bar keep showing the previous values.
    events.on('xpGained', () => this.ui.refresh(this.orb));

    events.on('gathered', ({ material, isNew, toOrb }) => {
      const def = content.material(material);
      this.renderer.addFloater(this.world.player.x, this.world.player.y, `+ ${def.name}`, def.color);
      if (isNew) this.ui.toast(`New material: ${def.name}`, 'good');
      else if (toOrb === null) this.ui.toast(`Orbs full - ${def.name} went to your pack`);
    });

    events.on('crafted', ({ material, via, isNew }) => {
      const def = content.material(material);
      this.renderer.addFloater(this.world.player.x, this.world.player.y, def.name, def.color, 1.6);
      if (!isNew) this.ui.toast(`${via === 'alchemy' ? 'Brewed' : 'Transmuted'}: ${def.name}`, 'good');
    });

    events.on('discovered', ({ material }) => {
      this.ui.toast(`Discovered - ${content.material(material).name}`, 'big');
    });

    events.on('decomposed', ({ material, gained }) => {
      const parts = Object.entries(gained)
        .map(([element, count]) => `${content.element(element).name} ${count}`)
        .join(', ');
      this.ui.toast(`${content.material(material).name} broke down into ${parts}`, 'good');
    });

    events.on('levelUp', ({ level, unlockedAlchemy, unlockedZones }) => {
      this.ui.refresh(this.orb);
      this.scheduleSave();
      this.ui.toast(`Level ${level}`, 'big');
      if (unlockedAlchemy) {
        this.ui.toast('Alchemy unlocked - press ⚗ on an orb to break a material into elements', 'big');
      }
      for (const zoneId of unlockedZones) {
        this.ui.toast(`New region: ${content.zone(zoneId).name}`, 'big');
      }
    });

    events.on('zoneChanged', ({ zoneId }) => {
      this.world = new World(content, content.zone(zoneId));
      this.ui.closeSheet();
      this.ui.toast(content.zone(zoneId).name, 'big');
    });
  }

  // ---------------------------------------------------------------- actions

  private gatherNearest(): void {
    const node = this.world.nodeInRange();
    if (!node) return;

    this.world.harvest(node);
    this.orb.gather(node.material);
  }

  /** Tapping a node in the world gathers it, as long as the player is close enough. */
  private onTap(clientX: number, clientY: number): void {
    if (this.ui.sheetOpen) return;

    const node = this.world.nodeInRange();
    if (!node) return;

    // Only treat it as "tapped that node" if the tap landed near it on screen;
    // otherwise a stray tap anywhere would silently harvest whatever is closest.
    const screen = this.renderer.worldToScreen(this.world, node.x, node.y);
    if (Math.hypot(clientX - screen.x, clientY - screen.y) > 60) return;

    this.world.harvest(node);
    this.orb.gather(node.material);
  }

  private transmute(): void {
    const recipe = this.orb.peekTransmutation();
    if (!recipe) return;
    this.orb.tryTransmute();
  }

  private unloadOrb(hand: Hand): void {
    if (this.orb.unloadOrb(hand)) this.ui.refresh(this.orb);
  }

  private decompose(hand: Hand): void {
    if (!this.orb.alchemyUnlocked) {
      this.ui.toast(`Alchemy unlocks at level ${content.progression.alchemyUnlockLevel}`, 'bad');
      return;
    }
    if (!this.orb.decomposeMaterialAt(hand)) this.ui.toast('Nothing in that orb', 'bad');
  }

  private loadFromPack(material: MaterialId): void {
    const hand = this.orb.loadFromInventoryToFreeOrb(material);
    if (hand === null) {
      this.ui.toast('Both orbs are full', 'bad');
      return;
    }
    this.ui.refresh(this.orb);
  }

  private placeInSlot(hand: Hand, material: MaterialId): void {
    if (this.orb.replaceOrb(hand, material)) return;
    // The only ordinary failure is tapping what is already in that slot.
    if (this.orb.orb(hand) !== material) this.ui.toast('Could not place that', 'bad');
  }

  private alchemize(recipe: AlchemyRecipe): void {
    if (this.orb.tryAlchemize(recipe) === null) this.ui.toast('Not enough elements', 'bad');
  }

  private mixSelection(selection: Record<string, number>): void {
    const { result, reason } = this.orb.tryAlchemizeSelection(selection);
    if (result !== null) {
      this.ui.clearMix();
      return;
    }

    if (reason === 'locked') {
      this.ui.toast(`Alchemy unlocks at level ${content.progression.alchemyUnlockLevel}`, 'bad');
    } else if (reason === 'short') {
      this.ui.toast('Not enough of those elements', 'bad');
    } else {
      // Wrong guesses are free - say nothing happened, not that you failed.
      this.ui.toast('Nothing forms from that mixture', 'info');
    }
  }

  private travel(zone: ZoneId): void {
    if (!this.orb.travelTo(zone)) this.ui.toast('You cannot go there yet', 'bad');
  }

  private reset(): void {
    clearSave();
    window.location.reload();
  }

  // ---------------------------------------------------------------- loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.lastFrame) / 1000, MAX_FRAME_SECONDS);
    this.lastFrame = now;

    const move = this.input.read();
    this.world.movePlayer(move.x, move.y, dt);
    this.world.update(dt);
    this.renderer.update(dt);
    this.orb.state.playtimeMs += dt * 1000;

    // Space / Enter gathers, so the game is fully playable on a keyboard too.
    if (this.input.consumeKey(' ') || this.input.consumeKey('enter')) this.gatherNearest();

    const target = this.world.nodeInRange();
    this.ui.setGatherTarget(target ? target.material : null);

    this.renderer.draw(
      this.world,
      {
        leftOrb: this.orb.leftOrb,
        rightOrb: this.orb.rightOrb,
        highlightNodeId: target ? target.id : null,
      },
      this.input,
    );
  };

  // ---------------------------------------------------------------- lifecycle

  private onResize = (): void => {
    this.renderer.resize();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.flushSave();
      this.stop();
    } else {
      this.start();
    }
  };

  private scheduleSave(): void {
    window.clearTimeout(this.saveHandle);
    this.saveHandle = window.setTimeout(() => save(this.orb.state), AUTOSAVE_DELAY_MS);
  }

  private flushSave = (): void => {
    window.clearTimeout(this.saveHandle);
    save(this.orb.state);
  };

  destroy(): void {
    this.stop();
    this.flushSave();
    this.input.destroy();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.flushSave);
  }
}
