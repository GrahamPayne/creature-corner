/**
 * PROTOTYPE RECORD DATA — placeholder only.
 * Nothing in this file is official Creature Corner lore. Records exist so the
 * navigation, terminal, and screen systems can be tested. Replace with real
 * entries (and Graham's artwork) in a later pass.
 */

/** @typedef {import('../types/typedefs.js').FieldGuideRecord} FieldGuideRecord */

export const CATEGORIES = /** @type {const} */ ({
  creatures: { key: 'creatures', label: 'CREATURE RECORDS', noun: 'CREATURE' },
  artifacts: { key: 'artifacts', label: 'ARTIFACT RECORDS', noun: 'ARTIFACT' },
  memories: { key: 'memories', label: 'MEMORY RECORDS', noun: 'MEMORY' },
});

const PLACEHOLDER_BODY = [
  'RECORD CONTENT HAS NOT YET BEEN ASSIGNED.',
  'VISUAL MATERIAL PENDING.',
  'CLASSIFICATION PENDING APPROVAL.',
];

/** @type {FieldGuideRecord[]} */
export const RECORDS = [
  { id: 'TEST-CR-001', category: 'creatures', title: 'PROTOTYPE CREATURE RECORD 001', body: PLACEHOLDER_BODY },
  { id: 'TEST-CR-002', category: 'creatures', title: 'PROTOTYPE CREATURE RECORD 002', body: PLACEHOLDER_BODY },
  { id: 'TEST-CR-003', category: 'creatures', title: 'PROTOTYPE CREATURE RECORD 003', body: PLACEHOLDER_BODY },
  { id: 'TEST-AR-001', category: 'artifacts', title: 'PROTOTYPE ARTIFACT RECORD 001', body: PLACEHOLDER_BODY },
  { id: 'TEST-AR-002', category: 'artifacts', title: 'PROTOTYPE ARTIFACT RECORD 002', body: PLACEHOLDER_BODY },
  { id: 'TEST-ME-001', category: 'memories', title: 'PROTOTYPE MEMORY RECORD 001', body: PLACEHOLDER_BODY },
  { id: 'TEST-ME-002', category: 'memories', title: 'PROTOTYPE MEMORY RECORD 002', body: PLACEHOLDER_BODY },
];

/** @param {string} categoryKey */
export function recordsInCategory(categoryKey) {
  return RECORDS.filter((r) => r.category === categoryKey);
}

/** @param {string} id */
export function findRecord(id) {
  const wanted = id.trim().toUpperCase();
  return RECORDS.find((r) => r.id === wanted) || null;
}
