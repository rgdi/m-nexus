// v0.28: Performance cache y optimizaciones.
// Cache LRU con TTL, debouncing, batching, lazy loading.

/** LRU Cache con TTL. */
export class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expiry: number }>();
  private hits = 0;
  private misses = 0;

  constructor(
    private maxSize: number = 100,
    private defaultTtlMs: number = 60_000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Mover al final (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      // Evict el más antiguo (primer key del Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiry: Date.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  /** Estadísticas. */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /** Limpia entries expiradas. */
  prune(): number {
    let pruned = 0;
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (now > v.expiry) {
        this.cache.delete(k);
        pruned++;
      }
    }
    return pruned;
  }
}

/** Debouncing: ejecuta después de N ms de inactividad. */
export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delayMs);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (timeout) { clearTimeout(timeout); timeout = null; }
  };
  return wrapped;
}

/** Throttle: ejecuta al menos una vez cada N ms. */
export function throttle<T extends (...args: never[]) => void>(fn: T, limitMs: number): T {
  let lastCall = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= limitMs) {
      lastCall = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(() => {
        lastCall = Date.now();
        pending = null;
        fn(...args);
      }, limitMs - (now - lastCall));
    }
  }) as T;
}

/** Memoization con TTL. */
export function memoize<Args extends unknown[], R>(fn: (...args: Args) => R, ttlMs: number = 60_000): (...args: Args) => R {
  const cache = new Map<string, { value: R; expiry: number }>();
  return (...args: Args) => {
    const key = JSON.stringify(args);
    const entry = cache.get(key);
    if (entry && Date.now() < entry.expiry) return entry.value;
    const value = fn(...args);
    cache.set(key, { value, expiry: Date.now() + ttlMs });
    return value;
  };
}

/** Batching: agrupa llamadas en un único batch. */
export class Batcher<T, R> {
  private queue: Array<{ item: T; resolve: (r: R) => void; reject: (e: unknown) => void }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private batchFn: (items: T[]) => Promise<R[]>,
    private maxBatchSize: number = 10,
    private maxWaitMs: number = 100,
  ) {}

  add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;
    const items = this.queue.splice(0, this.queue.length);
    try {
      const results = await this.batchFn(items.map((q) => q.item));
      for (let i = 0; i < items.length; i++) {
        if (i < results.length) items[i].resolve(results[i]);
        else items[i].reject(new Error("Batch returned fewer results"));
      }
    } catch (e) {
      for (const q of items) q.reject(e);
    }
  }
}

/** Lazy initialization. */
export class Lazy<T> {
  private value: T | undefined;
  private initialized = false;
  constructor(private factory: () => T) {}
  get(): T {
    if (!this.initialized) {
      this.value = this.factory();
      this.initialized = true;
    }
    return this.value as T;
  }
  isInitialized(): boolean { return this.initialized; }
  reset(): void { this.value = undefined; this.initialized = false; }
}

/** Pool de objetos reutilizables. */
export class ObjectPool<T> {
  private available: T[] = [];

  constructor(
    private factory: () => T,
    private reset: (obj: T) => void = () => {},
    private maxSize: number = 50,
  ) {}

  acquire(): T {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return this.factory();
  }

  release(obj: T): void {
    if (this.available.length < this.maxSize) {
      this.reset(obj);
      this.available.push(obj);
    }
  }
}

/** Medir tiempo de ejecución. */
export class PerfTimer {
  private start: number;
  private marks: Array<{ name: string; time: number }> = [];

  constructor(private name: string = "perf") {
    this.start = performance.now();
  }

  mark(name: string): void {
    this.marks.push({ name, time: performance.now() - this.start });
  }

  end(): { name: string; totalMs: number; marks: Array<{ name: string; time: number }> } {
    return {
      name: this.name,
      totalMs: performance.now() - this.start,
      marks: [...this.marks],
    };
  }
}

/** Singleton: mapa de singletons para lazy load. */
const singletons = new Map<string, unknown>();

export function getSingleton<T>(name: string, factory: () => T): T {
  if (!singletons.has(name)) {
    singletons.set(name, factory());
  }
  return singletons.get(name) as T;
}
