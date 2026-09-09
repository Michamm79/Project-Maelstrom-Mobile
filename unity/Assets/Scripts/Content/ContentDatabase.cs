using System.Collections.Generic;
using UnityEngine;
using OrbSystem.ContentModel;

namespace OrbSystem
{
    /// <summary>
    /// Loads the shared content bundle and turns it into live ScriptableObjects,
    /// then registers them with TransmutationSystem and AlchemySystem.
    ///
    /// This replaces hand-authoring 69 materials and 50 recipes as .asset files:
    /// content lives in one JSON that the web build reads too, so a balance change
    /// lands in both runtimes at once. Assets are still supported - if you would
    /// rather work in the inspector, run
    /// OrbSystem -> Content -> Import Content Assets and leave this unassigned.
    ///
    /// Create via: Create -> OrbSystem -> Content Database.
    /// </summary>
    [CreateAssetMenu(fileName = "ContentDatabase", menuName = "OrbSystem/Content Database", order = 10)]
    public class ContentDatabase : ScriptableObject
    {
        [Tooltip("Path under a Resources folder, without the .json extension.")]
        public string resourcePath = "maelstrom-content";

        [Tooltip("Sprite looked up by MaterialSO.shape, so generated materials can " +
                 "still show art. Optional - leave empty to run without icons.")]
        public List<ShapeSprite> shapeSprites = new List<ShapeSprite>();

        [System.Serializable]
        public struct ShapeSprite
        {
            public string shape;
            public Sprite sprite;
        }

        private readonly Dictionary<string, ElementSO> elementsById = new Dictionary<string, ElementSO>();
        private readonly Dictionary<string, MaterialSO> materialsById = new Dictionary<string, MaterialSO>();
        private readonly List<TransmutationRecipe> transmutationRecipes = new List<TransmutationRecipe>();
        private readonly List<AlchemyRecipe> alchemyRecipes = new List<AlchemyRecipe>();
        private readonly List<ZoneJson> zones = new List<ZoneJson>();

        private ProgressionJson progression = new ProgressionJson();
        private bool loaded;

        public bool Loaded => loaded;
        public ProgressionJson Progression => progression;
        public IReadOnlyList<ZoneJson> Zones => zones;
        public IReadOnlyDictionary<string, ElementSO> Elements => elementsById;
        public IReadOnlyDictionary<string, MaterialSO> Materials => materialsById;
        public IReadOnlyList<TransmutationRecipe> TransmutationRecipes => transmutationRecipes;
        public IReadOnlyList<AlchemyRecipe> AlchemyRecipes => alchemyRecipes;

        /// <summary>
        /// Parse the bundle and register everything. Safe to call repeatedly;
        /// only the first call does work.
        /// </summary>
        public void Load()
        {
            if (loaded) return;
            Reload();
        }

        /// <summary>Force a re-parse. Useful after editing content during play mode.</summary>
        public void Reload()
        {
            elementsById.Clear();
            materialsById.Clear();
            transmutationRecipes.Clear();
            alchemyRecipes.Clear();
            zones.Clear();

            var asset = Resources.Load<TextAsset>(resourcePath);
            if (asset == null)
            {
                Debug.LogError(
                    $"[ContentDatabase] No TextAsset at Resources/{resourcePath}.json. " +
                    "Run `npm run build:content` at the repo root to generate it.");
                loaded = true;
                return;
            }

            var bundle = JsonUtility.FromJson<ContentBundleJson>(asset.text);
            if (bundle == null || bundle.materials.Count == 0)
            {
                Debug.LogError($"[ContentDatabase] Could not parse Resources/{resourcePath}.json.");
                loaded = true;
                return;
            }

            progression = bundle.progression ?? new ProgressionJson();
            zones.AddRange(bundle.zones);

            BuildElements(bundle);
            BuildMaterials(bundle);
            BuildTransmutation(bundle);
            BuildAlchemy(bundle);

            TransmutationSystem.RegisterRecipes(transmutationRecipes);
            AlchemySystem.RegisterRecipes(alchemyRecipes);

            loaded = true;
            Debug.Log(
                $"[ContentDatabase] {elementsById.Count} elements, {materialsById.Count} materials, " +
                $"{transmutationRecipes.Count} transmutations, {alchemyRecipes.Count} alchemy recipes, " +
                $"{zones.Count} zones.");
        }

        private void BuildElements(ContentBundleJson bundle)
        {
            foreach (var json in bundle.elements)
            {
                var element = CreateInstance<ElementSO>();
                element.name = json.id;
                element.elementID = json.id;
                element.displayName = json.name;
                element.description = json.description;
                element.elementColor = ParseColor(json.color, Color.white);
                elementsById[json.id] = element;
            }
        }

