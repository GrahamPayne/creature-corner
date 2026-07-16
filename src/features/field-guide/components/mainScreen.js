/**
 * Upper main screen renderer. Pure function of store state -> DOM,
 * drawn inside the mount positioned over the illustrated screen face.
 */

import { CATEGORIES, recordsInCategory } from '../data/records.js';

/** @typedef {import('../types/typedefs.js').FgState} FgState */

const MENU_ITEMS = Object.values(CATEGORIES);

/** @param {HTMLElement} mount */
export function createMainScreen(mount) {
  mount.classList.add('fg-main');

  /** @param {string} tag @param {string} cls @param {string} [text] */
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** @param {FgState} s */
  function render(s) {
    mount.textContent = '';
    mount.dataset.state = s.device;

    switch (s.device) {
      case 'poweredOff':
      case 'returning':
        return;

      case 'booting': {
        mount.appendChild(el('div', 'fg-main-title', 'FIELD GUIDE'));
        mount.appendChild(el('div', 'fg-main-sub', 'INITIALIZING'));
        return;
      }

      case 'shuttingDown': {
        mount.appendChild(el('div', 'fg-main-sub', 'POWERING DOWN'));
        return;
      }

      case 'mainMenu': {
        mount.appendChild(el('div', 'fg-main-title', 'FIELD GUIDE'));
        mount.appendChild(el('div', 'fg-main-sub', 'RECORD CATEGORIES'));
        const list = el('ul', 'fg-main-list');
        MENU_ITEMS.forEach((cat, i) => {
          const item = el('li', 'fg-main-item', `${i === s.selection ? '▸ ' : '  '}${cat.label}`);
          if (i === s.selection) item.classList.add('is-selected');
          list.appendChild(item);
        });
        mount.appendChild(list);
        mount.appendChild(el('div', 'fg-main-hint', 'TYPE A CATEGORY NAME BELOW'));
        return;
      }

      case 'browsingIndex': {
        const cat = s.category ? CATEGORIES[s.category] : null;
        if (!cat) return;
        const items = recordsInCategory(cat.key);
        mount.appendChild(el('div', 'fg-main-sub', cat.label));
        const list = el('ul', 'fg-main-list');
        items.forEach((r, i) => {
          const item = el('li', 'fg-main-item', `${i === s.selection ? '▸ ' : '  '}${r.id}`);
          if (i === s.selection) item.classList.add('is-selected');
          list.appendChild(item);
        });
        mount.appendChild(list);
        mount.appendChild(el('div', 'fg-main-hint', 'OPEN <ID> · BACK'));
        return;
      }

      case 'viewingRecord': {
        const items = s.category ? recordsInCategory(s.category) : [];
        const record = items.find((r) => r.id === s.recordId);
        if (!record) return;
        const n = items.indexOf(record) + 1;
        mount.appendChild(el('div', 'fg-main-sub', record.id));
        mount.appendChild(el('div', 'fg-main-title fg-main-record-title', record.title));
        const body = el('div', 'fg-main-body');
        record.body.forEach((line) => body.appendChild(el('div', 'fg-main-bodyline', line)));
        mount.appendChild(body);
        mount.appendChild(el('div', 'fg-main-hint', `${n}/${items.length} · NEXT · PREV · BACK`));
        return;
      }
    }
  }

  return { render };
}
