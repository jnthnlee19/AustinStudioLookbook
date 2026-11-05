import { getStore } from "@netlify/blobs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import XLSX from "xlsx";

const cookieName = "studio_pricing_session";
const lifetime = 3600;
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }
});
const digest = value => createHash("sha256").update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");
const cookie = (value, age = lifetime) => `${cookieName}=${value}; Path=/.netlify/functions/consultant-pricing; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

function authorized(request, id, secret) {
  const token = (request.headers.get("cookie") || "").split(";").map(x => x.trim())
    .find(x => x.startsWith(cookieName + "="))?.slice(cookieName.length + 1) || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !equal(signature, sign(payload, secret))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return session.id === id && session.expires > Date.now();
  } catch { return false; }
}

function originalPrice(lookbook, option) {
  if (["2018056", "2022333"].includes(option)) return "Included";
  const workbook = XLSX.read(lookbook.workbook, { type: "base64" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet2, { header: 1 });
  let category = "";
  let row;
  for (const candidate of rows.slice(14)) {
    if (!candidate[0]) continue;
    if (!candidate[2]) { category = String(candidate[0]).split(" > ")[0].trim(); continue; }
    if (String(candidate[0]).trim() === option) { row = candidate; break; }
  }
  if (!row) return null;
  if (/^MO\s+Flooring$/i.test(category)) return "Pricing Available at Selection Appointment";
  const override = lookbook.priceOverrides?.[option];
  if (typeof override === "string" && override.trim()) return override.trim();
  const raw = String(row[13] ?? "").trim();
  if (/\bTBD\b/i.test(raw)) return "Pricing to be determined";
  const number = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(number)) return raw || "See Studio Consultant for Details";
  if (number === 0) {
    const context = [raw, row[2], row[9]].join(" ");
    if (/\bincluded\b/i.test(context)) return "Included";
    if (/\bno\s*charge\b/i.test(context)) return "No Charge";
    return "See Studio Consultant for Details";
  }
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403);
  const secret = process.env.CONSULTANT_PRICING_PASSWORD || process.env.PROTECTED_PAGE_PASSWORD;
  if (!secret) return json({ error: "Consultant pricing is not configured. Set the Studio password in Netlify Functions." }, 503);
  try {
    const payload = await request.json();
    const { id, action } = payload;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || "")) return json({ error: "Invalid Lookbook ID." }, 400);
    if (action === "lock") return json({ success: true }, 200, { "Set-Cookie": cookie("", 0) });
    if (action !== "unlock" && !authorized(request, id, secret)) return json({ error: "Unlock consultant pricing again to save changes." }, 401);
    if (action === "unlock" && (typeof payload.password !== "string" || !equal(payload.password, secret))) return json({ error: "Incorrect Studio password." }, 401);
    const store = getStore({ name: "austin-studio-lookbooks", consistency: "strong" });
    const lookbook = await store.get(`lookbooks/${id}`, { type: "json" });
    if (!lookbook) return json({ error: "Lookbook not found." }, 404);
    if (lookbook.active === false) return json({ error: "This Lookbook is no longer active." }, 403);
    if (action === "unlock") {
      const expires = Date.now() + lifetime * 1000;
      const token = Buffer.from(JSON.stringify({ id, expires })).toString("base64url");
      return json({ success: true, expires }, 200, { "Set-Cookie": cookie(`${token}.${sign(token, secret)}`) });
    }
    if (action !== "save") return json({ error: "Unknown action." }, 400);
    const option = String(payload.option || "").trim();
    const amount = payload.amount;
    if (!option || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 100000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) return json({ error: "Enter a price from $0 to $100,000,000 with at most two decimal places." }, 400);
    const original = originalPrice(lookbook, option);
    if (original === null) return json({ error: "Option not found in this Lookbook." }, 400);
    const key = `pricing/${id}`;
    const entry = await store.getWithMetadata(key, { type: "json" });
    const pricing = entry?.data || { revision: 0, options: {} };
    if (payload.revision !== pricing.revision) return json({ error: "Pricing changed in another session. Review the refreshed price and save again.", pricing }, 409);
    const existing = pricing.options[option];
    const updatedAt = new Date().toISOString();
    const priceText = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
    const previousPrice = existing?.priceText || original;
    if (priceText === previousPrice) return json({ success: true, pricing });
    const updated = {
      revision: pricing.revision + 1, updatedAt,
      options: { ...pricing.options, [option]: {
        originalPrice: existing?.originalPrice || original, amount, priceText, updatedAt,
        history: [...(existing?.history || []), { previousPrice, priceText, updatedAt }]
      } }
    };
    const result = await store.setJSON(key, updated, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (!result.modified) return json({ error: "Pricing changed in another session. Refresh and try again." }, 409);
    return json({ success: true, pricing: updated });
  } catch {
    return json({ error: "Unable to update pricing. Please try again." }, 500);
  }
}

// Limit password guessing and pricing writes at the edge, per client IP.
export const config = { rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
