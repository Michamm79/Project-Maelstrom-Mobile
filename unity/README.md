# Unity side

The `OrbSystem` scripts from Project_Maelstrom, evolved for a mobile build, plus
a loader that reads the same content file the web game uses.

> **Not compiled.** These scripts were written without a Unity installation
> available. They are structurally checked and reviewed, but never built or run.
> Open them expecting to fix something.

This is **not a Unity project** — no `ProjectSettings/`, no scenes, no prefabs.
It's `Assets/`, ready to drop into a project you create.

---

## Getting it into Unity

1. Create a new **2D (URP or Built-in)** project in Unity 2021.3 LTS or newer.
2. Copy `unity/Assets/Scripts` into your project's `Assets/`.
3. Copy `unity/Assets/Resources/maelstrom-content.json` into `Assets/Resources/`.
   (Regenerate it any time with `npm run build:content` from the repo root.)
4. Switch platform to **Android** or **iOS** in Build Settings.

You now have two ways to get at the content. Pick one:

### A. Runtime loading (nothing to author)

1. `Create → OrbSystem → Content Database`, leave `resourcePath` as `maelstrom-content`.
2. Drop that asset into `OrbContainer.contentDatabase`.

On `Awake`, it parses the JSON, builds ScriptableObjects in memory, and registers
them with `TransmutationSystem` and `AlchemySystem`. All 69 materials and 50
recipes exist with no asset authoring at all.

### B. Generated assets (inspector-friendly)

Menu: **OrbSystem → Content → Import Content Assets**

Writes real `.asset` files under `Assets/Resources/Generated/`. Use this when you
want to assign sprites and world prefabs per material.

Re-running the importer **updates assets in place and never touches `icon` or
`worldPrefab`** — those are the fields a human fills in, so a content rebuild
must not wipe them. That is the whole reason it's an importer rather than a
regenerate-from-scratch script.

Leave `OrbContainer.contentDatabase` empty in this mode; `Initialize()` falls
back to `Resources.LoadAll`, exactly as the desktop prototype did.

---

## Assembling a scene

Nothing below is done for you.

**Player**
- Sprite + `Rigidbody2D` (Kinematic) + `CircleCollider2D`
- `TouchPlayerController` — assign the joystick
- `GatherController` — assign the OrbContainer, set `nodeLayers` to your node layer
- `OrbContainer` — assign the ContentDatabase and a `spawnPoint`

**World**
- `ZoneSpawner` — assign the ContentDatabase and a node prefab, set `zoneID` to `hollow_verge`
- Feed `ZoneSpawner.WorldBounds` into `TouchPlayerController.bounds` so the player
  is clamped to the zone
- Node prefab: sprite + trigger `CircleCollider2D` + `MaterialNode` (assign `visuals`)

**Canvas** (Screen Space – Overlay, `CanvasScaler` → Scale With Screen Size, 1080×1920, Match 0.5)
- Full-screen transparent Image with `VirtualJoystick`, **behind** the buttons,
  Raycast Target on. Assign `baseRing` and `knob`.
- `OrbHUD` — two orb slots, transmute button, level readout
- `AlchemyPanel` — needs `AlchemyRecipeRow` and `ElementChip` prefabs

`ZoneSpawner.unitsPerPixel` converts the content file's pixel layout to metres.
The zones are sized for the web build's camera; `0.02` is a starting guess, not a
tuned value.

---

## Icons

`MaterialSO.shape` names a shape (`rock`, `ingot`, `flame`, …) rather than
carrying a sprite. The web build draws those procedurally, which is why this repo
ships no art.

For Unity, map shapes to sprites once in `ContentDatabase.shapeSprites` and every
material gets art automatically — 38 sprites cover all 69 materials. Or assign
`icon` per material after running the importer.

---

## Files

```
Core/
  ElementSO.cs             unchanged in spirit from the original
  MaterialSO.cs            + shape, tint, origin, tier, availableAtLevel
  TransmutationRecipe.cs   result is now a MaterialSO; resultPrefab still optional
  AlchemyRecipe.cs         + recipeID, xp
  TransmutationSystem.cs   pair-indexed lookup instead of a linear scan
  AlchemySystem.cs         + Shortfall(), KnownRecipes()
  PlayerProgression.cs     level/XP driven by the shared curve; also holds Inventory
  OrbContainer.cs          the original three actions, plus pack / XP / discovery

Content/
  ContentSchema.cs         JsonUtility-shaped mirrors of the content bundle
  ContentDatabase.cs       parses it into live ScriptableObjects

Mobile/
  VirtualJoystick.cs       floating thumb stick
  TouchPlayerController.cs joystick + keyboard movement, bounded
  MaterialNode.cs          world pickup with its own respawn timer
  GatherController.cs      nearest-node query, non-allocating
  ZoneSpawner.cs           weighted spawn tables from the content file, pooled

UI/
  OrbHUD.cs                orb slots, transmute preview, level bar
  AlchemyPanel.cs          + AlchemyRecipeRow.cs, ElementChip.cs

Editor/
  ContentImporter.cs       JSON -> .asset, non-destructive
```

## Known rough edges

- Never compiled. Assume at least one build error.
- `ZoneSpawner.unitsPerPixel` is a guess and will need tuning against your camera.
- No save/load on this side. The web build persists to `localStorage`;
  the equivalent here would be `JsonUtility` over the same state.
- No zone-travel UI. `ZoneSpawner.Build(zoneID)` is the entry point.
- The codex/pack UI has no Unity equivalent yet — `Inventory.Sorted()` is there
  to build one on.
