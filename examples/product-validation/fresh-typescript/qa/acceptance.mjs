import assert from "node:assert/strict";

import { summarizeCatalog } from "../dist/catalog-summary.js";
import { formatProduct } from "../dist/format-product.js";

const products = [
  { id: "tea", name: "Tea", priceCents: 425, featured: true },
  { id: "mug", name: "Mug", priceCents: 1299, featured: false },
  { id: "cake", name: "Cake", priceCents: 650, featured: true }
];

assert.equal(formatProduct(products[0]), "Tea — $4.25");
assert.equal(
  summarizeCatalog(products),
  "2 featured products\nTea — $4.25\nCake — $6.50"
);
assert.equal(summarizeCatalog([]), "No featured products");
process.stdout.write("Fresh TypeScript acceptance passed.\n");
