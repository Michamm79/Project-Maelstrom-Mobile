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

Three tiers, and they are renderings of hostile code rather than creatures —
which is what keeps the setting a corporate dystopia instead of a fantasy world.
Scarcity is the tuning knob; they drop nothing, because drop tables would make
fighting a gathering strategy and invert the loop.

**They wander.** They do not home in. Noticing is an encounter at 90–140 world
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

XP is **novelty only**: first material, first craft, first cast, first visit,
cleared wave. Nothing can be farmed. The curve is tuned against the guide, since
reaching Level 1 is what arms the waves: three distinct materials pays 90, the
craft the next card asks for pays 60, and Level 1 is 150 — so the warning lands
exactly on the card that explains it. Unit tests assert that alignment.

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

## Everything is generated

No binary art, no audio files. Icons, creatures, the character sprite and every
sound are produced by code:

- **Material icons** — 38 procedural shapes with a dilated keyline, banded
  shading and a baked drop shadow, all applied to every shape at once.
- **Enemies** — original creatures, one drawing each, posed by wind-up and
  stagger rather than by separate frames.
- **The character** — a pixel sheet generated from character maps and a palette
  in `tools/make-sprites.mjs`, so proportions and colours retune without
  redrawing anything.
- **Sound** — oscillators and shaped noise through envelopes. No samples.

The whole build is about 200KB. That is the reason for all of the above, and it
is also what makes the offline cache trivial.

## Shipping

- **PWA** — a generated manifest, a generated service worker that precaches the
  real hashed build output, and a cache-first fetch with a background refresh.
  Verified offline by killing the network and reloading.
- **Orientation** — the camera anchors its zoom to the longer screen axis and
  the HUD relays, so turning the phone is a rotation rather than a different
  game. The manifest must stay `"orientation": "any"` or all of that is undone
  on install.
- **Telemetry** — `web/src/core/funnel.ts` records where players stop, in
  localStorage, with no third-party SDK and nothing leaving the device.
  `maelstrom.funnelReport()` prints it. Sending it anywhere is a privacy
  decision that belongs to the author.

## Not built

Deliberately, because they need canon decisions rather than code:

- **Jakindur and the found notes.** Information Integrity only works if the two
  channels can disagree — plentiful and unreliable against rare and accurate —
  so it needs the actual prose.
- **Telemetry and the rune.** The seven signals, and the Level 2 read that
  assigns an archetype without ever showing a menu. Canon warns this cannot be
  retrofitted, since the rune reads the tutorial period as roughly half its
  evidence.
