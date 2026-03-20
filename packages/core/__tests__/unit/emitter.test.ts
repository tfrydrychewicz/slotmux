import { describe, expect, it, vi } from 'vitest';

import { TypedEventEmitter } from '../../src/events/emitter.js';
import { createContentId } from '../../src/types/branded.js';
import type { ContentItem } from '../../src/types/content.js';
import type { ContextEvent } from '../../src/types/events.js';

function makeItem(content: string): ContentItem {
  return {
    id: createContentId(),
    role: 'user',
    content,
    slot: 'history',
    createdAt: 1,
  };
}

describe('TypedEventEmitter', () => {
  it('delivers emit synchronously to on() handlers in registration order', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    const order: string[] = [];
    emitter.on('build:start', () => {
      order.push('a');
    });
    emitter.on('build:start', () => {
      order.push('b');
    });
    emitter.emit({ type: 'build:start', totalBudget: 100 });
    expect(order).toEqual(['a', 'b']);
  });

  it('dispatches by discriminant and only matching type', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    const seen: string[] = [];
    emitter.on('content:added', (e) => {
      seen.push(e.item.content as string);
    });
    emitter.emit({
      type: 'content:added',
      slot: 'history',
      item: makeItem('one'),
    });
    emitter.emit({
      type: 'content:evicted',
      slot: 'history',
      item: makeItem('gone'),
      reason: 'overflow',
    });
    expect(seen).toEqual(['one']);
  });

  it('off() removes a handler', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    const calls: number[] = [];
    const h = (): void => {
      calls.push(1);
    };
    emitter.on('build:start', h);
    emitter.off('build:start', h);
    emitter.emit({ type: 'build:start', totalBudget: 1 });
    expect(calls).toHaveLength(0);
  });

  it('off() for unknown handler is a no-op', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    emitter.off('build:start', () => {});
    emitter.emit({ type: 'build:start', totalBudget: 1 });
  });

  it('once() runs at most once', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    let n = 0;
    emitter.once('build:start', () => {
      n += 1;
    });
    emitter.emit({ type: 'build:start', totalBudget: 1 });
    emitter.emit({ type: 'build:start', totalBudget: 2 });
    expect(n).toBe(1);
  });

  it('isolates handler errors so other listeners still run', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    const spy = vi.fn();
    emitter.on('build:start', () => {
      throw new Error('boom');
    });
    emitter.on('build:start', spy);
    emitter.emit({ type: 'build:start', totalBudget: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('isolates errors from once() handlers without breaking emit loop', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    const spy = vi.fn();
    emitter.once('build:start', () => {
      throw new Error('once boom');
    });
    emitter.on('build:start', spy);
    emitter.emit({ type: 'build:start', totalBudget: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emit with no listeners does nothing', () => {
    const emitter = new TypedEventEmitter<ContextEvent>();
    emitter.emit({ type: 'build:start', totalBudget: 0 });
  });
});
