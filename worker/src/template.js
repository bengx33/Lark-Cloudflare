// Letterhead details are fixed. Edit them here once; they appear on every quote.
export const COMPANY = {
  name: "YOUR COMPANY NAME SDN BHD",
  reg: "(Company registration no.)",
  address: "Your street address, postcode, city, country",
  contact: "Tel / WhatsApp: your number",
};

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const money = (n) =>
  Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// data: { quoteNo, date, validity, client:{company,attn,address,phone,email},
//         items:[{code,desc,qty,uom,price}], remarks, preparedBy, designation }
export function renderQuoteHtml(data) {
  const items = data.items || [];
  let total = 0;
  const rows = items
    .map((it, i) => {
      const amount = Number(it.qty) * Number(it.price);
      total += amount;
      return `<tr class="${i % 2 ? "alt" : ""}">
        <td>${i + 1}</td><td>${esc(it.code)}</td><td>${esc(it.desc)}</td>
        <td class="c">${esc(it.qty)}</td><td class="c">${esc(it.uom)}</td>
        <td class="r">${money(it.price)}</td><td class="r">${money(amount)}</td></tr>`;
    })
    .join("");
  const c = data.client || {};
  const contactLine = [c.phone && `Tel: ${esc(c.phone)}`, c.email && `Email: ${esc(c.email)}`]
    .filter(Boolean)
    .join(" &nbsp;|&nbsp; ");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --navy:#2f3f7a; --navy-dark:#26336a; --tint:#eef1f8; --line:#2b2b2b; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color:#111; margin:0; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; }
  .co-name { font-size:15pt; font-weight:700; color:var(--navy); }
  .co-reg  { font-size:8.5pt; color:#444; margin-top:1px; }
  .co-addr { font-size:8.5pt; color:#444; margin-top:3px; max-width:340px; line-height:1.35; }
  .title { text-align:right; }
  .title h1 { margin:0 0 6px; font-size:24pt; letter-spacing:1px; }
  .meta { border-collapse:collapse; margin-left:auto; font-size:9pt; }
  .meta td { padding:2px 6px; }
  .meta td.l { text-align:right; font-weight:700; }
  .meta td.v { border:1px solid var(--line); min-width:150px; text-align:center; }
  .band { background:var(--navy); color:#fff; font-weight:700; padding:3px 8px; margin-top:14px; width:62%; }
  .client { margin-top:4px; line-height:1.45; width:62%; padding-left:2px; }
  .intro { margin:12px 0 8px; }
  table.items { width:100%; border-collapse:collapse; border:1.5px solid var(--navy-dark); }
  table.items thead { display:table-header-group; }
  table.items th { background:var(--navy); color:#fff; padding:7px 6px; font-size:9pt; text-align:left; }
  table.items td { padding:7px 6px; vertical-align:top; background:var(--tint); }
  table.items tr.alt td { background:#fff; }
  table.items tr { break-inside: avoid; }
  .c { text-align:center; } .r { text-align:right; }
  .lower { display:flex; justify-content:space-between; gap:18px; margin-top:12px; break-inside:avoid; }
  .remarks { width:56%; border:1.5px solid var(--navy-dark); }
  .remarks .h { background:var(--navy); color:#fff; text-align:center; font-weight:700; padding:3px; }
  .remarks .b { padding:6px 8px; min-height:92px; font-size:9pt; line-height:1.5; white-space:pre-line; }
  .right { width:40%; }
  .grand { display:flex; align-items:center; justify-content:space-between; background:#d9ddf0; padding:8px 10px; font-weight:700; }
  .grand .amt { font-size:12pt; }
  .sign { margin-top:12px; font-size:9pt; line-height:1.9; }
  .sign b { display:inline-block; width:82px; }
  .sigline { border-bottom:1px solid #444; width:170px; display:inline-block; height:34px; vertical-align:bottom; }
  </style></head><body>
  <div class="head">
    <div>
      <div class="co-name">${esc(COMPANY.name)}</div>
      <div class="co-reg">${esc(COMPANY.reg)}</div>
      <div class="co-addr">${esc(COMPANY.address)}<br>${esc(COMPANY.contact)}</div>
    </div>
    <div class="title">
      <h1>QUOTATION</h1>
      <table class="meta">
        <tr><td class="l">DATE</td><td class="v">${esc(data.date)}</td></tr>
        <tr><td class="l">QUOTE #</td><td class="v">${esc(data.quoteNo)}</td></tr>
        <tr><td class="l">VALIDITY</td><td class="v">${esc(data.validity || "30 DAYS")}</td></tr>
      </table>
    </div>
  </div>
  <div class="band">${esc(c.company || c.attn || "")}</div>
  <div class="client">
    ${c.attn ? `ATTN: ${esc(c.attn)}<br>` : ""}
    ${c.address ? `${esc(c.address)}<br>` : ""}
    ${contactLine}
  </div>
  <div class="intro">We are pleased to offer the following at the terms and conditions indicated:</div>
  <table class="items">
    <thead><tr>
      <th style="width:6%">NO</th><th style="width:13%">ITEM CODE</th><th>DESCRIPTION</th>
      <th class="c" style="width:8%">QTY</th><th class="c" style="width:8%">UOM</th>
      <th class="r" style="width:14%">UNIT PRICE (RM)</th><th class="r" style="width:14%">AMOUNT (RM)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="lower">
    <div class="remarks"><div class="h">REMARKS</div>
      <div class="b">${esc(data.remarks || "PAYMENT TERM : 30 DAYS")}</div></div>
    <div class="right">
      <div class="grand"><span>GRAND TOTAL (RM)</span><span class="amt">${money(total)}</span></div>
      <div class="sign">
        <div><b>Prepared By:</b> ${esc(data.preparedBy)}</div>
        <div><b>Designation:</b> ${esc(data.designation)}</div>
        <div><b>Signature:</b> <span class="sigline"></span></div>
      </div>
    </div>
  </div>
  </body></html>`;
}

// Repeats on every page: colour bar, company line, page numbers.
export function footerHtml() {
  return `<div style="width:100%;padding:0 12mm;font-family:Arial,sans-serif;font-size:8px;color:#333;-webkit-print-color-adjust:exact;">
    <div style="height:4px;background:linear-gradient(90deg,#e07b22 0 33%,#0f8b8d 33% 100%);margin-bottom:4px;"></div>
    <div style="display:flex;justify-content:space-between;">
      <span style="color:#2f3f7a;font-weight:bold;">${esc(COMPANY.name)} ${esc(COMPANY.reg)}</span>
      <span>${esc(COMPANY.address)} &nbsp;|&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div></div>`;
}
