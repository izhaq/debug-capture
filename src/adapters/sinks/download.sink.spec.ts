import { DownloadHost, downloadText } from './download.sink';

/**
 * Snapshot of the anchor at the moment it was clicked — the attributes and
 * attachment that matter are only observable then, since it is removed right
 * after.
 */
interface ClickSnapshot {
  href: string;
  download: string;
  rel: string;
  display: string;
  attached: boolean;
}

describe('downloadText', () => {
  let doc: Document;
  let deferred: Array<() => void>;
  let createObjectURL: jasmine.Spy;
  let revokeObjectURL: jasmine.Spy;
  let click: jasmine.Spy;
  let host: DownloadHost;

  beforeEach(() => {
    // An inert document (no browsing context): the anchor can never navigate,
    // and the real page's DOM is never touched.
    doc = document.implementation.createHTMLDocument('download-sink-spec');
    deferred = [];
    createObjectURL = jasmine.createSpy('createObjectURL').and.returnValue('blob:fake-url');
    revokeObjectURL = jasmine.createSpy('revokeObjectURL');
    // Belt and braces: no anchor click is ever real during these specs.
    click = spyOn(HTMLAnchorElement.prototype, 'click');
    host = {
      document: doc,
      URL: { createObjectURL, revokeObjectURL },
      defer: (fn) => deferred.push(fn),
    };
  });

  function flushDeferred(): void {
    deferred.splice(0).forEach((fn) => fn());
  }

  function blobPassedToCreateObjectURL(): Blob {
    const arg: unknown = createObjectURL.calls.mostRecent().args[0];
    if (!(arg instanceof Blob)) {
      throw new Error('createObjectURL was not called with a Blob');
    }
    return arg;
  }

  it('creates a blob with the given text and MIME type', async () => {
    downloadText('a,b\n1,2', 'data.csv', 'text/csv', host);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = blobPassedToCreateObjectURL();
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toBe('a,b\n1,2');
  });

  it('clicks a hidden anchor with the filename, then removes it', () => {
    let snapshot: ClickSnapshot | undefined;
    click.and.callFake(function (this: HTMLAnchorElement) {
      snapshot = {
        href: this.href,
        download: this.download,
        rel: this.rel,
        display: this.style.display,
        attached: this.parentNode === doc.body,
      };
    });

    downloadText('{}', 'capture.json', 'application/json', host);

    expect(click).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      href: 'blob:fake-url',
      download: 'capture.json',
      rel: 'noopener',
      display: 'none',
      attached: true,
    });
    expect(doc.body.childNodes.length).toBe(0);
  });

  it('revokes the object URL only after deferral', () => {
    downloadText('{}', 'capture.json', 'application/json', host);

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(deferred.length).toBe(1);

    flushDeferred();

    expect(revokeObjectURL).toHaveBeenCalledOnceWith('blob:fake-url');
  });

  it('cleans up even if click throws, and rethrows', () => {
    click.and.throwError('click blocked');

    expect(() => downloadText('{}', 'capture.json', 'application/json', host)).toThrowError(
      'click blocked',
    );

    expect(doc.body.childNodes.length).toBe(0);
    flushDeferred();
    expect(revokeObjectURL).toHaveBeenCalledOnceWith('blob:fake-url');
  });

  it('defaults the MIME type to application/json', () => {
    downloadText('{}', 'capture.json', undefined, host);

    expect(blobPassedToCreateObjectURL().type).toBe('application/json');
  });
});
