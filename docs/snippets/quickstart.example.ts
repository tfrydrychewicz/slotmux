import { createContext } from 'contextcraft';

const { config } = createContext({
  model: 'gpt-4o-mini',
  preset: 'chat',
  /** Skip peer resolution in minimal doc snippets; apps should use default true. */
  strictTokenizerPeers: false,
});

void config;
