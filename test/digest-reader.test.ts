import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';
import type { DigestNight } from '../src/digest/types.js';

function mustRead(runsDir: string, night: string): DigestNight {
  const digest = readNight(runsDir, night);
  if (digest === null) throw new Error(`no night ${night} in ${runsDir}`);
  return digest;
}

function row(digest: DigestNight, job: string) {
  const found = digest.rows.find((r) => r.job === job);
  if (found === undefined) throw new Error(`no row for ${job}`);
  return found;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = mustRead('runs', '2026-10-28');

  it('has 5 jobs, sorted by job, and 1 bad line', () => {
    expect(digest.night).toBe('2026-10-28');
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts good lines by status', () => {
    expect(digest.okLines).toBe(10);
    expect(digest.retryLines).toBe(4);
    expect(digest.failLines).toBe(1);
  });

  it('counts runs and retries per job', () => {
    const refresh = row(digest, 'fixtures/refresh');
    expect(refresh.runs).toBe(4);
    expect(refresh.retries).toBe(3);
    expect(refresh.fails).toBe(0);
    expect(refresh.lastStatus).toBe('ok');
    expect(refresh.lastError).toBeNull();
  });

  it('takes the last status and error from the latest line', () => {
    const backup = row(digest, 'notes/backup');
    expect(backup.fails).toBe(1);
    expect(backup.lastStatus).toBe('fail');
    expect(backup.lastError).toBe('quota exceeded');
    expect(backup.owner).toBe('lane-07');
  });

  it('keeps a row whose owner is null', () => {
    const render = row(digest, 'digest/render');
    expect(render.owner).toBeNull();
    expect(render.runs).toBe(1);
  });

  it('keeps the offset in firstAt and lastAt', () => {
    const sync = row(digest, 'lane/sync');
    expect(sync.runs).toBe(8);
    expect(sync.retries).toBe(1);
    expect(sync.firstAt).toBe('2026-10-28T23:00:06+01:00');
    expect(sync.lastAt).toBe('2026-10-29T05:00:04+01:00');
  });
});

describe('readNight edge cases', () => {
  let dir: string | null = null;

  function runsDirWith(night: string, text: string): string {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
    writeFileSync(join(dir, `${night}.jsonl`), text);
    return dir;
  }

  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('returns null for a night with no file', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
  });

  it('reads an empty file as a night where nothing ran', () => {
    const digest = mustRead(runsDirWith('2026-11-01', ''), '2026-11-01');
    expect(digest).toEqual({ night: '2026-11-01', rows: [], badLines: 0, okLines: 0, retryLines: 0, failLines: 0 });
  });

  it('skips blank lines without counting them as bad', () => {
    const digest = mustRead(runsDirWith('2026-11-01', '\n  \n\t\n'), '2026-11-01');
    expect(digest.rows).toEqual([]);
    expect(digest.badLines).toBe(0);
  });

  it('counts every kind of bad line and keeps them out of rows and counts', () => {
    const lines = [
      '{"at":"2026-11-01T01:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      'not json',
      '[1,2]',
      '"a string"',
      'null',
      '{"job":"a","status":"ok","owner":"rook"}',
      '{"at":"2026-11-01T02:00:00+01:00","job":7,"status":"ok","owner":"rook"}',
      '{"at":"2026-11-01T02:00:00+01:00","job":"a","status":"done","owner":"rook"}',
      '{"at":"2026-11-01T02:00:00+01:00","job":"a","status":"ok","owner":3}',
      '{"at":"2026-11-01T02:00:00+01:00","job":"a","status":"fail","owner":"rook","error":42}',
      '{"at":"2026-11-01T02:00:00+01:00","job":"b","status":"retry"}',
    ];
    const digest = mustRead(runsDirWith('2026-11-01', lines.join('\n') + '\n'), '2026-11-01');
    expect(digest.badLines).toBe(9);
    expect(digest.okLines).toBe(1);
    expect(digest.retryLines).toBe(1);
    expect(digest.failLines).toBe(0);
    expect(digest.rows.map((r) => [r.job, r.runs])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
    expect(row(digest, 'b').owner).toBeNull();
  });

  it('orders by time, not file order, and a tie goes to the later line', () => {
    const lines = [
      '{"at":"2026-11-01T03:00:00+01:00","job":"a","status":"fail","owner":"x","error":"late"}',
      '{"at":"2026-11-01T01:00:00+01:00","job":"a","status":"ok","owner":"y"}',
      // Same instant as the first line, written in another offset.
      '{"at":"2026-11-01T02:00:00Z","job":"a","status":"retry","owner":"z","error":"tie"}',
    ];
    const a = row(mustRead(runsDirWith('2026-11-01', lines.join('\n')), '2026-11-01'), 'a');
    expect(a.firstAt).toBe('2026-11-01T01:00:00+01:00');
    expect(a.lastAt).toBe('2026-11-01T02:00:00Z');
    expect(a.lastStatus).toBe('retry');
    expect(a.lastError).toBe('tie');
    expect(a.owner).toBe('z');
  });

  it('sorts rows by plain string comparison', () => {
    const lines = ['b', 'B', 'a/z', 'a'].map(
      (job) => `{"at":"2026-11-01T01:00:00+01:00","job":"${job}","status":"ok","owner":null}`,
    );
    const digest = mustRead(runsDirWith('2026-11-01', lines.join('\n')), '2026-11-01');
    expect(digest.rows.map((r) => r.job)).toEqual(['B', 'a', 'a/z', 'b']);
  });
});
