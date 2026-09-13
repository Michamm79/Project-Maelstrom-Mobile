/**
 * Glue: owns the loop and wires the core systems to input, canvas and HUD.
 * Everything game-rule shaped lives in ../core; this file only translates
 * between that and the browser.
 */
import { content } from '../core/content';
import { playerDamage } from '../core/combat';
import { createInitialState, OrbContainer } from '../core/orbContainer';
import { clearSave, load, save } from '../core/save';
import { advanceTutorial, emptyProgress, tutorialComplete, type TutorialProgress } from '../core/tutorial';
import { InputController } from './input';
import { Renderer } from './renderer';
import { Ui } from './ui';
import { TitleScreen } from './title';
import { World, type Enemy } from './world';
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

  private readonly title: TitleScreen;
  private tutorial: TutorialProgress = emptyProgress();
  /** Where the player stood at the last tutorial tick, for the walk-distance rule. */
  private tutorialMark = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const state = load(content) ?? createInitialState(content);
    this.orb = new OrbContainer(content, state);
    this.world = new World(content, content.zone(state.zoneId));
    this.world.player.hp = Math.max(1, Math.min(this.world.player.maxHp, state.vitals.hp));
    this.renderer = new Renderer(canvas, content);
    this.input = new InputController(canvas, (x, y) => this.onTap(x, y));

    this.ui = new Ui(uiRoot, content, {
      onAction: () => this.contextAction(),
      onSkipTutorial: () => this.endTutorial(),
      onReplayTutorial: () => this.replayTutorial(),
      onBenchOpened: () => { this.tutorial.benchOpened += 1; },
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

    this.title = new TitleScreen(uiRoot, {
      onContinue: () => this.beginPlay(),
      onNewGame: (guided) => this.startNewGame(guided),
    });

    this.wireEvents();
    this.ui.refresh(this.orb);

    // A run that was already started resumes behind the title card; a fresh one
    // has nothing to continue, so the card only offers the two ways to begin.
    if (this.orb.state.started) {
      this.title.show(true, this.runSummary());
    } else {
      this.title.show(false, null);
    }
    this.syncObjective();

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
      this.tutorial.gathered += 1;
      const def = content.material(material);
      this.renderer.addFloater(this.world.player.x, this.world.player.y, `+ ${def.name}`, def.color);
      if (isNew) this.ui.toast(`New material: ${def.name}`, 'good');
      else if (toOrb === null) this.ui.toast(`Orbs full - ${def.name} went to your pack`);
    });

    events.on('crafted', ({ material, via, isNew }) => {
      if (via === 'transmutation') this.tutorial.transmuted += 1;
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
      const carriedHp = this.orb.state.vitals.hp;
      this.world = new World(content, content.zone(zoneId));
      // Travelling is not a heal: arrive with the health you left with.
      this.world.player.hp = Math.max(1, Math.min(this.world.player.maxHp, carriedHp));
      this.ui.closeSheet();
      this.ui.toast(content.zone(zoneId).name, 'big');
    });
  }

  // ---------------------------------------------------------------- actions

  /**
   * The single action button. Attack takes precedence over gathering: in a
   * fight, having the button quietly pick up a stick instead of swinging would
   * be the worst possible moment to be helpful.
   */
  private contextAction(): void {
    if (this.world.player.dead) return;

    const enemy = this.world.enemyInReach();
    if (enemy) {
      this.swing(enemy);
      return;
    }
    this.gatherNearest();
  }

  private swing(target: Enemy | null): void {
    // Face what the button said you would hit, so the arc test cannot betray it.
    if (target) this.world.faceToward(target.x, target.y);
    const damage = playerDamage(content, this.orb.carried());
    this.world.attack(damage, () => Math.random());
  }

  private gatherNearest(): void {
    const node = this.world.nodeInRange();
    if (!node) return;

    this.world.harvest(node);
    this.orb.gather(node.material);
  }

  /** Turn queued world combat events into XP, drops, toasts and floaters. */
  private drainCombat(): void {
    for (const event of this.world.drainEvents()) {
      const { player } = this.world;

      if (event.kind === 'enemy-killed' && event.enemy) {
        this.renderer.addFloater(event.enemy.x, event.enemy.y, event.enemy.def.name, '#ffd27a', 1.4);
        this.orb.recordKill(event.xp ?? 0, event.drops ?? []);
        for (const drop of event.drops ?? []) {
          this.ui.toast(`${event.enemy.def.name} dropped ${content.material(drop).name}`, 'good');
        }
      } else if (event.kind === 'enemy-hit' && event.enemy) {
        this.tutorial.enemiesHit += 1;
        this.renderer.addFloater(event.enemy.x, event.enemy.y - 8, `-${event.amount}`, '#ffffff', 0.7);
      } else if (event.kind === 'player-hit') {
        this.renderer.addFloater(player.x, player.y - 30, `-${event.amount}`, '#f87171', 0.9);
      } else if (event.kind === 'player-died') {
        this.orb.recordDeath();
        this.ui.toast('You fell. Recovering...', 'bad');
      }
    }

    // The world owns health during play; the save state mirrors it so it
    // survives a reload and a zone change.
    this.orb.state.vitals.hp = this.world.player.hp;
    this.orb.state.vitals.maxHp = this.world.player.maxHp;
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

  // ---------------------------------------------------------------- opening

  /** A one-line "here is where you left off" for the Continue button. */
  private runSummary(): string {
    const { state } = this.orb;
    const minutes = Math.floor(state.playtimeMs / 60000);
    const where = content.zone(state.zoneId).name;
    return minutes > 0 ? `Level ${state.level} in ${where}, ${minutes} min played` : `Level ${state.level} in ${where}`;
  }

  /** Leave the title card and hand control to the player. */
  private beginPlay(): void {
    if (!this.orb.state.started) {
      this.orb.state.started = true;
      this.scheduleSave();
    }
    this.tutorialMark = { x: this.world.player.x, y: this.world.player.y };
    this.syncObjective();
  }

  private startNewGame(guided: boolean): void {
    // Starting over from an existing run has to actually clear it, not layer a
    // new game on top of the old inventory.
    if (this.orb.state.started) {
      clearSave();
      window.location.reload();
      return;
    }

    this.orb.state.started = true;
    this.orb.state.tutorialStep = guided ? 0 : -1;
    this.tutorial = emptyProgress();
    this.beginPlay();
  }

  /** Run the guide again from the top, with a clean tally so nothing auto-skips. */
  private replayTutorial(): void {
    this.tutorial = emptyProgress();
    this.tutorialMark = { x: this.world.player.x, y: this.world.player.y };
    this.orb.state.tutorialStep = 0;
    this.syncObjective();
    this.scheduleSave();
  }

  private endTutorial(): void {
    this.orb.state.tutorialStep = -1;
    this.ui.setObjective(null);
    this.scheduleSave();
  }

  /** Push the current step's text to the banner, or clear it when the guide is done. */
  private syncObjective(): void {
    const steps = content.tutorial;
    const step = this.orb.state.tutorialStep;
    this.ui.setObjective(tutorialComplete(steps, step) ? null : (steps[step] ?? null));
  }

  /**
   * Advance the guide. Called once a frame; every rule reads the running tally
   * rather than a "next" button, so the guide is finished by playing.
   */
  private updateTutorial(): void {
    const steps = content.tutorial;
    const step = this.orb.state.tutorialStep;
    if (tutorialComplete(steps, step)) return;

    const { player } = this.world;
    this.tutorial.travelled += Math.hypot(player.x - this.tutorialMark.x, player.y - this.tutorialMark.y);
    this.tutorialMark = { x: player.x, y: player.y };
    this.tutorial.orbsFilled = (this.orb.leftOrb ? 1 : 0) + (this.orb.rightOrb ? 1 : 0);

    const next = advanceTutorial(steps, step, this.tutorial);
    if (next === step) return;

    this.orb.state.tutorialStep = next;
    this.syncObjective();
    this.scheduleSave();
    if (tutorialComplete(steps, next)) {
      this.ui.toast('That is the whole of it. The rest is yours to work out.', 'big');
    }
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

    // The world keeps animating behind the title card, but the player does not
    // move until they have chosen how to start.
    const move = this.title.visible ? { x: 0, y: 0 } : this.input.read();
    this.world.movePlayer(move.x, move.y, dt);
    this.world.update(dt);
    this.renderer.update(dt);
    this.orb.state.playtimeMs += dt * 1000;

    // Space / Enter drives the same context action, so the game stays fully
    // playable on a keyboard.
    if (this.input.consumeKey(' ') || this.input.consumeKey('enter')) this.contextAction();

    this.drainCombat();
    this.ui.setVitals(this.world.player.hp, this.world.player.maxHp);
    if (!this.title.visible) this.updateTutorial();

    // Attack wins whenever it is available. The node is still resolved either
    // way, because the world highlight should follow what a gather would take.
    const enemy = this.world.enemyInReach();
    const node = this.world.nodeInRange();

    if (enemy) {
      this.ui.setAction('attack', enemy.def.name);
    } else {
      this.ui.setAction(node ? 'gather' : 'idle', node ? content.material(node.material).name : null);
    }

    this.renderer.draw(
      this.world,
      {
        leftOrb: this.orb.leftOrb,
        rightOrb: this.orb.rightOrb,
        highlightNodeId: !enemy && node ? node.id : null,
        highlightEnemyId: enemy ? enemy.id : null,
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
