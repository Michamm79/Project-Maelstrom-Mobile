using UnityEngine;

namespace OrbSystem
{
    /// <summary>
    /// A transmutation recipe: two input materials produce one output.
    ///
    /// Order-independent: (stick, stone) and (stone, stick) match the same recipe.
    /// TransmutationSystem handles that normalization.
    ///
    /// Changed from the desktop prototype: the result is a MaterialSO rather than
    /// only a prefab. A crafted thing has to be able to go back into an orb, or the
    /// tech tree cannot chain past its first tier. resultPrefab is still here and
    /// still optional - use it when the output should also exist in the world.
    /// </summary>
    [CreateAssetMenu(fileName = "NewTransmutationRecipe", menuName = "OrbSystem/Transmutation Recipe", order = 2)]
    public class TransmutationRecipe : ScriptableObject
    {
        [Header("Identity")]
        [Tooltip("Stable unique ID, matching the shared content JSON.")]
        public string recipeID;

        [Header("Inputs")]
        public MaterialSO inputA;
        public MaterialSO inputB;

        [Header("Output")]
        [Tooltip("The material produced. This is what lands in the player's pack.")]
        public MaterialSO resultMaterial;

        [Tooltip("Optional prefab to spawn in the world as well as granting the material.")]
        public GameObject resultPrefab;

        [Header("Gating")]
        [Tooltip("Minimum player level required to perform this transmutation.")]
        public int requiredLevel = 1;

        [Tooltip("XP awarded the first time this recipe is discovered.")]
        public int xp = 25;

        /// <summary>True if this recipe is satisfied by the given pair, in either order.</summary>
        public bool Matches(MaterialSO a, MaterialSO b)
        {
            if (a == null || b == null) return false;
            return (inputA == a && inputB == b) || (inputA == b && inputB == a);
        }
    }
}
