# Store and social copy

Player-facing writing for a storefront, an itch page or a post. Distinct from
`docs/PORTFOLIO.md`, which is written for someone assessing the engineering —
this one is written for someone deciding whether to tap.

Everything below is checked against what the build actually does. The
**Do not add** list at the bottom is the part that keeps it that way.

---

## Cover art

`docs/cover/cover.png` — 1024×1024, square.
`docs/cover/cover-clean.png` — the same image with no type, for when something
else supplies the title.

Regenerate with `npm run cover`, or `COVER_SIZE=2048 npm run cover` for a larger
master. It is drawn by the game's own art code — the real sprite sheet, the real
`drawCreature`, the real `drawIcon`, every colour read out of `content/` — so it
cannot drift away from what the game looks like.

What is in it, in case a caption is wanted: the pull spiral that the whole game
is built on, the four outer regions in their own palettes in the four corners
where canon puts them, one material from each region being dragged in, all three
enemy tiers with the awareness markers the player gets over them, and one very
small person at the middle of it.

---

## One line

> You wake in a bounded arena with no memory, no explanation, and two gauntlets
> that eat the world as you walk.

## Short blurb (~50 words)

> You woke up here. Nobody explains why. Your gauntlets pull the world in as you
> walk — no aiming, no gathering button, no stopping. Craft what you find into
> permanent upgrades, break the rest into elements, and turn those into the only
> weapons you are ever going to get.

## Full description

### The pull is the whole game

There is no pickaxe. No *press and hold to harvest*. No sparkle you have to
stand in the middle of. You walk, and the world comes to you — ore, glass,
fungus and stranger things spiralling in through the half-orbs above your hands.

Gathering is a toggle, and it starts **on**. The button exists so you can turn it
*off*.

### Two disciplines, and they are not the same verb

- **Crafting** spends materials and pays out permanent gauntlet upgrades — carry
  more, pull further, pull faster. Open from the moment you stand up.
- **Alchemy** spends elements and pays out abilities. It does not open until
  Level 2, and it is the only offence you will ever have beyond your own two
  hands.

The orbs above your hands **display**. They do not store. Your pack stores, and
it stops at 60 until you craft your way past it.

### One arena. No loading. No level gates.

Roughly 1.5km across, five regions, one continuous surface. The spawn sits in the
middle and it is generous — eight of the ten elements are right there. The other
two are not: cold lives on the mountain, shadow lives in the dead data-centre.

Nothing stops you walking straight at either one five minutes in. Distance *is*
the difficulty curve, and the game will not save you from your own ambition.

Regions are not skins. The wetland genuinely slows you down and genuinely hides
you. The desert is genuinely exposed — things spot you from half again as far
out. The data-centre fogs your sight and hums at you in coolant.

### The world does not know where you are

Enemies do not lock on. They wander around minding their own business and only
notice you from about two body-lengths away. Break off and they forget you and
go back to wandering.

You, meanwhile, feel everything within 1400 units — a permanent, silent read on
what is out there and how big it is. That advantage is the only one you get, and
the whole design is built to keep it yours.

Three tiers, and they are renderings of hostile code rather than animals. A
goblin is what the system spends when you are not worth much. A Minotaur means
something in there decided you were.

### Nothing can be farmed

XP is **novelty only**: first material, first craft, first cast, first time you
set foot somewhere new, first wave cleared. Standing in one spot killing the same
thing forever pays exactly nothing. There is no grind here because there is
nothing to grind.

### It gets quiet on purpose

Level 0 has no enemies at all — just you and a world to take apart. Level 1 sends
one bundle of three waves, after a warning you cannot miss. Clear it and the
world goes quiet again. What you do with that quiet is the actual game.

---

## What it is, honestly

- **Runs in a phone browser.** The title screen offers to install it — a real
  prompt on Android, and on iOS it points you at the button Safari hides in the
  share sheet. Installed, it plays with no signal at all and updates itself.
- **No download required to try it.** The link is the game.
- **Free.** No ads, no purchases, no account, no third-party tracker. It keeps a
  small record of where players stop, on the device, and nothing leaves it.
- **Roughly 30–60 minutes of content.** A vertical slice, not a finished game.
- **No art files and no audio files.** Every sprite, creature, icon and sound is
  generated by code while you play. The entire game is 43KB.
- **Single player.**

---

## Do not add

The copy above is worth what it is because all of it is true. Things that are
not, however much they would help a store page:

- ❌ Not on any app store. It is a web build.
- ❌ No download counts, player numbers, reviews or revenue. Do not invent them.
- ❌ Not endless, not procedurally generated, no "hundreds of hours". The world
  is fixed and hand-authored, and the slice is short.
- ❌ No multiplayer, no co-op, no leaderboards.
- ❌ Do not call the art AI-generated images. It is procedural drawing code, and
  a technical reader will notice the difference.
- ⚠️ **How to credit the work is the author's call**, not this file's. Describe
  the actual working arrangement; do not reach for "solo-developed" because it
  sounds better.
