'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { userColor } from '@/lib/usercolor';
import AsciiEditor from '@/components/asciieditor';

const POLL_INTERVAL = 4000;

const HELP_LINES = [
  'SOCIAL COMMANDS',
  '  <text>          post to the feed',
  '  reply <id> <text>  answer post #id (aliases: r)',
  '  bio <text>      set your bio · "bio" shows it',
  '  ascii           create your ASCII profile art',
  '  profile <name>  view an operator\'s profile · click the roster too',
  '  who · refresh · clear · exit',
];

function relTime(at) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Rootchain Social — the operators' feed, rendered as a terminal. Posts are
 * threads: a parent line plus indented replies. The side panel carries the
 * profile card (ASCII art + bio + counters) and the operator roster; clicking
 * a name views their profile. Everything is authenticated with the operator's
 * access code, exactly like the relay.
 */
export default function SocialTerminal({ session, relay, onExit }) {
  const [posts, setPosts] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [me, setMe] = useState({ bio: '', ascii: '' });
  const [viewing, setViewing] = useState(session.username.toLowerCase());
  const [sysLines, setSysLines] = useState([]);
  const [input, setInput] = useState('');
  const [showAscii, setShowAscii] = useState(false);

  const idRef = useRef(0);
  const busyRef = useRef(false);
  const bootedRef = useRef(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const sys = useCallback((text, kind = 'sys') => {
    setSysLines((prev) => [...prev.slice(-13), { id: (idRef.current += 1), kind, text }]);
  }, []);

  const poll = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const params = new URLSearchParams({ username: session.username, code: session.code });
      const res = await fetch(`/api/social?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) return;
      setPosts(data.posts || []);
      setProfiles(data.profiles || {});
      if (data.me) setMe(data.me);
    } catch {
      /* keep previous */
    } finally {
      busyRef.current = false;
    }
  }, [session.code, session.username]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    sys('ROOTCHAIN SOCIAL // OPERATOR FEED', 'head');
    sys('type to post · reply <id> <text> answers a post · "ascii" creates your profile art · "help" lists commands');
    poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        poll();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [showAscii]);

  async function action(payload) {
    try {
      const res = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, ...payload }),
      });
      const data = await res.json();
      if (data.ok) return { ok: true, data };
      const hint = /unrecognised operator code/i.test(String(data.error))
        ? ' — sign out and register again.'
        : '';
      sys(`${data.error || 'refused.'}${hint}`, 'error');
      return { ok: false };
    } catch {
      sys('feed unreachable — is the terminal service running?', 'error');
      return { ok: false };
    }
  }

  /** Greedy roster match — operator names may contain spaces. */
  function resolveOperator(tail) {
    const lower = tail.toLowerCase();
    const match = (relay?.operators || [])
      .map((o) => o.username)
      .sort((a, b) => b.length - a.length)
      .find((name) => lower === name.toLowerCase() || lower.startsWith(`${name.toLowerCase()} `));
    if (!match) return { name: null, rest: tail };
    return { name: match, rest: tail.slice(match.length).trim() };
  }

  const postCount = (nameLower) => posts.filter((p) => p.username.toLowerCase() === nameLower).length;

  async function onSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;

    const [word, ...rest] = value.split(/\s+/);
    const command = word.toLowerCase();

    if (command === 'exit' || command === 'quit') {
      onExit();
      return;
    }

    if (command === 'help') {
      HELP_LINES.forEach((l) => sys(l));
      return;
    }

    if (command === 'clear') {
      setSysLines([]);
      return;
    }

    if (command === 'refresh') {
      await poll();
      sys(`feed refreshed — ${posts.length} post(s) retained.`);
      return;
    }

    if (command === 'who') {
      const ops = relay?.operators || [];
      sys(`OPERATORS — ${ops.length} registered · ${(relay?.online || []).length} online`);
      for (const op of ops) {
        sys(`  ${(relay?.online || []).includes(op.username) ? '●' : '○'} ${op.username} · ${postCount(op.username.toLowerCase())} post(s)`);
      }
      return;
    }

    if (command === 'bio') {
      const text = value.slice(3).trim();
      if (!text) {
        sys(me.bio ? `your bio — ${me.bio}` : 'no bio set — "bio <text>" writes one.');
        return;
      }
      const res = await action({ action: 'profile', bio: text });
      if (res.ok) {
        setMe((m) => ({ ...m, bio: res.data.profile.bio }));
        sys('bio updated.', 'ok');
      }
      return;
    }

    if (command === 'ascii') {
      setShowAscii(true);
      return;
    }

    if (command === 'profile') {
      const tail = value.slice(7).trim();
      const target = tail ? resolveOperator(tail).name : session.username;
      if (!target) {
        sys(`no operator matches "${tail.split(' ')[0]}" — try "who".`, 'error');
        return;
      }
      setViewing(target.toLowerCase());
      sys(`viewing ${target}'s profile — see the panel on the right.`);
      return;
    }

    if (command === 'reply' || command === 'r') {
      const tail = value.slice(word.length).trim();
      const id = Number(tail.split(/\s+/)[0]);
      const text = tail.slice(String(tail.split(/\s+/)[0]).length).trim();
      if (!Number.isInteger(id) || id < 1 || !text) {
        sys('usage: reply <id> <text> — find the id in the [P#n] tag.', 'error');
        return;
      }
      const res = await action({ action: 'reply', replyTo: id, text });
      if (res.ok) {
        sys(`reply #${res.data.post.seq} posted to thread #${res.data.post.replyTo}.`, 'ok');
        await poll();
      }
      return;
    }

    // Default: a post.
    const res = await action({ action: 'post', text: value });
    if (res.ok) {
      sys(`posted #${res.data.post.seq}.`, 'ok');
      await poll();
    }
  }

  const parents = posts.filter((p) => !p.replyTo).sort((a, b) => b.seq - a.seq);
  const repliesOf = (seq) => posts.filter((p) => p.replyTo === seq).sort((a, b) => a.seq - b.seq);

  const operators = relay?.operators || [];
  const online = relay?.online || [];
  const viewProfile = profiles[viewing];
  const viewName = viewProfile?.username || viewing;
  const isMe = viewing === session.username.toLowerCase();

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">Rootchain Social // Operator Feed</h1>
        <div className="hdr__meta">
          <span className="hdr__user">
            USER <b>{session.username}</b>
          </span>
          <span className="kbview">
            {posts.length} post(s) · {operators.length} registered
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit social
          </button>
        </div>
      </header>

      <div className="main live__main">
        <section className="feedwrap live__feedwrap" aria-label="Social feed">
          <div className="feedwrap__bar">
            <span>operator feed — posts &amp; replies</span>
            <span className="feedwrap__hint-sys">{sysLines.length ? `last: ${sysLines[sysLines.length - 1].text.slice(0, 48)}` : 'watching…'}</span>
          </div>

          <div className="log" ref={scrollRef} role="log" aria-label="Social output">
            {sysLines.map((line) => (
              <div key={line.id} className={`line line--${line.kind === 'head' ? 'head' : line.kind === 'ok' ? 'ok' : line.kind === 'error' ? 'error' : 'sys'}`}>
                <span className="line__text">{line.text}</span>
              </div>
            ))}

            {sysLines.length && parents.length ? <div className="social-divider">── feed ──</div> : null}

            {parents.length === 0 ? (
              <div className="line line--sys">
                <span className="line__text">The feed is empty — type something to post the first line.</span>
              </div>
            ) : null}

            {parents.map((p) => {
              const mine = p.username === session.username;
              return (
                <div key={p.seq} className="social-thread">
                  <div
                    className={`line line--net${mine ? ' line--me' : ''}`}
                    style={{ borderLeftColor: userColor(p.username) }}
                    title={new Date(p.at).toLocaleString()}
                  >
                    <span className="line__tag" style={{ color: userColor(p.username) }}>
                      [P#{p.seq} · {relTime(p.at)}] {p.username}
                    </span>
                    <span className="line__text" style={{ color: userColor(p.username) }}>
                      {p.text}
                    </span>
                  </div>
                  {repliesOf(p.seq).map((r) => {
                    const rMine = r.username === session.username;
                    return (
                      <div
                        key={r.seq}
                        className={`line line--net line--reply${rMine ? ' line--me' : ''}`}
                        style={{ borderLeftColor: userColor(r.username) }}
                        title={new Date(r.at).toLocaleString()}
                      >
                        <span className="line__tag" style={{ color: userColor(r.username) }}>
                          [R#{r.seq} ↳P#{r.replyTo}] {r.username}
                        </span>
                        <span className="line__text" style={{ color: userColor(r.username) }}>
                          {r.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="panels" aria-label="Social panels">
          <section className="panel" data-panel="profile">
            <div className="panel__head">
              <span>Profile {isMe ? '· you' : `· ${viewName}`}</span>
              <span>{postCount(viewing)} post(s)</span>
            </div>
            <div className="panel__body">
              {viewProfile?.ascii ? (
                <pre className="ascii-art" style={{ color: userColor(viewName) }}>{viewProfile.ascii}</pre>
              ) : (
                <p className="mem-empty">
                  {isMe ? 'No ASCII art yet — "ascii" creates one from your name.' : 'No ASCII art on this profile.'}
                </p>
              )}
              <dl className="kv" style={{ marginTop: '10px' }}>
                <dt>Operator</dt>
                <dd style={{ color: userColor(viewName) }}>{viewName}</dd>
                <dt>Bio</dt>
                <dd>{viewProfile?.bio || (isMe ? 'not set — "bio <text>" writes one' : '—')}</dd>
              </dl>
            </div>
          </section>

          <section className="panel" data-panel="roster">
            <div className="panel__head">
              <span>Operators</span>
              <span>{online.length} online</span>
            </div>
            <div className="panel__body">
              {operators.length ? (
                <ul className="filelist">
                  {operators.map((op) => {
                    const lower = op.username.toLowerCase();
                    return (
                      <li
                        key={op.username}
                        className={lower === viewing ? 'active' : ''}
                        style={{ cursor: 'pointer' }}
                        title={`view ${op.username}'s profile`}
                        onClick={() => setViewing(lower)}
                      >
                        <span style={{ color: userColor(op.username) }}>
                          {online.includes(op.username) ? '●' : '○'} {op.username}
                          {op.username === session.username ? ' · you' : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mem-empty">No registered operators yet.</p>
              )}
              <p className="mem-empty" style={{ marginTop: '10px' }}>
                click a name to view their profile
              </p>
            </div>
          </section>
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {sysLines.length ? sysLines[sysLines.length - 1].text : ''}
      </p>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="social-input">
          Social input
        </label>
        <span className="composer__prompt" aria-hidden="true">
          <b>{session.username}</b>@social:~$
        </span>
        <input
          id="social-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (input) setInput('');
              else onExit();
            }
          }}
          placeholder="post to the feed · reply <id> <text> · bio · ascii · profile <name>"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="social-hint"
        />
        <span className="composer__hint" id="social-hint">
          Enter ⏎ post · ESC exit
        </span>
      </form>

      {showAscii ? (
        <AsciiEditor
          session={session}
          current={me.ascii}
          onSaved={(art) => {
            setMe((m) => ({ ...m, ascii: art }));
            setShowAscii(false);
            sys('ascii profile saved — it now heads your profile card.', 'ok');
            poll();
          }}
          onDismiss={() => setShowAscii(false)}
        />
      ) : null}
    </div>
  );
}
