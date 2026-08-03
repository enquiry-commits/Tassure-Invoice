// Shared casing rule for any staff/contact-name-shaped text across the app
// (email greetings, Master List/AR Reminder PIC-style columns, ...): a
// Chinese string is copied through untouched (Chinese has no case), an
// English/romanized string is title-cased per word regardless of how it was
// entered — e.g. raw "TAN QUINI" or "seow jin sheng" both become
// "Tan Quini" / "Seow Jin Sheng".
const CJK_PATTERN = /[一-鿿㐀-䶿豈-﫿]/;

export function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || CJK_PATTERN.test(trimmed)) return trimmed;
  return trimmed
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
