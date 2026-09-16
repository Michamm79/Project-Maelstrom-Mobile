# Design notes

What this build actually is, and why it is shaped this way. Canon is the GDD and
the pitch deck; where this departs from them it says so and why.

> This file previously described a different game entirely — a transmutation
> tree, zones called Hollow Verge and Rustpine Wood, alchemy gated at level 5,
> `XP = 60 × level^1.45`. None of that survived the rebuild onto the GDD. It was
> a port of `Project_Maelstrom`, an earlier Unity orb prototype that shares the
> name; the GDD's project is Unreal Engine 5.8.

## The loop

**The pull is the verb.** There is no gathering tool. The gauntlets draw nearby
material in along a spiral — a radius overlap, not a trace from a crosshair —
with no aiming and no charge-up, and it works at walking pace. Canon calls that
last part the rule the entire world shape depends on, so it is the one thing the
tests guard hardest.

Two disciplines consume what you gather, and they are deliberately not the same
verb:

| | spends | produces | opens at |
|---|---|---|---|
| **Crafting** | materials | permanent gauntlet upgrades | from the start |
| **Alchemy** | elements | combat abilities | Level 2 |

The orbs **display**; they do not store. Inventory stores, capped at 60 units and
raised permanently by crafting. Nothing is ever loaded into an orb.

## The world

One continuous bounded Coliseum, roughly 1.5km across. Plains/Forest is the
permanent spawn at the centre; four regions ring it on the diagonals at equal
distance with connective forest between. **Nothing loads and nothing gates on
player level** — distance from spawn is the difficulty axis, and it costs
nothing to build because it is already in the shape.

Each region is a place rather than a palette. Terrain values in
`content/biomes.json` make each mood line literally true:

| region | walking | concealment | sight | fog |
|---|---|---|---|---|
| Plains / Forest | 1.0 | 1.0 | 1.0 | — |
| Snowy Mountain | 0.86 | 1.05 | 0.92 | 0.20 |
| Desert | 0.94 | **1.45** | 1.30 | — |
| Wetland | **0.78** | **0.60** | 0.70 | 0.30 |
| Abandoned Data-Center | 1.0 | 0.80 | 0.72 | **0.42** |

Concealment multiplies how far enemies notice you *while you are standing
there*, so the Wetland's "cover in every direction" and the Desert's "nowhere to
hide" are properties of where you chose to stand. Values blend across the disc
edge, so a border is a gradient rather than a step. The spawn must stay at 1.0
on every axis — it is the baseline everything else is read against, and the
content build enforces that.

Ten invented elements, eighteen materials, each locked to one region.
**Plains/Forest yields eight of the ten.** The two it withholds are Glacite and
Umbrel: you want cold, you climb; you want to disappear, you walk into the
corporate ruin you are hiding from. That gating is the world's only reason to
leave the centre, so the build asserts it rather than trusting it.

## Enemies

**Seven kinds over canon's three tiers**, and they are renderings of hostile
code rather than creatures — which is what keeps the setting a corporate
dystopia instead of a fantasy world. Scarcity is the tuning knob; they drop
nothing, because drop tables would make fighting a gathering strategy and invert
the loop.

Canon names three — goblin, Minotaur, Scythe-bearer — and those three are
untouched, stats included. The other four are **inferred**, flagged as such in
`content/enemies.json`. Canon's three all resolve the same way, by walking at
you and swinging, so a fight was only ever a question of how long it took. The
rule for adding a kind is that it has to make some approach that was working
stop working:

| Kind | Tier | The question it asks |
| --- | --- | --- |
| Goblin | 1 | None. It closes and it swings — 16 HP, the combat tutorial. |
| Imp | 1 | Can you land a hit at all? 96 speed against your 84 sprint, 7 HP. |
| Wisp | 1 | Can you reach it? It holds at 190 units and shoots from 300. |
| Minotaur | 2 | Can you take one? 12 damage a swing, 58 HP. |
| Golem | 2 | Can you hit *hard*? 6 armour turns a 9-damage swing into 3. |
| Scythe-bearer | 3 | Canon's rare one, unchanged: 140 HP and 26 a hit. |
| Lich | 3 | Can you choose a target? It repairs everything else at 5/s. |

