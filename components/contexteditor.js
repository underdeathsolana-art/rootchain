'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Editor for one file of the operator's agent-context pair — skill.md or
 * readme.md. These files shape the system prompt of Root & Chain once the
 * operator links their own AI through the connector panel:
 *   · readme.md — the terminal's background: who runs it, what it watches.
 *   · skill.md  — how the agents should behave: language, style, focus.
 * The file is stored server-side against the operator's access code.
 */

const MAX_CHARS = 4000;

const TEMPLATES = {
  skill: [
    '# skill.md — how Root & Chain should talk',
    '',
    '- Reply in Bahasa Indonesia.',
    '- Keep every turn short and concrete; end with one question.',
    '- Focus on Solana memecoins and Solana -> BSC bridge flows.',
    '- No price predictions — discuss structure, risk and timing.',
  ].join('\n'),
  readme: [
    '# readme.md — background for this terminal',
    '',
    'This terminal is run by you. Describe what the agents should know:',
    '',
    '- Who operates this channel and what they trade or build.',
    '- The current market focus (e.g. memecoin rotation on Solana).',
    '- The audience the agents are speaking for.',
  ].join('\n'),
};

const FILE_META = {
  skill: {
    name: 'skill.md',
    role: 'Behaviour instructions — the final word on language, style and focus.',
    hint: 'Where skill.md disagrees with the terminal defaults (e.g. “English only”), skill.md wins.',
  },
  readme: {
    name: 'readme.md',
    role: 'Terminal background — who runs this channel and what it watches.',
    hint: 'Kept short and factual; it primes every live turn with your context.',
  },
};

export default function ContextEditor({ file, session, onSaved, onDismiss }) {
  const meta = FILE_META[file] || FILE_META.skill;
  const [content, setContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const areaRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const params = new URLSearchParams({ username: session.username, code: session.code });
        const res = await fetch(`/api/context?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json();
        if (!alive) return;
        if (!data.ok) {
          setError(data.error || 'The context store refused the request.');
        } else {
          setUpdatedAt(data.updatedAt || null);
          // Empty file → prefill the starter template so there is something
          // meaningful to edit; nothing is stored until Save is pressed.
          setContent(data[file] || TEMPLATES[file] || '');
        }
      } catch {
        if (alive) setError('Could not reach the terminal service.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, session.code, session.username]);

  useEffect(() => {
    if (!loading && areaRef.current) areaRef.current.focus();
  }, [loading]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: session.username,
          code: session.code,
          file,
          content,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Save refused.');
        return;
      }
      setUpdatedAt(data.updatedAt);
      onSaved(file, { bytes: data.bytes, content });
    } catch {
      setError('Could not reach the terminal service.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="boot" role="dialog" aria-modal="true" aria-label={`Edit ${meta.name}`}>
      <div className="boot__card">
        <div className="boot__head">
          <h2>
            {meta.name} <span className="ctx-owner">// {session.username}</span>
          </h2>
          <p>
            {meta.role} {meta.hint} Applies to every live AI turn — edit it any time; the
            next turn picks it up.
          </p>
        </div>

        <div className="boot__body">
          <div className="field">
            <label htmlFor={`ctx-${file}`}>
              {loading ? 'loading…' : `${content.length}/${MAX_CHARS} characters${updatedAt ? ' · saved ' + new Date(updatedAt).toLocaleString() : ' · not saved yet'}`}
            </label>
            <textarea
              id={`ctx-${file}`}
              ref={areaRef}
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
              rows={14}
              spellCheck={false}
              aria-describedby={`ctx-${file}-hint`}
              disabled={loading}
            />
            <span className="hint" id={`ctx-${file}-hint`}>
              Markdown is passed through as-is. The other file is edited with the
              {' '}{file === 'skill' ? '"readme"' : '"skill"'} command.
            </span>
          </div>

          {error ? (
            <p className="err" role="status">
              {error}
            </p>
          ) : null}

          <div className="boot__foot">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setContent(TEMPLATES[file] || '')}
              disabled={loading || saving}
            >
              Reset template
            </button>
            <span className="boot__actions">
              <button type="button" className="btn btn--ghost" onClick={onDismiss} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={save}
                disabled={loading || saving}
                aria-disabled={loading || saving}
              >
                {saving ? 'Saving…' : `Save ${meta.name}`}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
