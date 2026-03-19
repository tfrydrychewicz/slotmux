/**
 * SHA-256 checksum for {@link SerializedSnapshot} (§12.1 — Phase 5.5).
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

/**
 * Lowercase hex SHA-256 of `payload` encoded as UTF-8.
 */
export function sha256HexUtf8(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
