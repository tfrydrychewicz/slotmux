# Angular integration

Slotmux's `ReactiveContext` exposes signal-shaped refs with `.value` and `.subscribe()`. In Angular, the cleanest pattern is to hold the context in an injectable service and expose state to templates via Angular Signals (`signal`, `toSignal`) or the `async` pipe with Observables.

## Install

```bash
pnpm add slotmux
```

No separate Angular package is needed. The `slotmux/reactive` subpath export provides `reactiveContext` and the `Ref` primitives.

## Service pattern

Create an injectable service that owns the `ReactiveContext` and exposes Angular-friendly signals:

```typescript
// context.service.ts
import { Injectable, OnDestroy, signal, computed, effect } from '@angular/core';
import { reactiveContext, type ReactiveContext } from 'slotmux/reactive';
import { SlotOverflow } from 'slotmux';
import type { SnapshotMeta } from 'slotmux';

@Injectable({ providedIn: 'root' })
export class ContextService implements OnDestroy {
  private ctx: ReactiveContext;
  private unsubMeta: () => void;
  private unsubError: () => void;

  readonly meta = signal<SnapshotMeta | undefined>(undefined);
  readonly utilization = computed(() => this.meta()?.utilization ?? 0);
  readonly buildError = signal<Error | undefined>(undefined);

  constructor() {
    this.ctx = reactiveContext({
      model: 'gpt-4o-mini',
      maxTokens: 128_000,
      reserveForResponse: 4096,
      strictTokenizerPeers: false,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 2000 },
          overflow: SlotOverflow.ERROR,
          defaultRole: 'system',
          position: 'before',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          overflow: SlotOverflow.TRUNCATE,
          defaultRole: 'user',
          position: 'after',
        },
      },
    });

    this.ctx.system('You are a helpful assistant.');

    this.unsubMeta = this.ctx.meta.subscribe(() => {
      this.meta.set(this.ctx.meta.value);
    });

    this.unsubError = this.ctx.buildError.subscribe(() => {
      this.buildError.set(this.ctx.buildError.value);
    });
  }

  user(content: string): void {
    this.ctx.user(content);
  }

  assistant(content: string): void {
    this.ctx.assistant(content);
  }

  async build() {
    return this.ctx.build();
  }

  get reactiveContext(): ReactiveContext {
    return this.ctx;
  }

  ngOnDestroy(): void {
    this.unsubMeta();
    this.unsubError();
    this.ctx.dispose();
  }
}
```

The service subscribes to the slotmux refs and bridges values into Angular signals. Angular's change detection picks up signal updates automatically — no manual `ChangeDetectorRef.markForCheck()` needed.

## Using in a component

### With Angular Signals (recommended, Angular 16+)

```typescript
// chat.component.ts
import { Component, inject, signal, computed } from '@angular/core';
import { ContextService } from './context.service';
import { formatOpenAIMessages } from '@slotmux/providers';

@Component({
  selector: 'app-chat',
  standalone: true,
  template: `
    <ul>
      @for (m of messages(); track $index) {
        <li><b>{{ m.role }}:</b> {{ m.text }}</li>
      }
    </ul>

    <input [value]="input()" (input)="input.set($any($event.target).value)"
           (keyup.enter)="send()" />
    <button (click)="send()">Send</button>

    @if (contextService.buildError(); as error) {
      <div class="error">Build failed: {{ error.message }}</div>
    }

    @if (contextService.meta(); as meta) {
      <footer>
        {{ meta.totalTokens }} / {{ meta.totalBudget }} tokens
        ({{ (contextService.utilization() * 100).toFixed(1) }}%)
        · {{ meta.buildTimeMs }} ms
      </footer>
    }
  `,
})
export class ChatComponent {
  readonly contextService = inject(ContextService);
  readonly input = signal('');
  readonly messages = signal<{ role: string; text: string }[]>([]);

  async send(): Promise<void> {
    const text = this.input().trim();
    if (!text) return;

    this.contextService.user(text);
    this.messages.update((prev) => [...prev, { role: 'user', text }]);
    this.input.set('');

    const { snapshot } = await this.contextService.build();
    const formatted = formatOpenAIMessages(snapshot.messages);

    const reply = await callYourLLM(formatted);

    this.contextService.assistant(reply);
    this.messages.update((prev) => [...prev, { role: 'assistant', text: reply }]);
  }
}
```

### With `toSignal` and RxJS

If you prefer an Observable-based approach, wrap the slotmux `subscribe` API in an Observable and convert to a signal with `toSignal`:

