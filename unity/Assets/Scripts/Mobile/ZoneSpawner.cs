using System.Collections.Generic;
using UnityEngine;
using OrbSystem.ContentModel;

namespace OrbSystem.Mobile
{
    /// <summary>
    /// Populates a zone with MaterialNodes using the weighted spawn table from
    /// the shared content JSON, so the web build and this one field the same
    /// materials at the same rates.
    ///
    /// Nodes are pooled and repositioned rather than destroyed and recreated -
    /// on mobile, instantiating twenty prefabs on every zone change is a visible hitch.
    /// </summary>
    public class ZoneSpawner : MonoBehaviour
    {
        [Header("References")]
        public ContentDatabase contentDatabase;

        [Tooltip("Prefab with a MaterialNode component. One is pooled per node slot.")]
        public MaterialNode nodePrefab;

        [Tooltip("Parent for spawned nodes. Defaults to this transform.")]
        public Transform nodeParent;

        [Header("Zone")]
        [Tooltip("Zone id from content/zones.json, e.g. hollow_verge.")]
        public string zoneID = "hollow_verge";

        [Tooltip("World units per content-file pixel. The content file lays zones " +
                 "out in pixels for the web build; this converts to metres.")]
        public float unitsPerPixel = 0.02f;

        [Header("Layout")]
        [Tooltip("Nodes are kept at least this far apart, in world units.")]
        public float minSpacing = 1.9f;

        [Tooltip("Keeps nodes away from the zone edge, in world units.")]
        public float edgeMargin = 1.4f;

        private readonly List<MaterialNode> pool = new List<MaterialNode>();
        private ZoneJson zone;

        /// <summary>Zone extents in world units. Feed this to TouchPlayerController.bounds.</summary>
        public Rect WorldBounds { get; private set; }

        private void Start()
        {
            if (!string.IsNullOrEmpty(zoneID)) Build(zoneID);
        }

        /// <summary>Tear down the current zone and lay out a new one.</summary>
        public void Build(string newZoneID)
        {
            if (contentDatabase == null || nodePrefab == null)
            {
                Debug.LogError("[ZoneSpawner] Needs both a ContentDatabase and a node prefab.");
                return;
            }

            contentDatabase.Load();
            zone = contentDatabase.Zone(newZoneID);
            if (zone == null)
            {
                Debug.LogError($"[ZoneSpawner] No zone '{newZoneID}' in the content bundle.");
                return;
            }

            zoneID = newZoneID;

            float width = zone.size.w * unitsPerPixel;
            float height = zone.size.h * unitsPerPixel;
            WorldBounds = new Rect(-width * 0.5f, -height * 0.5f, width, height);

            // Deterministic per zone, so a zone looks the same each time you return.
            Random.State previous = Random.state;
            Random.InitState(newZoneID.GetHashCode());

            EnsurePool(zone.nodeCount);
            var placed = new List<Vector2>(zone.nodeCount);

            for (int i = 0; i < pool.Count; i++)
            {
                MaterialNode node = pool[i];
                bool used = i < zone.nodeCount;
                node.gameObject.SetActive(used);
                if (!used) continue;

                node.material = contentDatabase.Material(PickMaterialID());
                node.respawnSeconds = zone.respawnSeconds;
                node.transform.localPosition = PickPosition(placed);
                node.Respawn();
                placed.Add(node.transform.localPosition);
            }

            Random.state = previous;
        }

        private void EnsurePool(int required)
        {
            Transform parent = nodeParent != null ? nodeParent : transform;
            while (pool.Count < required)
            {
                pool.Add(Instantiate(nodePrefab, parent));
            }
        }

        private string PickMaterialID()
        {
            float total = 0f;
            foreach (var spawn in zone.spawns) total += spawn.weight;

            float roll = Random.value * total;
            foreach (var spawn in zone.spawns)
            {
                roll -= spawn.weight;
                if (roll <= 0f) return spawn.material;
            }

            return zone.spawns.Count > 0 ? zone.spawns[zone.spawns.Count - 1].material : null;
        }

        private Vector2 PickPosition(List<Vector2> placed)
        {
            Rect inner = new Rect(
                WorldBounds.xMin + edgeMargin,
                WorldBounds.yMin + edgeMargin,
                Mathf.Max(0.1f, WorldBounds.width - edgeMargin * 2f),
                Mathf.Max(0.1f, WorldBounds.height - edgeMargin * 2f));

            // Rejection-sample so nodes don't stack. Bounded attempts: on a crowded
            // zone this must terminate rather than loop looking for a perfect gap.
            Vector2 candidate = Vector2.zero;
            for (int attempt = 0; attempt < 24; attempt++)
            {
                candidate = new Vector2(
                    Random.Range(inner.xMin, inner.xMax),
                    Random.Range(inner.yMin, inner.yMax));

                bool clash = false;
                for (int i = 0; i < placed.Count; i++)
                {
                    if ((placed[i] - candidate).sqrMagnitude < minSpacing * minSpacing)
                    {
                        clash = true;
                        break;
                    }
                }
                if (!clash) break;
            }

            return candidate;
        }
    }
}
