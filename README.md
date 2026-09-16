# Project Maelstrom — Mobile

A touch-first mobile build of **Project Maelstrom**, following the game design
document.

You wake at the centre of a bounded arena you did not choose, with two half-orbs
above your hands and no memory of how you got here. The gauntlets pull material
out of the world as you walk. You craft that into permanent upgrades, break it
into elements, and recombine those into abilities. Nothing explains why.

**Play it:** https://michamm79.github.io/Project-Maelstrom-Mobile/ — open on a
phone. The title screen offers to install it; on Android that is a real prompt,
and on iOS it tells you where Safari hides the button. Installed, it runs from
the home screen, plays with no signal, and picks up every push silently the next
time it opens online — which is the whole distribution plan, since there is no
store account.

> **Note on history.** An earlier version of this build was a port of
> [`Project_Maelstrom`](https://github.com/Michamm79/Project_Maelstrom), which
> turned out to be a separate, much earlier Unity orb prototype that happens to
> share the name — the GDD's project is Unreal Engine 5.8. Everything built from
> it (a 69-material transmutation tree, level-gated zones, weapon items) was a
> faithful port of a different game and has been replaced. `unity/` is what
> remains of it; see the caveat at the bottom.

---

## No assets

There are no image files and no audio files in this repository. Every sprite,
icon, creature and sound is produced by code at runtime:

| | how |
|---|---|
| Character sprite | character maps and a palette, in `tools/make-sprites.mjs` |
| Material icons | 38 procedural shapes with a dilated keyline and banded shading |
| Enemies | vector drawings posed by wind-up and stagger, not animation frames |
| Deletion | killed enemies come apart into binary sampled from their own silhouette |
| Sound | oscillators and shaped noise through envelopes, via Web Audio |
| App icons | generated from code, including the favicon and manifest |

The whole build is **43KB gzipped**. That is the reason it installs instantly,
caches completely and plays with no network.

The **cover art** in `docs/cover/` is drawn the same way, by the game's own
art code — the real sprite sheet, the real creatures, the real item shapes,
every colour read out of `content/`. `npm run cover` regenerates it at any size.

## How to play

**Hold the phone sideways.** The game asks the device to turn itself, and turns
its own box when the device refuses - so it plays horizontally even with
rotation lock switched on, where "just rotate your phone" does nothing. Both of
those, and how much world the camera shows, are in the menu's **Screen** tab.

Two thumbs. The left half of the screen moves you; the right hand is a cluster
in the shape a mobile action MMO uses.

- **Move** — drag anywhere on the left. The stick appears where you touch it.
- **ATTACK** — large, under the thumb. Auto-targets the nearest enemy and turns
  to face before swinging. Staying on one target builds the hits; backing off
  resets them. A tap lands one; holding chains them.
- **Skills** — arced above the attack, one per combination you have, with the
  element cost on the face and a cooldown sweeping up from the bottom. Tapping
  fires immediately.
- **PULL** — set apart so it is never hit mid-fight. Gathering is a **toggle
  that starts on**, so walking is enough; the button exists to turn it off.
- **Transmute** — the menu holding both crafting and alchemy, with a live count
  of what can actually be made or cast right now. The world pauses while it is
  open. Its third tab is **Screen**: the view size (Close / Normal / Wide) and
  whether to play sideways.

A short guide runs on a new game and is completed by playing, never by pressing
*next*. Progress saves to the device. Keyboard works too (WASD/arrows), and Esc
pauses, which is handy in a desktop browser.

The title screen is a menu — **Settings**, **How to play** and **About** — and
the same pages are reachable mid-run from the pause control in the top bar.
Quitting there saves and returns to the menu; it is not the same as starting
over, and only one of those can be taken back.

## The loop

**The pull is the verb.** There is no gathering tool. The gauntlets draw nearby
material in on a spiral — a radius overlap, not a trace from a crosshair — with
no aiming and no charge-up, and it works at walking pace. Canon calls that last
part the rule the entire world shape depends on.

Two disciplines consume what you gather, and they are deliberately not the same
verb:

| | spends | produces | opens at |
|---|---|---|---|
| **Crafting** | materials | permanent gauntlet upgrades | from the start |
| **Alchemy** | elements | combat abilities | Level 2 |

The orbs **display**; they do not store. Inventory stores, capped at 60 units
and raised permanently by crafting.

## The world

One continuous bounded arena, roughly 1.5km across. Plains/Forest is the
permanent spawn at the centre; four regions ring it on the diagonals with
connective forest between. **Nothing loads and nothing gates on player level** —
distance from spawn is the difficulty axis.

Each region is a place rather than a palette:

| region | walking | concealment | sight | fog |
|---|---|---|---|---|
| Plains / Forest | 1.0 | 1.0 | 1.0 | — |
| Snowy Mountain | 0.86 | 1.05 | 0.92 | 0.20 |
| Desert | 0.94 | **1.45** | 1.30 | — |
| Wetland | **0.78** | **0.60** | 0.70 | 0.30 |
| Abandoned Data-Center | 1.0 | 0.80 | 0.72 | **0.42** |

Concealment multiplies how far enemies notice you *while you are standing
there*, so cover and exposure are properties of where you chose to stand.

Ten elements, eighteen materials, each locked to one region. **Plains/Forest
yields eight of the ten** — it withholds Glacite and Umbrel, which is the
world's only reason to leave the centre.

Enemies **wander**; they do not home in. Noticing is an encounter at 90–140
world units, and they forget once you break away. You, in exchange, sense
everything within 1400 units. The advantage is meant to be yours.

`docs/DESIGN.md` has the full design notes, including the two places this build
deliberately departs from canon.

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173 — open it on your phone over the LAN
```

```bash
npm test             # 147 unit tests over the core systems
npm run build        # content + icons + typecheck + bundle + service worker
npm run smoke        # builds, then drives the real game in headless Chromium
npm run screenshots  # regenerates docs/screenshots/
npm run cover        # regenerates the cover art in docs/cover/
```

`npm run smoke` is the interesting one: it runs the built game in a phone-sized
browser and asserts **129 behaviours** — playing from the title screen through
the opening, gathering, crafting, combat and a restart; driving **real
multi-touch through CDP**, because a browser does not synthesise a `click` for a
touch inside a multi-touch sequence and a click-bound control silently does
nothing while the other thumb is on the stick; reading rendered pixels back to
prove the icon lighting actually composited; surveying both orientations for HUD
overlap; and walking the real "Start over" buttons rather than calling a method.

One section drives the game in a **rotated box** — a portrait phone that will
not turn — and checks the things a screenshot cannot show: that the canvas
backing store came out landscape rather than portrait-stretched, and that a
thumb dragged toward the phone's bottom edge walks the player *left*. Get the
inverse transform wrong and the game looks perfect and steers sideways.

## Content is data, and it is validated

Neither runtime owns the content:

```
content/*.json            <- hand-authored
        |
        v
tools/build-content.mjs   <- validates against the design's own rules
        |
        +--> content/generated/maelstrom-content.json       -> the web build
        +--> unity/Assets/Resources/maelstrom-content.json  -> read by ContentDatabase.cs
```

The builder enforces canon rather than style. It refuses to emit a bundle where
an element symbol is not exactly three letters (the table once shipped `Fe` and
`Te` — iron and tellurium); a material could spawn outside its own region; the
spawn yields other than eight elements; Umbrel leaves the Data-Center; a
tutorial combination would require travel; an enemy has a drop table; XP is
awarded per unit gathered; a bundle is not three waves; an enemy notices from
far enough to be a detection sweep; or a region has no terrain.

To change the game, edit `content/*.json` and run `npm run build:content`. Adding
a material needs an id, a name, a `shape` from the icon renderer's vocabulary,
and a colour — no art, no prefab, no scene work.

## Repo layout

```
content/            the game, as data
  elements.json       the canon ten
  materials.json      18, each locked to one biome
  biomes.json         5 regions with terrain and palettes
  crafting.json       materials -> permanent gauntlet upgrades
  alchemy.json        elements -> combat abilities
  enemies.json        3 tiers, with movement and notice ranges
  waves.json          wave bundles, pacing and player awareness
  progression.json    XP curve, combat and player tuning
  tutorial.json       the waking scene, the guide, and what the world says
  generated/          built artefact — do not edit

web/src/
  core/               engine-agnostic rules, no DOM
    inventory, crafting, alchemy, combat, progression, tutorial,
    save, funnel, fragments, content, rng
  game/               browser layer
    world.ts            simulation: pull, terrain, enemies, waves
    renderer.ts         canvas: camera, ground, fog, creatures, swing
    screen.ts           which way up the box sits, and how much world it shows
    creatures.ts        the three enemy tiers, drawn
    icons.ts            38 procedural item shapes
    sound.ts            synthesised audio
    deletion.ts         enemies coming apart into binary
    install.ts          the offer to keep it on a home screen
    pages.ts            settings, controls and about, shared by both menus
    pause.ts            the way to stop mid-run
    opening.ts, input.ts, ui.ts, title.ts, waves.ts, game.ts

tools/
  build-content.mjs   content validator and builder
  make-sprites.mjs    character sprite sheet generator
  make-icons.mjs      app icons, favicon and manifest
  make-sw.mjs         service worker, built from the real hashed output
  make-cover.mjs      cover art, drawn by the game's own art code
  smoke.mjs           end-to-end browser test
  screenshots.mjs     portfolio screenshots
  cover/              the cover composition; under tools/ so it never ships

docs/
  DESIGN.md           design notes: what this is and why
  PORTFOLIO.md        a self-contained brief for writing about the project
  STORE.md            player-facing copy, and what not to claim in it
  PORTING.md          file-by-file mapping from the original prototype
  screenshots/        committed, regenerable
  cover/              cover art, committed, regenerable
```

---

## ⚠️ The Unity side

**The C# in `unity/` targets the wrong engine.** The GDD's project is Unreal
Engine 5.8; this directory exists only because of the mix-up described at the
top.

`Content/ContentSchema.cs` and `ContentDatabase.cs` are current — they mirror the
generated bundle and read it, so the one guarantee the directory was built for
still holds. **Everything else under `Assets/Scripts` is stale**: it implements
the earlier prototype's orb slots, pair-combination recipes and level-gated
zones. None of it has been compiled or run.

The recommendation is to delete the directory; if a bridge to the PC build is
wanted, the useful form is an Unreal-friendly export of the same content bundle.
It is left in place because that is the author's call.

The web build is the part that is verified. It is what to trust today.

## Credit

World, elements, factions and progression design by **Michamm79**, from the
project's design document. All code, and all generated art and audio, were
written for this build.
