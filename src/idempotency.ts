/**
 * Deterministic idempotency key generation for SDK calls.
 *
 * Keys are:
 * - **Unique per call** — a monotonic counter ensures two rapid calls with
 *   identical parameters produce different keys.
 * - **Stable across retries** — the key is generated once per SDK method
 *   invocation and reused for every retry attempt.
 * - **Deterministic** — no randomness; keys are reproducible given the same
 *   counter state.
 *
 * @internal
 */
import { createHash } from 'crypto';

let _callCounter = 0;

/**
 * Generate a deterministic, unique idempotency key.
 *
 * @param prefix - Short prefix for the key type (e.g. `chg`, `track`, `evt`, `run`, `stream`)
 * @param components - Call-specific values (customerId, meter, quantity, etc.)
 * @returns A key like `chg_<24-char hex hash>`
 */
export function deterministicIdempotencyKey(
  prefix: string,
  ...components: Array<string | number | undefined>
): string {
  const seq = ++_callCounter;
  const parts = components.filter((c) => c !== undefined).map(String);
  parts.push(String(seq));
  const hash = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

/**
 * Reset counter — only for tests.
 * @internal
 */
export function _resetCallCounter(): void {
  _callCounter = 0;
}
