/**
 * Budgets de temps (L1, L2) : chaque appel à une source est coupé au-delà de
 * son budget, et le budget restant de la requête est propagé.
 */
export type BudgetOutcome<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; outcome: "timeout" | "error"; ms: number; error?: unknown };

export async function runWithBudget<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<BudgetOutcome<T>> {
  const started = performance.now();
  const controller = new AbortController();
  if (timeoutMs <= 0) {
    controller.abort();
    return { ok: false, outcome: "timeout", ms: 0 };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([fn(controller.signal).then((value) => ({ value })), timeout]);
    const ms = Math.round(performance.now() - started);
    if (result === "timeout") return { ok: false, outcome: "timeout", ms };
    return { ok: true, value: result.value, ms };
  } catch (error) {
    return { ok: false, outcome: "error", ms: Math.round(performance.now() - started), error };
  } finally {
    clearTimeout(timer);
  }
}

/** Attente annulable, utilisée par les bouchons pour simuler la latence. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
