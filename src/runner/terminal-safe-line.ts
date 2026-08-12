export const MAX_TERMINAL_SAFE_LINE_LENGTH = 160;

function consumeControlSequence(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code < 0x30 || code > 0x3f) break;
    cursor += 1;
  }
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code < 0x20 || code > 0x2f) break;
    cursor += 1;
  }
  if (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) cursor += 1;
  }
  return cursor;
}

function consumeControlString(
  value: string,
  start: number,
  bellTerminates: boolean
): number {
  let cursor = start;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code === 0x9c || (bellTerminates && code === 0x07)) return cursor + 1;
    if (code === 0x1b && value.charCodeAt(cursor + 1) === 0x5c) {
      return cursor + 2;
    }
    cursor += 1;
  }
  return cursor;
}

function stripTerminalEscapeSequences(value: string): string {
  let safe = "";
  let cursor = 0;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code === 0x1b) {
      const next = value.charCodeAt(cursor + 1);
      if (next === 0x5b) {
        cursor = consumeControlSequence(value, cursor + 2);
        continue;
      }
      if (
        next === 0x5d ||
        next === 0x50 ||
        next === 0x58 ||
        next === 0x5e ||
        next === 0x5f
      ) {
        cursor = consumeControlString(value, cursor + 2, next === 0x5d);
        continue;
      }
      cursor += 1;
      while (cursor < value.length) {
        const intermediate = value.charCodeAt(cursor);
        if (intermediate < 0x20 || intermediate > 0x2f) break;
        cursor += 1;
      }
      if (cursor < value.length) {
        const final = value.charCodeAt(cursor);
        if (final >= 0x30 && final <= 0x7e) cursor += 1;
      }
      continue;
    }
    if (code === 0x9b) {
      cursor = consumeControlSequence(value, cursor + 1);
      continue;
    }
    if (
      code === 0x90 ||
      code === 0x98 ||
      code === 0x9d ||
      code === 0x9e ||
      code === 0x9f
    ) {
      cursor = consumeControlString(value, cursor + 1, code === 0x9d);
      continue;
    }
    safe += value[cursor];
    cursor += 1;
  }
  return safe;
}

export function terminalSafeLine(
  value: string,
  maximumLength = MAX_TERMINAL_SAFE_LINE_LENGTH
): string {
  const singleLine = stripTerminalEscapeSequences(value)
    .replace(/[\u0000-\u001F\u007F-\u009F]|\p{Cf}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(singleLine);
  if (characters.length <= maximumLength) return singleLine;
  if (maximumLength <= 0) return "";
  if (maximumLength === 1) return "…";
  return `${characters.slice(0, maximumLength - 1).join("")}…`;
}
