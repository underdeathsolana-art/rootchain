// AI connector layer — server-side only.
// The terminal never ships a built-in model key. Instead, each user attaches
// their own AI through the MCP connector panel:
//   · type "openai" → any OpenAI-compatible chat endpoint (OpenRouter, z.ai,
//     OpenAI, Ollama, LM Studio, …). Credentials arrive per request from the
//     browser and are used in memory only — nothing is written to disk.
//   · type "mcp"    → a Model Context Protocol server (Streamable HTTP). We
//     perform the JSON-RPC handshake, discover a chat-capable tool and call
//     it for each agent turn.
// When no connector is attached the local conversation engine keeps Root and
// Chain talking offline.

const OPENAI_TIMEOUT = 45000;
const MCP_STEP_TIMEOUT = 12000;
const MCP_CALL_TIMEOUT = 60000;

export function sanitizeConnector(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'mcp' ? 'mcp' : 'openai';
  const pick = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const out = { type };
  if (type === 'mcp') {
    out.url = pick(raw.url, 500);
    out.apiKey = pick(raw.apiKey, 400);
    out.tool = pick(raw.tool, 200);
    if (!/^https?:\/\//i.test(out.url)) return null;
  } else {
    out.url = pick(raw.url, 500);
    out.apiKey = pick(raw.apiKey, 400);
    out.model = pick(raw.model, 200);
    if (!/^https?:\/\//i.test(out.url)) return null;
    if (!out.model) return null;
  }
  return out;
}

// ── OpenAI-compatible endpoints ─────────────────────────────────────────────

/**
 * Call a user-provided OpenAI-compatible chat-completions endpoint.
 * @param {{url:string, apiKey?:string, model:string}} cfg
 * @param {{role:string,content:string}[]} messages
 */
export async function callChatApi(cfg, messages, { temperature = 0.9, maxTokens = 320 } = {}) {
  const base = cfg.url.replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base)
    ? base
    : `${base}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API_${res.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
    }

    const data = await res.json();
    if (data?.error) {
      throw new Error(`API_ERR: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
    }
    const msg = data?.choices?.[0]?.message;
    // Reasoning models (GLM-4.5+/GLM-5, …) can exhaust max_tokens while
    // thinking and return an empty `content` with the text sitting in
    // `reasoning_content` — fall back rather than reporting API_EMPTY.
    let content = msg?.content;
    if (!content || !content.trim()) content = msg?.reasoning_content;
    if (!content || !content.trim()) throw new Error('API_EMPTY');
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ── MCP client (Streamable HTTP transport) ──────────────────────────────────

async function mcpRpc(url, apiKey, body, sessionId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });

    const sid = res.headers.get('mcp-session-id') || sessionId;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`MCP_${res.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
    }

    const ct = res.headers.get('content-type') || '';
    const text = await res.text().catch(() => '');
    if (!text) return { json: null, sessionId: sid }; // 202 Accepted — notification

    let json;
    if (ct.includes('text/event-stream')) {
      const payloads = text
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(Boolean);
      json = body.id != null ? payloads.find((p) => p.id === body.id) : payloads[payloads.length - 1];
      if (!json) throw new Error('MCP_SSE_NO_RESULT');
    } else {
      json = JSON.parse(text);
    }

    if (json?.error) throw new Error(`MCP_ERR: ${json.error.message || JSON.stringify(json.error)}`);
    return { json, sessionId: sid };
  } finally {
    clearTimeout(timer);
  }
}

function initializeBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'rootchain-terminal', version: '1.0.0' },
    },
  };
}

/** Chat-like tool heuristic — most agent MCP servers expose one of these. */
const TOOL_MATCH = /(chat|ask|talk|converse|complete|generat|reply|respond|think|agent|prompt|infer|message)/i;
export function pickChatTool(tools) {
  if (!Array.isArray(tools) || !tools.length) return null;
  return tools.find((t) => TOOL_MATCH.test(t?.name || '')) || null;
}

/** Map the prompt onto the tool's declared input schema. */
function buildToolArgs(tool, prompt, system) {
  const props = tool?.inputSchema?.properties || {};
  const keys = Object.keys(props);
  const args = {};

  const preferred =
    keys.find((k) => /^(prompt|message|input|query|question|text)$/i.test(k)) ||
    keys.find((k) => /message|prompt|input|query/i.test(k));
  const target = preferred || keys.find((k) => props[k]?.type !== 'array' && props[k]?.type !== 'object') || 'prompt';

  args[target] = prompt;
  if (system && keys.includes('system')) args.system = system;
  return args;
}

/**
 * Run one full MCP exchange: initialize → tools/list (unless a tool is pinned)
 * → tools/call. Returns the concatenated text content of the tool result.
 * @param {{url:string, apiKey?:string, tool?:string}} cfg
 */
export async function callMcp(cfg, { system, prompt }) {
  const url = cfg.url;
  const apiKey = cfg.apiKey || '';

  let { sessionId } = await mcpRpc(url, apiKey, initializeBody(), null, MCP_STEP_TIMEOUT);
  await mcpRpc(url, apiKey, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId, MCP_STEP_TIMEOUT);

  let tool = null;
  if (cfg.tool) {
    tool = { name: cfg.tool, inputSchema: undefined };
  } else {
    const list = await mcpRpc(
      url,
      apiKey,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      sessionId,
      MCP_STEP_TIMEOUT,
    );
    const tools = list.json?.result?.tools || [];
    tool = pickChatTool(tools);
    if (!tool) {
      throw new Error(`MCP_NO_CHAT_TOOL: ${tools.length} tool(s) found, none chat-like. Pin a tool in the connector panel.`);
    }
  }

  const call = await mcpRpc(
    url,
    apiKey,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: tool.name, arguments: buildToolArgs(tool, prompt, system) },
    },
    sessionId,
    MCP_CALL_TIMEOUT,
  );

  const result = call.json?.result;
  if (result?.isError) throw new Error('MCP_TOOL_ERROR');
  const text = (result?.content || [])
    .filter((c) => c?.type === 'text' && c?.text)
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('MCP_NO_TEXT_CONTENT');
  return { text, tool: tool.name };
}

/** Probe a connector from the panel's TEST button. */
export async function testConnector(cfg) {
  if (cfg.type === 'openai') {
    const reply = await callChatApi(
      cfg,
      [{ role: 'user', content: 'Reply with the single word: ready' }],
      { temperature: 0, maxTokens: 768 },
    );
    return { ok: true, detail: `model "${cfg.model}" answered: ${reply.trim().slice(0, 40)}`, tools: [] };
  }

  const init = await mcpRpc(cfg.url, cfg.apiKey || '', initializeBody(), null, MCP_STEP_TIMEOUT);
  const serverInfo = init.json?.result?.serverInfo || {};
  await mcpRpc(cfg.url, cfg.apiKey || '', { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId, MCP_STEP_TIMEOUT);
  const list = await mcpRpc(cfg.url, cfg.apiKey || '', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sessionId, MCP_STEP_TIMEOUT);
  const tools = (list.json?.result?.tools || []).map((t) => ({ name: t.name, description: (t.description || '').slice(0, 120) }));
  const picked = pickChatTool(list.json?.result?.tools || []);
  return {
    ok: true,
    detail: `${serverInfo.name || 'server'}${serverInfo.version ? ` v${serverInfo.version}` : ''} · ${tools.length} tool(s)`,
    tools,
    picked: picked?.name || null,
  };
}
