using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace OrbSystem
{
    /// <summary>
    /// Runtime component attached to the player. Manages the two orb slots
    /// (Left/Right), the player's alchemic element pool, their pack, and their level.
    ///
    /// Exposes the same three core actions as the desktop prototype:
    ///   - AddMaterialToOrb()      : pick up a material into a free orb
    ///   - TryTransmute()          : attempt to combine the two orb materials
    ///   - DecomposeMaterialAt()   : alchemically break a material into elements
    ///
    /// plus what a shipping mobile loop needs on top: a pack to hold results,
    /// loading orbs back out of that pack, and XP.
    ///
    /// This script intentionally has no UI dependency. UI listens to the
    /// UnityEvents and queries the public properties; the orb logic stays clean.
    /// </summary>
    public class OrbContainer : MonoBehaviour
    {
        public enum Hand { Left, Right }

        [System.Serializable] public class MaterialEvent : UnityEvent<MaterialSO> { }
        [System.Serializable] public class RecipeEvent : UnityEvent<TransmutationRecipe> { }
        [System.Serializable] public class AlchemyEvent : UnityEvent<AlchemyRecipe> { }
        [System.Serializable] public class NoticeEvent : UnityEvent<string> { }

        [Header("Content")]
        [Tooltip("Loads elements, materials and recipes from the shared content JSON. " +
                 "Leave empty to use hand-authored assets in Resources/ instead.")]
        public ContentDatabase contentDatabase;

        [Header("Player State")]
        [Tooltip("Level at which alchemic decomposition unlocks.")]
        public int alchemyUnlockLevel = 5;

        [Header("Spawn Settings")]
        [Tooltip("Where transmuted/alchemized objects spawn (e.g., in front of the player).")]
        public Transform spawnPoint;

        [Tooltip("Also Instantiate() a recipe's resultPrefab, when it has one. " +
                 "Off by default: on mobile the result normally just goes into the pack.")]
        public bool spawnResultPrefabs;

        // ---- Runtime State ----
        private MaterialSO leftOrb;
        private MaterialSO rightOrb;
        private readonly Dictionary<ElementSO, int> elementPool = new Dictionary<ElementSO, int>();

        public readonly PlayerProgression progression = new PlayerProgression();
        public readonly Inventory pack = new Inventory();

        private readonly HashSet<string> discoveredRecipes = new HashSet<string>();
        private readonly HashSet<string> seenMaterials = new HashSet<string>();

        // ---- Events for UI to subscribe to ----
        public UnityEvent OnOrbContentsChanged = new UnityEvent();
        public UnityEvent OnElementPoolChanged = new UnityEvent();
        public MaterialEvent OnMaterialGathered = new MaterialEvent();
        public MaterialEvent OnMaterialCrafted = new MaterialEvent();
        public MaterialEvent OnMaterialDiscovered = new MaterialEvent();
        public MaterialEvent OnMaterialDecomposed = new MaterialEvent();
        public NoticeEvent OnNotice = new NoticeEvent();

        // ---- Public Read-Only Accessors ----
        public MaterialSO LeftOrb => leftOrb;
        public MaterialSO RightOrb => rightOrb;
        public IReadOnlyDictionary<ElementSO, int> ElementPool => elementPool;
        public int PlayerLevel => progression.Level;
        public bool AlchemyUnlocked => progression.Level >= alchemyUnlockLevel;
        public IReadOnlyCollection<string> DiscoveredRecipes => discoveredRecipes;
        public IReadOnlyCollection<string> SeenMaterials => seenMaterials;

        private void Awake()
        {
            if (contentDatabase != null)
            {
                contentDatabase.Load();
                alchemyUnlockLevel = contentDatabase.Progression.alchemyUnlockLevel;
                progression.Configure(contentDatabase.Progression.xpTable, contentDatabase.Progression.maxLevel);
            }
            else
            {
                // No JSON database wired up: fall back to hand-authored assets,
                // exactly as the desktop prototype did.
                TransmutationSystem.Initialize();
                AlchemySystem.Initialize();
            }
        }

        // ---------------------------------------------------------------
        // Adding materials
        // ---------------------------------------------------------------

        /// <summary>
        /// Place a material into the specified orb.
        /// Returns true if successful, false if the orb is already full.
        /// </summary>
        public bool AddMaterialToOrb(Hand hand, MaterialSO material)
        {
            if (material == null) return false;

            if (hand == Hand.Left)
            {
                if (leftOrb != null) return false;
                leftOrb = material;
            }
            else
            {
                if (rightOrb != null) return false;
                rightOrb = material;
            }

            OnOrbContentsChanged.Invoke();
            return true;
        }

        /// <summary>
        /// Auto-place into whichever orb is empty. Returns the hand used,
        /// or null if both orbs are full.
        /// </summary>
        public Hand? AddMaterialToFreeOrb(MaterialSO material)
        {
            if (leftOrb == null && AddMaterialToOrb(Hand.Left, material)) return Hand.Left;
            if (rightOrb == null && AddMaterialToOrb(Hand.Right, material)) return Hand.Right;
            return null;
        }

        /// <summary>Discards the orb's contents outright.</summary>
        public void ClearOrb(Hand hand)
        {
            if (hand == Hand.Left) leftOrb = null;
            else rightOrb = null;

            OnOrbContentsChanged.Invoke();
        }

        /// <summary>Move an orb's material into the pack rather than losing it.</summary>
        public bool UnloadOrb(Hand hand)
        {
            MaterialSO material = GetOrb(hand);
            if (material == null) return false;

            SetOrb(hand, null);
            pack.Add(material);
            OnOrbContentsChanged.Invoke();
            return true;
        }

        /// <summary>Draw from the pack into an orb - how tier-2+ crafting is actually done.</summary>
        public bool LoadFromPack(Hand hand, MaterialSO material)
        {
            if (material == null) return false;
            if (GetOrb(hand) != null) return false;
            if (!pack.Remove(material)) return false;

            SetOrb(hand, material);
            OnOrbContentsChanged.Invoke();
            return true;
        }

        public Hand? LoadFromPackToFreeOrb(MaterialSO material)
        {
            if (leftOrb == null && LoadFromPack(Hand.Left, material)) return Hand.Left;
            if (rightOrb == null && LoadFromPack(Hand.Right, material)) return Hand.Right;
            return null;
        }

        public void SwapOrbs()
        {
            (leftOrb, rightOrb) = (rightOrb, leftOrb);
            OnOrbContentsChanged.Invoke();
        }

        // ---------------------------------------------------------------
        // Gathering
        // ---------------------------------------------------------------

        /// <summary>
        /// Pick a material up out of the world. Falls through to the pack when
        /// both orbs are full, so a pickup is never silently wasted.
        /// </summary>
        public Hand? Gather(MaterialSO material)
        {
            if (material == null) return null;

            bool isNew = seenMaterials.Add(material.materialID);
            Hand? hand = AddMaterialToFreeOrb(material);
            if (hand == null) pack.Add(material);

            var xpConfig = contentDatabase != null ? contentDatabase.Progression.xp : null;
            int gain = xpConfig == null ? 4 : (isNew ? xpConfig.gatherNewMaterial : xpConfig.gather);
            progression.AddXp(gain);

            OnMaterialGathered.Invoke(material);
            if (isNew) OnMaterialDiscovered.Invoke(material);
            else if (hand == null) OnNotice.Invoke($"Orbs full - {material.displayName} went to your pack");

            return hand;
        }

        // ---------------------------------------------------------------
        // Transmutation
        // ---------------------------------------------------------------

        /// <summary>
        /// Peek at what would result from transmuting the current orb contents.
        /// Useful for showing a preview in the UI before committing.
        /// Returns null if no valid recipe exists.
        /// </summary>
        public TransmutationRecipe PeekTransmutation()
        {
            if (leftOrb == null || rightOrb == null) return null;
            return TransmutationSystem.FindRecipe(leftOrb, rightOrb, progression.Level);
        }

        /// <summary>
        /// A recipe exists for the current pair but the player is too low a level.
        /// Lets the UI say "needs level 12" instead of "no reaction".
        /// </summary>
        public TransmutationRecipe PeekLockedTransmutation()
        {
            if (leftOrb == null || rightOrb == null) return null;
            return TransmutationSystem.FindLockedRecipe(leftOrb, rightOrb, progression.Level);
        }

        /// <summary>
        /// Commit to the transmutation: consumes both orb materials and grants the
        /// result. Returns the resulting material, or null if no valid recipe.
        /// </summary>
        public MaterialSO TryTransmute()
        {
            var recipe = PeekTransmutation();
            if (recipe == null || recipe.resultMaterial == null) return null;

            // Consume inputs
            leftOrb = null;
            rightOrb = null;
            OnOrbContentsChanged.Invoke();

            bool isNew = discoveredRecipes.Add(recipe.recipeID);
            GrantResult(recipe.resultMaterial, recipe.resultPrefab);

            float factor = 1f;
            if (!isNew && contentDatabase != null) factor = contentDatabase.Progression.xp.repeatTransmuteFactor;
            progression.AddXp(Mathf.Max(1, Mathf.RoundToInt(recipe.xp * factor)));

            if (isNew) OnMaterialDiscovered.Invoke(recipe.resultMaterial);
            OnMaterialCrafted.Invoke(recipe.resultMaterial);
            return recipe.resultMaterial;
        }

        // ---------------------------------------------------------------
        // Alchemy
        // ---------------------------------------------------------------

        /// <summary>
        /// Alchemically decompose the material in the specified orb into its
        /// constituent elements, which are added to the player's element pool.
        /// Locked behind alchemyUnlockLevel.
        /// </summary>
        public bool DecomposeMaterialAt(Hand hand)
        {
            if (!AlchemyUnlocked)
            {
                OnNotice.Invoke($"Alchemy unlocks at level {alchemyUnlockLevel}");
                return false;
            }

            MaterialSO target = GetOrb(hand);
            if (target == null) return false;

            foreach (var comp in target.elementComposition)
            {
                if (comp.element == null || comp.quantity <= 0) continue;

                elementPool.TryGetValue(comp.element, out int have);
                elementPool[comp.element] = have + comp.quantity;
            }

            ClearOrb(hand);

            int gain = contentDatabase != null ? contentDatabase.Progression.xp.decompose : 6;
            progression.AddXp(gain);

            OnElementPoolChanged.Invoke();
            OnMaterialDecomposed.Invoke(target);
            return true;
        }

        /// <summary>
        /// Get every alchemy recipe the player can currently afford with their
        /// element pool. Use this to populate the alchemy menu.
        /// </summary>
        public List<AlchemyRecipe> GetAvailableAlchemyRecipes()
        {
            if (!AlchemyUnlocked) return new List<AlchemyRecipe>();
            return AlchemySystem.FindAvailableRecipes(elementPool, progression.Level);
        }

        public bool CanAfford(AlchemyRecipe recipe)
        {
            return AlchemySystem.CanFulfill(recipe, elementPool);
        }

        public Dictionary<ElementSO, int> Shortfall(AlchemyRecipe recipe)
        {
            return AlchemySystem.Shortfall(recipe, elementPool);
        }

        /// <summary>
        /// Commit to an alchemy recipe: consumes the required elements and grants
        /// the result. Returns the resulting material, or null on failure.
        /// </summary>
        public MaterialSO TryAlchemize(AlchemyRecipe recipe)
        {
            if (recipe == null || !AlchemyUnlocked) return null;
            if (recipe.requiredLevel > progression.Level) return null;
            if (recipe.resultMaterial == null) return null;
            if (!AlchemySystem.ConsumeElements(recipe, elementPool)) return null;

            bool isNew = discoveredRecipes.Add(recipe.recipeID);
            GrantResult(recipe.resultMaterial, recipe.resultPrefab);

            float factor = 1f;
            if (!isNew && contentDatabase != null) factor = contentDatabase.Progression.xp.repeatAlchemyFactor;
            progression.AddXp(Mathf.Max(1, Mathf.RoundToInt(recipe.xp * factor)));

            OnElementPoolChanged.Invoke();
            if (isNew) OnMaterialDiscovered.Invoke(recipe.resultMaterial);
            OnMaterialCrafted.Invoke(recipe.resultMaterial);
            return recipe.resultMaterial;
        }

        // ---------------------------------------------------------------
        // Helpers
        // ---------------------------------------------------------------

        public MaterialSO GetOrb(Hand hand)
        {
            return hand == Hand.Left ? leftOrb : rightOrb;
        }

        private void SetOrb(Hand hand, MaterialSO material)
        {
            if (hand == Hand.Left) leftOrb = material;
            else rightOrb = material;
        }

        public bool HasSeen(MaterialSO material)
        {
            return material != null && seenMaterials.Contains(material.materialID);
        }

        public bool HasDiscovered(string recipeID)
        {
            return discoveredRecipes.Contains(recipeID);
        }

        private void GrantResult(MaterialSO material, GameObject prefab)
        {
            pack.Add(material);
            seenMaterials.Add(material.materialID);

            if (!spawnResultPrefabs || prefab == null) return;

            Transform t = spawnPoint != null ? spawnPoint : transform;
            Instantiate(prefab, t.position, t.rotation);
        }
    }
}
