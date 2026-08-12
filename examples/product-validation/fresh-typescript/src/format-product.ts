import type { Product } from "./product.js";

export function formatProduct(product: Product): string {
  const dollars = (product.priceCents / 100).toFixed(2);
  return `${product.name} — $${dollars}`;
}
