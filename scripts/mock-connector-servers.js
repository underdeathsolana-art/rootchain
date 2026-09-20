// Test doubles for the MCP connector: a mock MCP server (Streamable HTTP,
// JSON responses) on :4100 and a mock OpenAI-compatible endpoint on :4101.
// Used only to verify Rootchain's connector paths locally.
const http = require('http');

let mcpReqId = 0;
let toolCalls = 0;

const mcpServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let msg = null;
    try { msg = JSON.parse(body); } catch {}

    if (req.method !== 'POST' || !msg) {
      res.writeHead(405).end();
      return;
    }

    if (msg.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'mock-sess-1' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-agent-mcp', version: '0.3.0' },
        },
      }));
      return;
    }

    if (msg.method === 'notifications/initialized') {
      res.writeHead(202).end();
      return;
    }

    if (msg.method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: {
          tools: [
            {
              name: 'get_time',
              description: 'Returns the current time',
              inputSchema: { type: 'object', properties: {}, required: [] },
            },
            {
              name: 'chat',
              description: 'Talk to the mock agent',
              inputSchema: {
                type: 'object',
                properties: { prompt: { type: 'string' }, system: { type: 'string' } },
                required: ['prompt'],
              },
            },
          ],
        },
      }));
      return;
    }

    if (msg.method === 'tools/call') {
      toolCalls += 1;
      mcpReqId += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: {
          isError: false,
          content: [{
            type: 'text',
            text: `Mock MCP turn #${mcpReqId}: the bridge volume thesis holds — attention moved first, depth is catching up.`,
          }],
        },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
  });
});

let apiCalls = 0;
const apiServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url.includes('/chat/completions')) {
      apiCalls += 1;
      const auth = req.headers.authorization || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: auth === 'Bearer test-key-ok'
              ? `Mock API turn #${apiCalls}: liquidity follows attention with a lag — the routers will confirm it within a cycle.`
              : `Mock API turn #${apiCalls} (no/other key): readable reply.`,
          },
        }],
      }));
      return;
    }
    res.writeHead(404).end();
  });
});

mcpServer.listen(4100, () => console.log('mock MCP  on :4100'));
apiServer.listen(4101, () => console.log('mock API  on :4101'));
