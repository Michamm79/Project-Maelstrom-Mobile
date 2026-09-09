using System.Collections.Generic;
using UnityEngine;

namespace OrbSystem
{
    /// <summary>
    /// Stateless lookup service for alchemy recipes.
    ///
    /// Alchemy is harder than transmutation: instead of matching exactly 2 inputs,
    /// it checks whether the player's available element pool *contains* all the
    /// required elements (with required quantities) for a given recipe.
    /// </summary>
    public static class AlchemySystem
    {
        private static readonly List<AlchemyRecipe> recipes = new List<AlchemyRecipe>();
        private static bool initialized;

        public static IReadOnlyList<AlchemyRecipe> Recipes => recipes;

        /// <summary>
        /// Loads every AlchemyRecipe asset from Assets/Resources/Recipes/Alchemy/.
        /// </summary>
        public static void Initialize()
        {
            if (initialized) return;

            AlchemyRecipe[] loaded = Resources.LoadAll<AlchemyRecipe>("Recipes/Alchemy");
            RegisterRecipes(loaded);

            Debug.Log($"[AlchemySystem] Loaded {recipes.Count} recipes.");
        }

        public static void RegisterRecipes(IEnumerable<AlchemyRecipe> incoming)
        {
            recipes.Clear();
            if (incoming != null)
            {
                foreach (var recipe in incoming)
                {
                    if (recipe != null) recipes.Add(recipe);
                }
            }
            initialized = true;
        }

        /// <summary>
        /// Given an available pool of elements (element -> quantity available),
        /// returns every alchemy recipe the player can currently perform.
        ///
        /// Returning a list (not a single recipe) makes sense for alchemy because
        /// the same element pool can often produce multiple different outputs -
        /// that's exactly the choice the UI menu should present to the player.
        /// </summary>
        public static List<AlchemyRecipe> FindAvailableRecipes(
            Dictionary<ElementSO, int> availableElements,
            int playerLevel = int.MaxValue)
        {
            if (!initialized) Initialize();

            var matches = new List<AlchemyRecipe>();
            if (availableElements == null || availableElements.Count == 0) return matches;

            foreach (var recipe in recipes)
            {
                if (recipe == null) continue;
                if (recipe.requiredLevel > playerLevel) continue;
                if (CanFulfill(recipe, availableElements)) matches.Add(recipe);
            }

            return matches;
        }

        /// <summary>Every recipe unlocked by level, affordable or not - the full menu.</summary>
        public static List<AlchemyRecipe> KnownRecipes(int playerLevel)
        {
            if (!initialized) Initialize();

            var known = new List<AlchemyRecipe>();
            foreach (var recipe in recipes)
            {
                if (recipe != null && recipe.requiredLevel <= playerLevel) known.Add(recipe);
            }
            return known;
        }

        /// <summary>
        /// Checks if the available pool contains enough of every element
        /// required by the recipe.
        /// </summary>
        public static bool CanFulfill(AlchemyRecipe recipe, Dictionary<ElementSO, int> available)
        {
            if (recipe == null || available == null) return false;

            foreach (var req in recipe.requiredElements)
            {
                if (req.element == null) continue;
                if (!available.TryGetValue(req.element, out int have)) return false;
                if (have < req.quantity) return false;
            }
            return true;
        }

        /// <summary>
        /// How short the pool is for each element. Showing the player "need 2 more
        /// Aether" is far more useful than hiding the recipe until it is affordable.
        /// </summary>
        public static Dictionary<ElementSO, int> Shortfall(
            AlchemyRecipe recipe,
            Dictionary<ElementSO, int> available)
        {
            var missing = new Dictionary<ElementSO, int>();
            if (recipe == null) return missing;

            foreach (var req in recipe.requiredElements)
            {
                if (req.element == null) continue;
                available.TryGetValue(req.element, out int have);
                int gap = req.quantity - have;
                if (gap > 0) missing[req.element] = gap;
            }
            return missing;
        }

        /// <summary>
        /// Consumes the elements required by a recipe from the provided pool.
        /// Call this when the player confirms an alchemy combination.
        /// Returns true if consumption succeeded; false (leaving the pool
        /// untouched) if the pool didn't have enough.
        /// </summary>
        public static bool ConsumeElements(AlchemyRecipe recipe, Dictionary<ElementSO, int> pool)
        {
            if (!CanFulfill(recipe, pool)) return false;

            foreach (var req in recipe.requiredElements)
            {
                if (req.element == null) continue;

                pool[req.element] -= req.quantity;
                if (pool[req.element] <= 0) pool.Remove(req.element);
            }
            return true;
        }
    }
}
