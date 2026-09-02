// EventBus minimalista con tipos. Inspirado en Node's EventEmitter.

export type Listener<T> = (arg: T) => void;

export class EventEmitter<Events> {
  private listeners: Map<keyof Events, Set<Listener<unknown>>> = new Map();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<unknown>);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, arg: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Iterar sobre una copia: si un listener llama a off() o on() durante
    // la iteración, modificar el Set en vivo causa comportamiento indefinido.
    const fns = Array.from(set);
    for (const fn of fns) {
      try {
        (fn as Listener<Events[K]>)(arg);
      } catch (e) {
        // swallow to keep emitter stable
        console.error(`[EventEmitter] listener for "${String(event)}" threw:`, e);
      }
    }
  }

  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event) {
      this.listeners.get(event)?.clear();
    } else {
      this.listeners.clear();
    }
  }
}
