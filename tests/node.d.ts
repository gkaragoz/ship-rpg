// Minimal Node typing so asset-contract tests can read files without adding @types/node
// (the app itself targets the browser; vitest runs these tests in Node).
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
}
