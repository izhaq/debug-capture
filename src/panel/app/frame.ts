import {
  ButtonControl,
  CaptureController,
  CONSOLE_VIEW_CSS,
  createButton,
  createConsoleView,
  createDom,
  createHttpView,
  createIcon,
  createListeners,
  createLocalDataSource,
  createMenu,
  createPanelStore,
  createPopover,
  createTabs,
  createThemeSheet,
  createWsView,
  CreateView,
  HTTP_VIEW_CSS,
  IconName,
  isProblemEntry,
  JSON_VIEWER_CSS,
  ListId,
  PanelDataSource,
  PanelState,
  PanelView,
  ROW_HEIGHTS,
  selectListCounts,
  setAttr,
  VIEW_CSS,
  ViewDeps,
  ViewSettings,
  VIRTUAL_LIST_CSS,
  WS_VIEW_CSS,
} from '../views';
import { createEventQueue } from './event-queue';
import { FRAME_CSS } from './frame-css';
import { createLayout } from './layout';
import type { MountPanelUiOptions, PanelUiHandle } from './mount-panel-ui';
import { createScheduler, FrameScope } from './scheduler';
import {
  chipsOf,
  createSettingsStore,
  defaultSettings,
  Dock,
  PanelSettings,
  SettingsStorage,
  ThemeSetting,
  TimeSetting,
} from './settings';
import { createSettingsForm, SettingName, SettingsValues } from './settings-form';
import { createStatusBar } from './status-bar';
import { rootZone, Run } from './zone';

/** Everything the frame takes from the outside world; specs pass fakes (AGENTS rule 8). */
export interface FrameDeps {
  /** The view for each list (`createHttpView`, `createWsView`, `createConsoleView`). */
  readonly views: Readonly<Record<ListId, CreateView>>;
  /** Builds the data source; the page's own is `createLocalDataSource(controller)`. */
  readonly source: (controller: CaptureController) => PanelDataSource;
  readonly scope: FrameScope;
  /** Puts timers and frames in the root zone (ISO-09). */
  readonly run: Run;
  /** A monotonic clock in ms, for the 8 ms frame budget. */
  readonly now: () => number;
  /** `localStorage`, read lazily: reading it throws when storage is blocked. */
  readonly storage: () => SettingsStorage | null;
  /** Origin of relative time (`+12.345 s`). */
  readonly timeOrigin: number;
  /** Local minus UTC, for clock time. */
  readonly utcOffsetMinutes: number;
  readonly viewport: () => { readonly width: number; readonly height: number };
  /**
   * Whether the host page has a modal dialog open or is fullscreen (S08-12): Chrome makes
   * everything outside either one unclickable and unfocusable. Asked only while the panel is open.
   */
  readonly hasModalDialog: () => boolean;
  /** How often that is asked, ms. */
  readonly dialogCheckMs: number;
}

/** How often the open panel looks for a host modal dialog. */
export const DIALOG_CHECK_MS = 500;

/** The real outside world, from the host page's window. */
export function defaultFrameDeps(doc: Document): FrameDeps {
  const win = doc.defaultView;
  if (!win) throw new Error('The panel needs a document that has a window');
  const timeOrigin = win.performance.timeOrigin;
  return {
    views: { http: createHttpView, ws: createWsView, console: createConsoleView },
    source: (controller) => createLocalDataSource(controller),
    scope: {
      requestAnimationFrame: (callback) => win.requestAnimationFrame(callback),
      cancelAnimationFrame: (handle) => win.cancelAnimationFrame(handle),
      setTimeout: (callback, delayMs) => win.setTimeout(callback, delayMs),
      clearTimeout: (handle) => win.clearTimeout(handle),
    },
    run: rootZone(win),
    now: () => win.performance.now(),
    storage: () => win.localStorage,
    timeOrigin,
    utcOffsetMinutes: -new Date(timeOrigin).getTimezoneOffset(),
    viewport: () => ({ width: win.innerWidth, height: win.innerHeight }),
    // `:modal` matches a modal `<dialog>` and the fullscreen element. Light DOM only: one inside a
    // host component's shadow root is not seen (ISO-21 limit).
    hasModalDialog: () => doc.querySelector(':modal') !== null,
    dialogCheckMs: DIALOG_CHECK_MS,
  };
}

type NetworkList = 'http' | 'ws';

const LISTS: readonly ListId[] = ['http', 'ws', 'console'];
const PANEL_ID: Readonly<Record<ListId, string>> = {
  http: 'dcp-panel-http',
  ws: 'dcp-panel-ws',
  console: 'dcp-panel-console',
};