        private void BuildMaterials(ContentBundleJson bundle)
        {
            // Two passes are not needed for materials (composition only references
            // elements, which are already built), but recipes below do need every
            // material to exist first.
            foreach (var json in bundle.materials)
            {
                var material = CreateInstance<MaterialSO>();
                material.name = json.id;
                material.materialID = json.id;
                material.displayName = json.name;
                material.description = json.description;
                material.tags = json.tags ?? new List<string>();
                material.shape = json.shape;
                material.tint = ParseColor(json.color, Color.white);
                material.icon = SpriteForShape(json.shape);
                material.tier = json.tier;
                material.availableAtLevel = json.availableAtLevel;
                material.origin = ParseOrigin(json.source);

                foreach (var pair in json.composition)
                {
                    if (!elementsById.TryGetValue(pair.element, out var element))
                    {
                        Debug.LogWarning($"[ContentDatabase] Material '{json.id}' references unknown element '{pair.element}'.");
                        continue;
                    }
                    material.elementComposition.Add(new ElementQuantity(element, pair.quantity));
                }

                materialsById[json.id] = material;
            }
        }

        private void BuildTransmutation(ContentBundleJson bundle)
        {
            foreach (var json in bundle.transmutation)
            {
                if (!TryResolve(json.a, json.id, out var a)) continue;
                if (!TryResolve(json.b, json.id, out var b)) continue;
                if (!TryResolve(json.result, json.id, out var result)) continue;

                var recipe = CreateInstance<TransmutationRecipe>();
                recipe.name = json.id;
                recipe.recipeID = json.id;
                recipe.inputA = a;
                recipe.inputB = b;
                recipe.resultMaterial = result;
                recipe.resultPrefab = result.worldPrefab;
                recipe.requiredLevel = json.requiredLevel;
                recipe.xp = json.xp;
                transmutationRecipes.Add(recipe);
            }
        }

        private void BuildAlchemy(ContentBundleJson bundle)
        {
            foreach (var json in bundle.alchemy)
            {
                if (!TryResolve(json.result, json.id, out var result)) continue;

                var recipe = CreateInstance<AlchemyRecipe>();
                recipe.name = json.id;
                recipe.recipeID = json.id;
                recipe.resultMaterial = result;
                recipe.resultPrefab = result.worldPrefab;
                recipe.requiredLevel = json.requiredLevel;
                recipe.xp = json.xp;

                foreach (var pair in json.requiredElements)
                {
                    if (!elementsById.TryGetValue(pair.element, out var element))
                    {
                        Debug.LogWarning($"[ContentDatabase] Alchemy '{json.id}' requires unknown element '{pair.element}'.");
                        continue;
                    }
                    recipe.requiredElements.Add(new ElementQuantity(element, pair.quantity));
                }

                alchemyRecipes.Add(recipe);
            }
        }

        private bool TryResolve(string materialID, string recipeID, out MaterialSO material)
        {
            if (materialsById.TryGetValue(materialID, out material)) return true;

            Debug.LogWarning($"[ContentDatabase] Recipe '{recipeID}' references unknown material '{materialID}'.");
            return false;
        }

        public ElementSO Element(string id)
        {
            return elementsById.TryGetValue(id, out var element) ? element : null;
        }

        public MaterialSO Material(string id)
        {
            return materialsById.TryGetValue(id, out var material) ? material : null;
        }

        public ZoneJson Zone(string id)
        {
            foreach (var zone in zones)
            {
                if (zone.id == id) return zone;
            }
            return null;
        }

        public List<ZoneJson> UnlockedZones(int playerLevel)
        {
            var unlocked = new List<ZoneJson>();
            foreach (var zone in zones)
            {
                if (zone.requiredLevel <= playerLevel) unlocked.Add(zone);
            }
            return unlocked;
        }

        private Sprite SpriteForShape(string shape)
        {
            if (string.IsNullOrEmpty(shape)) return null;

            foreach (var entry in shapeSprites)
            {
                if (entry.shape == shape) return entry.sprite;
            }
            return null;
        }

        private static MaterialSO.Origin ParseOrigin(string source)
        {
            switch (source)
            {
                case "transmuted": return MaterialSO.Origin.Transmuted;
                case "alchemized": return MaterialSO.Origin.Alchemized;
                default: return MaterialSO.Origin.Gathered;
            }
        }

        /// <summary>Parses "#rrggbb" (the form the content file uses).</summary>
        public static Color ParseColor(string hex, Color fallback)
        {
            if (!string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out var parsed)) return parsed;
            return fallback;
        }
    }
}
