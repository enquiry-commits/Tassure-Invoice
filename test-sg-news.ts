// Pins SG Latest News page behaviour (docs/INVARIANTS.md INV-DATA-077, Vincent 2026-10-07):
//   1. Cards sit on a fixed 4-column grid: a section with only 2 items keeps them at the 4-column
//      width and leaves the right-hand slots empty — it never stretches them to half the row each.
//      That is `repeat(auto-fill, …)`; `auto-fit` collapses the empty tracks and stretches.
//      (Measured in a real browser at 1668px: auto-fit gave 2 cards of 827px, auto-fill 407px — the
//      same width as a full row of 4.)
//
// Run: npx tsx test-sg-news.ts
import { readFileSync } from 'fs';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

// Code only: the explanatory comment next to CARD_GRID names "auto-fit" on purpose.
const page = readFileSync('app/sg-news/page.tsx', 'utf8').replace(/^\s*\/\/.*$/gm, '');
const grid = /const CARD_GRID = \{[^}]*gridTemplateColumns: '([^']+)'/.exec(page)?.[1] ?? '';

console.log('--- rule 1: the card grid ---');
check('the card grid is defined once, in CARD_GRID', grid !== '', 'CARD_GRID not found');
check('it is auto-FILL, so unused slots stay empty and 2 cards keep the 4-column width', /^repeat\(auto-fill,/.test(grid), grid);
check('it never uses auto-fit (which collapses empty tracks and stretches the cards)', !/auto-fit/.test(page), 'auto-fit found in app/sg-news/page.tsx');
check('four equal columns on a wide screen, never narrower than 240px', /minmax\(max\(240px, calc\(\(100% - 42px\) \/ 4\)\), 1fr\)/.test(grid), grid);
check('every section of cards uses CARD_GRID (no second hand-written grid)', !/gridTemplateColumns:/.test(page.replace(/const CARD_GRID = \{[^}]*\}/, '')), 'another gridTemplateColumns in the page');

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
