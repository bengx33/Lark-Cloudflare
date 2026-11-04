// Lark Base <-> quotation PDF. All Lark calls use the app's tenant token.
const MAX_ITEMS = 12; // item slots read from the Quotes table: "Item 1".."Item 12" + "Qty 1".."Qty 12"

const F = {
  company: "Client company",
  quoteNo: "Quote No",
  contact: "Contact (ATTN)",
  address: "Address",
  phone: "Phone",
  email: "Email",
  remarks: "Remarks",
  preparedBy: "Prepared by",
  designation: "Designation",
  status: "Status",
  pdf: "PDF",
  snapshot: "Lines snapshot",
  error: "Error message",
  created: "Created",
};

// ---- small helpers for Lark cell shapes -------------------------------------
const txt = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => (x && x.text) ?? (typeof x === "string" ? x : "")).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);
  return "";
};
const linkIds = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.flatMap((x) =>
      x?.record_ids || x?.link_record_ids || (x?.record_id ? [x.record_id] : typeof x === "string" ? [x] : []),
    );
  }
  return v.link_record_ids || v.record_ids || [];
};
const fmtDate = (ms) => {
  const d = ms ? new Date(Number(ms)) : new Date();
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

// ---- Lark API ---------------------------------------------------------------
async function larkJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code) throw new Error(`Lark API ${res.status} code ${body.code}: ${body.msg || "unknown error"}`);
  return body.data;
}

async function tenantToken(env) {
  const res = await fetch(`${env.LARK_API}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET }),
  });
  const body = await res.json();
  if (body.code) throw new Error(`Lark auth failed (code ${body.code}): ${body.msg}`);
  return body.tenant_access_token;
}

const api = (env, token) => {
  const base = `${env.LARK_API}/open-apis/bitable/v1/apps/${env.LARK_BASE_TOKEN}/tables`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    getRecord: async (table, id) =>
      (await larkJson(await fetch(`${base}/${table}/records/${id}`, { headers }))).record,
    getRecords: async (table, ids) =>
      (await larkJson(await fetch(`${base}/${table}/records/batch_get`, {
        method: "POST", headers, body: JSON.stringify({ record_ids: ids }),
      }))).records || [],
    update: async (table, id, fields) =>
      larkJson(await fetch(`${base}/${table}/records/${id}`, {
        method: "PUT", headers, body: JSON.stringify({ fields }),
      })),
    upload: async (name, bytes) => {
      const form = new FormData();
      form.append("file_name", name);
      form.append("parent_type", "bitable_file");
      form.append("parent_node", env.LARK_BASE_TOKEN);
      form.append("size", String(bytes.byteLength));
      form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
      const res = await fetch(`${env.LARK_API}/open-apis/drive/v1/medias/upload_all`, {
        method: "POST", headers: { authorization: `Bearer ${token}` }, body: form,
      });
      return (await larkJson(res)).file_token;
    },
  };
}

// ---- main job ---------------------------------------------------------------
// makePdf(data) -> Uint8Array comes from index.js so this file stays free of the browser code.
export async function buildQuote(env, recordId, makePdf) {
  const token = await tenantToken(env);
  const lark = api(env, token);
  const Q = env.QUOTES_TABLE;
  try {
    const rec = await lark.getRecord(Q, recordId);
    const f = rec.fields || {};
    if (txt(f[F.status]) !== "Ready for PDF") return { skipped: true, status: txt(f[F.status]) };
    await lark.update(Q, recordId, { [F.status]: "Generating", [F.error]: "" });

    // Collect the picked items and freeze today's prices.
    const slots = [];
    for (let i = 1; i <= MAX_ITEMS; i++) {
      const ids = linkIds(f[`Item ${i}`]);
      const qty = Number(f[`Qty ${i}`] ?? 0);
      if (ids.length && qty > 0) slots.push({ id: ids[0], qty });
    }
    if (!slots.length) throw new Error("No items with a quantity were found on this quote.");
    const products = await lark.getRecords(env.PRODUCTS_TABLE, [...new Set(slots.map((s) => s.id))]);
    const byId = Object.fromEntries(products.map((p) => [p.record_id, p.fields || {}]));
    const items = slots.map((s) => {
      const p = byId[s.id];
      if (!p) throw new Error(`Product record ${s.id} could not be read.`);
      return {
        code: txt(p["Item code"]), desc: txt(p["Description"]), uom: txt(p["UOM"]),
        qty: s.qty, price: Number(p["Selling price"] ?? 0),
      };
    });

    const quoteNo = txt(f[F.quoteNo]);
    const pdf = await makePdf({
      quoteNo,
      date: fmtDate(f[F.created]),
      validity: "30 DAYS",
      client: {
        company: txt(f[F.company]), attn: txt(f[F.contact]), address: txt(f[F.address]),
        phone: txt(f[F.phone]), email: txt(f[F.email]),
      },
      items,
      remarks: txt(f[F.remarks]) || "PAYMENT TERM : 30 DAYS",
      preparedBy: txt(f[F.preparedBy]),
      designation: txt(f[F.designation]),
    });

    const fileToken = await lark.upload(`${quoteNo || recordId}.pdf`, pdf);
    await lark.update(Q, recordId, {
      [F.pdf]: [{ file_token: fileToken }],
      [F.snapshot]: JSON.stringify(items),
      [F.status]: "PDF ready",
      [F.error]: "",
    });
    return { ok: true, quoteNo, lines: items.length };
  } catch (err) {
    // Best effort: tell staff in the record instead of failing silently.
    try {
      await lark.update(Q, recordId, { [F.status]: "PDF error", [F.error]: String(err.message || err).slice(0, 500) });
    } catch (_) { /* nothing more we can do */ }
    throw err;
  }
}
