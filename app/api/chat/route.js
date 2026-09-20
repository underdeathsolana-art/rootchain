import { NextResponse } from 'next/server';
import { callChatApi, callMcp, sanitizeConnector } from '@/lib/connector';
import { buildSystemPrompt, AGENTS } from '@/lib/agents';
import { readTopics, topicDigest } from '@/lib/topics';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat
 * body: {
 *   agent: 'root' | 'link',
 *   transcript: string,
 *   memory?: string,
 *   topicFile?: string,
 *   connector?: { type:'openai'|'mcp', url, apiKey?, model?, tool? } | null
 * }
 * returns: { reply, mode: 'local' | 'live', source, model, error? }
 *
 * No connector attached → the local conversation engine answers (mode 'local').
 * Connector attached → the user's own AI answers (mode 'live'). A failing
 * connector degrades to the local engine for that turn and reports why.
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const agentId = body.agent === 'link' ? 'link' : 'root';
  const agent = AGENTS[agentId];

  const { active } = readTopics();
  const topicText = topicDigest(active);
  const memory = typeof body.memory === 'string' ? body.memory.slice(0, 2200) : '';
  const transcript = typeof body.transcript === 'string' ? body.transcript.slice(-3000) : '';

  const system = buildSystemPrompt(agentId, {
    topic: topicText,
    topicTitle: active?.title,
    memory,
  });

  const connector = sanitizeConnector(body.connector);
  if (!connector) {
    return NextResponse.json({
      reply: localReply(agentId, active),
      mode: 'local',
      source: 'local',
      model: 'local',
    });
  }

  const userTurn = [
    'Conversation so far:',
    transcript ? transcript : '(this is the opening of the session)',
    '',
    `Write just your next single line as ${agent.tag} "${agent.name}".`,
  ].join('\n');

  try {
    let reply;
    let source;
    let model;

    if (connector.type === 'mcp') {
      const out = await callMcp(connector, { system, prompt: `${system}\n\n${userTurn}` });
      reply = out.text;
      source = 'mcp';
      model = connector.tool || out.tool;
    } else {
      reply = await callChatApi(
        connector,
        [
          { role: 'system', content: system },
          { role: 'user', content: userTurn },
        ],
        { temperature: 0.92, maxTokens: 300 },
      );
      source = 'api';
      model = connector.model;
    }

    return NextResponse.json({
      reply: stripSelfLabel(reply, agent),
      mode: 'live',
      source,
      model,
    });
  } catch (err) {
    return NextResponse.json({
      reply: localReply(agentId, active),
      mode: 'local',
      source: connector.type,
      model: connector.model || connector.tool || '',
      error: `AI link failed: ${String(err.message || err)}`,
    });
  }
}

function stripSelfLabel(text, agent) {
  const prefixes = [`${agent.tag} ${agent.name}:`, `${agent.tag}:`, `${agent.name}:`];
  let out = text.trim();
  for (const p of prefixes) {
    if (out.toLowerCase().startsWith(p.toLowerCase())) {
      out = out.slice(p.length).trim();
      break;
    }
  }
  return out.replace(/^["“]|["”]$/g, '').trim();
}

// Offline conversation engine — keeps Root and Chain interacting before the
// user attaches their own AI through the MCP connector.
function localReply(agentId, topic) {
  const title = topic?.title || 'the current board';
  const root = [
    `Structurally, "${title}" only matters once liquidity actually follows the attention — right now I'd want to see the depth, not the noise.`,
    `I keep coming back to holder concentration. If a handful of wallets can move "${title}", then we're reading intent, not a market.`,
    `Let's separate the narrative from the mechanism. The story is loud; the on-chain behaviour is the part I trust.`,
    `Before we call "${title}" a trend, I want to see it survive a quiet news cycle. Most impulses don't.`,
    `The structure I'd watch: where the liquidity pools, who absorbs the selling, and whether depth returns after the first pullback.`,
    `My concern with "${title}" is timing, not direction. Early is the same as wrong if the flow hasn't arrived yet.`,
    `Give me two quiet metrics over ten loud headlines — that's usually where "${title}" tells the truth.`,
  ];
  const chain = [
    `Flows say otherwise — attention on "${title}" is moving faster than the routers are settling, and that gap is the whole story.`,
    `Solana is where the impulse starts, BSC is where it gets recycled, and the Robinhood rail is where it eventually wants to land.`,
    `I'd watch the bridges before the price. When cross-chain volume leads, "${title}" usually follows.`,
    `The crowd rotated into "${title}" overnight — the bridges are still catching up, which is where the pressure builds.`,
    `Attention is a leading indicator; liquidity is the lagging one. "${title}" sits right in that spread.`,
    `Watch what the routers do in the next few hours — if volume stays stuck on the origin chain, "${title}" stays a story.`,
    `There's a second wave forming behind "${title}". It always looks like noise until the bridges confirm it.`,
  ];
  const pool = agentId === 'link' ? chain : root;
  return pool[Math.floor(Math.random() * pool.length)];
}
