/**
 * The run: owns the systems, the world, the loop and the input wiring.
 *
 * Two thumbs. The left half of the screen walks. On the right, PULL is a toggle
 * - canon's core verb is a sustained spiralling draw that works at a walk, not
 * a pickup press - the large button swings, and the arc above it fires the four
 * combinations the player chose to carry.
 */
import { content } from '../core/content';
import { Inventory } from '../core/inventory';
import { Crafting } from '../core/crafting';
import { Alchemy } from '../core/alchemy';
import { Progression } from '../core/progression';
import { clearSave, load, save, type RunState } from '../core/save';
import {
  advanceTutorial,
  emptyProgress,
  tutorialComplete,
  type TutorialProgress,
} from '../core/tutorial';
import { World } from './world';
import { Renderer } from './renderer';
import { Ui } from './ui';
import { InputController } from './input';
import { TitleScreen, type MenuDeps } from './title';
import { PauseMenu } from './pause';
import { WaveDirector } from './waves';
import { OpeningScene } from './opening';
import { Sound } from './sound';
import { Screen } from './screen';
import { Install } from './install';
import { Funnel } from '../core/funnel';
import { fragmentFor, type Fragment, type FragmentTrigger } from '../core/fragments';
import { accuracyHeld, pairings } from '../core/notes';
import { admit, toggleCarried, LOADOUT_SLOTS, type LoadoutState } from '../core/loadout';
import type { CombinationId, RecipeId } from '../core/types';

export class Game {
  private readonly world: World;
  private readonly screen: Screen;
  private readonly renderer: Renderer;
  private readonly ui: Ui;
  private readonly input: InputController;
  private readonly title: TitleScreen;
  private readonly pause: PauseMenu;
  private readonly opening: OpeningScene;
  private readonly sound = new Sound();
  private readonly install = new Install();
  private readonly funnel = new Funnel();
  private readonly waves: WaveDirector;

  private readonly inventory = new Inventory(content as never);
  private readonly crafting = new Crafting(content as never);
  private readonly alchemy = new Alchemy(content as never);
  private readonly progression = new Progression(content.progression);

  /** The four under the thumb, and which have ever been offered a slot. */
  private loadout: LoadoutState = { carried: [], known: [] };
  /** Gathering is on unless the player turns it off. */
  private pulling = true;
  /** Seconds left on each combination, ticked every frame. */
  private readonly cooldowns = new Map<CombinationId, number>();

  private started = false;
  private guided = false;
  private tutorialStep = 0;
  private readonly tutorialProgress: TutorialProgress = emptyProgress();
  /** World fragments already read this run. Cleared by starting over. */
  private readonly fragmentsSeen = new Set<string>();
  /** Notes picked up off the ground, from either channel. */
  private readonly notesHeld = new Set<string>();

  private playtimeMs = 0;
  private lastFrame = 0;
  private raf = 0;
  private sinceSave = 0;
  private currentBiome = '';

