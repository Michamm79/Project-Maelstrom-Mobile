# Porting notes: Project_Maelstrom → Project-Maelstrom-Mobile

File-by-file mapping from the desktop prototype, and why anything changed.

## Mapping

| Original (`Project_Maelstrom`) | Web (`web/src/core`) | Unity (`unity/Assets/Scripts`) |
|---|---|---|
| `ElementSO.cs` | `types.ts` → `ElementDef` | `Core/ElementSO.cs` |
| `MaterialSO.cs` | `types.ts` → `MaterialDef` | `Core/MaterialSO.cs` |
| `TransmutationRecipe.cs` | `types.ts` → `TransmutationRecipe` | `Core/TransmutationRecipe.cs` |
| `AlchemyRecipe.cs` | `types.ts` → `AlchemyRecipe` | `Core/AlchemyRecipe.cs` |
| `TransmutationSystem.cs` | `transmutation.ts` | `Core/TransmutationSystem.cs` |
| `AlchemySystem.cs` | `alchemy.ts` | `Core/AlchemySystem.cs` |
| `OrbContainer.cs` | `orbContainer.ts` | `Core/OrbContainer.cs` |
| — (`Resources.LoadAll`) | `content.ts` | `Content/ContentDatabase.cs` |
| — (`UnityEvent`) | `events.ts` | still `UnityEvent` |
| — | `progression.ts`, `save.ts`, `rng.ts` | `Core/PlayerProgression.cs` |

Method names were kept deliberately: `AddMaterialToOrb` → `addMaterialToOrb`,
`PeekTransmutation` → `peekTransmutation`, `DecomposeMaterialAt` →
`decomposeMaterialAt`, and so on. Reading the two side by side should be easy.

## What was kept exactly

- **Order-independent pair matching.** `(stick, stone)` and `(stone, stick)` are
  the same recipe. A pair of two *identical* materials is legal and used —
  `fiber + fiber → cord` is the first thing you craft.
- **Alchemy returns a list, not a recipe.** The original's comment explains why:
  one element pool usually satisfies several recipes, and that choice is the menu.
  Both ports keep it.
- **`CanFulfill` / `ConsumeElements` stay separate**, and `ConsumeElements`
  leaves the pool untouched when it fails rather than partially spending it.
- **Systems are stateless and UI-free.** Data in, data out. `orbContainer.ts` has
  no DOM import; `OrbContainer.cs` has no UI reference.
- **Level gating on both recipe types**, including the `int.MaxValue` default so
  an ungated call still works.

## What changed, and why

### 1. Recipe results are materials, not prefabs

`TransmutationRecipe.resultPrefab` was a `GameObject`. `OrbContainer.TryTransmute`
`Instantiate`d it and returned it.

That works for a system demo and breaks a crafting game: a spawned GameObject
can't go back into an orb, so nothing can be an ingredient, so the tech tree is
one tier deep. There are 40 transmutation recipes here and the deepest chain is
nine tiers, so the result had to become a material.

`resultPrefab` still exists in the Unity version and is still honoured — set
`OrbContainer.spawnResultPrefabs` to also drop the object into the world.

### 2. There is a pack

The prototype had two orbs and nowhere else to put anything. Once results are
materials, they need somewhere to live, and orbs need to be loadable *from* that
somewhere. Hence `Inventory` / `packContents()` and `loadFromInventory`.

Gathering with both orbs full now falls through to the pack instead of failing
silently — the original's `AddMaterialToFreeOrb` returned `null` and the pickup
was simply lost.

### 3. Decomposition is lossy

Composition of a crafted material is derived as `round(0.6 × sum of inputs)`,
minimum 1 per element.

Two problems it solves. Without loss, composition **doubles every craft tier** —
a tier-9 item would decompose into several hundred elements. With the 0.6 factor
the growth per tier is 1.2×, and the Maelstrom Key decomposes into 10 elements
rather than ~700.

It also closes an exploit: brew a Bound Fireball for 2 Pyron + 1 Zephyr,
decompose it, get 1 Pyron + 1 Zephyr back. Lossy in exactly the direction that
stops the loop being farmable. There's a test for it
(`orbContainer.test.ts` → "cannot be farmed").

### 4. Pair-indexed recipe lookup

The original scanned the recipe list on every `FindRecipe`. The UI calls it every
time the orbs change, so with 40 recipes it is 40 comparisons per frame that the
orbs are touched. Both ports build a `Map`/`Dictionary` keyed by the sorted input
pair at registration time. Same behaviour, constant-time.

The Unity version now also warns when two recipes claim the same pair — under a
linear scan the second was silently unreachable.

### 5. Locked-recipe feedback

New: `findLockedRecipe` / `PeekLockedTransmutation`. When a pair *does* have a
recipe but the player is too low a level, the UI says "Locked — needs Lv 12"
instead of "no reaction". A flat "no reaction" tells the player to stop trying a
combination that works perfectly well later, which is the worst thing a crafting
game can do.

### 6. Content moved out of Resources and into JSON

`Resources.LoadAll<T>("Recipes/Transmutation")` means 50 recipe assets and 69
material assets authored by hand, per runtime. One JSON, read by both, with a
build step that validates the graph, is cheaper to author and impossible to get
out of sync.

`Initialize()` still exists on both systems and still does the `Resources.LoadAll`
thing, so the original workflow is intact if you prefer it.

## Deliberately not ported

- `Instantiate`/`Transform`/`spawnPoint` — meaningless in the web build, kept in Unity.
- `Sprite icon` — the web build draws 38 shapes procedurally instead
  (`web/src/game/icons.ts`), which is why the repo ships no art. `MaterialSO.shape`
  carries the key in both.
