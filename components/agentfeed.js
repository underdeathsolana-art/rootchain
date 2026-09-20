'use client';

import { useEffect, useRef } from 'react';

export default function AgentFeed({ lines }) {
  const logRef = useRef(null);

  // Keep the newest line in view without scrollIntoView (which would yank the
  // host page around). We only move this container's own scroll offset.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="log" ref={logRef} role="log" aria-label="Terminal output">
      {lines.length === 0 ? (
        <div className="line line--sys">
          <span className="line__text">Waiting for the first transmission…</span>
        </div>
      ) : null}

      {lines.map((line) => (
        <div
          key={line.id}
          className={`line line--${line.kind}`}
          data-agent={line.agent || undefined}
        >
          {line.tag ? (
            <span className="line__tag" aria-hidden="true">
              {line.tag}
            </span>
          ) : null}
          <span className="line__text">{line.full.slice(0, line.shown)}</span>
          {!line.done ? <span className="caret" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}
