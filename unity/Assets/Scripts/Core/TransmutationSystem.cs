using System.Collections.Generic;
using UnityEngine;

namespace OrbSystem
{
    /// <summary>
    /// Stateless lookup service for transmutation recipes.
    ///
    /// Intentionally NOT a MonoBehaviour. Pure logic: data in, data out. That
    /// makes it trivial to unit-test and reuse anywhere.
    ///
    /// Changed from the desktop prototype: recipes are indexed by their input
    /// pair instead of scanned linearly, so lookup cost does not grow with the
    /// recipe count. On mobile, FindRecipe runs every time the orbs change, so
    /// the linear scan showed up.
    /// </summary>
    public static class TransmutationSystem
    {
        private static readonly List<TransmutationRecipe> recipes = new List<TransmutationRecipe>();
        private static readonly Dictionary<string, TransmutationRecipe> byPair =
            new Dictionary<string, TransmutationRecipe>();

        private static bool initialized;

        public static IReadOnlyList<TransmutationRecipe> Recipes => recipes;

        /// <summary>
        /// Loads every TransmutationRecipe asset from Assets/Resources/Recipes/Transmutation/.
        ///
        /// Alternative: call RegisterRecipes() manually - which is what
        /// ContentDatabase does when building recipes from the shared JSON.
        /// </summary>
        public static void Initialize()
        {
            if (initialized) return;

            TransmutationRecipe[] loaded = Resources.LoadAll<TransmutationRecipe>("Recipes/Transmutation");
            RegisterRecipes(loaded);

            Debug.Log($"[TransmutationSystem] Loaded {recipes.Count} recipes.");
        }

        /// <summary>
        /// Manual registration alternative - useful if recipes are managed by a
        /// MonoBehaviour registry or generated at runtime rather than loaded from Resources.
        /// </summary>
        public static void RegisterRecipes(IEnumerable<TransmutationRecipe> incoming)
        {
            recipes.Clear();
            byPair.Clear();

            if (incoming != null)
            {
                foreach (var recipe in incoming)
                {
                    if (recipe == null || recipe.inputA == null || recipe.inputB == null) continue;

                    string key = PairKey(recipe.inputA, recipe.inputB);
                    if (byPair.ContainsKey(key))
                    {
                        Debug.LogWarning(
                            $"[TransmutationSystem] Duplicate pair for '{recipe.name}' - " +
                            $"'{byPair[key].name}' already claims it, so this one is unreachable.");
                        continue;
                    }

                    recipes.Add(recipe);
                    byPair[key] = recipe;
                }
            }

            initialized = true;
        }

        /// <summary>
        /// Find a recipe matching the two input materials (order-independent).
        /// Returns null if no recipe exists for this pair, or if the recipe is
        /// above the supplied player level.
        /// </summary>
        public static TransmutationRecipe FindRecipe(MaterialSO a, MaterialSO b, int playerLevel = int.MaxValue)
        {
            if (!initialized) Initialize();
            if (a == null || b == null) return null;

            if (!byPair.TryGetValue(PairKey(a, b), out var recipe)) return null;
            return recipe.requiredLevel > playerLevel ? null : recipe;
        }

        /// <summary>
        /// A recipe exists for this pair, but the player is too low a level.
        /// The UI uses this to show "locked, needs level N" instead of a flat
        /// "no reaction", which would read as a dead end worth giving up on.
        /// </summary>
        public static TransmutationRecipe FindLockedRecipe(MaterialSO a, MaterialSO b, int playerLevel)
        {
            if (!initialized) Initialize();
            if (a == null || b == null) return null;

            if (!byPair.TryGetValue(PairKey(a, b), out var recipe)) return null;
            return recipe.requiredLevel > playerLevel ? recipe : null;
        }

        /// <summary>Every recipe the player has the level for. Powers the codex.</summary>
        public static List<TransmutationRecipe> AvailableRecipes(int playerLevel)
        {
            if (!initialized) Initialize();

            var matches = new List<TransmutationRecipe>();
            foreach (var recipe in recipes)
            {
                if (recipe != null && recipe.requiredLevel <= playerLevel) matches.Add(recipe);
            }
            return matches;
        }

        /// <summary>Order-independent key for a material pair.</summary>
        private static string PairKey(MaterialSO a, MaterialSO b)
        {
            string idA = a.materialID;
            string idB = b.materialID;
            return string.CompareOrdinal(idA, idB) <= 0 ? idA + "+" + idB : idB + "+" + idA;
        }
    }
}
