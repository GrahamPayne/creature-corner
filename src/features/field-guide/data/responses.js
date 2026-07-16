/**
 * Field Guide interface copy — PROTOTYPE WRITING, not permanent lore.
 * Everything the device "says" lives here so it can be edited without
 * touching the interaction code.
 *
 * Lore guardrails (see docs/LORE_RULES.md): the device records and preserves
 * anomalies. It may seem to act independently, but it is never confirmed to
 * be alive, conscious, evil, possessed, or a conventional AI, and its origin
 * is never explained.
 */

export const BOOT_LINES = [
  'FIELD GUIDE INTERFACE',
  'LOCAL RECORD SYSTEM ACTIVE',
  'TYPE HELP FOR AVAILABLE COMMANDS',
];

export const SHUTDOWN_LINES = ['RECORD SYSTEM CLOSING.'];

export const HELP_LINES = [
  'AVAILABLE INPUTS:',
  '  HELP            THIS LIST',
  '  INDEX           RECORD CATEGORIES',
  '  CREATURES       CREATURE RECORDS',
  '  ARTIFACTS       ARTIFACT RECORDS',
  '  MEMORIES        MEMORY RECORDS',
  '  OPEN <ID>       OPEN A RECORD',
  '  NEXT / PREV     MOVE THROUGH RECORDS',
  '  BACK            PREVIOUS SCREEN',
  '  HOME            MAIN MENU',
  '  STATUS          DEVICE STATE',
  '  CLEAR           CLEAR TERMINAL',
  '  POWER OFF       SHUT DOWN',
];

/** Rotated through deterministically for unrecognized input. */
export const UNKNOWN_RESPONSES = [
  ['COMMAND NOT RECOGNIZED.', 'TYPE HELP FOR AVAILABLE INPUTS.'],
  ['REQUEST OUTSIDE CURRENT RECORD PARAMETERS.'],
  ['INPUT RECORDED. NO ASSOCIATED ACTION FOUND.'],
];

/** Restrained conversational responses. Keys match parser chat keys. */
export const CHAT_RESPONSES = {
  HELLO: ['INPUT ACKNOWLEDGED.'],
  WHO_ARE_YOU: ['IDENTITY RECORD INCOMPLETE.', 'THE INTERFACE REMAINS AVAILABLE.'],
  ARE_YOU_ALIVE: ['TERM CANNOT BE VERIFIED.', 'CONTINUE WITH A RECORD QUERY.'],
  WHAT_IS_THIS: ['A DEVICE FOR RECORDING AND PRESERVING ANOMALOUS MATERIAL.'],
  WHAT_CAN_YOU_DO: ['RECORD NAVIGATION IS AVAILABLE.', 'TYPE HELP FOR AVAILABLE INPUTS.'],
};

export const MESSAGES = {
  noRecord: ['NO MATCHING RECORD WAS LOCATED.'],
  openNeedsId: ['SPECIFY A RECORD ID. EXAMPLE: OPEN TEST-CR-001'],
  atMainMenu: ['MAIN MENU.'],
  alreadyHome: ['ALREADY AT MAIN MENU.'],
  endOfRecords: ['END OF RECORDS.'],
  startOfRecords: ['START OF RECORDS.'],
  nothingToNavigate: ['NO RECORD SEQUENCE ACTIVE.'],
  poweringOff: ['POWER OFF REQUESTED.'],
  indexHint: ['RECORD CATEGORIES: CREATURES / ARTIFACTS / MEMORIES.', 'TYPE A CATEGORY NAME TO BROWSE.'],
};
