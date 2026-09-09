using UnityEngine;
using UnityEngine.Events;

namespace OrbSystem.Mobile
{
    /// <summary>
    /// A gatherable material sitting in the world. Handles its own respawn timer
    /// so a zone stays productive without the spawner tracking every node.
    /// </summary>
    public class MaterialNode : MonoBehaviour
    {
        [System.Serializable] public class NodeEvent : UnityEvent<MaterialNode> { }

        [Header("Contents")]
        public MaterialSO material;

        [Header("Respawn")]
        [Tooltip("Seconds before this node becomes gatherable again. 0 means never.")]
        public float respawnSeconds = 15f;

        [Header("Presentation")]
        [Tooltip("Hidden while depleted. Usually the sprite and its shadow.")]
        public GameObject visuals;

        [Tooltip("Optional: filled 0..1 as the node regrows.")]
        public UnityEngine.UI.Image respawnDial;

        [Tooltip("Gentle vertical bob, so nodes read as pickups rather than scenery.")]
        public float bobAmplitude = 0.08f;
        public float bobSpeed = 1.9f;

        public NodeEvent OnHarvested = new NodeEvent();
        public NodeEvent OnRespawned = new NodeEvent();

        private float respawnAt = -1f;
        private Vector3 restPosition;
        private float phase;

        public bool Available { get; private set; } = true;

        private void Awake()
        {
            restPosition = transform.localPosition;
            phase = Random.Range(0f, Mathf.PI * 2f);
        }

        private void Update()
        {
            if (Available)
            {
                if (bobAmplitude > 0f && visuals != null)
                {
                    float offset = Mathf.Sin(Time.time * bobSpeed + phase) * bobAmplitude;
                    visuals.transform.localPosition = new Vector3(0f, offset, 0f);
                }
                return;
            }

            if (respawnAt < 0f) return;

            if (respawnDial != null)
            {
                float remaining = respawnAt - Time.time;
                respawnDial.fillAmount = Mathf.Clamp01(1f - remaining / Mathf.Max(0.01f, respawnSeconds));
            }

            if (Time.time >= respawnAt) Respawn();
        }

        /// <summary>Take this node's material. Returns null if it is depleted.</summary>
        public MaterialSO Harvest()
        {
            if (!Available || material == null) return null;

            Available = false;
            if (visuals != null) visuals.SetActive(false);
            if (respawnDial != null) respawnDial.gameObject.SetActive(true);

            respawnAt = respawnSeconds > 0f ? Time.time + respawnSeconds : -1f;
            OnHarvested.Invoke(this);
            return material;
        }

        public void Respawn()
        {
            Available = true;
            respawnAt = -1f;

            if (visuals != null)
            {
                visuals.SetActive(true);
                visuals.transform.localPosition = Vector3.zero;
            }
            if (respawnDial != null) respawnDial.gameObject.SetActive(false);

            transform.localPosition = restPosition;
            OnRespawned.Invoke(this);
        }
    }
}
