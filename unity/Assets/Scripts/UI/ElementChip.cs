using UnityEngine;
using UnityEngine.UI;

namespace OrbSystem.UI
{
    /// <summary>A small "Pyron 2" pill, tinted by the element and reddened when short.</summary>
    public class ElementChip : MonoBehaviour
    {
        public Image dot;
        public Text label;
        public Graphic background;

        public Color shortfallColor = new Color(0.97f, 0.44f, 0.44f);
        public Color normalColor = new Color(0.58f, 0.63f, 0.71f);

        public void Bind(ElementSO element, int quantity, bool isShort)
        {
            if (element == null) return;

            if (dot != null) dot.color = element.elementColor;
            if (label != null)
            {
                label.text = $"{element.displayName} {quantity}";
                label.color = isShort ? shortfallColor : normalColor;
            }
            if (background != null)
            {
                background.color = isShort ? new Color(0.29f, 0.16f, 0.16f) : new Color(0.05f, 0.07f, 0.1f);
            }
        }
    }
}
