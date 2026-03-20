/**
 * Minimal shapes for lossless compression — structurally compatible with
 * `slotmux` `ContentItem` multimodal content (keep fields in sync when changing).
 *
 * @packageDocumentation
 */

/** Text block */
export interface LosslessMultimodalText {
  readonly type: 'text';
  readonly text: string;
}

/** Image URL block */
export interface LosslessMultimodalImageUrl {
  readonly type: 'image_url';
  readonly imageUrl?: string;
  readonly image_url?: string;
  readonly mimeType?: string;
  readonly tokenEstimate?: number;
}

/** Base64 image block */
export interface LosslessMultimodalImageBase64 {
  readonly type: 'image_base64';
  readonly imageBase64?: string;
  readonly image_base64?: string;
  readonly mimeType?: string;
  readonly tokenEstimate?: number;
}

export type LosslessMultimodalBlock =
  | LosslessMultimodalText
  | LosslessMultimodalImageUrl
  | LosslessMultimodalImageBase64;

/**
 * Minimum fields the lossless engine reads. Any extra fields (e.g. `id`, `slot`) are preserved via spreads.
 */
export type LosslessCompressibleItem = {
  readonly role: string;
  readonly content: string | readonly LosslessMultimodalBlock[];
  readonly losslessLocale?: string;
};
