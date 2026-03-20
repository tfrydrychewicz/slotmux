/**
 * Slotmux debug inspector shell.
 *
 * @packageDocumentation
 */

import { useCallback, useState } from 'preact/hooks';

import { DiffViewer } from './components/DiffViewer.js';
import { SlotUtilization } from './components/SlotUtilization.js';
import { Timeline } from './components/Timeline.js';
import { Waterfall } from './components/Waterfall.js';
import { WhatIfSimulator } from './components/WhatIfSimulator.js';
import { useInspector } from './hooks/useInspector.js';

import './styles.css';

export function App() {
  const { snapshot, previousSnapshot, slots, events, wsConnected, fetchError, refresh } = useInspector();
  const [budgetFactors, setBudgetFactors] = useState<Readonly<Record<string, number>>>({});

  const onFactors = useCallback((f: Readonly<Record<string, number>>) => {
    setBudgetFactors(f);
  }, []);

  const slotCount =
    slots !== null && slots['ok'] === true ? Object.keys(slots['slots']).length : 0;

  return (
    <div class="inspector">
      <header class="inspector__header">
        <div>
          <h1 class="inspector__title">Slotmux Inspector</h1>
          <p class="muted" style={{ margin: '0.25rem 0 0' }}>
            Live view of slots, budgets, and pipeline events.
          </p>
        </div>
        <div class="inspector__meta">
          <span class={`pill${wsConnected ? ' pill--ok' : ' pill--bad'}`}>
            WS {wsConnected ? 'live' : 'offline'}
          </span>
          <span class="pill">Slots (API): {slotCount}</span>
          <span class="pill">Events: {events.length}</span>
          <button type="button" class="pill" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {fetchError !== null ? <div class="error-banner">Fetch error: {fetchError}</div> : null}

      <div class="inspector__grid">
        <div>
          <WhatIfSimulator snapshot={snapshot} onFactorsChange={onFactors} />
          <SlotUtilization snapshot={snapshot} budgetFactors={budgetFactors} />
          <Waterfall snapshot={snapshot} />
        </div>
        <div>
          <Timeline events={events} />
          <DiffViewer before={previousSnapshot} after={snapshot} />
        </div>
      </div>
    </div>
  );
}
