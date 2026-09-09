using UnityEngine;
using UnityEngine.EventSystems;

namespace OrbSystem.Mobile
{
    /// <summary>
    /// Floating on-screen stick. Put this on a full-screen, transparent Image
    /// (Raycast Target on) sitting behind the HUD buttons.
    ///
    /// Floating rather than fixed: the stick appears wherever the thumb lands,
    /// which is what makes one-handed play comfortable. A fixed stick forces the
    /// player to look down and hunt for it.
    /// </summary>
    [RequireComponent(typeof(RectTransform))]
    public class VirtualJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        [Header("Visuals (optional)")]
        [Tooltip("Ring that appears at the touch point.")]
        public RectTransform baseRing;

        [Tooltip("Knob that follows the thumb inside the ring.")]
        public RectTransform knob;

        [Header("Feel")]
        [Tooltip("Screen-space radius, in canvas units, at which the stick reads as fully deflected.")]
        public float radius = 90f;

        [Tooltip("Deflection below this fraction is treated as no input, so a resting thumb doesn't drift.")]
        [Range(0f, 0.5f)] public float deadZone = 0.12f;

        private RectTransform self;
        private Canvas canvas;
        private Vector2 origin;
        private int activePointer = -1;

        /// <summary>Current stick direction, magnitude 0..1.</summary>
        public Vector2 Direction { get; private set; }

        public bool Active => activePointer != -1;

        private void Awake()
        {
            self = GetComponent<RectTransform>();
            canvas = GetComponentInParent<Canvas>();
            SetVisible(false);
        }

        public void OnPointerDown(PointerEventData eventData)
        {
            if (Active) return;

            activePointer = eventData.pointerId;
            origin = ToLocal(eventData);

            if (baseRing != null) baseRing.anchoredPosition = origin;
            if (knob != null) knob.anchoredPosition = origin;
            SetVisible(true);
        }

        public void OnDrag(PointerEventData eventData)
        {
            if (eventData.pointerId != activePointer) return;

            Vector2 delta = ToLocal(eventData) - origin;
            float distance = delta.magnitude;
            Vector2 clamped = distance > radius ? delta.normalized * radius : delta;

            if (knob != null) knob.anchoredPosition = origin + clamped;

            Vector2 raw = clamped / radius;
            Direction = raw.magnitude < deadZone ? Vector2.zero : raw;
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            if (eventData.pointerId != activePointer) return;
            Release();
        }

        private void OnDisable()
        {
            Release();
        }

        private void Release()
        {
            activePointer = -1;
            Direction = Vector2.zero;
            SetVisible(false);
        }

        private Vector2 ToLocal(PointerEventData eventData)
        {
            Camera cam = canvas != null && canvas.renderMode != RenderMode.ScreenSpaceOverlay
                ? canvas.worldCamera
                : null;

            RectTransformUtility.ScreenPointToLocalPointInRectangle(self, eventData.position, cam, out Vector2 local);
            return local;
        }

        private void SetVisible(bool visible)
        {
            if (baseRing != null) baseRing.gameObject.SetActive(visible);
            if (knob != null) knob.gameObject.SetActive(visible);
        }
    }
}
