using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace OrbSystem.UI
{
    /// <summary>
    /// Lists every alchemy recipe the player's level has unlocked, marks which
    /// are affordable, and brews on tap.
    ///
    /// Shows unaffordable recipes too, with the shortfall spelled out. Hiding
    /// them would leave the player with no idea what to go and decompose.
    /// </summary>
    public class AlchemyPanel : MonoBehaviour
    {
        [Header("References")]
        public OrbContainer orbContainer;

        [Header("Recipe list")]
        [Tooltip("Prefab with an AlchemyRecipeRow component.")]
        public AlchemyRecipeRow rowPrefab;
        public Transform rowParent;

        [Header("Element pool")]
        [Tooltip("Prefab with an ElementChip component.")]
        public ElementChip chipPrefab;
        public Transform chipParent;

        [Header("Empty states")]
        public GameObject lockedMessage;
        public GameObject emptyPoolMessage;

        private readonly List<AlchemyRecipeRow> rows = new List<AlchemyRecipeRow>();
        private readonly List<ElementChip> chips = new List<ElementChip>();

        private void OnEnable()
        {
            if (orbContainer == null) return;

            orbContainer.OnElementPoolChanged.AddListener(Refresh);
            Refresh();
        }

        private void OnDisable()
        {
            if (orbContainer == null) return;
            orbContainer.OnElementPoolChanged.RemoveListener(Refresh);
        }

        public void Refresh()
        {
            if (orbContainer == null) return;

            bool unlocked = orbContainer.AlchemyUnlocked;
            if (lockedMessage != null) lockedMessage.SetActive(!unlocked);
            if (!unlocked)
            {
                SetActiveCount(rows, 0);
                SetActiveCount(chips, 0);
                return;
            }

            RefreshPool();
            RefreshRecipes();
        }

        private void RefreshPool()
        {
            var pool = orbContainer.ElementPool;
            if (emptyPoolMessage != null) emptyPoolMessage.SetActive(pool.Count == 0);

            int index = 0;
            foreach (var entry in pool)
            {
                ElementChip chip = ChipAt(index++);
                if (chip == null) break;
                chip.Bind(entry.Key, entry.Value, false);
            }
            SetActiveCount(chips, index);
        }

        private void RefreshRecipes()
        {
            var known = AlchemySystem.KnownRecipes(orbContainer.PlayerLevel);

            int index = 0;
            foreach (var recipe in known)
            {
                AlchemyRecipeRow row = RowAt(index++);
                if (row == null) break;

                row.Bind(recipe, orbContainer);
            }
            SetActiveCount(rows, index);
        }

        private AlchemyRecipeRow RowAt(int index)
        {
            if (rowPrefab == null || rowParent == null) return null;

            while (rows.Count <= index) rows.Add(Instantiate(rowPrefab, rowParent));
            rows[index].gameObject.SetActive(true);
            return rows[index];
        }

        private ElementChip ChipAt(int index)
        {
            if (chipPrefab == null || chipParent == null) return null;

            while (chips.Count <= index) chips.Add(Instantiate(chipPrefab, chipParent));
            chips[index].gameObject.SetActive(true);
            return chips[index];
        }

        private static void SetActiveCount<T>(List<T> items, int active) where T : MonoBehaviour
        {
            for (int i = active; i < items.Count; i++) items[i].gameObject.SetActive(false);
        }
    }
}
