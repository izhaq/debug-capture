/**
 * Loaded once, before every spec file, by `scripts/bundle-specs.mjs`.
 * Initialises Angular's TestBed for the `src/angular/` specs. The other specs
 * do not touch Angular; zone.js is still loaded first for all of them, as in v1.
 */
import 'zone.js';
import 'zone.js/testing';
import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