```typescript
// context.service.ts (alternative approach)
import { Injectable, OnDestroy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { reactiveContext, type ReactiveContext } from 'slotmux/reactive';
import type { SnapshotMeta } from 'slotmux';

function fromSlotmuxRef<T>(ref: { value: T; subscribe: (fn: () => void) => () => void }): Observable<T> {
  return new Observable<T>((subscriber) => {
    subscriber.next(ref.value);
    const unsub = ref.subscribe(() => subscriber.next(ref.value));
    return unsub;
  });
}

@Injectable({ providedIn: 'root' })
export class ContextService implements OnDestroy {
  private ctx: ReactiveContext;

  readonly meta$: Observable<SnapshotMeta | undefined>;
  readonly meta;

  readonly buildError$: Observable<Error | undefined>;
  readonly buildError;

  constructor() {
    this.ctx = reactiveContext({ /* ... */ });

    this.meta$ = fromSlotmuxRef(this.ctx.meta);
    this.meta = toSignal(this.meta$);

    this.buildError$ = fromSlotmuxRef(this.ctx.buildError);
    this.buildError = toSignal(this.buildError$);
  }

  // ... user(), assistant(), build() methods ...

  ngOnDestroy(): void {
    this.ctx.dispose();
  }
}
```

### With `async` pipe (no signals)

For Angular versions before 16 or components where you prefer template subscriptions:

```typescript
// chat.component.ts
@Component({
  template: `
    <div *ngIf="contextService.meta$ | async as meta">
      {{ meta.totalTokens }} / {{ meta.totalBudget }} tokens
      ({{ (meta.utilization * 100).toFixed(1) }}%)
    </div>

    <div *ngIf="contextService.buildError$ | async as error" class="error">
      Build failed: {{ error.message }}
    </div>
  `,
})
export class ChatComponent {
  constructor(readonly contextService: ContextService) {}
}
```

## Per-slot breakdown

Display per-slot token stats in a table:

```typescript
@Component({
  standalone: true,
  template: `
    @if (slots(); as slotList) {
      <table>
        <thead>
          <tr><th>Slot</th><th>Tokens</th><th>Budget</th><th>%</th><th>Items</th></tr>
        </thead>
        <tbody>
          @for (s of slotList; track s.name) {
            <tr>
              <td>{{ s.name }}</td>
              <td>{{ s.used }}</td>
              <td>{{ s.budget }}</td>
              <td>{{ s.pct }}%</td>
              <td>{{ s.items }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class SlotStatsComponent {
  private contextService = inject(ContextService);

  readonly slots = computed(() => {
    const meta = this.contextService.meta();
    if (!meta) return undefined;
    return Object.entries(meta.slots).map(([name, s]) => ({
      name,
      used: Number(s.usedTokens),
      budget: Number(s.budgetTokens),
      pct: (s.utilization * 100).toFixed(1),
      items: s.itemCount,
    }));
  });
}
```

## Zone.js considerations

Slotmux refs call their listeners synchronously when `.value` changes. This means:

- **Inside `NgZone` (default):** Angular's zone automatically detects the change and triggers change detection. No extra work needed.
- **If you want to reduce change detection frequency:** Use `NgZone.runOutsideAngular()` in the service constructor to subscribe, then explicitly `NgZone.run()` when you want Angular to update. This is only worthwhile if meta updates are very frequent (e.g. `debounceMs: 0` with rapid mutations).

```typescript
constructor(private ngZone: NgZone) {
  this.ctx = reactiveContext({ /* ... */ });

  this.ngZone.runOutsideAngular(() => {
    this.ctx.meta.subscribe(() => {
      this.ngZone.run(() => {
        this.meta.set(this.ctx.meta.value);
      });
    });
  });
}
```

In practice, slotmux's default 50 ms debounce means at most ~20 builds per second, which is well within Angular's comfortable change detection rate. Only optimize this if you observe performance issues.

## `effect` for side effects

Use Angular's `effect()` to react to context changes:

```typescript
import { effect } from '@angular/core';

@Component({ /* ... */ })
export class ChatComponent {
  private contextService = inject(ContextService);

  constructor() {
    effect(() => {
      const util = this.contextService.utilization();
      if (util > 0.9) {
        console.warn('Context window nearly full:', (util * 100).toFixed(1) + '%');
      }
    });

    effect(() => {
      const err = this.contextService.buildError();
      if (err) {
        this.snackBar.open(`Build error: ${err.message}`, 'Dismiss');
      }
    });
  }
}
```

## Providing for subtrees

Scope the service to a specific component subtree using `providers`:

```typescript
@Component({
  providers: [ContextService],
  // ...
})
export class ConversationComponent {
  // This subtree gets its own ContextService instance
}
```

## Cleanup

The service implements `OnDestroy` and calls `ctx.dispose()`, which:

1. Cancels any pending debounced build.
2. Bumps the internal generation counter so in-flight async work won't write stale results.
3. Unsubscribes from slotmux refs.

For services provided in `'root'`, disposal happens when the app is destroyed. For component-scoped services, disposal follows the component lifecycle.

## Next steps

- [React integration](./react) — `@slotmux/react` hooks with `useSyncExternalStore`.
- [Vue integration](./vue) — `reactiveContext` with `computed` / `watch`.
- [Concepts: Snapshots](/concepts/snapshots) — what's inside `SnapshotMeta`.
- [Concepts: Overflow](/concepts/overflow) — overflow strategies and how they affect builds.
