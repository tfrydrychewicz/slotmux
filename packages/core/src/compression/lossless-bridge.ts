/**
 * Re-exports `@slotmux/compression` and wires lossless compression to core types
 * (`OverflowStrategyFn`, `CompressionStrategy`). Implementation lives in `packages/compression/`.
 *
 * @packageDocumentation
 */

export type {
  LosslessCompressibleItem,
  LosslessCompressorOptions,
  LosslessDetectLanguageFn,
  LosslessLanguagePack,
  LosslessMultimodalBlock,
  LosslessMultimodalImageBase64,
  LosslessMultimodalImageUrl,
  LosslessMultimodalText,
} from '@slotmux/compression';
export {
  LOSSLESS_LANGUAGE_PACK_DE,
  LOSSLESS_LANGUAGE_PACK_EN,
  LOSSLESS_LANGUAGE_PACK_MINIMAL,
  LosslessCompressor,
  getPlainTextForLossless,
  registerLosslessLanguagePack,
  resolveLosslessLanguagePack,
  unregisterLosslessLanguagePack,
} from '@slotmux/compression';

import {
  LosslessCompressor,
  type LosslessCompressorOptions,
} from '@slotmux/compression';

import type { CompressionStrategy } from '../types/compression.js';
import type { OverflowStrategyFn } from '../types/config.js';

/**
 * {@link OverflowStrategyFn} using {@link LosslessCompressor} (built-in `compress`).
 */
export const losslessCompressAsOverflow: OverflowStrategyFn = (items, _budget, ctx) => {
  const oc = ctx.slotConfig?.overflowConfig;
  const localeRaw = oc?.losslessLocale?.trim();
  const compressor = new LosslessCompressor({
    ...(localeRaw !== undefined && localeRaw !== '' ? { locale: localeRaw } : {}),
    ...(oc?.losslessDetectLanguage !== undefined
      ? { detectLanguage: oc.losslessDetectLanguage }
      : {}),
  });
  return Promise.resolve(compressor.compressItems(items));
};

/**
 * {@link CompressionStrategy} for {@link PluginContext.registerCompressor}.
 */
export function createLosslessCompressionStrategy(
  options?: LosslessCompressorOptions & { readonly name?: string },
): CompressionStrategy {
  const c = new LosslessCompressor(options);
  return {
    name: options?.name ?? 'lossless-text',
    compress: (items) => Promise.resolve(c.compressItems(items)),
  };
}
