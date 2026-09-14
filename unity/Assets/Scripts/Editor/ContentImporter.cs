#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using OrbSystem.ContentModel;

namespace OrbSystem.EditorTools
{
    /// <summary>
    /// Generates real .asset files (ElementSO, MaterialSO, TransmutationRecipe,
    /// AlchemyRecipe) from the shared content JSON.
    ///
    /// You do not need this to play: ContentDatabase builds the same objects in
    /// memory at runtime. Use it when you would rather work with the content in
    /// the inspector - assigning sprites and world prefabs per material, wiring
    /// recipe results to prefabs, and so on.
    ///
    /// Re-running it updates existing assets in place rather than replacing them,
    /// so any sprite or prefab you assigned by hand survives a content rebuild.
    /// That is the whole reason this is an importer and not a "delete and
    /// regenerate" script.
    ///
    /// Menu: OrbSystem -> Content -> Import Content Assets
    /// </summary>
    public static class ContentImporter
    {
        private const string BundleResourcePath = "maelstrom-content";
        private const string OutputRoot = "Assets/Resources/Generated";

        [MenuItem("OrbSystem/Content/Import Content Assets")]
        public static void Import()
        {
            var asset = Resources.Load<TextAsset>(BundleResourcePath);
            if (asset == null)
            {
                EditorUtility.DisplayDialog(
                    "Content not found",
                    $"No Resources/{BundleResourcePath}.json.\n\n" +
                    "Run `npm run build:content` at the repo root to generate it from content/*.json.",
                    "OK");
                return;
            }

            var bundle = JsonUtility.FromJson<ContentBundleJson>(asset.text);
            if (bundle == null || bundle.materials.Count == 0)
            {
                EditorUtility.DisplayDialog("Content unreadable", "Could not parse the content bundle.", "OK");
                return;
            }

            EnsureFolders();

            try
            {
                AssetDatabase.StartAssetEditing();

                var elements = ImportElements(bundle);
                var materials = ImportMaterials(bundle, elements);
                ImportTransmutation(bundle, materials);
                ImportAlchemy(bundle, materials, elements);
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
            }

            Debug.Log(
                $"[ContentImporter] Imported {bundle.elements.Count} elements, {bundle.materials.Count} materials, " +
                $"{bundle.transmutation.Count} transmutations, {bundle.alchemy.Count} alchemy recipes into {OutputRoot}.");

            EditorUtility.DisplayDialog(
                "Content imported",
                $"{bundle.materials.Count} materials and {bundle.transmutation.Count + bundle.alchemy.Count} recipes " +
                $"are now assets under {OutputRoot}.\n\nSprites and prefabs you assigned previously were preserved.",
                "OK");
        }

        [MenuItem("OrbSystem/Content/Reveal Generated Assets")]
        public static void Reveal()
        {
            var folder = AssetDatabase.LoadAssetAtPath<Object>(OutputRoot);
            if (folder != null) EditorGUIUtility.PingObject(folder);
            else EditorUtility.DisplayDialog("Nothing generated yet", "Run Import Content Assets first.", "OK");
        }

        private static void EnsureFolders()
        {
            CreateFolder("Assets", "Resources");
            CreateFolder("Assets/Resources", "Generated");
            CreateFolder(OutputRoot, "Elements");
            CreateFolder(OutputRoot, "Materials");
            CreateFolder(OutputRoot, "Recipes");
            CreateFolder(OutputRoot + "/Recipes", "Transmutation");
            CreateFolder(OutputRoot + "/Recipes", "Alchemy");
        }

        private static void CreateFolder(string parent, string child)
        {
            if (!AssetDatabase.IsValidFolder($"{parent}/{child}")) AssetDatabase.CreateFolder(parent, child);
        }

        /// <summary>Loads the existing asset if there is one, otherwise creates it.</summary>
        private static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var existing = AssetDatabase.LoadAssetAtPath<T>(path);
            if (existing != null) return existing;

