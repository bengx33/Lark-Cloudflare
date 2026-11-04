import puppeteer from "@cloudflare/puppeteer";
import { renderQuoteHtml, footerHtml } from "./template.js";
import { buildQuote } from "./lark.js";

async function makePdf(env, data) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(renderQuoteHtml(data), { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footerHtml(),
      margin: { top: "12mm", bottom: "26mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser.close();
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("quotation-pdf worker is up");
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });

    // Every POST needs the shared secret; with no secret set, everything is refused.
    const key = request.headers.get("x-api-key");
    if (!env.SHARED_SECRET || key !== env.SHARED_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Stage 1: render a PDF straight from JSON, no Lark involved.
    if (url.pathname === "/render") {
      const data = await request.json();
      const pdf = await makePdf(env, data);
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    }

    // Stage 2: Lark calls this with {"record_id": "rec..."}; the PDF job runs after we answer.
    if (url.pathname === "/lark") {
      const { record_id } = await request.json().catch(() => ({}));
      if (!/^rec[A-Za-z0-9]+$/.test(record_id || "")) {
        return new Response("record_id missing or malformed", { status: 400 });
      }
      ctx.waitUntil(
        buildQuote(env, record_id, (d) => makePdf(env, d)).catch((e) => console.error("buildQuote failed:", e.message)),
      );
      return new Response("accepted", { status: 202 });
    }

    return new Response("Not found", { status: 404 });
  },
};
