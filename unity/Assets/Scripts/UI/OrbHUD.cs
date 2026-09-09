using UnityEngine;
using UnityEngine.UI;

namespace OrbSystem.UI
{
    /// <summary>
    /// Binds the two orb slots, the transmute button and the level readout to an
    /// OrbContainer. Subscribes to the container's UnityEvents rather than
    /// polling, which is why OrbContainer exposes them.
    ///
    /// Wire the fields in the inspector; nothing here creates UI.
    /// </summary>
    public class OrbHUD : MonoBehaviour
    {
        [System.Serializable]
        public class OrbSlotView
        {
            public Image icon;
            public Text label;
            public Button unloadButton;
            public Button decomposeButton;
            [Tooltip("Highlight shown when the slot is filled.")]
            public GameObject filledFrame;
        }

        [Header("References")]
        public OrbContainer orbContainer;

        [Header("Orb slots")]
        public OrbSlotView leftSlot;
        public OrbSlotView rightSlot;

        [Header("Transmute")]
        public Button transmuteButton;
        public Text transmuteVerb;
        public Text transmuteResult;
        public Image transmuteResultIcon;

        [Header("Progression")]
        public Text levelLabel;
        public Text xpLabel;
        public Image xpFill;

        [Header("Copy")]
        public string emptySlotText = "empty";
        public string fillBothText = "fill both orbs";
        public string noReactionText = "no reaction";

        private void OnEnable()
        {
            if (orbContainer == null) return;

            orbContainer.OnOrbContentsChanged.AddListener(Refresh);
            orbContainer.progression.OnXpChanged.AddListener(Refresh);
            orbContainer.pack.OnChanged.AddListener(Refresh);

            BindButtons();
            Refresh();
        }

        private void OnDisable()
        {
            if (orbContainer == null) return;

            orbContainer.OnOrbContentsChanged.RemoveListener(Refresh);
            orbContainer.progression.OnXpChanged.RemoveListener(Refresh);
            orbContainer.pack.OnChanged.RemoveListener(Refresh);
        }

        private void BindButtons()
        {
            if (transmuteButton != null)
            {
                transmuteButton.onClick.RemoveListener(OnTransmute);
                transmuteButton.onClick.AddListener(OnTransmute);
            }

            BindSlot(leftSlot, OrbContainer.Hand.Left);
            BindSlot(rightSlot, OrbContainer.Hand.Right);
        }

        private void BindSlot(OrbSlotView slot, OrbContainer.Hand hand)
        {
            if (slot == null) return;

            if (slot.unloadButton != null)
            {
                slot.unloadButton.onClick.RemoveAllListeners();
                slot.unloadButton.onClick.AddListener(() => orbContainer.UnloadOrb(hand));
            }
            if (slot.decomposeButton != null)
            {
                slot.decomposeButton.onClick.RemoveAllListeners();
                slot.decomposeButton.onClick.AddListener(() => orbContainer.DecomposeMaterialAt(hand));
            }
        }

        private void OnTransmute()
        {
            orbContainer.TryTransmute();
        }

        public void Refresh()
        {
            if (orbContainer == null) return;

            RefreshSlot(leftSlot, orbContainer.LeftOrb);
            RefreshSlot(rightSlot, orbContainer.RightOrb);
            RefreshTransmute();
            RefreshProgression();
        }

        private void RefreshSlot(OrbSlotView slot, MaterialSO material)
        {
            if (slot == null) return;

            bool filled = material != null;

            if (slot.icon != null)
            {
                slot.icon.sprite = filled ? material.icon : null;
                slot.icon.color = filled ? material.tint : new Color(1f, 1f, 1f, 0f);
                slot.icon.enabled = filled && material.icon != null;
            }
            if (slot.label != null) slot.label.text = filled ? material.displayName : emptySlotText;
            if (slot.filledFrame != null) slot.filledFrame.SetActive(filled);
            if (slot.unloadButton != null) slot.unloadButton.interactable = filled;
            if (slot.decomposeButton != null)
            {
                slot.decomposeButton.interactable = filled && orbContainer.AlchemyUnlocked;
            }
        }

        private void RefreshTransmute()
        {
            var recipe = orbContainer.PeekTransmutation();

            if (recipe != null)
            {
                Set(transmuteVerb, "Transmute");
                Set(transmuteResult, recipe.resultMaterial != null ? recipe.resultMaterial.displayName : "");
                if (transmuteResultIcon != null)
                {
                    Sprite sprite = recipe.resultMaterial != null ? recipe.resultMaterial.icon : null;
                    transmuteResultIcon.sprite = sprite;
                    transmuteResultIcon.enabled = sprite != null;
                }
                if (transmuteButton != null) transmuteButton.interactable = true;
                return;
            }

            if (transmuteResultIcon != null) transmuteResultIcon.enabled = false;
            if (transmuteButton != null) transmuteButton.interactable = false;

            // A locked pair gets its own message: "no reaction" would tell the
            // player to stop trying a combination that does in fact work later.
            var locked = orbContainer.PeekLockedTransmutation();
            if (locked != null)
            {
                Set(transmuteVerb, "Locked");
                Set(transmuteResult, $"needs Lv {locked.requiredLevel}");
                return;
            }

            Set(transmuteVerb, "Transmute");
            bool bothFilled = orbContainer.LeftOrb != null && orbContainer.RightOrb != null;
            Set(transmuteResult, bothFilled ? noReactionText : fillBothText);
        }

        private void RefreshProgression()
        {
            var progression = orbContainer.progression;

            Set(levelLabel, $"Lv {progression.Level}");

            int next = progression.XpAtNextLevel(progression.Level);
            if (next < 0)
            {
                Set(xpLabel, "max");
            }
            else
            {
                int start = progression.XpAtLevelStart(progression.Level);
                Set(xpLabel, $"{progression.Xp - start} / {next - start}");
            }

            if (xpFill != null) xpFill.fillAmount = progression.Progress01();
        }

        private static void Set(Text label, string value)
        {
            if (label != null) label.text = value;
        }
    }
}
