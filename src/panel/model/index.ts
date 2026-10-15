/**
 * P1 panel model barrel — pure logic: the data source, store, selectors and
 * formatting. May import only the L5 barrel ('../..') and re-exports it, so
 * the layers below need a single import path. No DOM, no timers, no globals,
 * no packages: fully unit-testable.
 */
export * from '../..';

export type { PanelDataEvent, PanelDataSource } from './panel-data-source';
