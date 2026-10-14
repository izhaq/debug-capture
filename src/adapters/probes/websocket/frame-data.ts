/**
 * Byte-level helpers for WebSocket frames. Module-internal: the barrel does
 * not export them.
 */

/**
 * Byte length of `text` once UTF-8 encoded — what actually goes over the
 * wire for a text frame. Counted from the UTF-16 code units so a busy socket
 * does not allocate an encoded copy of every frame just to measure it.
 * Lone surrogates count as 3 bytes, because encoders replace them with
 * U+FFFD.
 *
 * Duplicates the helper in the http probe on purpose: sibling probe modules
 * may not import each other (layer rule 4), and core is not the place for
 * byte counting. Two tiny copies is the price of the rule.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Chunk size for String.fromCharCode. Spreading a whole 1 MB frame into one
 * call would blow the engine's argument limit; 32 k arguments is well
 * inside it on every engine.
 */
const CHUNK = 0x8000;

/** Base64 of `bytes`, safe for large frames. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The bytes a send of `data` puts on the wire. For a view that is only the
 * window `byteOffset .. byteOffset + byteLength`, not its whole buffer.
 */
export function bytesOf(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}
