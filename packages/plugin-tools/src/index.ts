/**
 * @slotmux/plugin-tools — Tool / function-call slot helpers.
 *
 * @packageDocumentation
 */

export {
  estimateTokensFromText,
  truncateStringToApproxTokens,
} from './truncate-result.js';
export {
  TOOLS_KIND_DEFINITION,
  TOOLS_METADATA_KIND,
  toolsPlugin,
} from './tools-plugin.js';
export type { ToolsPluginOptions } from './tools-plugin.js';
export { VERSION } from './version.js';
