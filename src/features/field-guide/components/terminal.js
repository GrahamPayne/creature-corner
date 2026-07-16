/**
 * Lower terminal screen: a real HTML input + scrolling history rendered
 * over the drawn terminal face. Never paints text into the artwork.
 */

/**
 * @param {HTMLElement} mount
 * @param {{ onCommand: (raw: string) => void, onFocusChange?: (focused: boolean) => void }} opts
 */
export function createTerminal(mount, opts) {
  mount.classList.add('fg-terminal');

  const history = document.createElement('div');
  history.className = 'fg-term-history';
  history.setAttribute('role', 'log');
  history.setAttribute('aria-live', 'polite');
  history.setAttribute('aria-label', 'Field Guide terminal output');

  const form = document.createElement('form');
  form.className = 'fg-term-form';

  const prompt = document.createElement('span');
  prompt.className = 'fg-term-prompt';
  prompt.textContent = '>';
  prompt.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.className = 'fg-term-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'characters';
  input.spellcheck = false;
  input.maxLength = 80;
  input.setAttribute('aria-label', 'Field Guide command input. Type HELP for available commands.');

  form.appendChild(prompt);
  form.appendChild(input);
  mount.appendChild(history);
  mount.appendChild(form);

  function scrollToEnd() {
    history.scrollTop = history.scrollHeight;
  }

  /** @param {string[]} lines @param {string} [cls] */
  function print(lines, cls = 'fg-term-line') {
    for (const line of lines) {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = line;
      history.appendChild(el);
    }
    scrollToEnd();
  }

  function clear() {
    history.textContent = '';
  }

  /** @param {boolean} enabled */
  function setEnabled(enabled) {
    input.disabled = !enabled;
    mount.classList.toggle('fg-terminal-off', !enabled);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value;
    input.value = '';
    if (!raw.trim()) return;
    print([`> ${raw.toUpperCase()}`], 'fg-term-line fg-term-echo');
    opts.onCommand(raw);
    // On small screens the enlarged typing overlay must return to the
    // illustrated layout once the command is submitted; on desktop keep
    // focus so several commands can be typed in a row.
    if (window.matchMedia('(max-width: 700px)').matches) input.blur();
    else input.focus();
  });

  // clicking/tapping anywhere on the terminal focuses the input
  mount.addEventListener('pointerdown', (e) => {
    if (e.target !== input && !input.disabled) {
      e.preventDefault();
      input.focus();
    }
  });

  input.addEventListener('focus', () => opts.onFocusChange?.(true));
  input.addEventListener('blur', () => {
    opts.onFocusChange?.(false);
    // the mobile zoom overlay changes the history height; re-pin to the end
    requestAnimationFrame(scrollToEnd);
  });

  setEnabled(false);
  return { print, clear, setEnabled, focus: () => input.focus(), input };
}
