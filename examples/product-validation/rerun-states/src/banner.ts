import { themeName } from "./theme.js";

export function bannerText(): string {
  return `Theme: ${themeName()}`;
}
