// functions/overrides.js
import { getStore } from "@netlify/blobs";

/** Helper to build JSON responses with CORS */
const json = (data, status = 200) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  },
  body: JSON.stringify(data),
});

/** Normalize header access (netlify lowercases them) */
const getHeader = (headers, name) => {
  if (!headers) return "";
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
};

/** Make an inclusive list of YYYY-MM-DD between two dates */
function datesBetween(fromISO, toISO) {
  const out = [];
  const from = new Date(fromISO + "T00:00:00");
  const to   = new Date(toISO + "T00:00:00");
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().split("T")[0]);
  }
  return out;
}

export async function handler(event) {
  // Preflight CORS
  if (event.httpMethod === "OPTIONS") return json({}, 204);

  const method = event.httpMethod || "GET";
  const params = event.queryStringParameters || {};
  const headers = event.headers || {};
  const adminKeyHeader = getHeader(headers, "x-admin-key");

  // Netlify Blobs store (persists globally for your site)
  const store = getStore("overrides");

  try {
    if (method === "GET") {
      const { date } = params;
      // Get a single day
      if (date) {
        const raw = await store.get(date);
        let value = null;
        try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
        return json({ [date]: value || null });
      }

      // Or list all
      const listing = await store.list();
      const blobs = listing?.blobs || listing?.keys || [];
      const keys = blobs.map(b => (typeof b === "string" ? b : b.key)).filter(Boolean);
      const out = {};
      for (const k of keys) {
        const raw = await store.get(k);
        try { out[k] = raw ? JSON.parse(raw) : null; } catch { out[k] = raw; }
      }
      return json(out);
    }

    if (method === "POST") {
      const adminConfigured = !!process.env.NETLIFY_ADMIN_KEY;
      const isAdmin = adminKeyHeader && adminKeyHeader === process.env.NETLIFY_ADMIN_KEY;
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);

      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

      const dates = [];
      if (body.date) dates.push(body.date);
      if (Array.isArray(body.dates)) dates.push(...body.dates);
      if (body.from && body.to) dates.push(...datesBetween(body.from, body.to));

      if (!dates.length) return json({ error: "date required" }, 400);

      // Payload normalization
      const record = {
        closed: !!body.closed,
        start: body.closed ? null : (body.start || null),
        end: body.closed ? null : (body.end || null),
        detail: body.detail || ""
      };

      for (const d of dates) {
        await store.setJSON(d, record);
      }
      return json({ ok: true, saved: dates.length });
    }

    if (method === "DELETE") {
      const adminConfigured = !!process.env.NETLIFY_ADMIN_KEY;
      const isAdmin = adminKeyHeader && adminKeyHeader === process.env.NETLIFY_ADMIN_KEY;
      const oneDate = params.date;
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);
      if (!oneDate)        return json({ error: "date required" }, 400);

      await store.delete(oneDate);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("overrides error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}
