import {
  useReactiveContextMeta,
  useReactiveContextUtilization,
  useReactiveContextBuildError,
} from '@slotmux/react';
import { useRef, useState, useCallback, type FormEvent } from 'react';
import { reactiveContext } from 'slotmux/reactive';

const rctx = reactiveContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  reserveForResponse: 4096,
  charTokenEstimateForMissing: true,
});

rctx.system('You are a helpful assistant.');

type Message = { role: 'user' | 'assistant'; content: string };

function StatusBar() {
  const meta = useReactiveContextMeta(rctx);
  const utilization = useReactiveContextUtilization(rctx);
  const error = useReactiveContextBuildError(rctx);

  if (error) {
    return <div style={{ color: 'red', padding: '0.5rem' }}>Build error: {String(error)}</div>;
  }

  if (!meta) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: '1rem',
        padding: '0.5rem 1rem',
        background: '#f5f5f5',
        borderRadius: 8,
        fontSize: '0.85rem',
        color: '#666',
      }}
    >
      <span>Tokens: {meta.totalTokens}</span>
      <span>Utilization: {(utilization * 100).toFixed(1)}%</span>
      <span>Build: {meta.buildTimeMs}ms</span>
      <span>
        Slots:{' '}
        {Object.entries(meta.slots)
          .map(([name, s]) => `${name}(${s.usedTokens})`)
          .join(', ')}
      </span>
    </div>
  );
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;

      const userMsg: Message = { role: 'user', content: input.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      rctx.user(userMsg.content);
      await rctx.build();

      // Simulate an assistant response (replace with real API call)
      const reply = `Echo: ${userMsg.content}`;
      rctx.assistant(reply);
      await rctx.build();

      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);

      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    },
    [input],
  );

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <h1 style={{ marginBottom: '0.5rem' }}>Slotmux React Chat</h1>
      <StatusBar />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: '1rem',
          margin: '1rem 0',
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: '0.75rem',
              textAlign: m.role === 'user' ? 'right' : 'left',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '0.5rem 0.75rem',
                borderRadius: 12,
                background: m.role === 'user' ? '#646cff' : '#f0f0f0',
                color: m.role === 'user' ? '#fff' : '#000',
                maxWidth: '80%',
              }}
            >
              {m.content}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: '0.75rem',
            borderRadius: 8,
            border: '1px solid #ddd',
            fontSize: '1rem',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: 8,
            border: 'none',
            background: '#646cff',
            color: '#fff',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
