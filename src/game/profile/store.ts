/**
 * The autosaving profile store.
 *
 * Progression must never depend on the player remembering to press anything,
 * or on them leaving the app politely. Every mutation goes through `update`,
 * which applies the change, notifies subscribers, and schedules a write.
 *
 * Three things make that reliable rather than merely frequent:
 *
 *   1. **Debounced writes.** Dragging a slider or rearranging a deck fires
 *      many mutations a second; each one serialising the whole profile to
 *      localStorage would jank the UI. Writes coalesce into one.
 *   2. **Flush on the page-lifecycle events that actually fire.** `pagehide`
 *      and `visibilitychange`, not `beforeunload` — mobile browsers routinely
 *      kill a backgrounded tab without ever firing `beforeunload`, which is
 *      exactly the "tapped out" case that must not lose data.
 *   3. **A dirty flag.** A pending write is always flushed synchronously on
 *      hide, so the worst case is losing the few hundred milliseconds since
 *      the last mutation, not the session.
 */

import type { PlayerProfile } from './schema';
import type { ProfileRepository } from './repository';

/** How long to coalesce rapid mutations before writing. */
const DEBOUNCE_MS = 350;

/** Upper bound between writes while mutations keep arriving. */
const MAX_DEFER_MS = 2000;

export type ProfileListener = (profile: PlayerProfile) => void;

export class ProfileStore {
  private profile: PlayerProfile | null = null;
  private listeners = new Set<ProfileListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private firstDirtyAt = 0;
  private detach: (() => void) | null = null;
  private clock: () => number;

  constructor(
    private readonly repository: ProfileRepository,
    options: { now?: () => number } = {},
  ) {
    // Injectable so tests can drive the deferral window without real time.
    this.clock = options.now ?? (() => Date.now());
  }

  async load(): Promise<PlayerProfile> {
    this.profile = await this.repository.load();
    this.installLifecycleHooks();
    this.emit();
    return this.profile;
  }

  get current(): PlayerProfile | null {
    return this.profile;
  }

  subscribe(listener: ProfileListener): () => void {
    this.listeners.add(listener);
    if (this.profile) listener(this.profile);
    return () => this.listeners.delete(listener);
  }

  /**
   * Apply a mutation and schedule a save.
   *
   * The mutator receives a shallow copy and may mutate it freely; returning a
   * value is optional. A new object identity is always published so React
   * re-renders without callers having to remember to clone.
   */
  update(mutator: (draft: PlayerProfile) => PlayerProfile | void): PlayerProfile | null {
    if (!this.profile) return null;
    const draft: PlayerProfile = { ...this.profile };
    const returned = mutator(draft);
    this.profile = returned ?? draft;

    this.markDirty();
    this.emit();
    return this.profile;
  }

  /** Write immediately, cancelling any pending debounce. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || !this.profile) return;
    this.dirty = false;
    await this.repository.save(this.profile);
  }

  /** Discard progress and start over. Written through immediately. */
  async reset(): Promise<PlayerProfile> {
    this.profile = await this.repository.reset();
    this.dirty = false;
    this.emit();
    return this.profile;
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private markDirty(): void {
    const now = this.clock();
    if (!this.dirty) {
      this.dirty = true;
      this.firstDirtyAt = now;
    }

    // A continuous stream of mutations must not defer the write forever, so
    // the debounce is capped: past MAX_DEFER_MS the next tick writes through.
    if (now - this.firstDirtyAt >= MAX_DEFER_MS) {
      void this.flush();
      return;
    }

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private emit(): void {
    if (!this.profile) return;
    for (const listener of this.listeners) listener(this.profile);
  }

  /**
   * Save on the events that fire when a mobile browser takes the app away.
   *
   * `pagehide` and a hidden `visibilitychange` are the two that are actually
   * dispatched when a tab is backgrounded or discarded; `beforeunload` is not
   * reliable on mobile and is deliberately not used as the primary hook.
   *
   * The flush here is intentionally not awaited — a synchronous localStorage
   * write completes before the handler returns, and awaiting inside a
   * lifecycle handler is not honoured by the browser anyway.
   */
  private installLifecycleHooks(): void {
    if (this.detach || typeof globalThis.addEventListener !== 'function') return;

    const save = () => {
      if (this.dirty) void this.flush();
    };
    const onVisibility = () => {
      if (globalThis.document?.visibilityState === 'hidden') save();
    };

    globalThis.addEventListener('pagehide', save);
    globalThis.addEventListener('freeze', save);
    globalThis.addEventListener('beforeunload', save);
    globalThis.document?.addEventListener('visibilitychange', onVisibility);

    this.detach = () => {
      globalThis.removeEventListener('pagehide', save);
      globalThis.removeEventListener('freeze', save);
      globalThis.removeEventListener('beforeunload', save);
      globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    };
  }
}
