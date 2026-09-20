'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * MCP connector panel — lets the user attach their own AI (an MCP server or
 * any OpenAI-compatible endpoint). Until then, Root & Chain keep interacting
 * on the local engine.
 */
export default function ConnectorPanel({ current, onConnect, onDisconnect, onDismiss }) {
  const [type, setType] = useState(current?.type || 'mcp');
  const [url, setUrl] = useState(current?.url || '');
  const [apiKey, setApiKey] = useState(current?.apiKey || '');
  const [model, setModel] = useState(current?.model || '');
  const [tool, setTool] = useState(current?.tool || '');
  const [tools, setTools] = useState([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, detail?, error? }
  const firstField = useRef(null);

  useEffect(() => {
    if (firstField.current) firstField.current.focus();
  }, []);

  const connector = {
    type,
    url: url.trim(),
    apiKey: apiKey.trim(),
    model: type === 'openai' ? model.trim() : undefined,
    tool: type === 'mcp' && tool ? tool : undefined,
  };

  const canAttempt = connector.url && (type === 'mcp' || connector.model);

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/connector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', connector }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok && data.tools?.length) {
        setTools(data.tools);
        if (data.picked) setTool(data.picked);
      }
    } catch {
      setResult({ ok: false, error: 'Could not reach the test probe. Is the dev server running?' });
    } finally {
      setTesting(false);
    }
  }

  async function connect() {
    setSaving(true);
    try {
      onConnect(connector);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="boot" role="dialog" aria-modal="true" aria-label="MCP connector">
      <div className="boot__card">
        <div className="boot__head">
          <h2>MCP // AI Connector</h2>
          <p>
            Bring your own agent. Root &amp; Chain run on the local engine until you attach
            an AI of your own — their full intelligence and memory form once your
            connector is linked. Keys stay in this browser and are never stored server-side.
          </p>
        </div>

        <div className="boot__body">
          <div className="boot__modes" role="tablist" aria-label="Connector type">
            <button
              type="button"
              role="tab"
              className="tab-pill"
              aria-selected={type === 'mcp'}
              onClick={() => { setType('mcp'); setResult(null); }}
            >
              MCP server
            </button>
            <button
              type="button"
              role="tab"
              className="tab-pill"
              aria-selected={type === 'openai'}
              onClick={() => { setType('openai'); setResult(null); }}
            >
              OpenAI-compatible
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (canAttempt && !testing) test(); }} noValidate>
            <div className="field">
              <label htmlFor="conn-url">
                {type === 'mcp' ? 'MCP server URL' : 'API base URL'}
              </label>
              <input
                id="conn-url"
                ref={firstField}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  type === 'mcp'
                    ? 'e.g. http://localhost:8000/mcp'
                    : 'e.g. https://openrouter.ai/api/v1'
                }
                autoComplete="off"
                spellCheck={false}
              />
              <span className="hint">
                {type === 'mcp'
                  ? 'Streamable HTTP endpoint of your MCP server. Chat-like tools are auto-detected.'
                  : 'Works with OpenRouter, z.ai, OpenAI, Ollama (http://localhost:11434/v1), LM Studio…'}
              </span>
            </div>

            {type === 'openai' ? (
              <>
                <div className="field" style={{ marginTop: '12px' }}>
                  <label htmlFor="conn-model">Model</label>
                  <input
                    id="conn-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. glm-4.7, gpt-4o-mini, llama3.2"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="field" style={{ marginTop: '12px' }}>
                  <label htmlFor="conn-key">API key (optional for local runtimes)</label>
                  <input
                    id="conn-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="your key — kept in this browser only"
                    autoComplete="off"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="field" style={{ marginTop: '12px' }}>
                  <label htmlFor="conn-token">Bearer token (optional)</label>
                  <input
                    id="conn-token"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="only if your MCP server requires one"
                    autoComplete="off"
                  />
                </div>
                {tools.length ? (
                  <div className="field" style={{ marginTop: '12px' }}>
                    <label htmlFor="conn-tool">Tool to use</label>
                    <select
                      id="conn-tool"
                      value={tool}
                      onChange={(e) => setTool(e.target.value)}
                    >
                      <option value="">auto-detect (chat-like tool)</option>
                      {tools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                          {t.description ? ` — ${t.description.slice(0, 60)}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </>
            )}

            {result ? (
              <p
                className="err"
                role="status"
                style={{ marginTop: '12px', color: result.ok ? 'var(--ok)' : undefined }}
              >
                {result.ok ? `LINK OK — ${result.detail}` : `LINK FAILED — ${result.error}`}
              </p>
            ) : null}

            <div className="boot__foot" style={{ marginTop: '16px' }}>
              {current ? (
                <button type="button" className="btn btn--ghost" onClick={onDisconnect}>
                  Disconnect
                </button>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={onDismiss}>
                  Back to terminal
                </button>
              )}
              <span className="boot__actions">
                <button
                  type="submit"
                  className="btn"
                  disabled={!canAttempt || testing}
                  aria-disabled={!canAttempt || testing}
                >
                  {testing ? 'Probing…' : 'Test link'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!canAttempt || saving}
                  aria-disabled={!canAttempt || saving}
                  onClick={connect}
                >
                  Connect
                </button>
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
