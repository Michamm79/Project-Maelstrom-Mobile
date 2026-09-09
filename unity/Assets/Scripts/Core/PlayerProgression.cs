using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace OrbSystem
{
    /// <summary>
    /// Level and XP. The curve comes from the shared content JSON so balance can
    /// be retuned without recompiling, and so the web build and this one level at
    /// exactly the same rate.
    /// </summary>
    [System.Serializable]
    public class PlayerProgression
    {
        [System.Serializable]
        public class LevelUpEvent : UnityEvent<int> { }

        [SerializeField] private int level = 1;
        [SerializeField] private int xp;

        /// <summary>Cumulative XP at which each level begins. Index 0 is level 1.</summary>
        private int[] xpTable = { 0 };
        private int maxLevel = 1;

        public LevelUpEvent OnLevelUp = new LevelUpEvent();
        public UnityEvent OnXpChanged = new UnityEvent();

        public int Level => level;
        public int Xp => xp;
        public int MaxLevel => maxLevel;

        public void Configure(int[] cumulativeXpTable, int maxPlayerLevel)
        {
            if (cumulativeXpTable != null && cumulativeXpTable.Length > 0) xpTable = cumulativeXpTable;
            maxLevel = Mathf.Max(1, maxPlayerLevel);
            level = Mathf.Clamp(LevelForXp(xp), 1, maxLevel);
        }

        public void Restore(int savedLevel, int savedXp)
        {
            xp = Mathf.Max(0, savedXp);
            // Never restore below what the XP actually earns - a save edited or
            // migrated from an older curve should not demote the player.
            level = Mathf.Clamp(Mathf.Max(savedLevel, LevelForXp(xp)), 1, maxLevel);
        }

        /// <summary>Adds XP and raises OnLevelUp once per level crossed.</summary>
        public void AddXp(int amount)
        {
            if (amount <= 0) return;

            int before = level;
            xp += amount;
            int after = LevelForXp(xp);

            OnXpChanged.Invoke();
            if (after <= before) return;

            level = after;
            for (int reached = before + 1; reached <= after; reached++) OnLevelUp.Invoke(reached);
        }

        public int LevelForXp(int totalXp)
        {
            int result = 1;
            for (int i = 1; i < xpTable.Length; i++)
            {
                if (totalXp >= xpTable[i]) result = i + 1;
                else break;
            }
            return Mathf.Min(result, maxLevel);
        }

        public int XpAtLevelStart(int forLevel)
        {
            int index = Mathf.Clamp(forLevel - 1, 0, xpTable.Length - 1);
            return xpTable[index];
        }

        /// <summary>Cumulative XP needed for the next level, or -1 at max level.</summary>
        public int XpAtNextLevel(int forLevel)
        {
            if (forLevel >= maxLevel || forLevel >= xpTable.Length) return -1;
            return xpTable[forLevel];
        }

        /// <summary>Progress through the current level, 0..1. Max level reads as full.</summary>
        public float Progress01()
        {
            int next = XpAtNextLevel(level);
            if (next < 0) return 1f;

            int start = XpAtLevelStart(level);
            int span = next - start;
            if (span <= 0) return 1f;

            return Mathf.Clamp01((xp - start) / (float)span);
        }
    }

    /// <summary>
    /// Materials the player is carrying but not holding in an orb. The desktop
    /// prototype had nowhere to put a transmutation result except the world;
    /// a pack is what lets a crafted item be loaded back into an orb and used as
    /// the input to the next tier.
    /// </summary>
    [System.Serializable]
    public class Inventory
    {
        private readonly Dictionary<MaterialSO, int> contents = new Dictionary<MaterialSO, int>();

        public UnityEvent OnChanged = new UnityEvent();

        public IReadOnlyDictionary<MaterialSO, int> Contents => contents;

        public int CountOf(MaterialSO material)
        {
            if (material == null) return 0;
            return contents.TryGetValue(material, out int count) ? count : 0;
        }

        public void Add(MaterialSO material, int count = 1)
        {
            if (material == null || count <= 0) return;

            contents[material] = CountOf(material) + count;
            OnChanged.Invoke();
        }

        public bool Remove(MaterialSO material, int count = 1)
        {
            if (material == null || count <= 0) return false;

            int have = CountOf(material);
            if (have < count) return false;

            int remaining = have - count;
            if (remaining > 0) contents[material] = remaining;
            else contents.Remove(material);

            OnChanged.Invoke();
            return true;
        }

        public void Clear()
        {
            contents.Clear();
            OnChanged.Invoke();
        }

        /// <summary>Deepest tier first, so late-game items surface at the top of the pack UI.</summary>
        public List<KeyValuePair<MaterialSO, int>> Sorted()
        {
            var list = new List<KeyValuePair<MaterialSO, int>>(contents);
            list.Sort((x, y) =>
            {
                int byTier = y.Key.tier.CompareTo(x.Key.tier);
                return byTier != 0 ? byTier : string.CompareOrdinal(x.Key.displayName, y.Key.displayName);
            });
            return list;
        }
    }
}
