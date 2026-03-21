---
"slotmux": patch
---

Fix `forceCompress` throwing `ContextOverflowError` on slots with `overflow: 'error'` (like the system slot in the chat preset). Error-strategy slots are now skipped when `forceCompress` is active and content is within the real budget.
