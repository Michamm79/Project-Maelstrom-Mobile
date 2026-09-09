/**
 * Minimal typed event emitter, standing in for the UnityEvents that
 * OrbContainer.cs exposes (OnOrbContentsChanged / OnElementPoolChanged).
 */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy first: a listener may unsubscribe itself while we're iterating.
    for (const fn of [...set]) (fn as Listener<Events[K]>)(payload);
  }
}