  constructor(
    canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    app: HTMLElement,
  ) {
    this.world = new World(content);
    /*
     * First, and before anything that measures: the screen decides how big the
     * app box is and which way up it sits, so a renderer built ahead of it
     * would size its backing store to a box that is about to change shape.
     */
    this.screen = new Screen(app);
    this.renderer = new Renderer(canvas, content, this.screen);
    this.waves = new WaveDirector(content, this.world);

    this.ui = new Ui(uiRoot, content, this.screen, this.install, this.sound, {
      onCraft: (id) => this.craft(id),
      onToggleCarry: (id) => this.toggleCarry(id),
      onAttack: () => this.attack(),
      onSkill: (id) => this.useSkill(id),
      onTogglePull: () => this.togglePull(),
      onToggleMute: () => {
        // Unlock first: the very first thing a player touches may be the mute
        // button, and unmuting a context that was never created does nothing.
        this.sound.unlock();
        return this.sound.toggleMute();
      },
      onPause: () => {
        // Closing the gauntlet sheet first, so two overlays are never stacked
        // and Resume never uncovers a menu the player had forgotten was open.
        this.ui.closeSheet();
        this.pause.open();
      },
    });

    this.input = new InputController(canvas, this.screen);
    // Escape pauses from a desktop keyboard. Bound as an event rather than
    // polled: a keypress is over before the next frame runs.
    this.input.onKey('escape', () => {
      if (!this.started || this.opening.active || this.title.visible) return;
      if (this.pause.visible) {
        this.pause.close();
        this.syncObjective();
        return;
      }
      this.ui.closeSheet();
      this.pause.open();
    });
    this.ui.setPullActive(this.pulling);

    this.opening = new OpeningScene(uiRoot);

    // Every path out of the title screen is a genuine user gesture, which is
    // the only moment a browser will let audio start.
    /*
     * One set of dependencies for both menus, so Settings opened before a run
     * and Settings opened during one are the same rows reading the same state.
     */
    const menuDeps: MenuDeps = {
      install: this.install,
      screen: this.screen,
      sound: this.sound,
      facts: [
        ['World', `${content.elements.length} elements, ${content.materials.length} materials, ${content.biomes.length} regions`],
        ['Enemies', `${content.enemies.length} tiers, wandering`],
        ['Everything', 'Drawn and synthesised by code, no asset files'],
      ],
    };

    this.pause = new PauseMenu(uiRoot, menuDeps, {
      onResume: () => this.syncObjective(),
      /*
       * Quitting is not starting over.
       *
       * It saves and hands the player back to the menu with the run intact,
       * because "I want to stop" and "I want this erased" are different
       * sentences and only one of them can be taken back.
       */
      onQuit: () => {
        this.persist();
        this.started = false;
        this.ui.closeSheet();
        this.title.show(true, this.runSummary());
      },
    });

    this.title = new TitleScreen(uiRoot, menuDeps, {
      onContinue: () => {
        this.sound.unlock();
        this.goLandscape();
        this.resume();
      },
      onNewGame: (guided: boolean) => {
        this.sound.unlock();
        this.goLandscape();
        clearSave();
        this.funnel.mark('restarted');
        this.resetRun();
        this.begin(guided);
      },
    });

    const restored = load(content, {
      inventory: this.inventory,
      crafting: this.crafting,
      progression: this.progression,
    });
    if (restored) this.applyRun(restored);

    // Canon awards XP for the first VISIT to a biome. Waking up at the spawn is
    // not a visit, and paying for it put the player at Level 1 before they had
    // pressed Begin - which armed the wave director and filled the world with
    // enemies during what is meant to be an undisturbed gathering tutorial.
    // markSeen, not award: this suppresses the payout, it does not collect it.
    this.progression.markSeen('firstBiome', content.spawnBiome.id);

    // The only distribution signal there is, with no store to report one.
    if (this.install.state === 'installed') this.funnel.mark('installed');
    this.install.onChange(() => {
      if (this.install.state === 'installed') this.funnel.mark('installed');
    });

    this.ui.setMuteLabel(this.sound.isMuted);
    // Before the first bind: the arc is drawn from the loadout, and a restored
    // run that has not been reconciled yet draws an empty one.
    this.syncLoadout();
    this.ui.bind(this.hudState());
    // currentBiome is deliberately left empty: refreshPlace() skips when the
    // biome has not changed, so seeding it here meant the place card never got
    // its first label. The award above is what stops the spawn paying out, and
    // it makes the award() call below a no-op on its own.
    this.refreshPlace();
    this.title.show(restored !== null && restored.started, restored ? this.runSummary() : null);
  }

  /**
   * Ask the device for landscape, on the same gesture that starts the audio.
   *
   * Both have to ride a real press, and this is the only one the player makes
   * before the world appears. Deliberately not awaited: the lock resolves a
   * frame or two later on the platforms that grant it, and the run should not
   * wait on the platforms that never will.
   */
  private goLandscape(): void {
    void this.screen.requestNative();
  }

  // ---------------------------------------------------------------- controls

  // ---------------------------------------------------------------- actions

  /**
   * Gathering is a toggle, not a hold. Canon wants the pull working at a run
   * with nothing to think about, and holding a button for a whole expedition is
   * the opposite of that - so it is on by default and stays on.
   */
  private togglePull(): void {
    this.pulling = !this.pulling;
    this.ui.setPullActive(this.pulling);
    this.ui.toast(this.pulling ? 'Gathering' : 'Gathering off', 'info');
  }