            var created = ScriptableObject.CreateInstance<T>();
            AssetDatabase.CreateAsset(created, path);
            return created;
        }

        private static Dictionary<string, ElementSO> ImportElements(ContentBundleJson bundle)
        {
            var byId = new Dictionary<string, ElementSO>();

            foreach (var json in bundle.elements)
            {
                var element = LoadOrCreate<ElementSO>($"{OutputRoot}/Elements/{json.id}.asset");
                element.elementID = json.id;
                element.displayName = json.name;
                element.description = json.description;
                element.elementColor = ContentDatabase.ParseColor(json.color, Color.white);

                EditorUtility.SetDirty(element);
                byId[json.id] = element;
            }
            return byId;
        }

        private static Dictionary<string, MaterialSO> ImportMaterials(
            ContentBundleJson bundle,
            Dictionary<string, ElementSO> elements)
        {
            var byId = new Dictionary<string, MaterialSO>();

            foreach (var json in bundle.materials)
            {
                var material = LoadOrCreate<MaterialSO>($"{OutputRoot}/Materials/{json.id}.asset");
                material.materialID = json.id;
                material.displayName = json.name;
                material.description = json.description;
                material.tags = json.tags ?? new List<string>();
                material.shape = json.shape;
                material.tint = ContentDatabase.ParseColor(json.color, Color.white);
                material.tier = json.tier;
                material.availableAtLevel = json.availableAtLevel;
                material.origin = json.source == "transmuted"
                    ? MaterialSO.Origin.Transmuted
                    : json.source == "alchemized"
                        ? MaterialSO.Origin.Alchemized
                        : MaterialSO.Origin.Gathered;

                // icon and worldPrefab are deliberately NOT touched - they are the
                // fields a human assigns, and a content rebuild must not wipe them.
                material.elementComposition.Clear();
                foreach (var pair in json.composition)
                {
                    if (elements.TryGetValue(pair.element, out var element))
                    {
                        material.elementComposition.Add(new ElementQuantity(element, pair.quantity));
                    }
                }

                EditorUtility.SetDirty(material);
                byId[json.id] = material;
            }
            return byId;
        }

        private static void ImportTransmutation(ContentBundleJson bundle, Dictionary<string, MaterialSO> materials)
        {
            foreach (var json in bundle.transmutation)
            {
                if (!materials.TryGetValue(json.a, out var a)) continue;
                if (!materials.TryGetValue(json.b, out var b)) continue;
                if (!materials.TryGetValue(json.result, out var result)) continue;

                var recipe = LoadOrCreate<TransmutationRecipe>($"{OutputRoot}/Recipes/Transmutation/{json.id}.asset");
                recipe.recipeID = json.id;
                recipe.inputA = a;
                recipe.inputB = b;
                recipe.resultMaterial = result;
                recipe.requiredLevel = json.requiredLevel;
                recipe.xp = json.xp;

                EditorUtility.SetDirty(recipe);
            }
        }

        private static void ImportAlchemy(
            ContentBundleJson bundle,
            Dictionary<string, MaterialSO> materials,
            Dictionary<string, ElementSO> elements)
        {
            foreach (var json in bundle.alchemy)
            {
                if (!materials.TryGetValue(json.result, out var result)) continue;

                var recipe = LoadOrCreate<AlchemyRecipe>($"{OutputRoot}/Recipes/Alchemy/{json.id}.asset");
                recipe.recipeID = json.id;
                recipe.resultMaterial = result;
                recipe.requiredLevel = json.requiredLevel;
                recipe.xp = json.xp;

                recipe.requiredElements.Clear();
                foreach (var pair in json.requiredElements)
                {
                    if (elements.TryGetValue(pair.element, out var element))
                    {
                        recipe.requiredElements.Add(new ElementQuantity(element, pair.quantity));
                    }
                }

                EditorUtility.SetDirty(recipe);
            }
        }
    }
}
#endif
