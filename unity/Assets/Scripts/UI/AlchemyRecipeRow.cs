using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace OrbSystem.UI
{
    /// <summary>One row in the alchemy list.</summary>
    public class AlchemyRecipeRow : MonoBehaviour
    {
        public Image resultIcon;
        public Text resultName;
        public Button brewButton;
        public CanvasGroup group;

        [Tooltip("Prefab with an ElementChip component, one per required element.")]
        public ElementChip chipPrefab;
        public Transform chipParent;

        private readonly List<ElementChip> chips = new List<ElementChip>();

        public void Bind(AlchemyRecipe recipe, OrbContainer container)
        {
            bool affordable = container.CanAfford(recipe);
            var missing = container.Shortfall(recipe);

            if (resultIcon != null)
            {
                Sprite sprite = recipe.resultMaterial != null ? recipe.resultMaterial.icon : null;
                resultIcon.sprite = sprite;
                resultIcon.enabled = sprite != null;
                if (recipe.resultMaterial != null) resultIcon.color = recipe.resultMaterial.tint;
            }
            if (resultName != null)
            {
                resultName.text = recipe.resultMaterial != null ? recipe.resultMaterial.displayName : recipe.recipeID;
            }
            if (group != null) group.alpha = affordable ? 1f : 0.45f;

            if (brewButton != null)
            {
                brewButton.interactable = affordable;
                brewButton.onClick.RemoveAllListeners();
                brewButton.onClick.AddListener(() => container.TryAlchemize(recipe));
            }

            int index = 0;
            foreach (var requirement in recipe.requiredElements)
            {
                if (requirement.element == null) continue;

                ElementChip chip = ChipAt(index++);
                if (chip == null) break;
                chip.Bind(requirement.element, requirement.quantity, missing.ContainsKey(requirement.element));
            }
            for (int i = index; i < chips.Count; i++) chips[i].gameObject.SetActive(false);
        }

        private ElementChip ChipAt(int index)
        {
            if (chipPrefab == null || chipParent == null) return null;

            while (chips.Count <= index) chips.Add(Instantiate(chipPrefab, chipParent));
            chips[index].gameObject.SetActive(true);
            return chips[index];
        }
    }
}
