# Budgets

Every slot has a **token budget** — the maximum number of tokens it may use. Slotmux resolves budgets automatically from a pool determined by the model's context window and the tokens reserved for the response.

## Total budget

```
totalBudget = maxTokens − reserveForResponse
```

- **`maxTokens`** — Inferred from the model registry (e.g. 128 000 for `gpt-5.4-mini`) or set explicitly in the config.
- **`reserveForResponse`** — Tokens held back for the model's reply. This is subtracted up front; slots never compete for it.

```typescript
const { config } = createContext({
  model: 'gpt-5.4-mini',       // maxTokens: 128 000
  preset: 'chat',
  reserveForResponse: 4096,   // totalBudget: 123 904
});
```

## Budget types

Slotmux supports four budget shapes:

<p align="center">
  <img src="/budget-types.svg" alt="Budget types: fixed, percent, flex, bounded flex" style="max-width: 560px; width: 100%;" />
</p>

### Fixed

A hard token allocation. The slot gets exactly this many tokens.

```typescript
budget: { fixed: 2000 }
```

### Percent

A percentage of the pool remaining after all fixed budgets are subtracted.

```typescript
budget: { percent: 40 }
```

The sum of all percent budgets across slots must not exceed 100.

### Flex

Takes an equal share of whatever tokens remain after fixed and percent slots are satisfied.

```typescript
budget: { flex: true }
```

If multiple slots use flex, the remaining pool is divided evenly among them. Higher-priority flex slots receive leftover fractional tokens first.

### Bounded flex

Flex with a minimum and maximum cap.

```typescript
budget: { flex: true, min: 500, max: 20000 }
```

The slot is guaranteed at least `min` tokens and will never exceed `max`, regardless of how large the flex pool is. The sum of all bounded flex minimums must fit within the flex pool.

## Resolution algorithm

The budget allocator resolves slots in this order:

```
1.  Sum all fixed budgets.
    → If fixedSum > totalBudget, throw BudgetExceededError.

2.  poolAfterFixed = totalBudget − fixedSum

3.  For each percent slot:
       allocation = floor(poolAfterFixed × percent / 100)

4.  flexPool = poolAfterFixed − sum(percent allocations)

5a. If flex slots exist:
       Assign each flex slot its min (0 if unbounded).
       → If sum(min) > flexPool, throw BudgetExceededError.
       Split the remainder evenly, capped at max per slot.
       Distribute leftover fractional tokens round-robin.

5b. If no flex slots but leftover tokens:
       Distribute leftover round-robin to percent slots.

6.  Any slot not yet allocated → 0 tokens.
```

Within each step, slots are processed in **priority-descending** order (highest first), with alphabetical tie-breaking.

## Example

Given `totalBudget = 100 000`:

| Slot | Budget | Allocation |
| --- | --- | --- |
| `system` | `{ fixed: 2000 }` | 2 000 |
| `rag` | `{ percent: 30 }` | 29 400 (`floor(98000 × 0.30)`) |
| `tools` | `{ flex: true, min: 1000, max: 40000 }` | 33 300 |
| `history` | `{ flex: true }` | 33 300 |

Pool after fixed: 98 000. Percent takes 29 400. Flex pool: 68 600, split between two flex slots. `tools` is capped at 40 000; excess redistributes to `history`.

Actual values:

| Step | Pool | `tools` | `history` |
| --- | --- | --- | --- |
| Assign min | 68 600 | 1 000 | 0 |
| Even split of 67 600 | — | 33 800 | 33 800 |
| Cap tools at 40 000 | — | 34 300 → 40 000 | 33 800 |
| Redistribute 0 | — | — | — |
| **Final** | **0** | **34 800** | **33 800** |

_(Exact numbers depend on rounding; the allocator uses `floor` and distributes remainders one-by-one.)_

## Build-time overrides

You can override `reserveForResponse` per build without changing the base config:

```typescript
const { snapshot } = await ctx.build({
  reserveForResponse: 8192,
});
```

This is useful when different turns need different response lengths (e.g. short answers vs. long code generation).

## Next

- [Slots](./slots) — how to structure and configure slots.
- [Overflow](./overflow) — what happens when content exceeds the budget.
