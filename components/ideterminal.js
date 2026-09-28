'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cloneRepo,
  listRepos,
  listWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
  removeRepo,
} from '@/lib/ideWorkspace';
import { runPython, runJavaScript, pipInstall } from '@/lib/runner';

const HELP_LINES = [
  'ROOTIDE COMMANDS',
  '  new <name>      start a new prompt/code file (.py/.js run as code)',
  '  open <name>     load a saved prompt file into the editor',
  '  wf <repo/path>  load a file from a cloned repo (click the panel too)',
  '  save            save the editor (prompt store or workspace file)',
  '  run             run the editor (Ctrl+Enter): .py → python, .js →',
  '                  javascript worker, anything else → your AI',
  '  clone <url>     git clone a public repo into your local workspace',
  '  repos · rmrepo <name>  list / remove cloned repos',
  '  pip install <pkg…>     install into the browser python runtime',
  '  del <name>      delete a saved prompt file · ls lists them',
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
  const [repos, setRepos] = useState([]);
  const [wsFiles, setWsFiles] = useState([]); // "repo/path" strings
  const [notice, setNotice] = useState('ROOTIDE online — write a prompt, then "run" (or Ctrl+Enter).');
  const [noticeKind, setNoticeKind] = useState('sys');
  const [output, setOutput] = useState(null); // { text, model, at, ok }
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');

  const areaRef = useRef(null);
  const bootedRef = useRef(false);
  const contentRef = useRef('');
  const nameRef = useRef(UNTITLED);
  const targetRef = useRef({ type: 'untitled' }); // { type:'untitled'|'prompt'|'ws', id }

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

  const refreshWorkspace = useCallback(async () => {
    try {
      const [names, all] = await Promise.all([listRepos(session.username), listWorkspace(session.username)]);
      setRepos(names || []);
      setWsFiles(all || []);
    } catch {
      /* workspace unavailable (SSR guard) — ignore */
    }
  }, [session.username]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    refreshFiles();
    refreshWorkspace();
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
        say(`no prompt file named "${name}" — try "wf" for repo files, or "new ${name}".`, 'error');
        return false;
      }
      setFileName(data.file.name);
      setContent(data.file.content || '');
      setSavedContent(data.file.content || '');
      targetRef.current = { type: 'prompt', id: data.file.name };
      setOutput(null);
      say(`loaded ${data.file.name} (${(data.file.content || '').length} chars).`);
      return true;
    } catch {
      say('ide store unreachable — is the terminal service running?', 'error');
      return false;
    }
  }

  async function openWorkspaceFile(path) {
    try {
      const body = await readWorkspaceFile(session.username, path);
      setFileName(path);
      setContent(body);
      setSavedContent(body);
      targetRef.current = { type: 'ws', id: path };
      setOutput(null);
      say(`loaded workspace file ${path} (${body.length} chars).`);
      return true;
    } catch (err) {
      say(String(err.message || err), 'error');
      return false;
    }
  }

  async function save() {
    const target = targetRef.current;
    try {
      if (target.type === 'ws') {
        const path = await writeWorkspaceFile(session.username, target.id, contentRef.current);
        setSavedContent(contentRef.current);
        say(`saved workspace file ${path}.`, 'ok');
        return;
      }
      const name = target.type === 'prompt' ? target.id : null;
      if (!name) {
        say('name the file first — "new <name>" then "save".', 'error');
        return;
      }
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
    } catch (err) {
      say(String(err.message || err) || 'save failed.', 'error');
    }
  }

  async function run() {
    const code = contentRef.current;
    if (!code.trim()) {
      say('nothing to run — the editor is empty.', 'error');
      return;
    }

    const name = nameRef.current.toLowerCase();
    if (name.endsWith('.py')) {
      setRunning(true);
      setOutput({ text: 'starting python…', model: 'python (pyodide, in your browser)', at: Date.now(), ok: true, pending: true });
      try {
        const text = await runPython(code, (s) => say(s));
        setOutput({ text: text || '(no output)', model: 'python (pyodide, in your browser)', at: Date.now(), ok: true });
        say('python run complete.', 'ok');
      } catch (err) {
        const msg = String(err.message || err);
        setOutput({ text: msg, model: 'python', at: Date.now(), ok: false });
        say('python run failed.', 'error');
      } finally {
        setRunning(false);
      }
      return;
    }

    if (name.endsWith('.js') || name.endsWith('.mjs')) {
      setRunning(true);
      setOutput({ text: 'running javascript…', model: 'javascript (browser worker)', at: Date.now(), ok: true, pending: true });
      try {
        const text = await runJavaScript(code);
        setOutput({ text, model: 'javascript (browser worker)', at: Date.now(), ok: true });
        say('javascript run complete.', 'ok');
      } catch (err) {
        setOutput({ text: String(err.message || err), model: 'javascript', at: Date.now(), ok: false });
        say('javascript run failed.', 'error');
      } finally {
        setRunning(false);
      }
      return;
    }

    // Anything else runs as a prompt against the operator's own AI.
    setRunning(true);
    setOutput({ text: 'running…', model: '', at: Date.now(), ok: true, pending: true });
    try {
      const res = await fetch('/api/ide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'run', content: code, connector }),
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
      const prompts = files.length ? files.map((f) => f.name).join(', ') : 'none';
      const cloned = repos.length ? repos.join(', ') : 'none';
      say(`prompt files — ${prompts} · cloned repos — ${cloned}`);
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
      targetRef.current = { type: 'untitled' };
      setOutput(null);
      say(`new file "${tail.toLowerCase()}" — .py/.js run as code, anything else runs as a prompt.`);
      areaRef.current?.focus();
      return;
    }
    if (command === 'clone') {
      if (!tail) {
        say('usage: clone https://github.com/user/repo', 'error');
        return;
      }
      setRunning(true);
      say(`cloning ${tail} — public repos, depth 1…`);
      try {
        const result = await cloneRepo(session.username, tail);
        if (!result.ok) {
          say(result.error, 'error');
          return;
        }
        await refreshWorkspace();
        say(`cloned "${result.repo}" — ${result.files} file(s) in your local workspace. "wf ${result.repo}/<path>" opens one.`, 'ok');
      } catch (err) {
        say(`clone failed — ${String(err.message || err).slice(0, 160)}`, 'error');
      } finally {
        setRunning(false);
      }
      return;
    }
    if (command === 'repos') {
      say(repos.length ? `cloned repos — ${repos.join(', ')}` : 'no repos cloned yet — "clone <url>" fetches one into this browser.');
      return;
    }
    if (command === 'rmrepo') {
      if (!tail) {
        say('usage: rmrepo <name>', 'error');
        return;
      }
      try {
        const result = await removeRepo(session.username, tail);
        if (!result.ok) {
          say(result.error, 'error');
          return;
        }
        if (targetRef.current.type === 'ws' && targetRef.current.id.startsWith(`${result.removed}/`)) {
          setFileName(UNTITLED);
          setContent('');
          setSavedContent('');
          targetRef.current = { type: 'untitled' };
        }
        await refreshWorkspace();
        say(`removed ${result.removed}.`, 'ok');
      } catch (err) {
        say(String(err.message || err), 'error');
      }
      return;
    }
    if (command === 'wf') {
      if (!tail) {
        say(wsFiles.length ? `workspace files — ${wsFiles.slice(0, 12).join(', ')}${wsFiles.length > 12 ? ' …' : ''}` : 'workspace empty — "clone <url>" first.');
        return;
      }
      if (await openWorkspaceFile(tail.replace(/^\/+/, ''))) areaRef.current?.focus();
      return;
    }
    if (command === 'pip') {
      const pkgs = value.split(/\s+/).slice(1);
      if (!pkgs.length || (pkgs[0] || '').toLowerCase() === 'install' && pkgs.length < 2) {
        say('usage: pip install <package> [more…]', 'error');
        return;
      }
      const list = (pkgs[0] || '').toLowerCase() === 'install' ? pkgs.slice(1) : pkgs;
      setRunning(true);
      try {
        const installed = await pipInstall(list, (s) => say(s));
        say(`installed ${installed.join(', ')} into the browser python runtime.`, 'ok');
      } catch (err) {
        say(`pip failed — ${String(err.message || err).slice(0, 160)}`, 'error');
      } finally {
        setRunning(false);
      }
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
          targetRef.current = { type: 'untitled' };
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
                      className={targetRef.current.type === 'prompt' && f.name === fileName ? 'active' : ''}
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

          <section className="panel" data-panel="workspace">
            <div className="panel__head">
              <span>Workspace (cloned)</span>
              <span>{repos.length} repo(s)</span>
            </div>
            <div className="panel__body">
              {repos.length ? (
                <ul className="filelist">
                  {wsFiles.slice(0, 120).map((path) => (
                    <li
                      key={path}
                      className={targetRef.current.type === 'ws' && path === fileName ? 'active' : ''}
                      style={{ cursor: 'pointer' }}
                      title={`open ${path}`}
                      onClick={() => openWorkspaceFile(path)}
                    >
                      <span>{path}</span>
                    </li>
                  ))}
                  {wsFiles.length > 120 ? <li className="mem-empty">+{wsFiles.length - 120} more…</li> : null}
                </ul>
              ) : (
                <p className="mem-empty">
                  Empty — "clone &lt;github url&gt;" pulls a public repo into
                  this browser. Python/JS runtimes stay local to you too.
                </p>
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
                  {l.trim() ? l : '\u00a0'}
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
