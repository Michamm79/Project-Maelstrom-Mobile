using UnityEngine;

namespace OrbSystem.Mobile
{
    /// <summary>
    /// Drives the player from the virtual joystick, with keyboard as a fallback
    /// so the game is still playable in the editor without touch simulation.
    ///
    /// Moves a Rigidbody2D when one is present (so colliders are respected) and
    /// falls back to translating the transform when there isn't.
    /// </summary>
    public class TouchPlayerController : MonoBehaviour
    {
        [Header("References")]
        public VirtualJoystick joystick;

        [Header("Movement")]
        public float moveSpeed = 5f;

        [Tooltip("Higher is snappier. Set very high for instant response.")]
        public float acceleration = 22f;

        [Tooltip("Clamps the player inside the zone. Leave zero-sized to disable.")]
        public Rect bounds = new Rect(0, 0, 0, 0);

        private Rigidbody2D body;
        private Vector2 velocity;

        /// <summary>Last non-zero facing, kept through idle frames so the sprite doesn't snap back.</summary>
        public Vector2 Facing { get; private set; } = Vector2.down;

        public bool IsMoving => velocity.sqrMagnitude > 0.01f;

        private void Awake()
        {
            body = GetComponent<Rigidbody2D>();

        }

        private void Update()
        {
            Vector2 input = joystick != null ? joystick.Direction : Vector2.zero;

            if (input.sqrMagnitude < 0.0001f)
            {
                input = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
                if (input.sqrMagnitude > 1f) input.Normalize();
            }

            Vector2 target = input * moveSpeed;
            velocity = Vector2.MoveTowards(velocity, target, acceleration * Time.deltaTime);

            if (input.sqrMagnitude > 0.01f) Facing = input.normalized;
        }

        private void FixedUpdate()
        {
            Vector2 step = velocity * Time.fixedDeltaTime;

            if (body != null)
            {
                Vector2 next = body.position + step;
                body.MovePosition(ClampToBounds(next));
            }
            else
            {
                Vector3 next = transform.position + (Vector3)step;
                Vector2 clamped = ClampToBounds(next);
                transform.position = new Vector3(clamped.x, clamped.y, transform.position.z);
            }
        }

        private Vector2 ClampToBounds(Vector2 position)
        {
            if (bounds.width <= 0f || bounds.height <= 0f) return position;

            return new Vector2(
                Mathf.Clamp(position.x, bounds.xMin, bounds.xMax),
                Mathf.Clamp(position.y, bounds.yMin, bounds.yMax));
        }
    }
}
