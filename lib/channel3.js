// Channel3 product catalog (@channel3/sdk): independent product facts for "not as described" disputes.
// PayPal Seller Protection does not cover "not as described", so the seller must show the item
// matched its listing. Catalog facts (brand, materials, key features, attributes such as size or
// color) become a citable evidence record that is not just the seller's own word.
import { Channel3 } from '@channel3/sdk';

const KEY = process.env.CHANNEL3_API_KEY;
export const CHANNEL3_ON = !!KEY;
const client = KEY ? new Channel3({ apiKey: KEY, ...(process.env.CHANNEL3_BASE_URL ? { baseUrl: process.env.CHANNEL3_BASE_URL } : {}) }) : null;

// Demo facts so the feature is visible without a key. Clearly labelled demo in the record.
const DEMO = {
  'Vintage denim jacket': { id: 'demo-c3-jacket', title: "Vintage denim trucker jacket (men's)", brand: 'Demo Denim Co.',
    attributes: { size: ['M (chest 38-40 in)'], color: ['Medium wash blue'] }, materials: ['100% cotton denim'], features: ['Button front', 'Two chest pockets'] },
  'Phone case (wrong color)': { id: 'demo-c3-case', title: 'Slim silicone phone case', brand: 'Demo Cases',
    attributes: { color: ['Red', 'Blue', 'Black'] }, materials: ['Silicone'], features: ['Sold in three colors'] },
};

const cache = new Map();
const pick = (p) => ({
  id: p.id,
  title: p.title,
  brand: (p.brands || []).map((b) => b.name).join(', ') || undefined,
  category: p.category?.name,
  attributes: Object.fromEntries(Object.entries(p.structured_attributes || {}).slice(0, 6).map(([k, v]) => [k, (v || []).slice(0, 4)])),
  materials: (p.materials || []).slice(0, 4),
  features: (p.key_features || []).slice(0, 4),
});

// Returns catalog facts for an item name, or null. Never throws: evidence is best effort.
export async function catalogFacts(itemName) {
  if (!itemName) return null;
  if (!CHANNEL3_ON) return DEMO[itemName] ? { ...DEMO[itemName], demo: true } : null;
  if (cache.has(itemName)) return cache.get(itemName);
  try {
    const page = await client.products.search({ query: itemName, limit: 1 });
    const p = page.data?.[0];
    const facts = p ? pick(p) : null;
    cache.set(itemName, facts);
    return facts;
  } catch (e) {
    console.warn('Channel3 lookup failed:', e.message?.slice(0, 160));
    return null;
  }
}
