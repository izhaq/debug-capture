/**
 * React 19 test host (S10-02, NFR-PORT-01). It starts debug capture exactly
 * as HLD §6.6 shows (2.2: the activation piece), waits for it, then creates
 * the root with the React seam (a session getter, FR-BG-10), so errors React
 * catches reach the recorder. Plain `createElement`, no JSX: the host
 * needs no compile step beyond the bundle.
 */
import { Component, createElement as h, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { installDebugActivation } from 'debug-capture/activate';
import { createReactRootErrorOptions } from 'debug-capture/react';

const debug = installDebugActivation();
// For the e2e tests only: the session (null while off) and the handle.
Object.defineProperty(window, '__hostSession', { get: () => debug.session });
window.__debug = debug;

/** Shows a fallback instead of the child that threw; React then calls the root's `onCaughtError`. */
class Boundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? h('p', { id: 'host-fallback' }, 'Something failed') : this.props.children;
  }
}

function Thrower() {
  throw new Error('react host failure');
}

function App() {
  const [reply, setReply] = useState('none');
  const [failing, setFailing] = useState(false);
  const load = () =>
    fetch('/api/ping')
      .then((response) => response.json())
      .then((body) => setReply(JSON.stringify(body)));
  return h(
    'main',
    null,
    h('h1', null, 'React host'),
    h('p', { id: 'framework' }, 'React 19 host'),
    h('input', { id: 'host-input', 'aria-label': 'Host input' }),
    h('button', { id: 'host-request', type: 'button', onClick: load }, 'Request'),
    h('button', { id: 'host-fail', type: 'button', onClick: () => setFailing(true) }, 'Fail'),
    h('p', { id: 'host-reply' }, reply),
    h(Boundary, null, failing ? h(Thrower) : null),
  );
}

debug.ready.then(() => {
  const root = createRoot(
    document.getElementById('root'),
    createReactRootErrorOptions(() => debug.session),
  );
  flushSync(() => root.render(h(App)));
  window.__hostReady = true;
});