Three of those break an assumption the player has been allowed to build for an
hour: that enemies come to you, that damage is damage, and that the field only
ever gets smaller. Each needs one new behaviour, and each behaviour is a rule in
the build because each fails silently:

- **Armour** subtracts before the hit lands, with a floor at 25% of the swing so
  nothing is ever immune. A Golem takes 3 from a basic swing and 20
  from a 26-damage one, which is the point: chip damage stops paying
  and the alchemy menu starts. Applied in one damage path and not the other it
  would have looked like a damage roll, so the tests drive both.
- **Ranged** kinds stop at `keepDistance` and fire instead of closing. The build
  caps bolt speed at four times sprint, so walking out of one is always
  possible, and it rejects a ranged kind whose attack reaches past the distance
  at which it forgets you — an enemy that shoots from outside its own leash.
- **Mending** repairs everything in radius except the mender, never past full and
  never the dead. A bowed line is drawn from the Lich to each thing it is
  holding up, because a mender you cannot see is just an enemy that will not die.

The Lich keeps 150 units and swings at 38, which on paper is a kind that retreats
from its own attack. It backs off at 58 and you sprint at 84, so it can be run
down — asserted in a test, because "its melee never fires" is not something the
game would report.

**They wander.** They do not home in. Noticing is an encounter at 90–150 world
units, not a detection sweep — the build rejects anything above 200 — and they
forget and go back to roaming once you are past `loseRadius`. The player, in
exchange, senses everything within 1400 units. That asymmetry has a direction:
the program does not know where the intruder is, and the build fails if the
player's awareness is ever narrower than an enemy's notice.

## Pacing

The opening is slow on purpose. Canon spaces wave bundles roughly thirty minutes
apart and puts **one** bundle in Milestone 1A, with repeating bundles and
ambient enemies both deferred. So the early game is not a faster cycle; it is
the absence of a cycle.

- **Level 0** — no enemies exist at all. The gathering tutorial.
- **Level 1** — one bundle of three waves, after an unmistakable warning.
- **Cleared** — the world goes quiet. Nothing is scheduled.
- **Level 5** — repeating bundles and the ambient population begin.
- **After that** — the shape stays and the size grows. Past the four authored
  composition rows a bundle gets 18% heavier per bundle up to 2.2×, the quiet
  shrinks geometrically to a seven-minute floor, and the ambient population is
  topped back up during the gaps. The scaling is also what makes canon's *"only
  a few"* Scythe-bearers mean scarcity rather than a hard limit of one.

`maxLiveEnemies` caps the whole thing at 36 — the heaviest authored bundle is
16, and the escalation multiplies by up to 2.2. That is a phone, not a design
opinion, and it is measured: a field held at the cap while a third of it is
deleted every half second runs at a p50 of 16.9ms and a p95 of 19.9ms in
headless software rasterisation, which is a pessimistic floor.

XP is **novelty only**: first note, first material, first craft, first cast,
first visit, cleared wave. Nothing can be farmed. The curve is tuned against the
guide, since reaching Level 1 is what arms the waves: three distinct materials
pays 90, the craft the next card asks for pays 60, and Level 1 is 150 — so the
warning lands exactly on the card that explains it. Unit tests assert that
alignment.

Because novelty is finite, the total a run can earn is **computable**, and the
build computes it. Doing everything once pays 2,895. The escalation and the
ending both sit at Level 5, which is 1,420 — about half of everything. This
matters because it was wrong: the curve previously put Level 5 at 1,970 against
a ceiling of 1,400, so the entire late game sat behind a door that could not
open in any run. Nothing failed. The game simply stopped having a second half.
`build-content.mjs` now fails the build when any gated level sits above the
ceiling.

