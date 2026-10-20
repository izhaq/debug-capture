/**
 * The hostile host's own behaviour (research §4, §3.4): the listeners and
 * recorders a real app has. Runs before the panel loads. Everything the tests
 * read lives on `window.__host`.
 */
const host = {
  /** Bubble listeners on window/document/body: must never see panel events (ISO-07). */
  bubbled: [],
  /** Capture listeners on document/body (CDK style): still see panel events (D-16, research E3). */
  captured: [],
  /** Global hotkeys with the usual "not while typing in an input" guard (research E4). */
  hotkeys: [],
  menuOpen: true,
  dialogOpen: true,
  copies: 0,
  violations: [],
  errors: [],
  bodyMutations: 0,
  defines: {},
  overlay: null,
};
window.__host = host;

const TYPES = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerover',
  'pointerout',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'touchstart',
  'touchmove',
  'touchend',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'focusin',
  'focusout',
  'copy',
  'cut',
  'paste',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'dragstart',
  'drag',
  'dragend',
  'dragover',
  'drop',
];
const isOurs = (event) => event.composedPath().some((n) => n.localName === 'debug-capture-panel-v2');
for (const type of TYPES) {
  for (const target of [window, document, document.body]) {
    target.addEventListener(type, (event) => {
      if (isOurs(event)) host.bubbled.push(`${type}@${target === window ? 'window' : target.nodeName}`);
    });
  }
  document.addEventListener(type, (event) => isOurs(event) && host.captured.push(type), true);
}

// "Click outside closes the menu" (research E2): the usual contains() check.
const menu = document.getElementById('menu');
document.getElementById('menu-button').addEventListener('click', () => (host.menuOpen = true));
document.addEventListener('click', (event) => {
  if (!menu.contains(event.target) && event.target.id !== 'menu-button') host.menuOpen = false;
});

// Global hotkeys with an input guard (research E4) and a CDK-style body Escape (E5).
document.addEventListener('keydown', (event) => {
  const t = event.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  host.hotkeys.push(event.key);
});
document.body.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') host.dialogOpen = false;
});

// A non-passive wheel blocker (research L10), clipboard, CSP, error and mutation recorders.
window.addEventListener('wheel', (event) => isOurs(event) || event.preventDefault(), { passive: false });
document.addEventListener('copy', () => host.copies++);
document.addEventListener('securitypolicyviolation', (event) =>
  host.violations.push(`${event.violatedDirective} ${event.blockedURI}`),
);
window.addEventListener('error', (event) => host.errors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => host.errors.push(String(event.reason)));
new MutationObserver((records) => (host.bodyMutations += records.length)).observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
});

// Count customElements.define per name (research D5: a second define would throw).
const define = customElements.define.bind(customElements);
customElements.define = (name, ctor, options) => {
  host.defines[name] = (host.defines[name] ?? 0) + 1;
  return define(name, ctor, options);
};

/** A full-screen, max z-index overlay appended after the panel (research L3). */
host.addOverlay = () => {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', () => (host.overlayClicks = (host.overlayClicks ?? 0) + 1));
  document.body.appendChild(overlay);
  host.overlay = overlay;
};
host.overlayClicks = 0;
