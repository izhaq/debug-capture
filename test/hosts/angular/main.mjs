/**
 * Angular 16 test host (S10-01, NFR-PORT-01). It starts debug capture
 * exactly as HLD §6.6 shows, then bootstraps a standalone component with the
 * Angular seam. JIT, so no Angular build step: `@angular/compiler` compiles
 * the template at start-up. The package bans decorator syntax, so
 * `Component(…)` is called as a plain function — what `@Component` does.
 */
import '@angular/compiler';
import 'zone.js';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Component, enableProdMode, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { createCaptureController, isDebugRequested } from 'debug-capture';
import { provideDebugCapture, provideDebugCaptureSession } from 'debug-capture/angular';
import { installDebugPanel } from 'debug-capture/panel';

const controller = isDebugRequested() ? createCaptureController() : null;
installDebugPanel(controller);
// For the e2e test only: null when the flag is off.
window.__hostSession = controller?.session ?? null;

class AppComponent {
  http = inject(HttpClient);
  reply = 'none';

  load() {
    this.http.get('/api/ping').subscribe((body) => (this.reply = JSON.stringify(body)));
  }

  fail() {
    throw new Error('angular host failure');
  }
}
Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <h1>Angular host</h1>
    <p id="framework">Angular 16 host</p>
    <input id="host-input" aria-label="Host input" />
    <button id="host-request" type="button" (click)="load()">Request</button>
    <button id="host-fail" type="button" (click)="fail()">Fail</button>
    <p id="host-reply">{{ reply }}</p>
  `,
})(AppComponent);

// A production build, as on the stations (BR-02).
enableProdMode();
bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideDebugCapture(), provideDebugCaptureSession(controller?.session ?? null)],
}).then(
  () => (window.__hostReady = true),
  (error) => (window.__hostError = String(error)),
);
