using System.Collections.Generic;
using UnityEngine;

namespace OrbSystem
{
    /// <summary>
    /// An alchemy recipe: a set of elements (with required quantities) produces
    /// one output.
    ///
    /// Unlike transmutation (which pairs exactly 2 materials), alchemy can
    /// combine any number of elements with any quantities - e.g., 2 Pyron + 1 Zephyr
    /// -> Bound Fireball.
    /// </summary>
    [CreateAssetMenu(fileName = "NewAlchemyRecipe", menuName = "OrbSystem/Alchemy Recipe", order = 3)]
    public class AlchemyRecipe : ScriptableObject
    {
        [Header("Identity")]
        [Tooltip("Stable unique ID, matching the shared content JSON.")]
        public string recipeID;

        [Header("Inputs")]
        [Tooltip("Elements required (with quantities) to produce the output.")]
        public List<ElementQuantity> requiredElements = new List<ElementQuantity>();

        [Header("Output")]
        public MaterialSO resultMaterial;
        public GameObject resultPrefab;

        [Header("Gating")]
        [Tooltip("Minimum player level required to perform this alchemy.")]
        public int requiredLevel = 5;

        [Tooltip("XP awarded the first time this recipe is discovered.")]
        public int xp = 40;
    }
}
