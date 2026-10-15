// Generates public/sample/orders.csv: a synthetic e-commerce dataset with
// realistic, deliberately planted quality issues so every DataLens feature has
// something to find. Deterministic (seeded) so the demo is reproducible.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample', 'orders.csv');
const ROWS = 2000;
const DUPLICATES = 40;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261015);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
};
const gaussian = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const CITIES = [['Mumbai', 22], ['Delhi', 20], ['Bengaluru', 18], ['Hyderabad', 10], ['Pune', 10], ['Chennai', 9], ['Kolkata', 7], ['Ahmedabad', 4]];
const CATEGORIES = { Electronics: 2400, Fashion: 900, Home: 1300, Beauty: 450, Books: 350, Sports: 1100 };
const PAYMENTS = [['UPI', 55], ['Card', 25], ['COD', 12], ['NetBanking', 8]];

// Festive season (Oct–Nov) gets more orders.
function randomDate() {
  const start = Date.UTC(2024, 0, 1);
  const end = Date.UTC(2025, 11, 31);
  for (;;) {
    const d = new Date(start + rand() * (end - start));
    const m = d.getUTCMonth();
    const weight = m === 9 || m === 10 ? 1 : 0.55;
    if (rand() < weight) return d.toISOString().slice(0, 10);
  }
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = ['order_id', 'order_date', 'customer_id', 'city', 'category', 'quantity', 'unit_price', 'discount_pct', 'payment_method', 'delivery_days', 'is_returned', 'currency'];
const rows = [];

for (let i = 0; i < ROWS; i++) {
  const category = pick(Object.keys(CATEGORIES));
  let city = weighted(CITIES);
  const roll = rand();
  if (roll < 0.05) city = `  ${city} `; // untrimmed whitespace
  else if (roll < 0.06) city = ' '; // blank value

  let quantity = 1 + Math.floor(Math.abs(gaussian()) * 2.5);
  if (rand() < 0.01) quantity = -quantity; // impossible negative

  let price = CATEGORIES[category] * Math.exp(gaussian() * 0.45);
  if (rand() < 0.005) price *= 40; // extreme outlier
  price = Math.round(price * 100) / 100;

  const discount = rand() < 0.08 ? null : weighted([[0, 40], [5, 25], [10, 20], [15, 10], [25, 5]]);
  const payment = weighted(PAYMENTS);
  const delivery = rand() < 0.03 ? 'N/A' : String(1 + Math.floor(rand() * (payment === 'COD' ? 10 : 7)));
  const returned = rand() < (category === 'Fashion' ? 0.18 : 0.06);

  rows.push([
    `ORD-${100001 + i}`,
    randomDate(),
    `C${String(1 + Math.floor(rand() * 600)).padStart(4, '0')}`,
    city,
    category,
    quantity,
    price.toFixed(2),
    discount,
    payment,
    delivery,
    returned,
    'INR', // constant column
  ]);
}

// Exact duplicate rows, as produced by a re-run ingestion job.
for (let i = 0; i < DUPLICATES; i++) rows.splice(Math.floor(rand() * rows.length), 0, [...pick(rows)]);

const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv);
console.log(`Wrote ${rows.length} rows to ${OUT}`);
