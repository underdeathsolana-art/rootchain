'use client';

import { useEffect, useRef, useState } from 'react';
import { renderAscii } from '@/lib/asciifont';

/**
 * ASCII profile editor — every operator can set the block art shown on their
 * social profile. "Generate from name" renders the username in the terminal's
 * 5-row block font as a starting point; from there it is plain text — edit,
 * clear or replace it with any art, then save against the access code.
 */

const MAX_CHARS = 400;

export default function AsciiEditor({ session, current, onSaved, onDismiss }) {
  const [art, setArt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const areaRef = useRef(null);

  useEffect(() => {
    setArt(current || renderAscii(session.username));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (areaRef.current) areaRef.current.focus();
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'profile', ascii: art }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Save refused.');
        return;
      }
      onSaved(art);
    } catch {
      setError('Could not reach the terminal service.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="boot" role="dialog" aria-modal="true" aria-label="Edit ASCII profile">
      <div className="boot__card">
        <div className="boot__head">
          <h2>
            ascii profile <span className="ctx-owner">// {session.username}</span>
          </h2>
          <p>
            The block art shown at the top of your social profile. Generate it from your
            name, then edit freely — any monospace art works, max {MAX_CHARS} characters.
          </p>
        </div>

        <div className="boot__body">
          <div className="field">
            <label htmlFor="ascii-art">
              {`${art.length}/${MAX_CHARS} characters`}
            </label>
            <textarea
              id="ascii-art"
              ref={areaRef}
              value={art}
              onChange={(e) => setArt(e.target.value.slice(0, MAX_CHARS))}
              rows={9}
              spellCheck={false}
              className="ascii-input"
              aria-describedby="ascii-hint"
            />
            <span className="hint" id="ascii-hint">
              Shown verbatim on your profile — keep every line short enough for the
              terminal (≈ 60 columns).
            </span>
          </div>

          {error ? (
            <p className="err" role="status">
              {error}
            </p>
          ) : null}

          <div className="boot__foot">
            <span className="boot__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setArt(renderAscii(session.username))}
                disabled={saving}
              >
                Generate from name
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setArt('')}
                disabled={saving}
              >
                Clear
              </button>
            </span>
            <span className="boot__actions">
              <button type="button" className="btn btn--ghost" onClick={onDismiss} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={save}
                disabled={saving}
                aria-disabled={saving}
              >
                {saving ? 'Saving…' : 'Save ascii'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
