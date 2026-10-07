import { beforeEach } from "vitest";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    for (const key of this.#values.keys()) delete (this as unknown as Record<string, string>)[key];
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    const normalized = String(key);
    this.#values.delete(normalized);
    delete (this as unknown as Record<string, string>)[normalized];
  }

  setItem(key: string, value: string): void {
    const normalized = String(key);
    const stored = String(value);
    this.#values.set(normalized, stored);
    Object.defineProperty(this, normalized, {
      configurable: true,
      enumerable: true,
      get: () => this.#values.get(normalized),
    });
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

beforeEach(() => storage.clear());