/**
 * The panel frame (S-08): title bar with tabs and toolbar, banners, the
 * Network sub-tabs, one view per list, the status bar; dock, resize and
 * maximize; settings and their storage; the once-per-frame scheduler.
 *
 * Data: one data source and one store per mount, one subscription; events
 * wait in a queue and are applied at most once per frame within the budget
 * (§4.4). Only the visible view gets `update`. Every callback runs in
 * `try/catch` and a failure is counted (`panel error N`), never logged
 * (NFR-REL-01, ISO-12). `unmount()` removes everything it added.
 */
export function mountFrame(
  root: ShadowRoot,
  controller: CaptureController,
  options: MountPanelUiOptions,
  deps: FrameDeps,
): PanelUiHandle {
  const disposers: Array<() => void> = [];
  const dispose = (): void => {
    for (let undo = disposers.pop(); undo; undo = disposers.pop()) {
      try {
        undo();
      } catch {
        // Keep undoing the rest.
      }
    }
  };
  try {
    build(root, controller, options, deps, disposers);
  } catch (error) {
    dispose();
    throw error;
  }
  let mounted = true;
  return {
    unmount(): void {
      if (!mounted) return;
      mounted = false;
      dispose();
    },
  };
}

function build(
  root: ShadowRoot,
  controller: CaptureController,
  options: MountPanelUiOptions,
  deps: FrameDeps,
  disposers: Array<() => void>,
): void {
  const doc = options.document;
  const panelRoot = options.panelRoot;
  const dom = createDom(doc);
  const later = (undo: () => void): void => {
    disposers.push(undo);
  };

  let errors = 0;
  /** Set while a frame runs: a failure there is shown by that frame's status bar, not by a new frame. */
  let framing = false;
  // Declared before anything can fail, so `report` always has a scheduler to wake.
  let invalidate = (): void => undefined;
  const report = (_error: unknown): void => {
    errors++;
    // A frame that fails every time must not ask for the next one (no endless redraw).
    if (!framing) invalidate();
  };
  const safely = (work: () => void): void => {
    try {
      work();
    } catch (error) {
      report(error);
    }
  };

  // Settings and data.
  const storage = createSettingsStore(deps.storage, options.storageKey, defaultSettings(options.defaultDock));
  let settings: PanelSettings = storage.load();
  const save = (): void => storage.save(settings);

  const source = deps.source(controller);
  const store = createPanelStore({ source, isProblemEntry, filters: settings.chips });
  const queue = createEventQueue(store, deps.now);
  // Subscribed in the same task as the store read its snapshot, so no event falls between (§6.3).
  later(
    source.subscribe((event) => {
      queue.push(event);
      // No frames in a background tab: never hold more than the buffer can (the store drops the oldest).
      if (queue.length > source.capacity()) safely(() => queue.flush());
      invalidate();
    }),
  );

  const scheduler = createScheduler(
    deps.scope,
    deps.run,
    () => {
      framing = true;
      try {
        frame();
      } catch (error) {
        report(error);
      } finally {
        framing = false;
      }
    },
    report,
  );
  later(() => scheduler.destroy());
  invalidate = () => scheduler.invalidate();
  later(store.subscribe(() => invalidate()));

  const listeners = createListeners(report);
  later(() => listeners.removeAll());

  // The stylesheet: appended after the loader's, never replacing it (C3-3).
  const sheet = createThemeSheet(doc, [
    VIRTUAL_LIST_CSS,
    JSON_VIEWER_CSS,
    FRAME_CSS,
    VIEW_CSS,
    HTTP_VIEW_CSS,
    WS_VIEW_CSS,
    CONSOLE_VIEW_CSS,
  ]);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  later(() => {
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
  });

  // Theme and text size live on the panel root (§4.10): Auto = no attribute, so CSS follows the OS.
  const applyLook = (): void => {
    setAttr(panelRoot, 'data-theme', settings.theme === 'auto' ? null : settings.theme);
    setAttr(panelRoot, 'data-text-size', settings.textSize === 'normal' ? null : settings.textSize);
  };
  applyLook();
  later(() => {
    setAttr(panelRoot, 'data-theme', null);
    setAttr(panelRoot, 'data-text-size', null);
  });

  const layout = createLayout(dom, {
    panelRoot,
    dock: settings.dock,
    height: settings.height,
    width: settings.width,
    viewport: deps.viewport,
    onResize: (dock, px) => {
      settings = dock === 'bottom' ? { ...settings, height: px } : { ...settings, width: px };
      save();
    },
    onError: report,
  });
  later(() => layout.destroy());

  // Controls. Each is destroyed on unmount; its listeners report errors instead of throwing.
  const controls: Array<{ destroy(): void }> = [];
  later(() => controls.forEach((c) => c.destroy()));
  const button = (
    label: string,
    icon: IconName,
    onClick: () => void,
    extra: { iconOnly?: boolean; className?: string } = {},
  ): ButtonControl => {
    const control = createButton(dom, { label, icon, onClick, onError: report, ...extra });
    // The name stays when a narrow dock hides the word (frame CSS).
    if (!extra.iconOnly) setAttr(control.element, 'aria-label', label);
    controls.push(control);
    return control;
  };
  const setIcon = (control: ButtonControl, icon: IconName): void => {
    const old = control.element.querySelector('.dcp-icon');
    if (old) control.element.replaceChild(createIcon(dom, icon), old);
  };

  const requestClose = (): void => options.onRequestClose();
  const viewFor = (): PanelView | null => views[active] ?? null;

  const paused = dom.el('span', { className: 'dcp-paused', attrs: { hidden: true } });
  const pause = button('Pause', 'pause', () => (store.getState().paused ? store.resume() : store.pause()));
  const capture = button('Capture', 'opened', () =>
    store.getState().captureOn ? source.capture.stop() : source.capture.start(),
  );
  const clear = button('Clear', 'clear', () => source.clear());
  const exportButton = button('Export', 'export', () => undefined);
  exportButton.element.append(createIcon(dom, 'chevron-down'));
  const exportMenu = createMenu(dom, {
    trigger: exportButton.element,
    ariaLabel: 'Export',
    items: [
      { id: 'download', label: 'Download all (JSON)' },
      { id: 'copy', label: 'Copy all (JSON)' },
    ],
    onSelect: (id) => {
      // Always the whole buffer — paused or not, whatever the filters (FR-BAR-04).
      if (id === 'download') source.download(root);
      else source.copyText(source.exportJson(), root).catch(report);
    },
    onError: report,
  });
  controls.push(exportMenu);
  const settingsButton = button('Settings', 'settings', () => undefined, { iconOnly: true });
  const form = createSettingsForm(dom, (name, value) => safely(() => changeSetting(name, value)), report);
  controls.push(form);
  const settingsPopover = createPopover(dom, {
    trigger: settingsButton.element,
    ariaLabel: 'Settings',
    content: [form.element],
    onError: report,
  });
  controls.push(settingsPopover);
  const maximize = button('Maximize panel', 'maximize', () => setMaximized(!layout.maximized), { iconOnly: true });
  const close = button('Close debug panel', 'close', requestClose, { iconOnly: true });

  // Tabs: Network (HTTP / WebSocket) and Console (FR-WIN-06).
  const top = createTabs(dom, {
    tabs: [
      { id: 'network', label: 'Network', panelId: 'dcp-panel-network' },
      { id: 'console', label: 'Console', panelId: PANEL_ID.console },
    ],
    ariaLabel: 'Panel sections',
    idPrefix: 'dcp-tab',
    onChange: (id) => show(id === 'console' ? 'console' : lastNetwork),
    onError: report,
  });
  controls.push(top);
  const sub = createTabs(dom, {
    tabs: [
      { id: 'http', label: 'HTTP', panelId: PANEL_ID.http },
      { id: 'ws', label: 'WebSocket', panelId: PANEL_ID.ws },
    ],
    ariaLabel: 'Network',
    idPrefix: 'dcp-subtab',
    onChange: (id) => show(id === 'ws' ? 'ws' : 'http'),
    onError: report,
  });
  controls.push(sub);

  const tabPanel = (id: string, labelledBy: string, children: HTMLElement[] = []): HTMLElement =>
    dom.el(
      'div',
      { className: 'dcp-tabpanel', attrs: { id, role: 'tabpanel', 'aria-labelledby': labelledBy } },
      children,
    );
  const panels: Record<ListId, HTMLElement> = {
    http: tabPanel(PANEL_ID.http, 'dcp-subtab-http'),
    ws: tabPanel(PANEL_ID.ws, 'dcp-subtab-ws'),
    console: tabPanel(PANEL_ID.console, 'dcp-tab-console'),
  };
  const network = tabPanel('dcp-panel-network', 'dcp-tab-network', [
    dom.el('div', { className: 'dcp-subbar' }, [sub.element]),
    panels.http,
    panels.ws,
  ]);

  // Banners (§4.11).
  const turnOn = button('Turn on', 'opened', () => source.capture.start());
  const banner = (text: string, action?: ButtonControl): HTMLElement =>
    dom.el('div', { className: 'dcp-banner', attrs: { role: 'status', hidden: true } }, [
      dom.el('span', { className: 'dcp-banner__text' }, [text]),
      action ? action.element : null,
    ]);
  const captureBanner = banner('Capture is off — nothing new is recorded.', turnOn);
  const dialogBanner = banner(
    'The page has a dialog open or is fullscreen. The panel can be seen but not used until it closes.',
  );

  const status = createStatusBar(dom);
  const frameElement = dom.el('div', { className: 'dcp-frame' }, [
    layout.handle,
    dom.el('header', { className: 'dcp-titlebar' }, [
      dom.el('span', { className: 'dcp-title' }, [createIcon(dom, 'brand'), dom.el('span', null, ['Debug'])]),
      top.element,
      dom.el('div', { className: 'dcp-toolbar', attrs: { role: 'toolbar', 'aria-label': 'Panel actions' } }, [
        paused,
        pause.element,
        capture.element,
        clear.element,
        exportMenu.element,
        settingsPopover.element,
        maximize.element,
        close.element,
      ]),
    ]),
    captureBanner,
    dialogBanner,
    dom.el('div', { className: 'dcp-body' }, [network, panels.console]),
    status.element,
  ]);

  // Views: created on first show and kept (S08-03).
  const views: Partial<Record<ListId, PanelView>> = {};
  const failed = new Set<ListId>();
  later(() => {
    for (const list of LISTS) safely(() => views[list]?.destroy());
  });
  const viewSettings = (): ViewSettings => ({
    time:
      settings.time === 'clock'
        ? { mode: 'clock', utcOffsetMinutes: deps.utcOffsetMinutes }
        : { mode: 'relative', origin: deps.timeOrigin },
    rowHeight: ROW_HEIGHTS[settings.textSize] as ViewSettings['rowHeight'],
    dock: settings.dock,
  });
  const ensureView = (list: ListId): void => {
    if (views[list] || failed.has(list)) return;
    const viewDeps: ViewDeps = {
      document: doc,
      root,
      source,
      store,
      settings: viewSettings(),
      requestFrame: (callback) => scheduler.requestFrame(callback),
      schedule: scheduler.schedule,
      report,
    };
    try {
      const view = deps.views[list](viewDeps);
      views[list] = view;
      panels[list].appendChild(view.element);
    } catch (error) {
      failed.add(list);
      report(error);
    }
  };
  const pushSettings = (): void => {
    const next = viewSettings();
    for (const list of LISTS) {
      const view = views[list];
      if (view) safely(() => view.applySettings(next));
    }
  };

  let active: ListId = settings.tab;
  let lastNetwork: NetworkList = settings.tab === 'ws' ? 'ws' : 'http';
  let viewStale = true;
  const show = (list: ListId): void => {
    active = list;
    if (list !== 'console') lastNetwork = list;
    top.select(list === 'console' ? 'console' : 'network');
    sub.select(lastNetwork);
    network.hidden = list === 'console';
    panels.console.hidden = list !== 'console';
    panels.http.hidden = list !== 'http';
    panels.ws.hidden = list !== 'ws';
    ensureView(list);
    viewStale = true;
    invalidate();
    if (settings.tab !== list) {
      settings = { ...settings, tab: list };
      save();
    }
  };

  const setMaximized = (on: boolean): void => {
    layout.setMaximized(on);
    maximize.setLabel(on ? 'Restore panel size' : 'Maximize panel');
    setAttr(maximize.element, 'aria-pressed', on ? 'true' : 'false');
  };

  const formValues = (captureOn: boolean): SettingsValues => ({
    theme: settings.theme,
    dock: settings.dock,
    textSize: settings.textSize,
    time: settings.time,
    capture: captureOn ? 'on' : 'off',
  });
  const changeSetting = (name: SettingName, value: string): void => {
    if (name === 'capture') {
      if (value === 'on') source.capture.start();
      else source.capture.stop();
      return;
    }
    if (name === 'theme') settings = { ...settings, theme: value as ThemeSetting };
    else if (name === 'textSize') settings = { ...settings, textSize: value as PanelSettings['textSize'] };
    else if (name === 'time') settings = { ...settings, time: value as TimeSetting };
    else if (name === 'dock') {
      settings = { ...settings, dock: value as Dock };
      layout.setDock(settings.dock);
    }
    applyLook();
    if (name !== 'theme') pushSettings();
    save();
  };

  // Keys inside the panel (§4.12). On the panel root: the loader focuses the root itself.
  listeners.on(panelRoot, 'keydown', (event) => {
    if (event.defaultPrevented) return;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    // Escape that ends an IME composition belongs to the input method.
    if (event.key === 'Escape' && plain && !event.isComposing) {
      // Innermost first: the view's own menu or detail, then our popups, then the panel (FR-WIN-05).
      event.preventDefault();
      const view = viewFor();
      let handled = false;
      // A failing view must not keep the panel from closing.
      if (view) safely(() => (handled = view.handleEscape() === true));
      if (handled) return;
      if (settingsPopover.isOpen) settingsPopover.close();
      else if (exportMenu.isOpen) exportMenu.close();
      else requestClose();
    } else if (event.code === 'KeyF' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      // No view to search in: the browser keeps its own Find.
      const view = viewFor();
      if (!view) return;
      event.preventDefault();
      safely(() => view.focusFilter());
    } else if (
      (event.code === 'Digit1' || event.code === 'Digit2') &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      show(event.code === 'Digit1' ? lastNetwork : 'console');
      // Focus may have been inside the view just hidden: keep it in the panel.
      top.focus();
    }
  });

  // The host modal dialog check runs only while mounted, on our timer (S08-12, ISO-21).
  let dialogOpen = false;
  let dialogFailed = false;
  const checkDialog = (): void => {
    let open = false;
    try {
      open = deps.hasModalDialog() === true;
    } catch (error) {
      // Counted once: a check that always fails would raise the count every 500 ms.
      if (!dialogFailed) report(error);
      dialogFailed = true;
    }
    if (open !== dialogOpen) {
      dialogOpen = open;
      dialogBanner.hidden = !open;
    }
    scheduler.schedule(checkDialog, deps.dialogCheckMs);
  };

  // One render per frame, after at most one apply.
  let shownState: PanelState | null = null;
  // The chips the store started with came from storage: nothing to write until they change.
  let savedFilters: PanelState['filters'] = store.getState().filters;
  let shownPaused: string | null = null;
  let shownCapture: boolean | null = null;
  const frame = (): void => {
    // A failing apply must not skip the rest of the frame: the status bar shows the count.
    let more = false;
    safely(() => (more = queue.flush()));
    if (more) invalidate();
    const state = store.getState();
    const view = viewFor();
    if (view && (state !== shownState || viewStale)) {
      shownState = state;
      viewStale = false;
      safely(() => view.update(state));
    }
    const counts = selectListCounts(state, active);
    status.update({
      shown: counts.shown,
      total: counts.total,
      problems: state.buffer.problems,
      used: state.buffer.used,
      capacity: state.buffer.capacity,
      dropped: state.buffer.dropped,
      evicted: state.buffer.evicted,
      captureOn: state.captureOn,
      errors,
    });
    const pausedText = state.paused ? `Paused · ${state.newSincePause} new` : '';
    if (pausedText !== shownPaused) {
      shownPaused = pausedText;
      paused.textContent = pausedText;
      paused.hidden = !state.paused;
      pause.setLabel(state.paused ? 'Resume' : 'Pause');
      setAttr(pause.element, 'aria-label', state.paused ? 'Resume' : 'Pause');
      setIcon(pause, state.paused ? 'resume' : 'pause');
    }
    if (state.captureOn !== shownCapture) {
      shownCapture = state.captureOn;
      setAttr(capture.element, 'aria-pressed', state.captureOn ? 'true' : 'false');
      setAttr(capture.element, 'title', state.captureOn ? 'Capture is on: click to stop recording' : 'Capture is off');
      setIcon(capture, state.captureOn ? 'opened' : 'off');
      captureBanner.hidden = state.captureOn;
      form.set(formValues(state.captureOn));
    }
    // Chips are kept (§4.10); a change of search text alone writes nothing.
    if (state.filters !== savedFilters) {
      savedFilters = state.filters;
      settings = { ...settings, chips: chipsOf(state.filters) };
      save();
    }
  };

  setMaximized(false);
  show(active);
  form.set(formValues(store.getState().captureOn));
  panelRoot.appendChild(frameElement);
  later(() => frameElement.remove());
  checkDialog();
}