  private attack(): void {
    const result = this.world.swing({
      damage: this.inventory.strikeDamage,
      range: this.inventory.strikeReach,
    });
    if (!result) return;
    this.sound.play(result.hit.length ? 'hit' : 'ui', 1 + result.combo * 0.12);
    if (result.hit.length) this.funnel.mark('struck');
    if (result.killed.length) this.funnel.mark('killed');
    for (let i = 0; i < result.killed.length; i++) this.sound.play('kill');
    this.ui.setCombo(result.combo);
    if (result.killed.length) this.waves.notifyKills(result.killed.length);
    if (result.hit.length) this.tutorialProgress.struck += 1;
  }

  private useSkill(id: CombinationId): void {
    if ((this.cooldowns.get(id) ?? 0) > 0) return;
    this.cast(id);
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private begin(guided: boolean): void {
    this.started = true;
    this.guided = guided;
    this.tutorialStep = guided ? 0 : -1;
    this.title.hide();

    // The waking scene comes before the first card, and holds the world while
    // it plays. It runs for whichever opening was chosen: skipping the guide
    // skips the instruction, not the fiction.
    this.funnel.mark('began');
    this.uiRoot.classList.add('waking');
    this.opening.play(content.opening, () => {
      this.funnel.mark('wokeUp');
      this.uiRoot.classList.remove('waking');
      this.syncObjective();
    });
  }

  /**
   * Every piece of run state, put back to its opening condition.
   *
   * "Start over" used to call clearSave() and nothing else. That emptied
   * localStorage, but the live systems were untouched and the next autosave -
   * five seconds later - wrote the old run straight back: same level, same
   * upgrades, same pack, same standing position. Worse, XP is novelty-only, so
   * a new run that inherited the old `seen` set could never earn most of it
   * again. Anything holding run state needs a line here.
   */
  private resetRun(): void {
    this.inventory.load({ counts: [] });
    // After the inventory, which clears the upgrades that crafting re-derives.
    this.crafting.load([], this.inventory);
    this.progression.load(undefined);
    this.world.reset();
    this.waves.reset();

    this.cooldowns.clear();
    this.loadout = { carried: [], known: [] };
    this.pulling = true;
    this.playtimeMs = 0;
    this.sinceSave = 0;
    this.currentBiome = '';
    Object.assign(this.tutorialProgress, emptyProgress());
    // Given back on purpose: a reading lands once, and a new run is a player
    // who has not read it. Anything holding run state needs a line here - the
    // save used to write the old run straight back for exactly this reason.
    this.fragmentsSeen.clear();
    this.notesHeld.clear();
    this.ui.hideFragment();

    // Waking at the spawn is not a visit, exactly as in the constructor.
    this.progression.markSeen('firstBiome', content.spawnBiome.id);

    this.ui.setPullActive(this.pulling);
    this.ui.setCombo(0);
    this.ui.setCooldowns(this.cooldowns);
    this.syncLoadout();
    this.ui.refresh(this.hudState());
    this.refreshPlace();
  }

  private resume(): void {
    this.started = true;
    this.title.hide();
    this.syncObjective();
  }

  private applyRun(run: RunState): void {
    this.world.player.x = run.player.x;
    this.world.player.y = run.player.y;
    this.world.player.hp = run.player.hp;
    this.started = run.started;
    this.tutorialStep = run.tutorialStep;
    this.playtimeMs = run.playtimeMs;
    this.guided = run.tutorialStep >= 0;
    this.fragmentsSeen.clear();
    for (const id of run.fragmentsSeen) this.fragmentsSeen.add(id);
    this.notesHeld.clear();
    for (const id of run.notesHeld) this.notesHeld.add(id);
    // Notes already read are gone from the ground, or the Coliseum would
    // repopulate itself with paper the player is already carrying.
    for (const note of this.world.notes) if (this.notesHeld.has(note.id)) note.taken = true;
    this.loadout = { carried: [...run.loadout.carried], known: [...run.loadout.known] };
  }

  /**
   * One reading, the first time the player does a thing.
   *
   * The guide says what to do and canon withholds why; this is the narrow band
   * in between - a sentence about what just happened, at the moment the game
   * has shown it. Silent afterwards, because a reading about something coming
   * apart into digits is worth nothing on the fortieth kill.
   */
  private fragment(on: FragmentTrigger): void {
    const found = fragmentFor(content.fragments as readonly Fragment[], on, this.fragmentsSeen);
    if (!found) return;
    this.fragmentsSeen.add(found.id);
    this.ui.showFragment(found.title, found.text);
    this.sound.play('ui');
  }

  /**
   * One note, off the ground and into the log.
   *
   * Shown immediately rather than filed silently, because a note the player
   * has to go looking in a menu for is a note most players never read - and
   * the disagreement between the two channels only works if both sides
   * actually land.
   */
  private pickUpNote(id: string): void {
    if (this.notesHeld.has(id)) return;
    const def = content.notes.find((note) => note.id === id);
    if (!def) return;

    this.notesHeld.add(id);
    this.sound.play('absorb');
    this.funnel.mark(def.channel === 'jakindur' ? 'foundNote' : 'readBulletin');
    this.ui.showFragment(def.title, def.text, def.channel);

    const disputes = pairings(content.notes, this.notesHeld);
    const fresh = disputes.find((pair) => pair.found.id === id || pair.bulletin.id === id);
    if (fresh) {
      this.funnel.mark('sawContradiction');
      // Named rather than resolved. Which of the two is lying is the one thing
      // this system exists to make the player decide.
      this.ui.toast(`That contradicts ${fresh.bulletin.title}`, 'big');
    }

    this.awardXp(this.progression.award('firstNote', id), `Picked up: ${def.title}`);
    this.ui.refresh(this.hudState());
  }

  private persist(): void {
    save(
      { inventory: this.inventory, crafting: this.crafting, progression: this.progression },
      {
        player: { x: this.world.player.x, y: this.world.player.y, hp: this.world.player.hp },
        started: this.started,
        tutorialStep: this.tutorialStep,
        playtimeMs: this.playtimeMs,
        fragmentsSeen: [...this.fragmentsSeen],
        notesHeld: [...this.notesHeld],
        loadout: this.loadout,
      },
    );
  }

  // ---------------------------------------------------------------- actions

  private hudState() {
    return {
      inventory: this.inventory,
      crafting: this.crafting,
      alchemy: this.alchemy,
      progression: this.progression,
      notesHeld: this.notesHeld,
      carried: this.loadout.carried,
      slots: LOADOUT_SLOTS,
    };
  }

  private craft(id: RecipeId): void {
    const result = this.crafting.craft(id, this.inventory);
    if (!result.ok) {
      this.ui.toast(
        result.reason === 'already-built' ? 'Already built' : 'Not enough material',
        'bad',
      );
      return;
    }
    const recipe = result.recipe!;
    const STAT_NAMES: Record<string, string> = {
      carryCapacity: 'carry',
      pullRadius: 'pull radius',
      pullSpeed: 'pull speed',
      strikeDamage: 'strike',
      strikeReach: 'reach',
      channelRate: 'recovery',
    };
    const stat = STAT_NAMES[recipe.effect.stat] ?? recipe.effect.stat;
    this.sound.play('craft');
    this.funnel.mark('crafted');
    this.fragment('firstCraft');
    this.ui.toast(`${recipe.name}: ${stat} +${recipe.effect.amount}`, 'good');
    this.tutorialProgress.crafted += 1;
    this.awardXp(this.progression.award('firstCraft', recipe.id), `First craft: ${recipe.name}`);
    this.ui.refresh(this.hudState());
  }

  /**
   * Put a combination on the arc, or take it off.
   *
   * A full bar refuses rather than evicting: four things the player chose are
   * worth more than the one they just tapped, and a bar that rearranges itself
   * is a bar nobody trusts.
   */
  private toggleCarry(id: CombinationId): void {
    const result = toggleCarried(this.loadout.carried, id, LOADOUT_SLOTS);
    if (result.change === 'full') {
      this.ui.toast(`Only ${LOADOUT_SLOTS} fit - take one off first`, 'bad');
      return;
    }
    this.loadout = { carried: result.carried, known: this.loadout.known };
    this.sound.play('ui');
    this.ui.refresh(this.hudState());
  }

  private cast(id: CombinationId): void {
    const combination = this.alchemy.cast(id, this.inventory, this.progression.level);
    if (!combination) {
      this.ui.toast(this.whyNotCastable(id), 'bad');
      return;
    }
    this.tutorialProgress.combinationsUsed += 1;
    this.sound.play('cast');
    this.funnel.mark('cast');
    this.fragment('firstCast');
    // Scaled by the gauntlets: channelRate is the one crafting stat that
    // reaches alchemy, and it is the reason the deep recipes are worth making
    // once the carry capacity has stopped being the thing holding you back.
    this.cooldowns.set(combination.id, combination.cooldownSeconds * this.inventory.cooldownScale);
    this.awardXp(
      this.progression.award('firstAlchemy', combination.id),
      `First cast: ${combination.name}`,
    );
    const killed = this.world.cast(combination);
    if (killed.length) this.waves.notifyKills(killed.length);
    this.ui.refresh(this.hudState());
  }

  /**
   * `amount` has already been added by the caller, so the level here is the new
   * one; `before` is recomputed from the XP that was not yet awarded.
   */
  /**
   * "Not enough elements" is true but useless while something is chasing you.
   * Name the element that is short and a material that carries it, so the answer
   * is "go and pull one of those" rather than "open the menu and work it out".
   */
  private whyNotCastable(id: CombinationId): string {
    const combination = content.combination(id);
    const outlook = this.alchemy.outlook(combination, this.inventory, this.progression.level);
    if (!outlook.unlocked) {
      return `${combination.name} opens at level ${content.progression.alchemyUnlockLevel}`;
    }
    const missing = Object.keys(outlook.shortfall)[0];
    if (!missing) return `${combination.name} will not fire`;

    const element = content.element(missing);
    const source = content.materials.find((m) => m.elements.includes(missing));
    return source
      ? `${combination.name} needs ${element.name} - pull a ${source.name}`
      : `${combination.name} needs ${element.name}`;
  }

  private awardXp(amount: number, message: string): void {
    if (amount <= 0) return;
    const after = this.progression.level;
    const before = this.progression.levelAt(this.progression.xp - amount);
    this.ui.toast(message, 'good');
    if (after > before) {
      if (after >= 1) this.funnel.mark('reachedLevel1');
      if (after >= content.progression.alchemyUnlockLevel) this.funnel.mark('reachedLevel2');
      this.sound.play('level');
      this.onLevelUp(before, after);
      // The cast bar is built from what the level unlocks, so it has to be
      // rebuilt here. Without this the combinations stayed invisible until the
      // next pickup, and the player had nothing to attack with.
      this.ui.refresh(this.hudState());
    }
  }

  private onLevelUp(from: number, to: number): void {
    this.ui.toast(`Level ${to}`, 'big');
    if (from < 1 && to >= 1) {
      // Canon: reaching Level 1 triggers an unmistakable warning and the first
      // bundle. That warning is the whole of the combat tutorial's setup.
      this.ui.toast('SOMETHING HAS NOTICED YOU', 'big');
      this.tutorialProgress.warned = true;
      this.waves.arm();
    }
    if (to >= content.progression.alchemyUnlockLevel) {
      this.ui.toast('The workshop is open. Alchemy, in the menu.', 'big');
    }
    this.syncLoadout();
  }

  /**
   * Hand over anything newly unlocked, once.
   *
   * A combination that unlocks and then waits in a menu for the player to go
   * and find it is a combination most players never cast. So the first free
   * slot takes it - and because `admit` remembers what it has offered, taking
   * it back off again sticks.
   */
  private syncLoadout(): void {
    const level = this.progression.level;
    const available = content.alchemy.filter((c) => this.alchemy.unlocked(c, level)).map((c) => c.id);
    const before = this.loadout.carried.join(',');
    this.loadout = admit(this.loadout, available, LOADOUT_SLOTS);
    if (this.loadout.carried.join(',') !== before) this.ui.refresh(this.hudState());
  }

  // ---------------------------------------------------------------- loop

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.started) {
      this.playtimeMs += dt * 1000;
      this.step(dt);
    }

