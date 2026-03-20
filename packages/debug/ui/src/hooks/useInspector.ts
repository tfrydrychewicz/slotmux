/**
 * Poll REST + WebSocket-triggered refresh for inspector state.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type {
  InspectorEventWire,
  SerializedSnapshotWire,
  SlotsOkResponse,
  TimedInspectorEvent,
} from '../types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function isSerializedSnapshot(v: unknown): v is SerializedSnapshotWire {
  if (!isRecord(v)) {
    return false;
  }
  return (
    v['version'] === '1.0' &&
    typeof v['id'] === 'string' &&
    isRecord(v['meta']) &&
    isRecord((v['meta'] as Record<string, unknown>)['slots'])
  );
}

function parseEventsPayload(data: unknown): readonly InspectorEventWire[] {
  if (!isRecord(data) || data['ok'] !== true) {
    return [];
  }
  const raw = data['events'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((e): e is InspectorEventWire => isRecord(e) && typeof e['type'] === 'string');
}

export function useInspector(pollMs = 2000): {
  readonly snapshot: SerializedSnapshotWire | null;
  readonly previousSnapshot: SerializedSnapshotWire | null;
  readonly slots: SlotsOkResponse | null;
  readonly events: readonly TimedInspectorEvent[];
  readonly wsConnected: boolean;
  readonly fetchError: string | null;
  readonly refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<SerializedSnapshotWire | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<SerializedSnapshotWire | null>(null);
  const [slots, setSlots] = useState<SlotsOkResponse | null>(null);
  const [events, setEvents] = useState<readonly TimedInspectorEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const snapshotRef = useRef<SerializedSnapshotWire | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((next: SerializedSnapshotWire | null) => {
    if (next === null) {
      setSnapshot(null);
      snapshotRef.current = null;
      return;
    }
    const prev = snapshotRef.current;
    snapshotRef.current = next;
    setSnapshot(next);
    if (prev !== null && prev.id !== next.id) {
      setPreviousSnapshot(prev);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setFetchError(null);
      const [evRes, snapRes, slotRes] = await Promise.all([
        fetch('/events'),
        fetch('/snapshot'),
        fetch('/slots'),
      ]);

      if (!evRes.ok || !snapRes.ok || !slotRes.ok) {
        setFetchError(`HTTP ${evRes.status}/${snapRes.status}/${slotRes.status}`);
        return;
      }

      const evJson: unknown = await evRes.json();
      const snapJson: unknown = await snapRes.json();
      const slotJson: unknown = await slotRes.json();

      const evList = parseEventsPayload(evJson);
      const base = Date.now();
      setEvents(evList.map((event, i) => ({ receivedAt: base + i, event })));

      if (isRecord(snapJson) && snapJson['ok'] === true) {
        const s = snapJson['snapshot'];
        if (s !== null && isSerializedSnapshot(s)) {
          applySnapshot(s);
        }
      }

      if (isRecord(slotJson) && slotJson['ok'] === true && isRecord(slotJson['slots'])) {
        setSlots({
          ok: true,
          slots: slotJson['slots'] as SlotsOkResponse['slots'],
        });
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    }
  }, [applySnapshot]);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void refresh();
    }, 80);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (msg) => {
      try {
        const data: unknown = JSON.parse(String(msg.data));
        if (isRecord(data) && data['type'] === 'slotmux:event') {
          scheduleRefresh();
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      ws.close();
    };
  }, [scheduleRefresh]);

  return {
    snapshot,
    previousSnapshot,
    slots,
    events,
    wsConnected,
    fetchError,
    refresh,
  };
}
