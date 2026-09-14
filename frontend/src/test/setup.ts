// Vitest setup: make `localStorage` reliably available in every environment.
//
// Node ≥22 exposes an experimental global `localStorage` whose getter returns
// `undefined` unless the process is started with `--localstorage-file`. Vitest's
// jsdom environment deliberately skips populating any key that already exists on
// the Node global (see `getWindowKeys`), so that broken getter shadows jsdom's
// own storage and tests see `localStorage === undefined`.
//
// Install a working storage unconditionally: the real jsdom window storage when
// the environment provides one (clean, per-file isolation), otherwise a minimal
// in-memory stand-in so node-env suites that import modules touching
// `localStorage` do not crash. We never read the Node getter, so no
// ExperimentalWarning.
function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, String(value))
    },
  }
}

const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window
const storage = jsdomWindow?.localStorage ?? createMemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true,
})
