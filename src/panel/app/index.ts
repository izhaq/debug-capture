/**
 * P4 panel app barrel — the UI chunk's entry: `mountPanelUi` with the frame,
 * scheduler, settings storage and banners. May import only the P3 views
 * barrel and re-exports it. Loaded lazily: P5 reaches it only by
 * `import type` and one dynamic `import()`. No packages.
 */
export * from '../views';

export type { MountPanelUi, MountPanelUiOptions, PanelUiHandle } from './mount-panel-ui';
