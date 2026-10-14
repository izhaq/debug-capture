/**
 * Download sink — saves text as a file. On a machine without DevTools this is
 * how a capture leaves the browser: the user hands the file to a developer.
 *
 * Takes a plain string and knows nothing about entries or serialization, so
 * the caller decides what goes in the file.
 */

/**
 * The globals the download touches. Injected so specs can pass fakes and never
 * start a real download.
 */
export interface DownloadHost {
  document: Pick<Document, 'createElement' | 'body'>;
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  /** Defers the object-URL revoke until after the click is processed. */
  defer(fn: () => void): void;
}

function realDownloadHost(): DownloadHost {
  return {
    document,
    URL,
    defer: (fn) => {
      setTimeout(fn, 0);
    },
  };
}

/**
 * Starts a browser download of `text` as `filename`.
 *
 * Uses a Blob object URL rather than a `data:` URL: no base64 bloat and no URL
 * length limit, which matters for a capture of thousands of entries.
 *
 * Throws if the click throws; the caller decides how to report that. The
 * anchor is removed and the object URL released either way, so a failed
 * download leaks nothing.
 */
export function downloadText(
  text: string,
  filename: string,
  mimeType = 'application/json',
  host: DownloadHost = realDownloadHost(),
): void {
  // Anchor first: if creating it throws, no object URL has been made to leak.
  const anchor = host.document.createElement('a');
  const url = host.URL.createObjectURL(new Blob([text], { type: mimeType }));
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    host.document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Revoking synchronously can cancel the download in some browsers: the
    // click only queues it, and the fetch of the blob URL happens later.
    host.defer(() => host.URL.revokeObjectURL(url));
  }
}
