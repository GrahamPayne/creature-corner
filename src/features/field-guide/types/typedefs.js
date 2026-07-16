/**
 * Shared JSDoc type definitions for the Field Guide feature.
 * The site has no TypeScript build; these typedefs give editors and
 * `npm run fg:typecheck` something to verify against.
 */

/**
 * @typedef {'poweredOff'|'booting'|'mainMenu'|'browsingIndex'|'viewingRecord'|'returning'|'shuttingDown'} DeviceState
 */

/**
 * @typedef {Object} FieldGuideRecord
 * @property {string} id            e.g. "TEST-CR-001" (prototype data only)
 * @property {'creatures'|'artifacts'|'memories'} category
 * @property {string} title
 * @property {string[]} body
 */

/**
 * @typedef {Object} FgState
 * @property {DeviceState} device
 * @property {boolean} terminalActive   terminal input currently focused
 * @property {('creatures'|'artifacts'|'memories'|null)} category
 * @property {string|null} recordId
 * @property {number} selection        highlighted row in menu/index views
 */

/**
 * @typedef {Object} FgAction
 * @property {string} type
 * @property {string} [category]
 * @property {string} [id]
 * @property {string} [key]
 * @property {string} [raw]
 */

export {};
