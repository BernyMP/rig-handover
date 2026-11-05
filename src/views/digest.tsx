import type { DigestNight } from '../digest/types.js';

const dash = '—';

export function DigestPage({ digest }: { digest: DigestNight }) {
  const { rows, badLines } = digest;
  return (
    <>
      <h1>digest · {digest.night}</h1>
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>fails</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr class={r.retries >= 3 || r.fails >= 1 ? 'warn' : undefined}>
                <td>{r.job}</td>
                <td>{r.owner ?? dash}</td>
                <td>{r.runs}</td>
                <td>{r.retries}</td>
                <td>{r.fails}</td>
                <td>{r.lastStatus}</td>
                <td>{r.lastError ?? dash}</td>
                <td>{r.firstAt}</td>
                <td>{r.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {badLines > 0 && (
        <p class="warn">
          {badLines} {badLines === 1 ? "line didn't" : "lines didn't"} parse
        </p>
      )}
      <p class="mute">
        ok {digest.okLines} · retry {digest.retryLines} · fail {digest.failLines}
      </p>
    </>
  );
}
