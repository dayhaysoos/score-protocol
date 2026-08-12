export function optionValue(
  argumentsList: ReadonlyArray<string>,
  name: string
): string | undefined {
  const index = argumentsList.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = argumentsList[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for --${name} option`);
  }
  return value;
}