    this.renderer.update(dt);

    // A reading the player is still in the middle of must not expire while the
    // world is stopped, which is exactly when somebody would stop to read it.
    if (!this.pause.visible) this.ui.tickFragment(dt);
    this.renderer.draw(this.world, {
      pullRadius: this.inventory.pullRadius / content.unitsPerPixel,
      pulling: this.pulling,
      showEnemies: this.waves.showingEnemies,
    }, this.input);
    this.raf = requestAnimationFrame(this.frame);
  };

  private step(dt: number): void {
    // The waking scene holds the world: canon has the player come round before
    // anything asks anything of them, and a wave timer ticking under a fade is
    // the opposite of that.
    if (this.opening.active) {
      this.opening.update(dt);
      return;
    }

    /*
     * Paused: nothing moves, including the pull.
     *
     * Ahead of the menu check below because the pause is the stronger claim -
     * a player who asked for the world to stop should not find the gauntlets
     * still gathering for them.
     */
    if (this.pause.visible) return;

    // GDD 6.1 has the world keep running while the menu is open, reasoning that
    // a pause "would have erased wave pressure in exactly the moment it should
    // bite". The author asked for a pause instead, so this honours that - and
    // the pull is suspended with it, since a menu that kept gathering for you
    // would be a stranger answer than either.
    if (content.progression.pauseWithMenu && this.ui.sheetOpen) {
      this.world.updatePull(dt, false, 0, content.progression.player.pullSeconds, 0);
      return;
    }

    const player = content.progression.player;
    const move = this.input.read();
    const wasMoving = Math.hypot(move.x, move.y) > 0.01;

    const before = { x: this.world.player.x, y: this.world.player.y };
    this.world.movePlayer(dt, move.x, move.y, player.moveSpeed);
    const walked = Math.hypot(this.world.player.x - before.x, this.world.player.y - before.y);
    this.tutorialProgress.travelled += walked;
    // Footfalls come off distance rather than time, so slow ground - the
    // Wetland, the Mountain - sounds heavy rather than just being slow.
    if (walked > 0.1) {
      this.sound.play('step');
      this.funnel.mark('walked');
    }

    this.world.updatePull(
      dt,
      this.pulling,
      this.inventory.pullRadius / content.unitsPerPixel,
      player.pullSeconds,
      this.inventory.free,
    );

    for (const id of this.world.read) this.pickUpNote(id);

    if (this.world.absorbed.length) {
      this.sound.play('absorb');
      this.funnel.mark('gathered');
      this.fragment('firstMaterial');
      if (wasMoving) this.funnel.mark('gatheredWhileMoving');
    }
    for (const material of this.world.absorbed) {
      const taken = this.inventory.add(material, 1);
      if (taken === 0) {
        this.ui.toast('The gauntlets are full', 'bad');
        continue;
      }
      this.tutorialProgress.gathered += 1;
      if (wasMoving) this.tutorialProgress.gatheredMoving += 1;
      this.tutorialProgress.distinctHeld = this.inventory.distinctCount;
      // The carry card's bar, and the last quiet milestone before the warning.
      if (this.inventory.distinctCount >= 3) this.funnel.mark('heldThreeMaterials');
      this.awardXp(
        this.progression.award('firstMaterial', material),
        `New material: ${content.material(material).name}`,
      );
      this.ui.refresh(this.hudState());
    }

    if (this.ui.attacking) this.attack();

    for (const [id, left] of this.cooldowns) {
      const next = left - dt;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }
    this.ui.setCooldowns(this.cooldowns);
    this.ui.setCombo(this.world.player.combo);

    this.world.update(dt);
    this.waves.update(dt, this.progression.level);
    this.drainEvents();
    this.refreshPlace();
    this.syncObjective();

    this.ui.setVitals(this.world.player.hp, this.world.player.maxHp);

    this.sinceSave += dt;
    if (this.sinceSave > 5) {
      this.sinceSave = 0;
      this.funnel.tick(this.playtimeMs);
      this.persist();
    }
  }

  /** Where players stop, readable from the console: maelstrom.funnelReport(). */
  funnelReport(): string {
    return this.funnel.report();
  }

  private drainEvents(): void {
    for (const event of this.world.events) {
      /*
       * Every kill, from wherever it came.
       *
       * Hooked to the event rather than to swing(), because a thing can also
       * die to a cast or to a burn ticking down, and a deletion that only
       * happened when you hit it would make the other two look like the enemy
       * had simply been forgotten.
       */
      if (event.kind === 'enemy-killed' && event.enemy) {
        const { enemy } = event;
        this.renderer.addDeletion(
          enemy.def.id,
          enemy.x,
          enemy.y,
          enemy.def.color,
          // The size drawEnemies uses, so the glyphs land on the silhouette the
          // player was actually looking at.
          (34 + enemy.def.tier * 8) * 1.35,
        );
      }
      if (event.kind === 'enemy-killed') this.fragment('firstKill');
      if (event.kind === 'player-hit') this.sound.play('hurt');
      if (event.kind === 'player-died') {
        this.sound.play('hurt');
        this.funnel.mark('died');
        this.ui.toast('You fell. Recovering...', 'bad');
      }
    }
    this.world.events.length = 0;

    for (const message of this.waves.drainMessages()) {
      // Canon calls the warning unmistakable; it is the only cue that is meant
      // to be unpleasant.
      this.sound.play('warn');
      this.funnel.mark('sawWarning');
      this.ui.toast(message, 'big');
    }
    const cleared = this.waves.takeClearedWaves();
    for (let i = 0; i < cleared; i++) {
      this.awardXp(
        this.progression.award('clearWave', String(this.waves.wavesCleared - i)),
        'Wave cleared',
      );
    }
    if (cleared > 0) this.fragment('waveCleared');
  }

  private runSummary(): string {
    const minutes = Math.round(this.playtimeMs / 60000);
    const rare = accuracyHeld(content.notes, this.notesHeld);
    return (
      `Level ${this.progression.level} - ${this.progression.countSeen('firstMaterial')} of ` +
      `${content.materials.length} materials - ${rare.found} of ${rare.total} notes - ${minutes} min`
    );
  }

  private refreshPlace(): void {
    const disc = this.world.biomeAt(this.world.player.x, this.world.player.y);
    const id = disc?.id ?? 'between';
    if (id === this.currentBiome) return;
    this.currentBiome = id;

    if (disc) {
      this.ui.setPlace(disc.name, disc.mood);
      if (disc.id !== content.spawnBiome.id) {
        this.funnel.mark('leftSpawnBiome');
        this.fragment('newBiome');
      }
      if (this.progression.countSeen('firstBiome') >= content.biomes.length) this.funnel.mark('sawAllBiomes');
      this.awardXp(this.progression.award('firstBiome', disc.id), `Reached ${disc.name}`);
    } else {
      this.ui.setPlace('The Coliseum', 'Forest, between the regions.');
    }

    /*
     * Retune the ambient bed to the region.
     *
     * Pitch and brightness are derived from the terrain rather than authored
     * per biome: fog muffles, so it closes the filter, and slow ground sits
     * lower. That way a new region gets a sound for free the moment it gets
     * terrain, and the two can never describe different places.
     */
    const terrain = this.world.terrainAt(this.world.player.x, this.world.player.y);
    this.sound.setBiome(
      44 + (1 - terrain.moveScale) * 90,
      2400 - terrain.fog * 2100,
      disc ? 0.012 + terrain.fog * 0.05 : 0.008,
    );
  }

  private syncObjective(): void {
    if (!this.guided || this.tutorialStep < 0) {
      this.ui.setObjective(null);
      return;
    }
    const steps = content.tutorial;
    this.tutorialStep = advanceTutorial(steps, this.tutorialStep, this.tutorialProgress);
    this.ui.setObjective(
      tutorialComplete(steps, this.tutorialStep) ? null : (steps[this.tutorialStep] ?? null),
    );
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    this.sound.dispose();
  }
}
