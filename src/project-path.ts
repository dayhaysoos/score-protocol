import { isAbsolute, posix } from "node:path";

export function normalizeProjectRelativePath(path: string): string | undefined {
  const normalized = posix.normalize(path);
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== path
  ) {
    return undefined;
  }
  return normalized;
}
