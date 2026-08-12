import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import jsonValidator from "json-dup-key-validator";

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`Invalid Unicode surrogate at ${path}`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`Invalid Unicode surrogate at ${path}`);
    }
  }
}

export function assertIJson(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "string") {
    assertValidUnicode(value, path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError(`Unsafe integer at ${path}`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported JSON value at ${path}`);
  }
  if (seen.has(value)) {
    throw new TypeError(`Circular JSON value at ${path}`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertIJson(entry, `${path}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertValidUnicode(key, `${path} property name`);
      assertIJson(entry, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function canonicalJson(value: unknown): string {
  assertIJson(value);
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new TypeError("Value cannot be represented as RFC 8785 canonical JSON");
  }
  return serialized;
}

export function parseJsonNoDuplicateKeys(text: string): unknown {
  const parsed = jsonValidator.parse(text, false);
  assertIJson(parsed);
  return parsed;
}

export function sha256Bytes(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sha256Json(value: unknown): string {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}
