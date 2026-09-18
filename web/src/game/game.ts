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
import {
  advanceBreach,
  breachBlocked,
  epilogueFor,
  stageIndex,
  type BreachBlock,
} from '../core/ending';
import { EndingScene } from './ending';
import {
  blend,
  emptyReading,
  mergeGrants,
  profile,
  readArchetype,
  type ArchetypeDef,
  type ArchetypeGrants,
  type Reading,
} from '../core/telemetry';
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
  private readonly ending: EndingScene;
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

  /*
   * The seven signals, and what they have been read as.
   *
   * Canon's section 10 reads the player continuously and grants a rune at
   * Level 2 and a class at Level 5, neither ever chosen from a menu. It warns
   * the system cannot be retrofitted, because the rune reads the tutorial
   * period as roughly half its evidence - which is a warning about when the
   * data starts existing, so this starts counting on the first frame and banks
   * the tutorial period the moment the rune lands.
   */
  private reading: Reading = emptyReading(content.archetypes.signals);
  private tutorialReading: Reading | null = null;
  private rune: ArchetypeDef | null = null;
  private archetype: ArchetypeDef | null = null;
  private grants: ArchetypeGrants = {};

  /** 0..1 along the boundary breach. See core/ending.ts. */
  private breach = 0;
  /** Which of the breach's stage lines has already been said. */
  private breachStage = -1;
  private breachSpawn = 0;
  /** Set once the player has got out. The run continues; the ending does not repeat. */
  private finished = false;

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
    this.ending = new EndingScene(uiRoot);

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
        ['Workshop', `${content.crafting.recipes.length} gauntlet upgrades, ${content.alchemy.length} combinations`],
        ['Enemies', `${content.enemies.length} tiers, wandering`],
        ['Lying about', `${content.notes.length} things to read, in two hands that disagree`],
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
    this.applyGrants();
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
    const result = this.world.swing();
    if (!result) return;
    this.sound.play(result.hit.length ? 'hit' : 'ui', 1 + result.combo * 0.12);
    if (result.hit.length) this.funnel.mark('struck');
    if (result.killed.length) this.funnel.mark('killed');
    for (let i = 0; i < result.killed.length; i++) this.sound.play('kill');
    this.ui.setCombo(result.combo);
    if (result.killed.length) this.waves.notifyKills(result.killed.length);
    if (result.hit.length) {
      this.tutorialProgress.struck += 1;
      this.signal('aggression', result.hit.length);
    }
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
    this.reading = emptyReading(content.archetypes.signals);
    this.tutorialReading = null;
    this.rune = null;
    this.archetype = null;
    this.applyGrants();
    this.breach = 0;
    this.breachStage = -1;
    this.breachSpawn = 0;
    this.finished = false;
    this.ui.setBreach(null, null);
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
    // Reconciled on the way back in as well as on the way out. It is cheap and
    // idempotent, and it means every route into the world - a fresh run, a
    // restored save, a quit and continue - gets the same bar.
    this.syncLoadout();
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
    this.breach = run.breach;
    this.breachStage = stageIndex(run.breach, content.ending.stages);
    this.finished = run.finished;

    this.reading = { ...emptyReading(content.archetypes.signals), ...run.telemetry.reading };
    this.tutorialReading = run.telemetry.tutorial;
    const find = (id: string | null) =>
      id ? (content.archetypes.archetypes.find((a) => a.id === id) ?? null) : null;
    this.rune = find(run.telemetry.rune);
    this.archetype = find(run.telemetry.archetype);
    this.applyGrants();
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
    this.signal('curiosity');
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

  // ------------------------------------------------------- what it reads

  /** Add to one of the seven counters. Anything not in the list is ignored. */
  private signal(name: string, amount = 1): void {
    if (amount <= 0 || !(name in this.reading)) return;
    this.reading[name] = (this.reading[name] ?? 0) + amount;
  }

  /**
   * Everything the telemetry currently has, weighted the way canon says.
   *
   * Before the rune lands there is only one period and the whole run is it.
   * After, the tutorial period is banked and counts for `tutorialWeight` -
   * canon's "roughly half its evidence" - against everything since.
   */
  private currentProfile(): Reading {
    const { scales, tutorialWeight } = content.archetypes;
    const whole = profile(this.reading, scales);
    if (!this.tutorialReading) return whole;

    const early = profile(this.tutorialReading, scales);
    const since: Reading = {};
    for (const signal of content.archetypes.signals) {
      since[signal] = Math.max(0, (this.reading[signal] ?? 0) - (this.tutorialReading[signal] ?? 0));
    }
    return blend(early, profile(since, scales), tutorialWeight);
  }

  /**
   * Read the player, and grant whatever that came out as.
   *
   * Called on level-up only. Canon has two moments - a rune at Level 2 and a
   * class at Level 5 - and nothing in between, which is what stops this being
   * a stat screen that shuffles while you watch it.
   */
  private readTelemetry(level: number): void {
    const { runeLevel, archetypes } = content.archetypes;
    const classLevel = content.progression.classLevel;

    if (!this.rune && level >= runeLevel) {
      // Bank the tutorial period at the moment it stops being the tutorial.
      this.tutorialReading = { ...this.reading };
      this.rune = readArchetype(profile(this.reading, content.archetypes.scales), archetypes);
      if (this.rune) {
        this.funnel.mark('gotRune');
        this.ui.toast(`${this.rune.rune}. ${this.rune.runeDescription}`, 'big');
      }
    }

    if (!this.archetype && level >= classLevel) {
      this.archetype = readArchetype(this.currentProfile(), archetypes);
      if (this.archetype) {
        this.funnel.mark('gotClass');
        this.ui.toast(`You have been assessed as ${this.archetype.name}.`, 'big');
        this.ui.toast(this.archetype.description, 'big');
      }
    }

    this.applyGrants();
  }

  /**
   * Fold the rune and the class into one set of numbers, and hand them to the
   * world.
   *
   * The two can be different archetypes - the rune reads the tutorial and the
   * class reads the run, and somebody whose play changed will hold one of each.
   * Canon never says they have to agree, so they merge field by field rather
   * than the later one replacing the earlier wholesale.
   */
  private applyGrants(): void {
    this.grants = mergeGrants(this.rune?.runeGrants, this.archetype?.classGrants);
    this.world.strike = {
      damage: this.inventory.strikeDamage,
      range: this.inventory.strikeReach,
      damageScale: this.grants.strikeScale,
      comboBonus: this.grants.comboBonus,
      comboMax: this.grants.comboMax,
      chargeSeconds: this.grants.chargeSeconds,
      chargeBonus: this.grants.chargeBonus,
    };
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
        breach: this.breach,
        finished: this.finished,
        telemetry: {
          reading: this.reading,
          tutorial: this.tutorialReading,
          rune: this.rune?.id ?? null,
          archetype: this.archetype?.id ?? null,
        },
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
      rune: this.rune,
      archetype: this.archetype,
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
    // Before anything else: two of the recipes raise the swing, and the world
    // holds its own copy of those numbers. Without this, crafting Coldforged
    // Knuckles changed the menu and nothing else until the next level-up.
    this.applyGrants();
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
    this.signal('alchemy');
    this.sound.play('cast');
    this.funnel.mark('cast');
    this.fragment('firstCast');
    // Scaled by the gauntlets: channelRate is the one crafting stat that
    // reaches alchemy, and it is the reason the deep recipes are worth making
    // once the carry capacity has stopped being the thing holding you back.
    this.cooldowns.set(
      combination.id,
      combination.cooldownSeconds * this.inventory.cooldownScale * (this.grants.cooldownScale ?? 1),
    );
    this.awardXp(
      this.progression.award('firstAlchemy', combination.id),
      `First cast: ${combination.name}`,
    );
    const killed = this.world.cast(combination, this.grants.castScale ?? 1);
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
    this.syncLoadout(true);
    this.readTelemetry(to);
  }

  /**
   * Hand over anything newly unlocked, once.
   *
   * A combination that unlocks and then waits in a menu for the player to go
   * and find it is a combination most players never cast. So the first free
   * slot takes it - and because `admit` remembers what it has offered, taking
   * it back off again sticks.
   */
  private syncLoadout(announce = false): void {
    const level = this.progression.level;
    const available = content.alchemy.filter((c) => this.alchemy.unlocked(c, level)).map((c) => c.id);
    const before = this.loadout.carried.join(',');
    const knownBefore = new Set(this.loadout.known);
    this.loadout = admit(this.loadout, available, LOADOUT_SLOTS);
    if (this.loadout.carried.join(',') !== before) this.ui.refresh(this.hudState());
    if (!announce) return;

    /*
     * Say what opened, and especially what opened and did not fit.
     *
     * A combination that unlocks onto a full bar goes into `known` and stays
     * off the arc, which is correct - the player chose those four - but until
     * this, nothing anywhere mentioned that it had happened. The unlock was
     * silent, and the only way to find it was to open the workshop and notice
     * a row that had stopped saying "Locked".
     */
    const fresh = available.filter((id) => !knownBefore.has(id));
    if (!fresh.length) return;
    const names = fresh.map((id) => content.combination(id).name);
    const missed = fresh.filter((id) => !this.loadout.carried.includes(id));
    this.ui.toast(
      missed.length
        ? `${names.join(' and ')} - no room on the bar, swap in the workshop`
        : `${names.join(' and ')}, on the bar`,
      missed.length ? 'info' : 'good',
    );
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

    // The same rule at the other end of the run: the scene owns the screen and
    // nothing is allowed to walk into it while the player is reading.
    if (this.ending.active) {
      this.ending.update(dt);
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
      this.signal('roaming', walked);
    }
    /*
     * Patience is time spent with nothing hunting you.
     *
     * Deliberately not "time not attacking": standing still while three
     * goblins close on you is not patience, it is being about to be hit, and
     * counting it as patience would read every cornered player as Dotore.
     */
    if (!this.world.enemies.some((enemy) => !enemy.dead && enemy.aggro)) this.signal('patience', dt);

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
      this.signal('gathering');
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
    this.updateBreach(dt);
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
      /*
       * Something fired at you, which you may not be looking at.
       *
       * The bolt is drawn with a tell and a tail, but a player fighting a
       * Minotaur is looking at the Minotaur - so the shot gets a noise as
       * well, at a lower volume than a hit, because "that came from somewhere
       * else" is the whole information a Wisp exists to deliver.
       */
      if (event.kind === 'enemy-fired') this.sound.play('ui', 0.7);

      if (event.kind === 'player-hit') {
        this.sound.play('hurt');
        this.signal('risk', event.amount ?? 0);
      }
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

  // ---------------------------------------------------------------- the ending

  /** Why the boundary will not take a pull right now, or null when it will. */
  private breachBlock(): BreachBlock {
    return breachBlocked(
      {
        fromCentre: Math.hypot(this.world.player.x, this.world.player.y),
        boundaryRadius: this.world.boundaryRadius,
        level: this.progression.level,
        built: this.crafting.isBuilt(content.ending.requires.recipe),
      },
      content.ending,
    );
  }

  /**
   * The boundary coming apart, one frame at a time.
   *
   * Only while the player is standing at the edge with the pull on. The rest of
   * this - the stage lines, the assault - hangs off the meter rather than off a
   * timer, so a player who breaks off to fight for twenty seconds comes back to
   * the same sentence they left rather than to one that has moved on without
   * them.
   */
  private updateBreach(dt: number): void {
    if (this.finished) return;

    /*
     * Nearness first, and separately from the rest.
     *
     * breachBlocked() reports the level before the distance, which is the
     * right answer for the reason string and the wrong one for deciding
     * whether to draw anything - using it alone put "The boundary is code.
     * Level 5 first." on screen from the first minute of the tutorial, in the
     * middle of a game that has not mentioned a boundary yet.
     */
    const toEdge = this.world.boundaryRadius - Math.hypot(this.world.player.x, this.world.player.y);
    const near = toEdge <= content.ending.breach.reach;
    const blocked = this.breachBlock();

    if (!near) {
      // Walked away mid-attempt: the meter holds where it is and bleeds down
      // slowly, so going back for health is not a decision to start over.
      if (this.breach > 0) this.breach = advanceBreach(this.breach, dt, false, content.ending.breach);
      this.ui.setBreach(this.breach > 0 ? this.breach : null, this.breach > 0 ? 'distance' : null);
      return;
    }

    if (blocked !== null) {
      // At the edge, and it will not open. Say which of the two it is: the
      // player has walked to the end of the world, and nothing happening with
      // no explanation is indistinguishable from a bug.
      this.ui.setBreach(this.breach > 0 ? this.breach : null, blocked);
      return;
    }

    const before = this.breach;
    this.breach = advanceBreach(this.breach, dt, this.pulling, content.ending.breach);
    this.ui.setBreach(this.breach, null);
    if (before === 0 && this.breach > 0) this.funnel.mark('startedBreach');

    const stage = stageIndex(this.breach, content.ending.stages);
    if (stage > this.breachStage) {
      this.breachStage = stage;
      const line = content.ending.stages[stage];
      if (line) {
        this.sound.play('warn');
        this.ui.toast(line.text, 'big');
      }
    }

    // The system stops scheduling and starts arriving.
    if (this.breach > 0 && this.breach < 1) {
      this.breachSpawn -= dt;
      if (this.breachSpawn <= 0) {
        const [min, max] = content.ending.breach.spawnEverySeconds;
        this.breachSpawn = (min ?? 6) + Math.random() * ((max ?? 10) - (min ?? 6));
        this.waves.assault(content.ending.breach.pressure);
      }
    }

    if (this.breach >= 1) this.finish();
  }

  /** Out. The run is kept: the world is still there, and so is the hole. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.ui.setBreach(null, null);
    this.ui.closeSheet();
    this.sound.play('level');
    this.funnel.mark('gotOut');

    const rare = accuracyHeld(content.notes, this.notesHeld);
    const epilogue = epilogueFor(rare.found, content.ending.epilogues);
    this.persist();
    if (!epilogue) {
      // Cannot happen - the build refuses a table with no zero-note entry -
      // but a missing epilogue must not be a black screen with no way out.
      this.title.show(true, this.runSummary());
      return;
    }

    this.ending.play(epilogue, this.runSummary(), () => {
      this.started = false;
      this.title.show(true, this.runSummary());
    });
  }

  private runSummary(): string {
    const minutes = Math.round(this.playtimeMs / 60000);
    const rare = accuracyHeld(content.notes, this.notesHeld);
    const out = this.finished ? 'Out - ' : '';
    return (
      `${out}Level ${this.progression.level} - ${this.progression.countSeen('firstMaterial')} of ` +
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
      // Arriving somewhere new is worth more than a note: it is the larger
      // decision, and it is the one canon builds the whole world shape around.
      if (!this.progression.hasSeen('firstBiome', disc.id)) this.signal('curiosity', 3);
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
