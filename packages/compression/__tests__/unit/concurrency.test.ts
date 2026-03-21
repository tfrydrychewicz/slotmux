import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../../src/concurrency.js';

describe('runWithConcurrency', () => {
  it('returns results in order regardless of completion order', async () => {
    const tasks = [
      () => new Promise<string>((r) => setTimeout(() => r('slow'), 30)),
      () => Promise.resolve('fast'),
      () => new Promise<string>((r) => setTimeout(() => r('medium'), 10)),
    ];
    const results = await runWithConcurrency(tasks);
    expect(results).toEqual(['slow', 'fast', 'medium']);
  });

  it('returns empty array for no tasks', async () => {
    expect(await runWithConcurrency([])).toEqual([]);
  });

  it('runs all tasks in parallel when maxConcurrency >= tasks.length', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const makeTask = (id: number) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return id;
    };
    const tasks = [makeTask(0), makeTask(1), makeTask(2), makeTask(3)];
    const results = await runWithConcurrency(tasks);
    expect(results).toEqual([0, 1, 2, 3]);
    expect(maxConcurrent).toBe(4);
  });

  it('limits concurrency to maxConcurrency', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const makeTask = (id: number) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return id;
    };
    const tasks = [makeTask(0), makeTask(1), makeTask(2), makeTask(3), makeTask(4), makeTask(5)];
    const results = await runWithConcurrency(tasks, 2);
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('handles maxConcurrency=1 (sequential)', async () => {
    const order: number[] = [];
    const makeTask = (id: number) => async () => {
      order.push(id);
      await new Promise((r) => setTimeout(r, 5));
      return id;
    };
    const tasks = [makeTask(0), makeTask(1), makeTask(2)];
    const results = await runWithConcurrency(tasks, 1);
    expect(results).toEqual([0, 1, 2]);
    expect(order).toEqual([0, 1, 2]);
  });

  it('propagates errors', async () => {
    const tasks = [
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('boom')),
    ];
    await expect(runWithConcurrency(tasks, 1)).rejects.toThrow('boom');
  });
});
