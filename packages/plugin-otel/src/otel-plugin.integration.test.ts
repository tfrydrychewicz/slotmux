/**
 * OTel plugin integration (§13.4) without loading OTel ESM under Vitest.
 *
 * @packageDocumentation
 */

import type { Histogram, Meter, Span, Tracer } from '@opentelemetry/api';
import { Context, ContextOrchestrator, createContext, toTokenCount } from 'slotmux';
import { describe, expect, it } from 'vitest';

import {
  OTEL_METRIC_BUILD_DURATION,
  OTEL_METRIC_TOKENS_USED,
  OTEL_METRIC_UTILIZATION,
  OTEL_SPAN_BUILD,
  OTEL_SPAN_OVERFLOW,
  otelPlugin,
} from './index.js';

type FinishedSpan = {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
};

function createRecordingTracer(onEnd: (s: FinishedSpan) => void): Tracer {
  return {
    startSpan(name: string, options?: unknown, _parent?: unknown) {
      const attrs: Record<string, string | number | boolean> = {};
      const o = options as { attributes?: Record<string, string | number | boolean> } | undefined;
      if (o?.attributes !== undefined) {
        Object.assign(attrs, o.attributes);
      }
      const span: Span = {
        spanContext: () => ({
          traceId: '0'.repeat(32),
          spanId: '0'.repeat(16),
          traceFlags: 0,
        }),
        setAttribute: (k, v) => {
          attrs[k] = v as string | number | boolean;
          return span;
        },
        setAttributes: (a) => {
          Object.assign(attrs, a);
          return span;
        },
        addEvent: () => span,
        setStatus: () => span,
        updateName: () => span,
        end: () => {
          onEnd({ name, attributes: { ...attrs } });
        },
        // Span interface completeness for TypeScript
        addLink: () => span,
        addLinks: () => span,
        isRecording: () => true,
        recordException: () => span,
      };
      return span;
    },
    startActiveSpan: () => {
      throw new Error('not used');
    },
  } as unknown as Tracer;
}

function createRecordingMeter(
  onHist: (name: string, value: number) => void,
): Meter {
  const histogram = (histogramName: string): Histogram => ({
    record: (value: number, _attrs?: unknown) => {
      onHist(histogramName, value);
    },
  });
  return {
    createHistogram: (name: string) => histogram(name),
    createCounter: () => ({ add: () => {} }),
    createUpDownCounter: () => ({ add: () => {} }),
    createObservableCounter: () => ({ addCallback: () => {} }),
    createObservableGauge: () => ({ addCallback: () => {} }),
    createObservableUpDownCounter: () => ({ addCallback: () => {} }),
    createBatchObservableCallback: () => {},
  } as unknown as Meter;
}

describe('otelPlugin integration', () => {
  it('emits build + overflow spans and records histograms on truncate overflow', async () => {
    const finished: FinishedSpan[] = [];
    const hist: { name: string; value: number }[] = [];
    const tracer = createRecordingTracer((s) => finished.push(s));
    const meter = createRecordingMeter((name, value) => hist.push({ name, value }));

    const { config } = createContext({
      model: 'm',
      maxTokens: 400,
      strictTokenizerPeers: false,
      slots: {
        a: {
          priority: 100,
          budget: { fixed: 80 },
          overflow: 'truncate',
          defaultRole: 'user',
          position: 'after',
        },
      },
      plugins: [otelPlugin({ serviceName: 'integration-test', tracer, meter })],
    });

    const ctx = Context.fromParsedConfig(config);
    for (let i = 0; i < 15; i++) {
      ctx.push('a', [
        {
          content: `msg-${i}-` + 'y'.repeat(120),
          tokens: toTokenCount(90),
          role: 'user',
        },
      ]);
    }

    await ContextOrchestrator.build({ config, context: ctx });

    expect(finished.map((s) => s.name)).toContain(OTEL_SPAN_BUILD);
    expect(finished.map((s) => s.name)).toContain(OTEL_SPAN_OVERFLOW);

    const build = finished.find((s) => s.name === OTEL_SPAN_BUILD);
    expect(build?.attributes['service.name']).toBe('integration-test');
    expect(build?.attributes['slotmux.total_budget']).toBeGreaterThan(0);
    expect(build?.attributes['slotmux.message_count']).toBeGreaterThanOrEqual(0);

    expect(hist.some((h) => h.name === OTEL_METRIC_BUILD_DURATION)).toBe(true);
    expect(hist.some((h) => h.name === OTEL_METRIC_UTILIZATION)).toBe(true);
    expect(hist.some((h) => h.name === OTEL_METRIC_TOKENS_USED)).toBe(true);
  });
});
