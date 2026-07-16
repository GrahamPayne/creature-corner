/**
 * Deterministic terminal command parser.
 * Case-insensitive, tolerant of extra whitespace and trailing punctuation.
 * Produces plain action objects; commands/dispatch.js executes them.
 * No network, no AI — a lookup table.
 */

/** @typedef {import('../types/typedefs.js').FgAction} FgAction */

/** @param {string} input */
export function normalize(input) {
  return input.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Exact-phrase commands (after normalization, punctuation stripped for chat). */
const EXACT = new Map([
  ['HELP', { type: 'HELP' }],
  ['INDEX', { type: 'INDEX' }],

  ['CREATURES', { type: 'CATEGORY', category: 'creatures' }],
  ['LIST CREATURES', { type: 'CATEGORY', category: 'creatures' }],
  ['SHOW CREATURES', { type: 'CATEGORY', category: 'creatures' }],
  ['CREATURE INDEX', { type: 'CATEGORY', category: 'creatures' }],
  ['CREATURES INDEX', { type: 'CATEGORY', category: 'creatures' }],

  ['ARTIFACTS', { type: 'CATEGORY', category: 'artifacts' }],
  ['LIST ARTIFACTS', { type: 'CATEGORY', category: 'artifacts' }],
  ['SHOW ARTIFACTS', { type: 'CATEGORY', category: 'artifacts' }],
  ['ARTIFACT INDEX', { type: 'CATEGORY', category: 'artifacts' }],
  ['ARTIFACTS INDEX', { type: 'CATEGORY', category: 'artifacts' }],

  ['MEMORIES', { type: 'CATEGORY', category: 'memories' }],
  ['LIST MEMORIES', { type: 'CATEGORY', category: 'memories' }],
  ['SHOW MEMORIES', { type: 'CATEGORY', category: 'memories' }],
  ['MEMORY INDEX', { type: 'CATEGORY', category: 'memories' }],
  ['MEMORIES INDEX', { type: 'CATEGORY', category: 'memories' }],

  ['NEXT', { type: 'NEXT' }],
  ['PREVIOUS', { type: 'PREV' }],
  ['PREV', { type: 'PREV' }],

  ['BACK', { type: 'BACK' }],
  ['GO BACK', { type: 'BACK' }],
  ['RETURN', { type: 'BACK' }],

  ['HOME', { type: 'HOME' }],
  ['MAIN MENU', { type: 'HOME' }],

  ['STATUS', { type: 'STATUS' }],
  ['CLEAR', { type: 'CLEAR' }],
  ['POWER OFF', { type: 'POWER_OFF' }],
]);

/** Conversational phrases -> chat keys (restrained responses in data/responses.js). */
const CHAT = new Map([
  ['HELLO', 'HELLO'],
  ['HI', 'HELLO'],
  ['WHO ARE YOU', 'WHO_ARE_YOU'],
  ['ARE YOU ALIVE', 'ARE_YOU_ALIVE'],
  ['WHAT IS THIS', 'WHAT_IS_THIS'],
  ['WHAT CAN YOU DO', 'WHAT_CAN_YOU_DO'],
]);

/**
 * @param {string} input raw terminal input
 * @returns {FgAction}
 */
export function parse(input) {
  const cmd = normalize(input);
  if (!cmd) return { type: 'NOOP', raw: input };

  const exact = EXACT.get(cmd);
  if (exact) return { ...exact, raw: input };

  if (cmd.startsWith('OPEN')) {
    const id = cmd.slice(4).trim();
    return { type: 'OPEN', id, raw: input };
  }

  const dePunctuated = cmd.replace(/[?!.,]+$/g, '').trim();
  const chatKey = CHAT.get(dePunctuated);
  if (chatKey) return { type: 'CHAT', key: chatKey, raw: input };

  return { type: 'UNKNOWN', raw: input };
}
