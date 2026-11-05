import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

// runs/ is read-only: every file the routes read lives in a temp dir.
const fixture = fileURLToPath(new URL('../runs/2026-10-28.jsonl', import.meta.url));
const jobs = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];

let runsDir = '';
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };
let previousMarker: string | undefined;

/** The `<tr>` segments of a page, in page order, each with the job it names. */
function pageRows(html: string): { job: string; segment: string }[] {
  return html
    .split('<tr')
    .slice(1)
    .flatMap((segment) => {
      const job = jobs.find((j) => segment.includes(j));
      return job ? [{ job, segment }] : [];
    });
}

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));
  copyFileSync(fixture, join(runsDir, '2026-10-28.jsonl'));
  writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-10-31.jsonl'),
    [
      '{"at":"2026-10-31T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
      'this line is not json',
      '{"at":"2026-10-31T02:00:00+01:00","job":"notes/backup","status":"ok","owner":null}',
      '',
    ].join('\n'),
  );
  config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
  previousMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = 'DIGEST-MARKER';
});

afterAll(() => {
  if (previousMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = previousMarker;
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders 2026-10-28 with the lane banner and one row per job, sorted', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lane-07');
    expect(html).toContain('DIGEST-MARKER');
    expect(html).toContain('digest · 2026-10-28');

    const rows = pageRows(html);
    expect(rows.map((r) => r.job)).toEqual(jobs);
  });

  it('marks fixtures/refresh (3 retries) and notes/backup (1 fail) as warn, not lane/sync', async () => {
    const html = await (await createApp(config).request('/digest/2026-10-28')).text();
    const rows = pageRows(html);
    const rowOf = (job: string) => rows.find((r) => r.job === job)?.segment ?? '';

    expect(rowOf('fixtures/refresh')).toMatch(/^[^>]*class="warn"/);
    expect(rowOf('notes/backup')).toMatch(/^[^>]*class="warn"/);
    expect(rowOf('lane/sync')).not.toMatch(/class="warn"/);
  });

  it('shows — for a null owner (digest/render)', async () => {
    const html = await (await createApp(config).request('/digest/2026-10-28')).text();
    const row = pageRows(html).find((r) => r.job === 'digest/render')?.segment ?? '';
    expect(row).toContain('—');
  });

  it('mentions the bad line in 2026-10-28', async () => {
    const html = await (await createApp(config).request('/digest/2026-10-28')).text();
    expect(html).toMatch(/lines? didn(?:'|&#39;)t parse/);
  });

  it('404s for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for 2026-01-01');
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await createApp(config).request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('renders a night with a bad line with 200 and mentions the bad line', async () => {
    const res = await createApp(config).request('/digest/2026-10-31');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-10-31');
    expect(html).toMatch(/lines? didn(?:'|&#39;)t parse/);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 2026-10-28 as JSON with 5 rows and the counts', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.night).toBe('2026-10-28');
    expect(body.rows).toHaveLength(5);
    expect(body.badLines).toBe(1);
    expect(body.okLines).toBe(10);
    expect(body.retryLines).toBe(4);
    expect(body.failLines).toBe(1);
  });

  it('gives each row the full shape', async () => {
    const body = (await (await createApp(config).request('/api/digest/2026-10-28')).json()) as DigestNight;
    const keys = ['job', 'owner', 'runs', 'retries', 'fails', 'lastStatus', 'lastError', 'firstAt', 'lastAt'];
    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual([...keys].sort());
    }
  });

  it('lists jobs in the same order as the page', async () => {
    const body = (await (await createApp(config).request('/api/digest/2026-10-28')).json()) as DigestNight;
    const html = await (await createApp(config).request('/digest/2026-10-28')).text();
    const jsonJobs = body.rows.map((r) => r.job);
    expect(jsonJobs).toEqual(pageRows(html).map((r) => r.job));
    expect(jsonJobs).toEqual(jobs);
  });

  it('404s with a JSON error for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log for 2026-01-01' });
  });

  it('returns rows [] for an empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });
});
