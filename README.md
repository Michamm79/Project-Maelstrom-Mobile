# Project Maelstrom — Mobile

A touch-first mobile build of the orb / transmutation / alchemy systems from
[Project_Maelstrom](https://github.com/Michamm79/Project_Maelstrom).

Two orbs. Fill both, transmute the pair into something new. At level 5 alchemy
unlocks and you can break materials down into their elements instead, then
recombine those into things no pair of materials could make. 69 materials,
50 recipes, 5 regions, ending at the Maelstrom Key.

There are **two runtimes in this repo, and one source of truth for content**:

| | What it is | Status |
|---|---|---|
| **`web/`** | TypeScript + HTML5 canvas. Playable on a phone browser. | Built, tested, verified running |
| **`unity/`** | C# for Unity, evolved from the original `OrbSystem` scripts. | Written, **not compiled** — see the caveat below |
| **`content/`** | The elements, materials, recipes and zones. Read by both. | Validated on every build |

---

## Play it

Once GitHub Pages is switched on (below), the game is at:

**`https://michamm79.github.io/Project-Maelstrom-Mobile/`**

Open it on your phone and add it to your home screen — it has a manifest and
icons, so it launches full-screen with no browser chrome.

### Turning Pages on (one time, ~30 seconds)

1. Repo **Settings → Pages**
2. **Source: GitHub Actions**
3. Push, or re-run the *Deploy web build to Pages* workflow.

If the deploy fails with an environment-protection error, the `github-pages`
environment is restricted to the default branch — merge the PR and it will go
out from `main`.

### How to play

- **Move** — drag your thumb anywhere on the map. The stick appears where you touch it.
- **Gather** — walk near a node and tap the **Gather** button, or tap the node itself.
- **Transmute** — with both orbs full, the centre button previews the result. Tap it.
- **Pack** — crafted things land here. Tap one to load it back into an orb; that is how you reach tier 2 and beyond.
- **Decompose** (level 5+) — the **⚗** button under an orb breaks that material into elements.
- **Alchemy** (level 5+) — spend pooled elements on recipes no material pair can produce.
- **Travel** — tap the zone name, top left. New regions open at levels 3, 6, 10 and 15.

Progress saves to the device automatically. Keyboard works too (WASD/arrows, space to gather),
which is handy in a desktop browser.

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173 — open it on your phone over the LAN
```

```bash
npm test             # 47 unit tests over the core systems
npm run build        # content + icons + typecheck + production bundle
npm run smoke        # builds, then drives the real game in headless Chromium
```

`npm run smoke` is the interesting one: it runs the built game in a phone-sized
browser, plays through gather → transmute → level up → decompose → brew → travel,
asserts 26 behaviours, and drops screenshots in `.verify/`.

---

## How the two runtimes stay in sync

The thing that usually kills a port like this is content drift — the web build
says a Void Blade needs one thing, the Unity build says another, and nobody
notices for a month.

So neither runtime owns the content:

```
content/*.json                     <- hand-authored: elements, materials, recipes, zones
        |
        v
tools/build-content.mjs            <- validates the graph, derives what can be derived
        |
        +--> content/generated/maelstrom-content.json        -> imported by the web build
        +--> unity/Assets/Resources/maelstrom-content.json   -> read by ContentDatabase.cs
```

Only the 19 world-gathered materials have hand-written element compositions.
Every craftable material's composition is **derived from its recipe inputs** at
build time, with a loss factor — so a Void Blade's composition is whatever its
whole tree actually adds up to, in both runtimes, and can't be edited into
disagreement.

The builder refuses to emit a broken graph. It catches unreachable materials,
recipe cycles, duplicate input pairs that would shadow each other, elements no
material produces, and recipes gated below the level their own inputs become
obtainable. It found a real balance bug the first time it ran (glass unlocked at
level 5, but its sand input only spawns in a level-6 zone).

CI additionally fails if the committed generated bundle has drifted from
`content/`.

### Changing the game's content

Edit `content/*.json`, then:

```bash
npm run build:content
```

That's the whole loop. Adding a material needs an id, a name, a `shape` from the
icon renderer's vocabulary, and a colour — no art, no prefab, no scene work. It
is playable immediately in the web build.

---

## Repo layout

```
content/            the game, as data
  elements.json               9 fictional elements (Pyron, Lumis, Verdant, ...)
  materials.gathered.json     19 world materials, with hand-authored compositions
  materials.crafted.json      40 craftables — compositions derived, not written
  materials.alchemized.json   10 alchemy outputs
  transmutation.json          40 two-input recipes
  alchemy.json                10 element recipes
  zones.json                  5 regions with weighted spawn tables
  progression.json            XP curve and tuning constants
  generated/                  built artefact — do not edit

web/src/
  core/               engine-agnostic game rules, no DOM
    transmutation.ts    port of TransmutationSystem.cs
    alchemy.ts          port of AlchemySystem.cs
    orbContainer.ts     port of OrbContainer.cs
    progression.ts, save.ts, content.ts, events.ts, rng.ts
    __tests__/          47 tests
  game/               browser layer
    icons.ts            38 procedurally drawn item shapes — the reason there is no art
    renderer.ts, world.ts, input.ts, ui.ts, game.ts

unity/Assets/Scripts/
  Core/               the original OrbSystem scripts, evolved for mobile
  Content/            ContentDatabase — loads the shared JSON into ScriptableObjects
  Mobile/             virtual joystick, touch movement, nodes, zone spawner
  UI/                 HUD and alchemy panel controllers
  Editor/             menu item that generates .asset files from the same JSON

tools/
  build-content.mjs   content validator and builder
  make-icons.mjs      generates app icons and the favicon from code
  smoke.mjs           end-to-end browser test
```

---

## What changed from the desktop prototype

The original systems came across close to unchanged — same method names, same
order-independent pair matching, same `CanFulfill` / `ConsumeElements` split,
same "alchemy returns a list because the pool usually satisfies several recipes"
reasoning. Four things genuinely had to change, all forced by making it a game
rather than a systems sketch:

1. **Recipe results are materials, not prefabs.** `TransmutationRecipe.resultPrefab`
   spawned a `GameObject`. A crafted thing has to be able to go *back into an orb*
   or the tech tree can't chain past its first tier. Results are now `MaterialSO`
   (Unity) / material ids (web); `resultPrefab` still exists and is still optional.
2. **There is a pack.** The prototype had nowhere to put a result except the world.
3. **Decomposition is lossy** (60%, `content/progression.json`). Without it,
   decompose → recompose is free elements, and composition doubles every craft
   tier — a level-20 item would break down into hundreds of elements instead of ten.
4. **Recipe lookup is indexed by input pair** rather than scanned linearly.
   `FindRecipe` runs every time the orbs change; on a phone the scan showed up.

`docs/PORTING.md` has the file-by-file mapping.

---

## The Unity side — please read this

**The C# in `unity/` has not been compiled or run.** There is no Unity
installation in the environment this was written in, so it has been checked for
structure and reviewed by eye, and nothing more. Treat it as a well-formed
starting point to open on your laptop, not as working code. Expect to fix
something.

What it is not: it is not a Unity *project* — there is no `ProjectSettings/`,
no scenes, no prefabs. It is the scripts, plus the content, ready to drop into a
project you create. `unity/README.md` has the scene-assembly steps.

The web build is the part that is verified. It is what to trust today.

---

## Credit

Systems, world and naming from **Project_Maelstrom** by Michamm79.
