# Porting notes: Project_Maelstrom → Project-Maelstrom-Mobile

File-by-file mapping from the desktop prototype, and why anything changed.

> **Historical.** `Project_Maelstrom` is an earlier Unity orb prototype that
> shares the name; the GDD's project is Unreal Engine 5.8, and everything
> ported from the prototype has since been replaced by canon. This is kept
> because the decisions it records — why a transmutation result is a material
> and not a prefab, why content moved out of `Resources` — still hold in the
> build that replaced it. A C# mirror of these systems used to live in
> `unity/`; it targeted the wrong engine and has been deleted.

## Mapping

| Original (`Project_Maelstrom`) | Web (`web/src/core`) |
|---|---|
| `ElementSO.cs` | `types.ts` → `ElementDef` |
| `MaterialSO.cs` | `types.ts` → `MaterialDef` |
| `TransmutationRecipe.cs` | `types.ts` → `TransmutationRecipe` |
| `AlchemyRecipe.cs` | `types.ts` → `AlchemyRecipe` |
| `TransmutationSystem.cs` | `transmutation.ts` |
| `AlchemySystem.cs` | `alchemy.ts` |
| `OrbContainer.cs` | `orbContainer.ts` |
| — (`Resources.LoadAll`) | `content.ts` |
| — (`UnityEvent`) | `events.ts` |
| — | `progression.ts`, `save.ts`, `rng.ts` |

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

`resultPrefab` has no meaning in a build with no GameObjects; an engine-side
port that wants the spawned object back can read the same recipe and do both.

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
orbs are touched. The web build indexes a `Map` keyed by the sorted input pair
at registration time. Same behaviour, constant-time — and it reports two recipes
claiming the same pair, which under a linear scan left the second silently
unreachable.

### 5. Locked-recipe feedback

New: `findLockedRecipe` / `PeekLockedTransmutation`. When a pair *does* have a
recipe but the player is too low a level, the UI says "Locked — needs Lv 12"
instead of "no reaction". A flat "no reaction" tells the player to stop trying a
combination that works perfectly well later, which is the worst thing a crafting
game can do.

### 6. Content moved out of Resources and into JSON

`Resources.LoadAll<T>("Recipes/Transmutation")` means 50 recipe assets and 69
material assets authored by hand, per runtime. One JSON, validated by a build
step, is cheaper to author and cannot fall out of sync with itself — and it is
what any second runtime should read rather than re-authoring the graph.

## Deliberately not ported

- `Instantiate`/`Transform`/`spawnPoint` — meaningless without GameObjects.
- `Sprite icon` — the web build draws 38 shapes procedurally instead
  (`web/src/game/icons.ts`), which is why the repo ships no art. The bundle
  carries `shape` as the key.
