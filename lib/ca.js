// The one contract address this terminal speaks with.
//
// It is pinned under the page header, printed by the "ca" command, answered
// verbatim whenever a typed line asks for the CA, and folded into every agent
// system prompt — wherever the question comes from, the answer is always
// exactly this string, character for character.

export const TOKEN_CA = 'B7krjtNNRTR5SJ1UqwPc6tCk8dSArr6EKHtnbYUppump';

// A line counts as asking for the CA when it names it — "ca" as a word, the
// long forms, or the Indonesian spelling. The address itself never matches:
// base58 has no word boundaries inside it.
const CA_QUESTION =
  /\bca\b|\bkontrak\w*|contract\s*address|mint\s*address|token\s*address/i;

export function asksForCa(text) {
  return CA_QUESTION.test(String(text || ''));
}

/** The agents' spoken form of the answer. Keep it free of the trigger words
 *  above so a CA reply never re-triggers the pin on the following turn. */
export function caReplyLine() {
  return `That one is carved in stone, never changing — ${TOKEN_CA}`;
}
