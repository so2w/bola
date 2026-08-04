/**
 * Minimal Node.js ambient typings for the smoke test.
 *
 * Deliberately tiny: adds no @types/node dependency (keeps install to the
 * 4 pinned packages per design). Extend only if tests need more surface.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Buffer;
}

declare module 'node:path' {
  const path: {
    resolve(...segments: string[]): string;
    dirname(p: string): string;
    join(...segments: string[]): string;
  };
  export default path;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

/** Handful of Buffer members the smoke test actually uses. */
interface Buffer extends Uint8Array {
  subarray(start?: number, end?: number): Buffer;
  toString(encoding: 'ascii', start?: number, end?: number): string;
  readUInt32BE(offset: number): number;
}
