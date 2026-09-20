'use client';

export default function SidePanels({ topics, memory }) {
  const activeFile = topics?.active?.file;

  return (
    <aside className="panels" aria-label="Terminal modules">
      {/* ── topics ─────────────────────────────────────────────────────── */}
      <section className="panel" data-panel="topics">
        <div className="panel__head">
          <span>Topics / current</span>
          <span>{topics?.current?.length ?? 0} file(s)</span>
        </div>
        <div className="panel__body">
          {topics?.active ? (
            <>
              <h3 className="topic-title">{topics.active.title}</h3>
              <p className="topic-body">{topics.active.body}</p>
            </>
          ) : (
            <p className="mem-empty">
              No topic loaded. Drop a .md or .txt file into content/topics/current/ and refresh.
            </p>
          )}

          <ul className="filelist">
            {(topics?.current || []).map((f) => (
              <li key={f.file} className={f.file === activeFile ? 'active' : ''}>
                <span>{f.file}</span>
              </li>
            ))}
          </ul>

          {topics?.scheduled?.length ? (
            <p className="mem-empty">scheduled: {topics.scheduled.map((f) => f.file).join(', ')}</p>
          ) : null}
        </div>
      </section>

      {/* ── memory ─────────────────────────────────────────────────────── */}
      <section className="panel" data-panel="memory">
        <div className="panel__head">
          <span>Memory</span>
          <span>{memory?.count ?? 0} turn(s)</span>
        </div>
        <div className="panel__body">
          {memory?.summary ? <p className="topic-body">{memory.summary}</p> : null}
          {!memory?.summary && !memory?.recent?.length ? (
            <p className="mem-empty">Nothing committed yet. The agents will log turns here as they talk.</p>
          ) : null}

          <dl className="kv">
            <dt>Last topic</dt>
            <dd>{memory?.lastTopic || '—'}</dd>
            <dt>Updated</dt>
            <dd>{memory?.updatedAt ? new Date(memory.updatedAt).toLocaleString() : '—'}</dd>
          </dl>

          {memory?.recent?.length ? (
            <div style={{ marginTop: '10px' }}>
              {memory.recent.map((entry, i) => (
                <div className="memline" key={`${entry.at}-${i}`}>
                  <span className={`who ${entry.agent}`}>{entry.agent === 'link' ? 'CHAIN' : 'ROOT'}</span>
                  <span className="what">{entry.text}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* ── bridge ─────────────────────────────────────────────────────── */}
      <section className="panel" data-panel="bridge">
        <div className="panel__head">
          <span>Cross-chain module</span>
          <span>route map</span>
        </div>
        <div className="panel__body">
          <div className="bridge">
            <div className="route">
              <div className="node">
                SOL
                <small>Solana</small>
              </div>
              <span className="arrow" aria-hidden="true">
                →
              </span>
              <div className="node">
                BSC
                <small>BNB Chain</small>
              </div>
            </div>
            <div className="route">
              <div className="node" style={{ gridColumn: '1 / 2' }}>
                BSC
                <small>settle</small>
              </div>
              <span className="arrow" aria-hidden="true">
                →
              </span>
              <div className="node">
                EQ
                <small>Robinhood</small>
              </div>
            </div>
          </div>

          <dl className="kv" style={{ marginTop: '14px' }}>
            <dt>Router</dt>
            <dd>Solana → BSC → Robinhood</dd>
            <dt>Status</dt>
            <dd>ready — no live feed attached</dd>
            <dt>Source</dt>
            <dd>topics / current</dd>
          </dl>
        </div>
      </section>
    </aside>
  );
}
