/**
 * Log / telemetry string redaction (§19.2 / Phase 7.3).
 *
 * @packageDocumentation
 */

/**
 * Default patterns: US SSN-style, email, common card number groupings (design §19.2 / Phase 10.2).
 * Does not replace Luhn validation — heuristic redaction for logs/events only.
 */
export const DEFAULT_REDACTION_PATTERNS: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  /** 16-digit groups (Visa/MC/Discover-style). */
  /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  /** Amex-style 15 digits starting with 34 or 37. */
  /\b3[47]\d{13}\b/g,
];

export type RedactionOptions = {
  readonly patterns: readonly RegExp[];
  /** Replacement text (default `[REDACTED]`). */
  readonly replacement?: string | undefined;
};

const DEFAULT_REPLACEMENT = '[REDACTED]';

/**
 * Applies each pattern in order to `text`.
 */
export function redactString(
  text: string,
  patterns: readonly RegExp[] = DEFAULT_REDACTION_PATTERNS,
  replacement: string = DEFAULT_REPLACEMENT,
): string {
  let out = text;
  for (const p of patterns) {
    out = out.replace(p, replacement);
  }
  return out;
}

/**
 * Deep-walks plain objects and arrays; redacts all string leaves. Leaves functions, Dates, etc. unchanged.
 */
export function redactUnknown(
  value: unknown,
  options: RedactionOptions = { patterns: [...DEFAULT_REDACTION_PATTERNS] },
): unknown {
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;
  const patterns = options.patterns;

  if (typeof value === 'string') {
    return redactString(value, patterns, replacement);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactUnknown(v, options));
  }
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o)) {
    out[key] = redactUnknown(o[key], options);
  }
  return out;
}
