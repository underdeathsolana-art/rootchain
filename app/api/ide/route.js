import { NextResponse } from 'next/server';
import { sanitizeConnector, callChatApi, callMcp } from '@/lib/connector';
import {
  findUserByCode,
  listIdeFiles,
  readIdeFile,
  saveIdeFile,
  deleteIdeFile,
  IDE_LIMITS,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

const NAME_RE = /^[a-z0-9][a-z0-9 _.-]{0,39}$/i;

const RUN_SYSTEM = [
  'You are ROOTIDE, the prompt runtime inside the Rootchain terminal.',
  'Answer the prompt directly and completely. Plain text unless the prompt asks for code or markdown.',
].join(' ');

/**
 * ROOTIDE — the online prompt IDE.
 *
 * GET  /api/ide?username=&code=[&name=]
 *        no name  -> { ok, rev, files: [{name, size, updatedAt}] }
 *        with name -> { ok, rev, file: {name, content, updatedAt} | null }
 *
 * POST /api/ide { username, code, action, ... }
 *        'save'   { name, content }
 *        'delete' { name }
 *        'run'    { content, connector }  — executes the prompt against the
 *                 operator's own AI (OpenAI-compatible or MCP). The key lives
 *                 in the operator's browser and passes through memory only.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get('username') || '').slice(0, 40);
  const code = (searchParams.get('code') || '').toUpperCase();
  const name = (searchParams.get('name') || '').trim();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 401 });
  }

  if (name) {
    const file = await readIdeFile(user.username.toLowerCase(), name.toLowerCase());
    return NextResponse.json({ ok: true, rev: 1, file });
  }

  const files = await listIdeFiles(user.username.toLowerCase());
  return NextResponse.json({ ok: true, rev: 1, files });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const user = await findUserByCode(String(body.code || '').toUpperCase());
  if (
    !user ||
    user.username.toLowerCase() !== String(body.username || '').trim().toLowerCase()
  ) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 401 });
  }

  if (body.action === 'save' || body.action === 'delete') {
    const name = String(body.name || '').trim();
    if (!NAME_RE.test(name)) {
      return NextResponse.json(
        { ok: false, error: `Invalid name — use letters, digits, space . _ - (max ${IDE_LIMITS.NAME_MAX}).` },
        { status: 400 },
      );
    }
    const lower = name.toLowerCase();

    if (body.action === 'delete') {
      await deleteIdeFile(user.username.toLowerCase(), lower);
      return NextResponse.json({ ok: true, deleted: name });
    }

    if (typeof body.content !== 'string') {
      return NextResponse.json({ ok: false, error: 'content must be a string.' }, { status: 400 });
    }
    const result = await saveIdeFile(user.username.toLowerCase(), lower, body.content);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  }

  if (body.action === 'run') {
    const prompt = String(body.content || '').replace(/\r\n/g, '\n').trim().slice(0, IDE_LIMITS.CONTENT_MAX);
    if (!prompt) {
      return NextResponse.json({ ok: false, error: 'Nothing to run — the editor is empty.' }, { status: 400 });
    }

    const connector = sanitizeConnector(body.connector);
    if (!connector) {
      return NextResponse.json(
        { ok: false, error: 'No AI linked — type "connect" in the main terminal and attach one first.' },
        { status: 400 },
      );
    }

    try {
      if (connector.type === 'mcp') {
        const out = await callMcp(connector, { system: RUN_SYSTEM, prompt });
        return NextResponse.json({ ok: true, output: out.text, model: connector.tool || out.tool });
      }
      const output = await callChatApi(
        connector,
        [
          { role: 'system', content: RUN_SYSTEM },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.7, maxTokens: 1200 },
      );
      return NextResponse.json({ ok: true, output, model: connector.model });
    } catch (err) {
      return NextResponse.json({ ok: false, error: `Run failed: ${String(err.message || err).slice(0, 300)}` }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
