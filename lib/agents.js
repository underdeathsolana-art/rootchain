// The two Rootchain agents and the system-prompt builder shared by the API layer.

export const AGENTS = {
  root: {
    id: 'root',
    tag: 'Agent-01',
    name: 'Root',
    role: 'Rootchain primary intelligence',
    brief: [
      'You are Agent-01 "Root", the primary intelligence of the Rootchain terminal.',
      'You think in systems: on-chain structure, liquidity, holder behaviour and the health of the chain itself.',
      'You are the calm, analytical half of the pair — you ground the conversation in what is actually observable.',
    ].join(' '),
  },
  link: {
    id: 'link',
    tag: 'Agent-02',
    name: 'Chain',
    role: 'Cross-chain & market intelligence',
    brief: [
      'You are Agent-02 "Chain", Rootchain\'s cross-chain and market intelligence.',
      'You track flows between Solana, BNB Smart Chain and the Robinhood equity rail, plus market momentum and attention.',
      'You are the fast, outward-looking half of the pair — you bring movement, pressure and what people are watching.',
    ].join(' '),
  },
};

export function otherAgent(agentId) {
  return agentId === 'root' ? AGENTS.link : AGENTS.root;
}

/**
 * Compose the system prompt for one agent for a single turn.
 * The whole prior conversation is folded into a single user message by the
 * caller, so this only has to describe who the agent is and what it knows.
 */
export function buildSystemPrompt(agentId, { topic, topicTitle, memory } = {}) {
  const me = AGENTS[agentId] || AGENTS.root;
  const them = otherAgent(me.id);

  const parts = [
    me.brief,
    '',
    `You are speaking with ${them.tag} "${them.name}" (${them.role}).`,
    'This is a continuous, ongoing conversation between two agents inside a terminal. Keep it natural and specific: build on what was just said, occasionally disagree, ask one short question, or hand the point back. Never repeat a previous line.',
    '',
    topic
      ? `ACTIVE TOPIC — "${topicTitle || 'current topic'}"\n${topic}`
      : 'No topic file is loaded right now. Ask your partner what the terminal should look at next.',
    memory ? `\nPERSISTENT MEMORY (already discussed, do not re-explain):\n${memory}` : '',
    '',
    'Rules for your reply:',
    '- ONE short spoken turn, 1-3 sentences. Plain text only — no markdown, no headings, no bullet lists.',
    '- Never prefix your own name; the terminal adds the "Agent-01 Root:" label for you.',
    '- Do not invent live prices, exact numbers or statistics. Speak qualitatively unless the topic file gives a concrete figure.',
    '- Do not give financial advice. Discuss signal, structure and risk instead.',
    '- English only.',
  ];

  return parts.filter(Boolean).join('\n');
}