## Getting out

There is a win condition, and it is made out of the systems that already exist
rather than bolted to the end of them.

It needs **Level 5**, so it needs progression. It needs the **Maelstrom Draw**,
which costs material from all five regions, so it needs the gathering loop and
the travel the world is shaped around. And it is performed with the **pull**,
which is canon's verb rather than something invented for a finale. Walk to the
edge of the Coliseum and hold it: the boundary takes about fifty seconds, and
the system stops scheduling and starts arriving while you do. There is no boss —
the Scythe-bearer turning up while you are holding the pull is the fight.

Breaking off to fight costs progress without undoing the attempt. A meter that
emptied would make the only viable play standing still and tanking, which is the
least interesting thing the combat can do, and the build refuses a decay rate
faster than the fill rate for exactly that reason — it caught the first numbers
written for it.

The epilogue depends on how many of Jakindur's five notes you found. Three of
them. Nothing ever tells the player which one they got.

Only the spacing *inside* a bundle is compressed for mobile. `content/waves.json`
carries both; set `activePacing` to `"canon"` for the PC timings.

## Two departures from canon

Both deliberate, both flagged in content rather than buried:

1. **The menu pauses the world.** GDD §6.1 says the opposite — *"a pause would
   have erased wave pressure in exactly the moment it should bite"* — and the
   author asked for a pause. Built as asked, with that quote next to the flag.
2. **A contradiction inside canon.** §5.2 lists `Coolant Residue (GLC·VSN)` in
   the Data-Center while §5.3 says *"Glacite — Snowy Mountain only."* The build
   encodes the reading that keeps both true: §5.3 describes what the **spawn**
   withholds, not exclusivity everywhere. Worth resolving in the document.

## How content works

```
content/*.json  ->  tools/build-content.mjs  -+-> content/generated/…json   (web)
                                              +-> unity/…/Resources/…json   (reader only)
```

The builder enforces canon rather than style. Among the rules that fail a build:
an element symbol that is not exactly three letters (the table once shipped `Fe`
and `Te`); a material scattered outside its own region; a spawn that yields
other than eight elements; Umbrel outside the Data-Center; a tutorial
combination that would require travel; an enemy with a drop table; per-unit
gather XP; a bundle that is not three waves; a notice radius wide enough to be a
detection sweep; a biome with no terrain. CI also fails if the committed bundle
has drifted from `content/`.

Most of the rules exist because the thing they catch had already happened and
nothing had reported it. The ones added with the late game are all of that kind:

- **an element no combination wants.** Seven of the ten sat in that state
  through several releases — gatherable, carryable, readable about, and then
  nothing — while canon's own gating rule was buying travel that paid out in it.
- **a gated level above the XP ceiling.** See above.
- **a region no recipe wants anything from.** Canon's four recipes are all
  buildable at the spawn, which left the outer four regions paying in elements
  only.
- **a self-cast that does nothing to the caster**, a beam with no range, a chain
  that cannot leap, a shield with no duration, a slow that speeds things up.
  Every one of them spends the elements, plays the sound, starts the cooldown,
  and does not do anything.
- **one channel and a rumour** — a rare note channel that agrees with
  everything, a note arguing with something that does not exist, or a bulletin
  allowed to be right on purpose. Information Integrity with nothing
  contradicting anything plays exactly like the working version.
- **an escalation that does not escalate**, a gap multiplier at or above 1, a
  live cap below a single wave.
- **an ending gated on a recipe that no longer exists**, a breach meter that
  decays faster than it fills, or an epilogue table with a hole in it.
- **a tier with one kind in it**, a ranged enemy that shoots past the distance at
  which it forgets you, a bolt faster than the player can ever outrun, armour
  that outweighs every attack in the game, or a mender that repairs itself.

