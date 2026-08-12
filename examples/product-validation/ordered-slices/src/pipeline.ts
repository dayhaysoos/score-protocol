export function baseMessage(name: string): string {
  const normalizedName = name.trim();
  return `Hello, ${normalizedName}`;
}

export function emphasizeMessage(name: string): string {
  return `${baseMessage(name).toUpperCase()}!`;
}

export function summarizePipeline(name: string): string {
  return `Result: ${emphasizeMessage(name)}`;
}
