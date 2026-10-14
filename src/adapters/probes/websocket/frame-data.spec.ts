import { bytesOf, toBase64, utf8Length } from './frame-data';

describe('websocket frame-data', () => {
  it('utf8Length counts multi-byte characters', () => {
    const encoder = new TextEncoder();
    const samples = ['', 'abc', 'héllo', '€', 'שלום', '日本語', '😀', 'a😀b€c', '\ud800', 'x\udc00y'];
    for (const text of samples) {
      expect(utf8Length(text)).withContext(JSON.stringify(text)).toBe(encoder.encode(text).length);
    }
  });

  it('toBase64 round-trips large buffers', () => {
    const size = 256 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = (i * 31 + 7) & 0xff;
    }

    const decoded = atob(toBase64(bytes));

    expect(decoded.length).toBe(size);
    let mismatches = 0;
    for (let i = 0; i < size; i++) {
      if (decoded.charCodeAt(i) !== bytes[i]) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });

  it('bytesOf respects typed-array views', () => {
    const buffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;

    expect(Array.from(bytesOf(buffer))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(bytesOf(new Uint8Array(buffer, 2, 3)))).toEqual([2, 3, 4]);
    expect(Array.from(bytesOf(new DataView(buffer, 5, 2)))).toEqual([5, 6]);
    // A wider element type: 1 element of 2 bytes, starting at byte 4.
    expect(Array.from(bytesOf(new Uint16Array(buffer, 4, 1)))).toEqual([4, 5]);
  });
});