## Everything is generated

No binary art, no audio files. Icons, creatures, the character sprite and every
sound are produced by code:

- **Material icons** — 38 procedural shapes with a dilated keyline, banded
  shading and a baked drop shadow, all applied to every shape at once.
- **Enemies** — original creatures, one drawing each for all seven, posed by
  wind-up and stagger rather than by separate frames. The silhouettes are
  deliberately unlike each other, because the deletion effect samples the real
  drawing: a kind without one does not come apart into binary, it vanishes.
- **Deletion** — a killed enemy does not fall over and does not fade like a
  body. Canon says the tiers are renderings of hostile code, so the rendering
  comes apart: a white flash, a conversion sweeping up from the feet, and the
  silhouette standing there as flickering ones and zeroes before it drifts off.
  The glyph positions are sampled from the real `drawCreature` output rather
  than scattered in a box, which is what makes it read as *that goblin* being
  deleted, horns and scythe included.
- **The character** — a pixel sheet generated from character maps and a palette
  in `tools/make-sprites.mjs`, so proportions and colours retune without
  redrawing anything.
- **Sound** — oscillators and shaped noise through envelopes. No samples.

The whole build is about 268KB unpacked, 60KB over the wire. That is the reason for all of the above, and it
is also what makes the offline cache trivial.

## Shipping

- **PWA** — a generated manifest, a generated service worker that precaches the
  real hashed build output, and a cache-first fetch with a background refresh.
  Verified offline by killing the network and reloading.
- **Orientation** — the game is meant to be played sideways, and asks for it in
  three steps: `screen.orientation.lock('landscape')`, then fullscreen and the
  same lock, then rotating its own box with a transform. Only the last works on
  iOS, and only the last works on *any* phone whose owner has rotation lock
  switched on - the one case where "turn your phone" is a dead end rather than
  advice. The manifest stays `"orientation": "any"` on purpose: a lock there
  would override the player's own setting, and only on Android.

  The fallback is the part with teeth. A rotated element's bounding rect is its
  axis-aligned cover, so anything that measured one got the axes swapped: the
  backing store came out portrait inside a landscape box, the stick steered
  sideways, and `@media (orientation: landscape)` kept answering about the
  phone rather than the box. The box publishes its own shape instead -
  `data-shape`, `data-squat`, `--box-w`, `--box-h` - and every touch is mapped
  through one inverse in `screen.ts`.

- **How much world is on screen** — the camera anchors its zoom to the longer
  screen axis, so turning the phone is a rotation rather than a different game.
  That span is a setting rather than a constant: 700 put 700x315 units on a
  phone held sideways and read as a letterbox, and 900 - the new default -
  shows about two thirds more ground while still drawing the character at
  49px. Close (760) and Wide (1080) sit either side of it, in the menu's Screen
  tab. It is purely presentational; reach, speed and spawn density are all in
  world units and do not move.
- **Installing** — the build is a working PWA, and with no store account that
  is the entire distribution plan: installed, it runs from a home screen, plays
  offline, and picks up every push silently the next time it opens online. The
  only thing standing in the way is that nobody finds an install buried in a
  browser menu, so the title screen offers it. Three states, because the
  platforms differ: a real prompt where Chromium hands one over, instructions on
  iOS where Safari installs from the share sheet and nothing in a page can open
  it, and silence for anyone already installed. `beforeinstallprompt` is caught
  by six lines inline in `index.html` rather than from the bundle, because it
  fires before a deferred module has evaluated and the offer would otherwise
  never appear on the slow connections most likely to want an offline copy.

- **Telemetry** — `web/src/core/funnel.ts` records where players stop, in
  localStorage, with no third-party SDK and nothing leaving the device.
  `maelstrom.funnelReport()` prints it. Sending it anywhere is a privacy
  decision that belongs to the author.

## What the world tells you

