using System.Collections.Generic;
using UnityEngine;
using Maelstrom.ContentModel;

namespace Maelstrom
{
    /// <summary>
    /// Reads the generated content bundle and indexes it.
    ///
    /// Deliberately a plain reader: it builds no ScriptableObjects and owns no
    /// game logic, so the one thing this directory still guarantees - that the
    /// two runtimes read identical content - holds without the rest of the tree
    /// having to be correct.
    ///
    /// See the note in ContentSchema.cs: the GDD's PC project is Unreal Engine
    /// 5.8, not Unity. The other scripts under unity/Assets/Scripts still
    /// implement the earlier prototype's mechanics - orb slots, and combining
    /// two materials into a third - which are not in canon and no longer exist
    /// anywhere else in this repository. They are left in place pending a
    /// decision on this directory rather than quietly rewritten.
    /// </summary>
    [CreateAssetMenu(fileName = "ContentDatabase", menuName = "Maelstrom/Content Database", order = 0)]
    public class ContentDatabase : ScriptableObject
    {
        [Tooltip("Resources path of the generated bundle, without the .json extension.")]
        public string resourcePath = "maelstrom-content";

        private ContentBundleJson bundle;
        private bool loaded;

        private readonly Dictionary<string, ElementJson> elementsById = new Dictionary<string, ElementJson>();
        private readonly Dictionary<string, MaterialJson> materialsById = new Dictionary<string, MaterialJson>();
        private readonly Dictionary<string, BiomeJson> biomesById = new Dictionary<string, BiomeJson>();
        private readonly Dictionary<string, EnemyJson> enemiesById = new Dictionary<string, EnemyJson>();
        private readonly Dictionary<string, AlchemyCombinationJson> combinationsById =
            new Dictionary<string, AlchemyCombinationJson>();

        public bool Loaded => loaded;
        public ProgressionJson Progression => bundle?.progression;
        public ColiseumJson Coliseum => bundle?.coliseum;
        public CraftingJson Crafting => bundle?.crafting;
        public WavesJson Waves => bundle?.waves;
        public float UnitsPerPixel => bundle?.unitsPerPixel ?? 12f;
        public IReadOnlyList<ElementJson> Elements => bundle?.elements ?? new List<ElementJson>();
        public IReadOnlyList<MaterialJson> Materials => bundle?.materials ?? new List<MaterialJson>();
        public IReadOnlyList<BiomeJson> Biomes => bundle?.biomes ?? new List<BiomeJson>();
        public IReadOnlyList<AlchemyCombinationJson> Alchemy => bundle?.alchemy ?? new List<AlchemyCombinationJson>();
        public IReadOnlyList<EnemyJson> Enemies => bundle?.enemies ?? new List<EnemyJson>();
        public IReadOnlyList<TutorialStepJson> Tutorial => bundle?.tutorial ?? new List<TutorialStepJson>();

        public void Load()
        {
            if (loaded) return;
            Reload();
        }

        public void Reload()
        {
            loaded = false;
            elementsById.Clear();
            materialsById.Clear();
            biomesById.Clear();
            enemiesById.Clear();
            combinationsById.Clear();

            var asset = Resources.Load<TextAsset>(resourcePath);
            if (asset == null)
            {
                Debug.LogError($"ContentDatabase: no bundle at Resources/{resourcePath}. " +
                               "Run `npm run build:content` at the repository root.");
                return;
            }

            bundle = JsonUtility.FromJson<ContentBundleJson>(asset.text);
            if (bundle == null)
            {
                Debug.LogError("ContentDatabase: the bundle failed to parse.");
                return;
            }

            foreach (var e in bundle.elements) elementsById[e.id] = e;
            foreach (var m in bundle.materials) materialsById[m.id] = m;
            foreach (var b in bundle.biomes) biomesById[b.id] = b;
            foreach (var e in bundle.enemies) enemiesById[e.id] = e;
            foreach (var c in bundle.alchemy) combinationsById[c.id] = c;

            loaded = true;
        }

        public ElementJson Element(string id) =>
            elementsById.TryGetValue(id ?? string.Empty, out var v) ? v : null;

        public MaterialJson Material(string id) =>
            materialsById.TryGetValue(id ?? string.Empty, out var v) ? v : null;

        public BiomeJson Biome(string id) =>
            biomesById.TryGetValue(id ?? string.Empty, out var v) ? v : null;

        public EnemyJson Enemy(string id) =>
            enemiesById.TryGetValue(id ?? string.Empty, out var v) ? v : null;

        public AlchemyCombinationJson Combination(string id) =>
            combinationsById.TryGetValue(id ?? string.Empty, out var v) ? v : null;

        /// <summary>
        /// The pacing actually in use. The bundle carries both canon's PC timings
        /// and the compressed mobile ones.
        /// </summary>
        public WavePacingJson ActivePacing()
        {
            if (bundle?.waves == null) return new WavePacingJson();
            return bundle.waves.activePacing == "canon" ? bundle.waves.canon : bundle.waves.mobile;
        }

        /// <summary>
        /// Which region a point falls in, in Unreal units, or null for the
        /// connective forest between them.
        /// </summary>
        public BiomeJson BiomeAt(float x, float y)
        {
            foreach (var b in Biomes)
            {
                if (b.centre == null) continue;
                var dx = x - b.centre.x;
                var dy = y - b.centre.y;
                if (Mathf.Sqrt(dx * dx + dy * dy) <= b.radius) return b;
            }
            return null;
        }

        public static Color ParseColor(string hex, Color fallback)
        {
            return ColorUtility.TryParseHtmlString(hex, out var parsed) ? parsed : fallback;
        }
    }
}
