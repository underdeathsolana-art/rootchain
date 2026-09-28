import { NextResponse } from 'next/server';
import { callChatApi, callMcp, sanitizeConnector } from '@/lib/connector';
import { buildSystemPrompt, AGENTS } from '@/lib/agents';
import { readTopics, topicDigest } from '@/lib/topics';
import { findUserByCode, readAgentContext } from '@/lib/store';
import { nextLocalLine } from '@/lib/localdialogue';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat
 * body: {
 *   agent: 'root' | 'link',
 *   transcript: string,
 *   memory?: string,
 *   topicFile?: string,
 *   username?: string, code?: string,   — resolves the operator, whose
 *                                         skill.md / readme.md are folded
 *                                         into the system prompt
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

  // Operator context: the skill.md / readme.md pair edited from the terminal.
  // Anonymous or unrecognised sessions simply run without a custom context.
  let context = {};
  if (body.username && body.code) {
    const user = await findUserByCode(String(body.code).toUpperCase());
    if (user && user.username.toLowerCase() === String(body.username).trim().toLowerCase()) {
      const stored = await readAgentContext(user.username.toLowerCase());
      if (stored.skill || stored.readme) {
        context = { skill: stored.skill, readme: stored.readme, username: user.username };
      }
    }
  }

  const system = buildSystemPrompt(agentId, {
    topic: topicText,
    topicTitle: active?.title,
    memory,
    context,
  });

  const connector = sanitizeConnector(body.connector);
  if (!connector) {
    return NextResponse.json({
      reply: nextLocalLine(agentId, { transcript }),
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
        // Reasoning models spend completion tokens thinking before the one
        // spoken line — leave them headroom so content never truncates empty.
        { temperature: 0.92, maxTokens: 900 },
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
      reply: nextLocalLine(agentId, { transcript }),
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
