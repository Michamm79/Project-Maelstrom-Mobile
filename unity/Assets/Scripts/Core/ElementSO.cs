using UnityEngine;

namespace OrbSystem
{
    /// <summary>
    /// Defines a fictional element used by the alchemy system.
    /// Deliberately NOT mapped to the real periodic table.
    ///
    /// Examples: Pyron (fire-essence), Lumis (light), Verdant (life),
    /// Ferric (binding/metal-essence), etc.
    ///
    /// Assets can be authored by hand (Create -> OrbSystem -> Element) or
    /// generated from the shared content JSON via
    /// OrbSystem -> Content -> Import Content Assets.
    /// </summary>
    [CreateAssetMenu(fileName = "NewElement", menuName = "OrbSystem/Element", order = 1)]
    public class ElementSO : ScriptableObject
    {
        [Header("Identity")]
        public string displayName;

        [Tooltip("Stable unique ID. Do NOT change after creation - recipes reference this.")]
        public string elementID;

        [TextArea(2, 4)]
        public string description;

        [Header("Visuals")]
        public Sprite icon;
        public Color elementColor = Color.white;

        public override string ToString()
        {
            return string.IsNullOrEmpty(displayName) ? elementID : displayName;
        }
    }
}
