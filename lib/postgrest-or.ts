// Typed search text inside a PostgREST `.or()` filter string. A comma ends one
// condition and starts the next, so searching "Han Kun, LLP" made PostgREST
// fail with 'failed to parse logic tree' (a 500 from the Companies, Master
// List and AR Reminder search boxes; found by the 2026-10-06 council review
// and reproduced — brackets and quotes alone never broke it). A value wrapped
// in double quotes may contain , . : ( ) — only \ and " need an escape.
// `%` and `_` stay LIKE wildcards, exactly as when the text was unquoted.
// Pure — never put typed text into `.or()` any other way (guarded by
// test-postgrest-or.ts).

export function ilikeAny(columns: string[], term: string): string {
  const value = `"%${term.replace(/[\\"]/g, ch => `\\${ch}`)}%"`;
  return columns.map(column => `${column}.ilike.${value}`).join(',');
}
