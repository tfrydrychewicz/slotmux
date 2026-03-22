/** LongMemEval dataset entry (longmemeval_s_cleaned.json). */
export type DatasetEntry = {
  readonly question_id: string;
  readonly question_type: string;
  readonly question: string;
  readonly answer: string;
  readonly question_date: string;
  readonly haystack_session_ids: readonly string[];
  readonly haystack_dates: readonly string[];
  readonly haystack_sessions: ReadonlyArray<
    ReadonlyArray<{ role: 'user' | 'assistant'; content: string; has_answer?: boolean }>
  >;
  readonly answer_session_ids: readonly string[];
};

/** One benchmark run for a (question, strategy, budget) triple. */
export type BenchmarkRun = {
  readonly questionId: string;
  readonly questionType: string;
  readonly strategy: string;
  readonly budgetTokens: number;
  readonly actualTokens: number;
  readonly buildTimeMs: number;
  readonly question: string;
  readonly expectedAnswer: string;
  readonly modelAnswer: string;
  /** Number of LLM API requests made during this run (compression + reader). */
  readonly llmRequests?: number;
  /** Estimated tokens sent to the LLM across all requests (compression + reader). */
  readonly llmTokensSent?: number;
};

/** A benchmark run after LLM-as-judge evaluation. */
export type EvaluatedRun = BenchmarkRun & {
  readonly correct: boolean;
  readonly judgeExplanation: string;
};

export const QUESTION_TYPES = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'temporal-reasoning',
  'knowledge-update',
  'multi-session',
] as const;

/** Canonical question type categories for the report. */
export const QUESTION_TYPE_CATEGORIES: Record<string, string> = {
  'single-session-user': 'Information Extraction',
  'single-session-assistant': 'Information Extraction',
  'single-session-preference': 'Information Extraction',
  'temporal-reasoning': 'Temporal Reasoning',
  'knowledge-update': 'Knowledge Updates',
  'multi-session': 'Multi-Session Reasoning',
};

export function getCategory(questionType: string, questionId: string): string {
  if (questionId.endsWith('_abs')) return 'Abstention';
  return QUESTION_TYPE_CATEGORIES[questionType] ?? questionType;
}
