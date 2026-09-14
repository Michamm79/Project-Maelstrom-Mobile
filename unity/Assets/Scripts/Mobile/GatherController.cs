using UnityEngine;
using UnityEngine.Events;

namespace OrbSystem.Mobile
{
    /// <summary>
    /// Finds the nearest gatherable node in range and hands it to the OrbContainer.
    ///
    /// Kept separate from OrbContainer so the orb logic stays free of scene
    /// queries - OrbContainer never needs to know that a "material" arrived from
    /// a collider rather than a menu.
    /// </summary>
    public class GatherController : MonoBehaviour
    {
        [System.Serializable] public class NodeEvent : UnityEvent<MaterialNode> { }

        [Header("References")]
        public OrbContainer orbContainer;

        [Header("Range")]
        [Tooltip("How close the player must be for a node to be gatherable.")]
        public float gatherRadius = 1.4f;

        [Tooltip("Layers that hold MaterialNode colliders.")]
        public LayerMask nodeLayers = ~0;

        [Header("Events")]
        [Tooltip("Fires when the node in range changes, including to null. " +
                 "Drive the Gather button's visibility from this.")]
        public NodeEvent OnTargetChanged = new NodeEvent();

        private readonly Collider2D[] hits = new Collider2D[16];
        private MaterialNode target;

        public MaterialNode Target => target;

        private void Update()
        {
            MaterialNode nearest = FindNearest();
            if (nearest == target) return;

            target = nearest;
            OnTargetChanged.Invoke(target);
        }

        /// <summary>Hook this to the Gather button.</summary>
        public void GatherNearest()
        {
            if (target == null || orbContainer == null) return;

            MaterialSO material = target.Harvest();
            if (material == null) return;

            orbContainer.Gather(material);

            target = null;
            OnTargetChanged.Invoke(null);
        }

        private MaterialNode FindNearest()
        {
            // Non-allocating overlap: this runs every frame, and the GC pressure
            // from the allocating version is very visible on a mid-range phone.
            int count = Physics2D.OverlapCircleNonAlloc(transform.position, gatherRadius, hits, nodeLayers);

            MaterialNode best = null;
            float bestDistance = float.MaxValue;

            for (int i = 0; i < count; i++)
            {
                var node = hits[i] != null ? hits[i].GetComponentInParent<MaterialNode>() : null;
                if (node == null || !node.Available) continue;

                float distance = ((Vector2)(node.transform.position - transform.position)).sqrMagnitude;
                if (distance >= bestDistance) continue;

                best = node;
                bestDistance = distance;
            }

            return best;
        }

        private void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 1f, 1f, 0.35f);
            Gizmos.DrawWireSphere(transform.position, gatherRadius);
        }
    }
}
