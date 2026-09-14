using System.Collections.Generic;
using UnityEngine;

namespace OrbSystem
{
    /// <summary>
    /// Defines a collectible material in the world (stick, stone, iron ore, etc.).
    /// Each material can be transmuted with other materials, or alchemically
    /// broken down into its constituent elements.
    ///
    /// Assets can be authored by hand (Create -> OrbSystem -> Material) or
    /// generated from the shared content JSON via
    /// OrbSystem -> Content -> Import Content Assets.
    /// </summary>
    [CreateAssetMenu(fileName = "NewMaterial", menuName = "OrbSystem/Material", order = 0)]
    public class MaterialSO : ScriptableObject
    {
        public enum Origin
        {
            /// <summary>Found in the world.</summary>
            Gathered,
            /// <summary>Produced by pairing two materials.</summary>
            Transmuted,
            /// <summary>Produced from elements.</summary>
            Alchemized
        }

        [Header("Identity")]
        [Tooltip("Display name shown in UI.")]
        public string displayName;

        [Tooltip("Stable unique ID. Do NOT change after creation - recipes reference this.")]
        public string materialID;

        [TextArea(2, 4)]
        public string description;

        [Header("Visuals")]
        public Sprite icon;
        public GameObject worldPrefab; // prefab for the pickup in-world
        public Color tint = Color.white;

        [Tooltip("Shape key used by the procedural icon renderer in the web build. " +
                 "Kept here so both runtimes stay describable from one content file.")]
        public string shape;

        [Header("Tags")]
        [Tooltip("Free-form tags for categorization: Wood, Metal, Organic, etc.")]
        public List<string> tags = new List<string>();

        [Header("Alchemic Composition")]
        [Tooltip("What elements this material breaks down into when alchemically decomposed.")]
        public List<ElementQuantity> elementComposition = new List<ElementQuantity>();

        [Header("Derived (generated from the content graph - do not hand-edit)")]
        public Origin origin = Origin.Gathered;

        [Tooltip("0 for world-gathered; otherwise 1 + the deepest input's tier.")]
        public int tier;

        [Tooltip("Lowest player level at which this can actually be obtained. 0 means unreachable.")]
        public int availableAtLevel;

        /// <summary>Quantity of a single element in this material, or 0 if absent.</summary>
        public int CompositionOf(ElementSO element)
        {
            if (element == null) return 0;

            for (int i = 0; i < elementComposition.Count; i++)
            {
                if (elementComposition[i].element == element) return elementComposition[i].quantity;
            }
            return 0;
        }

        public override string ToString()
        {
            return string.IsNullOrEmpty(displayName) ? materialID : displayName;
        }
    }

    /// <summary>
    /// Pairs an element with a quantity. Used inside MaterialSO to describe
    /// what a material breaks down into, and inside AlchemyRecipe to describe cost.
    /// </summary>
    [System.Serializable]
    public struct ElementQuantity
    {
        public ElementSO element;
        public int quantity;

        public ElementQuantity(ElementSO element, int quantity)
        {
            this.element = element;
            this.quantity = quantity;
        }
    }
}
