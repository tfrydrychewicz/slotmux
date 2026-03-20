/**
 * @slotmux/plugin-otel — OpenTelemetry for slotmux (§13.4).
 *
 * @packageDocumentation
 */

export {
  OTEL_METRIC_BUILD_DURATION,
  OTEL_METRIC_TOKENS_USED,
  OTEL_METRIC_UTILIZATION,
  OTEL_SPAN_BUILD,
  OTEL_SPAN_COMPRESS,
  OTEL_SPAN_OVERFLOW,
  otelPlugin,
} from './otel-plugin.js';
export type { OtelPluginOptions } from './otel-plugin.js';
export { VERSION } from './version.js';