The guide says what to do, and canon is explicit that it withholds why. But
withholding why is not the same as saying nothing, and the build had the player
wake with no memory into a world that then never mentioned the situation again.

Six **fragments** in `content/tutorial.json` fire on first-time actions — first
material, first craft, first kill, first cast, first new region, first wave
cleared — so the reading always lands on the thing it is about. The deletion
fragment arrives the first time something comes apart into digits in front of
you. Each fires once per run, and starting over gives them back.

Every word of them is **inferred, and flagged as such** in the content file
alongside what canon does support. They are deliberately one channel with no
narrator, and they claim to be neither of the two below.

## Information Integrity

Canon describes two channels of information about the world: one plentiful and
unreliable, one rare and accurate, with Jakindur as the author of the second.
The system only means anything if the two can **disagree**, so the disagreement
is modelled rather than implied.

Fourteen **system bulletins** in `content/notes.json`, numbered and
procedurally reassuring, at least two in every region and the most at the spawn.
Five **found notes** in the other hand, one per region, sitting further out than
the material nodes cluster — he was not posting them where a notice board would
go. Both are picked up by the pull, with no capacity check, because paper is not
ore.

Each of the five names the bulletin it contradicts. The Log tab draws the
pairing only when the player is holding **both halves**: showing it otherwise
hands them the accurate channel's conclusion without the unreliable one's claim,
which is the single thing this system asks them to work out for themselves. It
is never marked which side is right.

A player who reads only the bulletins can finish the game believing something
specific and wrong. That is the intended outcome, and it is the only reason to
build two channels instead of one.

Every word of it is invented and flagged in the content file, alongside what
canon does support.

## Being assessed

GDD §10 reads the player continuously and grants a **rune at Level 2** and a
**class at Level 5**, neither ever chosen from a menu. §9 names three archetypes
and gives each a mechanical identity — and those hooks are what each one is
built out of, rather than three sets of invented numbers:

| | canon's line | what it grants |
|---|---|---|
| **Amorratua** | damage scales with *"consecutive hits without disengaging"* | a longer combo ceiling and double the per-hit bonus |
| **Nahaste** | *"near-zero unarmed capability"*, given as this archetype's **cost** | basic attack at 0.4×, casts at 1.45×, cooldowns at 0.7× |
| **Dotore** | builds charge *"released into the next attack"* | a charge that fills while you are not swinging |

Seven signals — gathering, roaming, aggression, alchemy, patience, curiosity,
risk — each normalised against its own scale so that 26,000 units walked is the
same amount of evidence as twelve casts. Without those scales, roaming drowns
out everything else purely by being counted in smaller pieces, and reads every
player as Dotore.

> Canon warns this **cannot be retrofitted**, since the rune reads the tutorial
> period as roughly half its evidence. That is a warning about *when the data
> starts existing*, not about the grant — so the read starts on the first frame,
> the tutorial period is banked the instant the rune lands, and the class read
> weights that banked period at exactly half against everything since. The whole
> reading is saved, because a run resumed the next day with that period missing
> would be read as somebody who never did a tutorial.

The rune and the class can be **different archetypes**. Somebody whose play
changed will hold one of each, and the grants merge field by field rather than
the later one replacing the earlier. Canon never says they have to agree.

It is shown in the **Log**, next to the two channels arguing about the system,
because that is what it is — and the row says *"You were not asked"*, because a
player looking at it will go looking for the menu that let them pick it.

## Not built

- Nothing named in canon is now unbuilt. The two systems that were —
  Information Integrity and the telemetry read — are above.

One thing that is built but is the author's to replace:

- **Everything past canon.** Eight of the eleven alchemy combinations, nine of
  the thirteen recipes, four of the seven enemy kinds, all nineteen notes, the
  ending, every level above 2, and every number in the archetype read are
  inferred. Each is flagged in its own
  content file with what canon does support and what was invented on top of it —
  so replacing any of them is an edit to one JSON file, not an archaeology
  exercise.
