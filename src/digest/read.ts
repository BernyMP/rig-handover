import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunStatus } from './types.js';

/** One run log line after parsing at the edge. */
type RunLine = {
  at: string;
  time: number;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** Parses one non-blank line; `null` when it isn't a valid run line. */
function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string' || !isStatus(status)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  return { at, time: Date.parse(at), job, status, owner: owner ?? null, error: error ?? null };
}

/** True when `a` is strictly later than `b`. An unparseable `at` (NaN) is never later, so file order decides. */
function isAfter(a: RunLine, b: RunLine): boolean {
  return a.time > b.time;
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  const text = readFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  type Acc = { row: DigestRow; first: RunLine; last: RunLine };
  const jobs = new Map<string, Acc>();
  const digest: DigestNight = { night, rows: [], badLines: 0, okLines: 0, retryLines: 0, failLines: 0 };

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      digest.badLines++;
      continue;
    }
    if (line.status === 'ok') digest.okLines++;
    else if (line.status === 'retry') digest.retryLines++;
    else digest.failLines++;

    let acc = jobs.get(line.job);
    if (acc === undefined) {
      acc = {
        row: {
          job: line.job,
          owner: line.owner,
          runs: 0,
          retries: 0,
          fails: 0,
          lastStatus: line.status,
          lastError: line.error,
          firstAt: line.at,
          lastAt: line.at,
        },
        first: line,
        last: line,
      };
      jobs.set(line.job, acc);
    }
    const { row } = acc;
    row.runs++;
    if (line.status === 'retry') row.retries++;
    if (line.status === 'fail') row.fails++;
    // Ties keep file order: the earlier line stays first, the later line becomes last.
    if (isAfter(acc.first, line)) {
      acc.first = line;
      row.firstAt = line.at;
    }
    if (!isAfter(acc.last, line)) {
      acc.last = line;
      row.owner = line.owner;
      row.lastStatus = line.status;
      row.lastError = line.error;
      row.lastAt = line.at;
    }
  }

  digest.rows = [...jobs.values()]
    .map((acc) => acc.row)
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return digest;
};
