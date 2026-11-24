import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";

// Reads a public store page and returns the product name, photo and price it advertises.
// Only public http(s) hosts are fetched, so the route can't be pointed at this machine or the local network.

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

function privateAddress(address: string) {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw Error("Use an http or https link.");
  if (url.username || url.password) throw Error("Use a link without a username or password.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{address: host}] : await lookup(host, {all: true});
  if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw Error("That link doesn’t point to a public store page.");
}

async function fetchPage(start: URL) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const response = await fetch(url, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"},
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) { url = new URL(location, url); continue; }
    if (!response.ok) throw Error("The store returned " + response.status + ". Enter the details yourself.");
    if (!(response.headers.get("content-type") ?? "").includes("html")) throw Error("That link isn’t a web page.");
    const reader = response.body?.getReader();
    if (!reader) throw Error("The store page was empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    void reader.cancel().catch(() => {});
    return {html: new TextDecoder().decode(Buffer.concat(chunks)), url};
  }
  throw Error("The link redirected too many times.");
}

const entities: Record<string, string> = {amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " "};
const decode = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, code: string) =>
  code[0] === "#" ? String.fromCodePoint(parseInt(code.slice(code[1].toLowerCase() === "x" ? 2 : 1), code[1].toLowerCase() === "x" ? 16 : 10)) : entities[code.toLowerCase()] ?? match).replace(/\s+/g, " ").trim();

function meta(html: string, ...keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content && keys.includes(key)) return decode(content);
  }
}

type Json = Record<string, unknown>;
function findProduct(node: unknown): Json | undefined {
  if (Array.isArray(node)) { for (const item of node) { const found = findProduct(item); if (found) return found; } return; }
  if (!node || typeof node !== "object") return;
  const record = node as Json;
  const type = record["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return record;
  return findProduct(record["@graph"]) ?? findProduct(record.mainEntity);
}
const firstImage = (image: unknown): string | undefined =>
  typeof image === "string" ? image : Array.isArray(image) ? firstImage(image[0]) : image && typeof image === "object" ? firstImage((image as Json).url ?? (image as Json).contentUrl) : undefined;
function offerPrice(offers: unknown): string | undefined {
  if (Array.isArray(offers)) { for (const offer of offers) { const price = offerPrice(offer); if (price) return price; } return; }
  if (!offers || typeof offers !== "object") return;
  const offer = offers as Json;
  const price = offer.price ?? offer.lowPrice ?? (offer.priceSpecification as Json | undefined)?.price;
  return price === undefined || price === null ? offerPrice(offer.offers) : String(price);
}

function parse(html: string, base: URL) {
  let product: Json | undefined;
  for (const [, body] of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { product = findProduct(JSON.parse(body.trim())); } catch { /* stores sometimes ship invalid JSON-LD */ }
    if (product) break;
  }
  const name = (typeof product?.name === "string" ? decode(product.name) : undefined) ?? meta(html, "og:title", "twitter:title") ??
    decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const image = firstImage(product?.image) ?? meta(html, "og:image", "og:image:secure_url", "twitter:image", "image");
  const rawPrice = offerPrice(product?.offers) ?? meta(html, "product:price:amount", "og:price:amount", "price") ??
    /itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([\d.,]+)/i.exec(html)?.[1] ??
    /"currentPrice"\s*:\s*\{[^{}]*?"price"\s*:\s*"?([\d.]+)/.exec(html)?.[1];
  const price = rawPrice ? Number(rawPrice.replace(/[^\d.]/g, "")) : NaN;
  let imageUrl: string | undefined;
  try { const resolved = image ? new URL(image, base) : undefined; if (resolved && /^https?:$/.test(resolved.protocol)) imageUrl = resolved.href; } catch { /* ignore bad image URLs */ }
  // "PS5 Console - Walmart.com" → "PS5 Console"
  const site = meta(html, "og:site_name") ?? base.hostname.replace(/^www\./, "");
  const cleaned = name.replace(/\s*[|\-–—:]\s*([^|\-–—:]+)$/, (tail, last: string) =>
    last.toLowerCase().replace(/\.com$/, "").includes(site.toLowerCase().replace(/\.com$/, "").split(".")[0]) ? "" : tail).trim();
  return {
    name: cleaned.slice(0, 100) || undefined,
    image: imageUrl,
    price: Number.isFinite(price) && price > 0 ? price.toFixed(2) : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const {url} = await request.json() as {url?: unknown};
    if (typeof url !== "string" || url.length > 2048) throw Error("Paste a product link.");
    let target: URL;
    try { target = new URL(url.trim()); } catch { throw Error("That doesn’t look like a link."); }
    const page = await fetchPage(target);
    const details = parse(page.html, page.url);
    // A name with no photo or price is usually a bot check or a generic page (e.g. "Amazon.com"), not the product.
    if (!details.image && !details.price) throw Error("This store blocked the lookup. Enter the name and price yourself.");
    return Response.json({...details, url: target.href});
  } catch (problem) {
    const message = problem instanceof Error && !/fetch failed|ENOTFOUND|aborted|timeout/i.test(problem.message) ? problem.message : "Couldn’t reach that store. Enter the details yourself.";
    return Response.json({error: message}, {status: 422});
  }
}
