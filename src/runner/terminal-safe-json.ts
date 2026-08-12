const TERMINAL_UNSAFE_JSON_CHARACTER = /[\u007f-\u009f\u2028\u2029]|\p{Cf}/gu;

function unicodeEscape(character: string): string {
  const codePoint = character.codePointAt(0)!;
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  }
  const offset = codePoint - 0x10000;
  const high = 0xd800 + (offset >> 10);
  const low = 0xdc00 + (offset & 0x3ff);
  return `\\u${high.toString(16).padStart(4, "0")}\\u${low
    .toString(16)
    .padStart(4, "0")}`;
}

/**
 * Serialize unchanged JSON data while escaping characters that a terminal may
 * interpret or reorder. JSON parsing recovers the exact original values.
 */
export function terminalSafeJson(value: unknown, space?: string | number): string {
  const serialized = JSON.stringify(value, null, space) ?? "undefined";
  return serialized.replace(TERMINAL_UNSAFE_JSON_CHARACTER, unicodeEscape);
}
