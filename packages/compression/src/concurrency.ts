/**
 * Concurrency-limited task runner for parallel LLM calls (§8.9).
 *
 * @packageDocumentation
 */

/**
 * Runs an array of async task factories with bounded concurrency.
 *
 * When `maxConcurrency` is `Infinity` or exceeds the number of tasks,
 * all tasks run in parallel via `Promise.all`. Otherwise, at most
 * `maxConcurrency` tasks execute simultaneously.
 *
 * Results are returned in the same order as `tasks`, regardless of
 * completion order.
 *
 * @param tasks - Factory functions that produce promises when invoked
 * @param maxConcurrency - Maximum simultaneous tasks (default: `Infinity`)
 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  maxConcurrency = Infinity,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  if (!isFinite(maxConcurrency) || maxConcurrency >= tasks.length) {
    return Promise.all(tasks.map((t) => t()));
  }

  const cap = Math.max(1, Math.floor(maxConcurrency));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]!();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(cap, tasks.length) }, () => worker()),
  );
  return results;
}
