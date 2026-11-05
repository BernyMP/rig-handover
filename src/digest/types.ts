// Plan morning-digest § 1. The shapes every part of § 2 builds against.
// Reader logic lives in `src/digest/read.ts` (issue #2), not here.

/** A run log line's `status`, as written in `runs/<night>.jsonl`. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's summary for one night. One row per distinct `job` in the log. */
export type DigestRow = {
  /** The `job` field, as written in the log, e.g. `lane/sync`. */
  job: string;
  /** The `owner` from the job's latest line by `at`; `null` when the log says `null`. Render as `—`. */
  owner: string | null;
  /** Every line for this job that night, whatever its status. */
  runs: number;
  /** Lines for this job with status `retry`. */
  retries: number;
  /** Lines for this job with status `fail`. The page marks any row with one or more. */
  fails: number;
  /** The `status` of the job's latest line by `at`. */
  lastStatus: RunStatus;
  /** The `error` of the job's latest line by `at`; `null` when that line has none. */
  lastError: string | null;
  /** The job's earliest `at`, the string exactly as in the log (offset kept, never converted to UTC). */
  firstAt: string;
  /** The job's latest `at`, the string exactly as in the log (offset kept, never converted to UTC). */
  lastAt: string;
};

/** One night's digest: everything the page, the JSON and the board need. */
export type DigestNight = {
  /** The night, `YYYY-MM-DD`, as in the file name `runs/<night>.jsonl`. */
  night: string;
  /** One row per job. Empty when the file is empty (the page shows "nothing ran"). */
  rows: DigestRow[];
  /** Lines that don't parse as a run line. Counted, never thrown; they are in no row. */
  badLines: number;
  /** Parsed lines with status `ok`, across all jobs. */
  okLines: number;
  /** Parsed lines with status `retry`, across all jobs. */
  retryLines: number;
  /** Parsed lines with status `fail`, across all jobs. */
  failLines: number;
};

/**
 * Reads `<runsDir>/<night>.jsonl` into a `DigestNight`.
 * Returns `null` when that file doesn't exist (the page answers 404).
 * Implemented as `readNight` in `src/digest/read.ts` (issue #2).
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
