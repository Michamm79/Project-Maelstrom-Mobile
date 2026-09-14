# Design notes

## The loop

Gather → fill both orbs → transmute → the result goes in your pack → load it
back into an orb → transmute again, deeper.

At level 5 a second verb opens up: instead of pairing a material, break it into
elements, pool those, and spend them on recipes that no pair of materials can
produce. Transmutation is *combination*; alchemy is *decomposition and
recombination*. The second is strictly harder to reason about, which is why it
is the one that's gated.

## Progression

| Level | What opens |
|---|---|
| 1 | Hollow Verge. Six materials, six recipes. |
| 2 | Rope, snare. |
| 3 | **Rustpine Wood.** Resin, glowcap, bone, gale moss. The kiln. |
| 5 | **Alchemy.** Decompose ⚗ and the element pool. |
| 6 | **Cinder Flats.** Coal, sand, obsidian, ember bloom. Glass and brick. |
| 8 | The forge — brick × 2. Gates all metalworking. |
| 10 | **Ferrous Deep.** Iron, silver, crystal. Ingots. |
| 12 | Swords, lenses, lanterns, mirrors. |
| 15 | **The Maelstrom Rim.** Voidglass, aetherdust. Runes. |
| 18 | Orb Focus. |
| 20 | **Maelstrom Key.** |

XP is `60 × level^1.45`, cumulative, rounded to 5. Discovering a recipe pays full
XP; repeating it pays 20–25%, so the reward is for *finding* things, and grinding
a known recipe is deliberately weak.

## The tech tree

Four gates structure the whole thing, each one a station rather than a level check:

```
flint + flint  -> ember          the first fire
clay  + ember  -> kiln           unlocks glass and brick
brick + brick  -> forge          unlocks every metal
stone + aetherdust -> rune stone unlocks the arcane tier
```

The longest ingredient chain — eight tiers of crafting into the Void Blade.
The Maelstrom Key sits one tier above it at nine, pairing the Orb Focus with an
alchemy product:

```
fiber+fiber -> cord
stone+stone -> whetstone                 flint+flint -> ember
                                         clay+ember  -> kiln
                                         clay+kiln   -> brick
                                         brick+brick -> forge
iron_ore+forge   -> iron_ingot
iron_ingot+whetstone -> iron_blade
iron_blade+cord  -> iron_sword
voidglass+iron_hammer -> void_shard
void_shard+iron_sword -> void_blade
```

A test walks this simulation for real — gathering everything available at each
level, crafting everything craftable, decomposing for elements, brewing what it
can afford — and asserts that all 69 materials come out reachable and the
Maelstrom Key is obtainable. If a content edit strands an item, that test fails.

## Elements

Nine, none of them a real element, per the original's insistence:

Principal gathered sources — crafted materials inherit whatever their inputs
carried, so most things decompose into several of these at once.

| | | Gathered from |
|---|---|---|
| **Pyron** | fire | coal, flint, resin, obsidian, ember bloom |
| **Aqualis** | water | spring water, clay |
| **Terran** | earth | stone, clay, flint, sand, coal, iron ore |
| **Zephyr** | air | gale moss, sand, aetherdust |
| **Verdant** | life | fiber, stick, glowcap, resin, gale moss |
| **Ferric** | binding | iron ore, silver ore |
| **Lumis** | light | glowcap, silver ore, crystal |
| **Umbral** | shadow | bone, obsidian, voidglass |
| **Aether** | void | crystal, voidglass, aetherdust |

Scarcity follows the zones: Ferric and Lumis need the level-10 mine, Aether the
level-15 rim. So the alchemy recipes gate themselves by geography as much as by
level — Philosopher's Ember needs Aether, and Aether is only found at the Rim.

## Zones

Sized so roughly five or six nodes are on screen at once — enough that there's
always something to walk toward, sparse enough that walking is a real decision.
Nodes respawn on a 14–22 second timer, shown as a filling ring, so a small zone
doesn't strip bare.

Layout is seeded from the zone id, so a region looks the same every time you come
back to it. It reads as a place rather than a shuffle.

## Mobile-specific decisions

- **Floating joystick.** It appears where your thumb lands. A fixed stick makes
  you look down and find it.
- **Gather is a button, not proximity pickup.** Automatic pickup takes the choice
  away and fills your orbs with whatever you walked past.
- **Sheets, not screens.** Pack, alchemy, codex and travel are bottom sheets over
  the running game, so you never lose your place.
- **Text and lists are DOM, not canvas.** Native scrolling on a phone beats
  anything hand-rolled, and the canvas stays for the parts that need it.
- **The whole build is 22 KB gzipped.** It loads instantly on a phone connection.

## Tuning

All of it is in `content/progression.json` — move speed, gather radius, XP
values, the level curve, the decomposition yield. Change a number, run
`npm run build:content`, and both runtimes have it.
