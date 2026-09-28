'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const HELP_LINES = [
  'ROOTIDE COMMANDS',
  '  new <name>      start a new prompt file',
  '  open <name>     load a saved file into the editor',
  '  save            save the editor to the current file',
  '  run             run the editor as a prompt (Ctrl+Enter too)',
  '  del <name>      delete a saved file',
  '  ls              list your files',
  '  exit            back to the terminal (ESC too)',
];

const UNTITLED = 'untitled';

/**
 * ROOTIDE — the online prompt IDE. Every operator keeps named prompt files
 * server-side (against their access code), edits them in the terminal-styled
 * editor, and runs them against their own linked AI (the same OpenAI-compatible
 * / MCP connector that powers Root & Chain). Output lands in the panel below
 * the editor. Without a connector, running explains what to link first.
 */
export default function IdeTerminal({ session, connector, onExit }) {
  const [fileName, setFileName] = useState(UNTITLED);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [files, setFiles] = useState([]);
  const [notice, setNotice] = useState('ROOTIDE online — write a prompt, then "run" (or Ctrl+Enter).');
  const [noticeKind, setNoticeKind] = useState('sys');
  const [output, setOutput] = useState(null); // { text, model, at, ok }
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');

  const areaRef = useRef(null);
  const bootedRef = useRef(false);
  const contentRef = useRef('');
  const nameRef = useRef(UNTITLED);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  useEffect(() => {
    nameRef.current = fileName;
  }, [fileName]);

  const say = useCallback((text, kind = 'sys') => {
    setNotice(text);
    setNoticeKind(kind);
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const params = new URLSearchParams({ username: session.username, code: session.code });
      const res = await fetch(`/api/ide?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setFiles(data.files || []);
    } catch {
      /* keep previous */
    }
  }, [session.code, session.username]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (areaRef.current) areaRef.current.focus();
  }, []);

  const dirty = content !== savedContent;

  async function openFile(name) {
    try {
      const params = new URLSearchParams({ username: session.username, code: session.code, name });
      const res = await fetch(`/api/ide?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) {
        say(data.error || 'open refused.', 'error');
        return false;
      }
      if (!data.file) {
        say(`no file named "${name}" — "new ${name}" creates one.`, 'error');
        return false;
      }
      setFileName(data.file.name);
      setContent(data.file.content || '');
      setSavedContent(data.file.content || '');
      setOutput(null);
      say(`loaded ${data.file.name} (${(data.file.content || '').length} chars).`);
      return true;
    } catch {
      say('ide store unreachable — is the terminal service running?', 'error');
      return false;
    }
  }

  async function save() {
    const name = nameRef.current === UNTITLED ? null : nameRef.current;
    if (!name) {
      say('name the file first — "new <name>" then "save".', 'error');
      return;
    }
    try {
      const res = await fetch('/api/ide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'save', name, content: contentRef.current }),
      });
      const data = await res.json();
      if (!data.ok) {
        say(data.error || 'save refused.', 'error');
        return;
      }
      setSavedContent(contentRef.current);
      say(`saved ${name} (${data.file.size} chars).`, 'ok');
      refreshFiles();
    } catch {
      say('ide store unreachable — is the terminal service running?', 'error');
    }
  }

  async function run() {
    const prompt = contentRef.current;
    if (!prompt.trim()) {
      say('nothing to run — the editor is empty.', 'error');
      return;
    }
    setRunning(true);
    setOutput({ text: 'running…', model: '', at: Date.now(), ok: true, pending: true });
    try {
      const res = await fetch('/api/ide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'run', content: prompt, connector }),
      });
      const data = await res.json();
      if (!data.ok) {
        setOutput({ text: data.error || 'run refused.', model: '', at: Date.now(), ok: false });
        say('run failed — see the output panel.', 'error');
        return;
      }
      setOutput({ text: data.output, model: data.model, at: Date.now(), ok: true });
      say(`run complete — ${data.output.length} chars from ${data.model}.`, 'ok');
    } catch {
      setOutput({ text: 'run failed — could not reach the terminal service.', model: '', at: Date.now(), ok: false });
      say('run failed.', 'error');
    } finally {
      setRunning(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;

    const [word, ...rest] = value.split(/\s+/);
    const command = word.toLowerCase();
    const tail = value.slice(word.length).trim();

    if (command === 'exit' || command === 'quit') {
      onExit();
      return;
    }
    if (command === 'help') {
      say(HELP_LINES.join(' · '));
      return;
    }
    if (command === 'ls' || command === 'files') {
      say(files.length ? `your files — ${files.map((f) => `${f.name} (${f.size}b)`).join(', ')}` : 'no files yet — "new <name>" starts one.');
      return;
    }
    if (command === 'new') {
      if (!tail) {
        say('usage: new <name>', 'error');
        return;
      }
      setFileName(tail.toLowerCase());
      setContent('');
      setSavedContent('');
      setOutput(null);
      say(`new file "${tail.toLowerCase()}" — write the prompt, then "save".`);
      areaRef.current?.focus();
      return;
    }
    if (command === 'open') {
      if (!tail) {
        say('usage: open <name>', 'error');
        return;
      }
      if (await openFile(tail.toLowerCase())) areaRef.current?.focus();
      return;
    }
    if (command === 'save') {
      await save();
      return;
    }
    if (command === 'run') {
      await run();
      areaRef.current?.focus();
      return;
    }
    if (command === 'del' || command === 'delete' || command === 'rm') {
      if (!tail) {
        say('usage: del <name>', 'error');
        return;
      }
      try {
        const res = await fetch('/api/ide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: session.username, code: session.code, action: 'delete', name: tail.toLowerCase() }),
        });
        const data = await res.json();
        if (!data.ok) {
          say(data.error || 'delete refused.', 'error');
          return;
        }
        if (nameRef.current === tail.toLowerCase()) {
          setFileName(UNTITLED);
          setContent('');
          setSavedContent('');
        }
        say(`deleted ${tail}.`, 'ok');
        refreshFiles();
      } catch {
        say('ide store unreachable — is the terminal service running?', 'error');
      }
      return;
    }
    say(`rootide: unknown command "${word}" — "help" lists them.`, 'error');
  }

  const aiLabel = connector
    ? `${connector.model || connector.tool || connector.type} (${connector.type === 'mcp' ? 'MCP' : 'API'})`
    : 'none — "connect" first';

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">
          ROOTIDE // {fileName}
          {dirty ? ' ●' : ''}
        </h1>
        <div className="hdr__meta">
          <span className="hdr__user">
            USER <b>{session.username}</b>
          </span>
          <span className="kbview">AI: {aiLabel}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit ide
          </button>
        </div>
      </header>

      <div className="main live__main">
        <section className="feedwrap live__feedwrap" aria-label="ROOTIDE editor">
          <div className="feedwrap__bar">
            <span className={`ide-note ide-note--${noticeKind}`}>{notice}</span>
            <span className="feedwrap__actions">
              <button type="button" className="btn btn--sm" onClick={() => save()} disabled={fileName === UNTITLED}>
                Save
              </button>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => run()} disabled={running}>
                {running ? 'Running…' : 'Run'}
              </button>
            </span>
          </div>

          <div className="ide__col">
            <textarea
              ref={areaRef}
              className="ide-editor"
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 8000))}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  run();
                }
              }}
              spellCheck={false}
              aria-label="Prompt editor"
              placeholder="write your prompt here — it runs against your linked AI"
            />

            <div className="ide-outwrap" aria-label="Run output">
              <div className="ide-outwrap__bar">
                <span>output</span>
                <span>{output && output.model ? `model: ${output.model}` : output ? 'error' : 'no run yet'}</span>
              </div>
              <div className={`ide-out${output && output.pending ? ' ide-out--pending' : ''}`}>
                {output ? output.text : 'Run a prompt to see the answer here (Ctrl+Enter).'}
              </div>
            </div>
          </div>
        </section>

        <aside className="panels" aria-label="ROOTIDE panels">
          <section className="panel" data-panel="files">
            <div className="panel__head">
              <span>Prompt files</span>
              <span>{files.length}/20</span>
            </div>
            <div className="panel__body">
              {files.length ? (
                <ul className="filelist">
                  {files.map((f) => (
                    <li
                      key={f.name}
                      className={f.name === fileName ? 'active' : ''}
                      style={{ cursor: 'pointer' }}
                      title={`open ${f.name}`}
                      onClick={() => openFile(f.name)}
                    >
                      <span>
                        {f.name} · {f.size}b
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mem-empty">No files yet — "new &lt;name&gt;" starts one.</p>
              )}
            </div>
          </section>

          <section className="panel" data-panel="hints">
            <div className="panel__head">
              <span>Commands</span>
              <span>Ctrl+Enter = run</span>
            </div>
            <div className="panel__body">
              {HELP_LINES.slice(1).map((l) => (
                <p key={l} className="mem-empty" style={{ margin: '0 0 4px' }}>
                  {l}
                </p>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="ide-input">
          ROOTIDE command
        </label>
        <span className="composer__prompt" aria-hidden="true">
          <b>{session.username}</b>@rootide:~$
        </span>
        <input
          id="ide-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (input) setInput('');
              else onExit();
            }
          }}
          placeholder="new <name> · open <name> · save · run · del <name> · ls"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="ide-hint"
        />
        <span className="composer__hint" id="ide-hint">
          Enter ⏎ run command · ESC exit
        </span>
      </form>
    </div>
  );
}
