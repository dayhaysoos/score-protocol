import type { Product } from "./product.js";
import { formatProduct } from "./format-product.js";

export function summarizeCatalog(products: readonly Product[]): string {
  const featured = products.filter((product) => product.featured);
  if (featured.length === 0) {
    return "No featured products";
  }
  const header =
    featured.length === 1
      ? "1 featured product"
      : `${featured.length} featured products`;
  return [header, ...featured.map(formatProduct)].join("\n");
}
