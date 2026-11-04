# Lark-Cloudflare: quotations from a Lark form to a PDF email

Staff fill in a form in a **Lark Base**. A **Cloudflare Worker** builds a letterhead PDF quotation and attaches it to the record. A staff member reviews it, approves it, and **Lark mail** sends it to the client.

Nothing runs on a personal computer. Both Lark and Cloudflare keep it running, and the free plans are enough for a small team.

> This repository holds placeholders only. Do not commit company details, passwords, secrets or real Base ids into a public copy. See [Security](#security).

---

## 1. How it works

```
 Staff                    Lark Base                      Cloudflare Worker
 -----                    ---------                      -----------------
 fill the form  ───────►  new record in "Quotes"
 press [Make PDF]  ────►  Status = Ready for PDF
                          workflow 1 fires  ───────────►  POST /lark {record_id}
                                                          1. Status = Generating
                                                          2. read the record + the Products
                                                          3. freeze the prices
                                                          4. render letterhead HTML to PDF
                          PDF attached, Status = PDF ready ◄──  5. upload PDF, write back
 review the PDF
 set Status = Approved to send
                          workflow 2 fires:
                          Lark mail to the client with the PDF, Status = Sent
```

| Part | What it does | Where it lives |
|---|---|---|
| **Products** table | Item code, description, unit, selling price | Lark Base |
| **Quotes** table + form | One record per quotation | Lark Base |
| **Make PDF** button | Starts (or restarts) PDF generation for that record | Lark Base |
| **Workflow 1** | Status becomes "Ready for PDF", then calls the Worker | Lark Base |
| **Worker** (`worker/`) | Reads Lark, builds the PDF, writes it back | Cloudflare |
| **Workflow 2** | Status becomes "Approved to send", then emails the client | Lark Base |

### Statuses

| Status | Meaning | Set by |
|---|---|---|
| Ready for PDF | Start generating | the Make PDF button |
| Generating | Worker is working (about 10 to 60 seconds) | Worker |
| PDF ready | PDF is attached; review it | Worker |
| PDF error | Something failed; the reason is in "Error message" | Worker |
| Approved to send | Email it now | staff, by hand |
| Sent | Email sent | workflow 2 |
| Send error | (optional) email failed | not wired by default |

Prices are copied onto the quote when the PDF is made (field "Lines snapshot"), so changing a product price later does not change an old quote.

---

## 2. What you need

- A **Lark** (or Feishu) account with permission to create a custom app and a Base. A tenant admin must approve the app (step A4).
- A **Cloudflare** account. The free plan works. Free-plan limits apply to browser time, so check Cloudflare's current limits.
- **Node.js 20 or newer** and **git** on the computer you use for setup. It is only needed once, and again if you change the code.
- Optional: **lark-cli** (Lark's command line tool). Every step has a point-and-click route, and the JSON files in `lark/` can be used with `lark-cli`.

---

## 3. Setup

### Part A: Lark Base

**A1. Create the Base and the two tables**

Create a Base with two tables named exactly `Products` and `Quotes`. Field names matter: the Worker reads them by name.

`Products` (see `lark/products-fields.json`):

| Field | Type |
|---|---|
| Description | Text (this is the primary column) |
| Item code | Text |
| UOM | Text |
| Selling price | Number, 2 decimals |

`Quotes` (see `lark/quotes-fields.json`):

| Field | Type | Notes |
|---|---|---|
| Client company | Text | primary column |
| Quote No | Auto number | for example `QT-` + year/month + 4-digit counter |
| Contact (ATTN) | Text | |
| Address | Text | |
| Phone | Phone | |
| Email | Email | the client's email |
| Item 1 … Item 4 | Link to `Products` | one product each; allow a single record |
| Qty 1 … Qty 4 | Number, 0 decimals | quantity for the matching item |
| Remarks | Text | |
| Prepared by | Text | |
| Designation | Text | |
| Status | Single select | options exactly: Draft, Ready for PDF, Generating, PDF ready, PDF error, Approved to send, Sent, Send error |
| PDF | Attachment | |
| Lines snapshot | Text | filled by the Worker |
| Error message | Text | filled by the Worker |
| Created | Created time | |

The Worker reads up to 12 item slots (`Item 1` to `Item 12`, `Qty 1` to `Qty 12`). Add more pairs if you need more than 4; the code needs no change.

Optional with `lark-cli` (run `lark-cli auth login` first). The JSON files hold the field definitions. Pass their contents to `--fields`:

```bash
lark-cli base +base-create --name "Quotation" --table-name Products --fields '<contents of lark/products-fields.json>'
lark-cli base +table-create --base-token <BASE_TOKEN> --name Quotes --fields '<contents of lark/quotes-fields.json>'
```

Create `Products` first, because the Item fields link to it. Run `--help` on each command for details. Add some items: `lark/products-sample.json` has sample rows to enter by hand or load with `lark-cli base +record-batch-create --base-token <BASE_TOKEN> --table-id <PRODUCTS_TABLE> --json @lark/products-sample.json`.

If you want to work through an AI coding agent instead, hand it `AGENTS.md`. It is a step-by-step runbook that says which steps the agent does and which only a person can do.

**A2. Find the ids you will need**

- **Base token:** open the Base. In the address bar it is the part after `/base/`.
- **Table ids** (`tbl…`): in the address bar after `table=` when each table is open, or with `lark-cli base +table-list --base-token <BASE_TOKEN>`.

**A3. Build the staff form**

1. On the `Quotes` table, create a **Form** view. Use "Generate Form" so every field becomes a question.
2. **Hide** these questions from the form: Status, PDF, Lines snapshot, Error message. Quote No and Created are system fields and do not appear.
3. Keep: Client company, Contact, Address, Phone, Email, Item/Qty pairs, Remarks, Prepared by, Designation.
4. Hide questions, do not delete them. Deleting a question that was created in the form editor also deletes its field.

Two things to know:

- The form editor's "Add a question" menu cannot add a record picker. That is why the form is generated from the table, which includes the linked Item fields.
- If a question will not hide in the editor, you can set it through the API, which needs the `bitable:app` scope:
  `lark-cli api PATCH /open-apis/bitable/v1/apps/<BASE_TOKEN>/tables/<QUOTES_TABLE>/forms/<FORM_VIEW_ID>/fields/<FIELD_ID> --data '{"visible":false}'`
  To list the form's field ids, run the same command with `GET` and `.../fields` instead.

Turn on the form's share link only for people inside your company.

**A4. Create the Lark app the Worker uses**

1. Open the Lark developer console and create a **custom app**. Name it, for example, "Quotation PDF".
2. Enable the **Bot** capability.
3. Add the permission scope `bitable:app` (view, comment, edit and manage Base). Add nothing else.
4. Create a version and release it. A tenant admin approves it.
5. Copy the **App ID** (`cli_…`) and **App Secret**. The App ID goes into `wrangler.toml`. The App Secret goes only into Cloudflare as a secret (step B4). Never put it in a file or chat.
6. Open your Base, choose the three-dot menu, then add the app as a collaborator with **edit** rights (the "Add document app" option). Without this the Worker gets a permission error.

**A5. Create workflow 1: Ready for PDF, then call the Worker**

Do this after Part B, because you need the Worker address. In the Base, open **Automations**, then **New workflow**.

- Trigger: **Record changes**, table `Quotes`, condition `Status` is `Ready for PDF`.
- Action: **HTTP request** (add this action):
  - Method `POST`
  - URL `https://quotation-pdf.<your-subdomain>.workers.dev/lark`
  - Headers: `Content-Type: application/json` and `x-api-key: <your SHARED_SECRET>`
  - Body (raw JSON): `{"record_id":"<the trigger record's Record ID>"}`. Insert the record id as a variable from the trigger, not as typed text.

A starting file for `lark-cli base +workflow-create --json @lark/workflow-make-pdf.json` is included. Replace `YOUR-SUBDOMAIN` and `PASTE-YOUR-SHARED-SECRET-HERE`. Workflows made this way start disabled, so enable it afterwards.

**A6. Create the Make PDF button and its workflow** (point-and-click only)

1. On `Quotes`, add a field of type **Button**. Name it "Make PDF" and set its text, for example "Make / re-make PDF".
2. Under the button's action, choose **Run Workflow → New Workflow**. Lark creates a workflow with a "When a button is clicked" trigger for this field.
3. Add the action **Update record**: table `Quotes`, record = the record from the trigger step (shown as "Step 1 action"), set `Status` to `Ready for PDF`.
4. Name it (these characters are not allowed: `/ \ ? * [ ] :`) and **Save and Activate**.

Staff now open a quote, check the details, and press the button. Pressing it again after a fix creates a fresh PDF.

**A7. Create workflow 2: Approved to send, then email the client** (point-and-click only)

The "Send a Lark email" step cannot be created from the command line, so build this one in the app.

1. New workflow. Trigger: **Record changes**, table `Quotes`, `Status` is `Approved to send`.
2. Action **Send a Lark email**:
   - To: the record's `Email` field
   - Subject: something like `Quotation ` plus the record's `Quote No`
   - Body: your standard wording
   - Attachment: the record's `PDF` field
3. Action **Update record**: set `Status` to `Sent`.
4. **Save and Activate.**

The email is sent from the mailbox of the person who creates and activates the workflow. Use a shared or company mailbox if you want clients to see a company address. `lark/workflow-send-email.json` is only a skeleton (trigger and "mark as Sent"). It has no email step.

---

### Part B: Cloudflare Worker

Run these in a terminal, from the `worker/` folder.

**B1. Install**

```bash
cd worker
npm install
```

**B2. Log in to Cloudflare and pick a workers.dev name**

```bash
npx wrangler login
```

In the Cloudflare dashboard, open **Workers & Pages** and register your `workers.dev` subdomain if it asks. Your Worker address will be `https://quotation-pdf.<your-subdomain>.workers.dev`.

**B3. Fill in `wrangler.toml`**

Replace each value in angle brackets: `LARK_APP_ID`, `LARK_BASE_TOKEN`, `QUOTES_TABLE`, `PRODUCTS_TABLE`. If you use Feishu (China) instead of Lark, change `LARK_API` to `https://open.feishu.cn`.

**B4. Store the two secrets** (type each value into the prompt, never into a file or chat)

```bash
npx wrangler secret put SHARED_SECRET
npx wrangler secret put LARK_APP_SECRET
```

- `SHARED_SECRET` is a password you invent. Make it long and random, for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The same value goes into workflow 1's `x-api-key` header.
- `LARK_APP_SECRET` is the App Secret from step A4.
- Run both commands from inside `worker/`. From another folder wrangler says the Worker name is missing.

**B5. Set your letterhead**

Edit `worker/src/template.js`. At the top, set `COMPANY` (name, registration number, address, phone). You can also change the colours in the `:root` block, the default validity (`30 DAYS`) and payment term text (`src/lark.js`, `src/template.js`), and the currency label "(RM)" in the table header.

The time zone for the quote date is set in `src/lark.js` (`fmtDate`, default `Asia/Kuala_Lumpur`). Change it to yours.

**B6. Deploy and check**

```bash
npx wrangler deploy
```

Open `https://quotation-pdf.<your-subdomain>.workers.dev/` in a browser. It should say `quotation-pdf worker is up`.

Test the PDF layout without Lark. The `sample-quote.json` file has dummy data:

```bash
curl -X POST https://quotation-pdf.<your-subdomain>.workers.dev/render \
  -H "x-api-key: <your SHARED_SECRET>" \
  -H "content-type: application/json" \
  --data @sample-quote.json --output test.pdf
```

Open `test.pdf`. If the letterhead looks right, Part B is done. Don't commit `test.pdf`.

---

### Part C: End-to-end test

1. In `Products`, add a few items with prices (see `lark/products-sample.json`).
2. Open the staff form and create a quote for yourself: your own email, two items, quantities.
3. Open the new record in `Quotes` and press **Make PDF**.
4. Within about a minute, `Status` should go **Generating**, then **PDF ready**, and the PDF appears in the `PDF` field. If it shows **PDF error**, read `Error message`.
5. Open the PDF and check it.
6. Set `Status` to **Approved to send**. The email should arrive with the PDF attached and `Status` becomes **Sent**.
7. Try an outside address such as a personal Gmail to confirm that clients can receive it.

---

## 4. Daily use (for staff)

1. Open the form and fill in the client and items. Submit.
2. Open the quote in the table and press **Make PDF**.
3. Wait for `Status` = **PDF ready**, then open the PDF and check it.
4. If something is wrong, fix the quote, then press **Make PDF** again.
5. When it is right, set `Status` to **Approved to send**. The client gets the email.

---

## 5. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Nothing happens after pressing the button | Workflow 1 is not enabled, or the button workflow is not activated. Check both in Automations. |
| `PDF error` with "No items with a quantity" | An Item has no product picked, or its Qty is empty or 0. Fix and press the button again. |
| `PDF error` with a Lark error code | The app is not added to the Base with edit rights (A4 step 6), or the table ids in `wrangler.toml` are wrong. |
| Workflow 1 shows a 401 | `x-api-key` in the workflow does not match `SHARED_SECRET`. |
| "Required Worker name missing" when setting a secret | You are not in the `worker/` folder. |
| `wrangler dev --remote` or deploy asks for a subdomain | Register the workers.dev subdomain (B2). |
| The Run Workflow list in the button settings is empty | Normal until a button-trigger workflow exists. Use "New Workflow" there. |
| Workflow creation error 800004006 | A select field needs an option object, not plain text: `{"value_type":"option","value":{"name":"Ready for PDF"}}`. |
| Status says PDF ready but the PDF field is empty | You changed Status by hand. Press the button instead. |
| Want to see what the Worker did | `npx wrangler tail` in `worker/`, then press the button. |

---

## 6. Security

- **Keep secrets out of files.** Only `SHARED_SECRET` and `LARK_APP_SECRET` are secrets, and both live in Cloudflare. `.dev.vars` is ignored by git. Never paste a secret into chat, an issue or a commit.
- The Worker refuses every POST without the right `x-api-key`. Use a long random `SHARED_SECRET` and replace it if it ever leaks. Update it in both Cloudflare and workflow 1.
- The Lark app only has the `bitable:app` scope and only sees the Bases it is added to.
- If this repository is public, keep it that way only with placeholders. Your Base token and table ids identify your Base, so keep them in your own private copy.
- Workflows send email as the user who created them. Check who that is before you go live.

---

## 7. Limits to know about

- Worker free plan: tiny CPU budget and about 10 minutes of browser time a day. Each PDF takes a few seconds of browser time, so roughly dozens of quotes a day fit. Check Cloudflare's current limits.
- PDF generation runs in the background, so the first answer to Lark is "accepted" and the real result appears in the record a few seconds later.
- The code takes only the first product linked in each Item field.
- Only up to 12 item slots are read.
- Buttons, button workflows and the email step are created in the Lark app, not by command line.
- Sending is manual by design: nothing is emailed until someone sets `Approved to send`.

---

## 8. Files

```
README.md                      this guide
worker/
  wrangler.toml                Worker settings (placeholders)
  package.json
  sample-quote.json            dummy data for testing /render
  src/index.js                 HTTP entry: /render and /lark, shared-secret check
  src/lark.js                  reads and writes the Base, freezes prices, uploads the PDF
  src/template.js              letterhead HTML, company details, colours, footer
lark/
  products-fields.json         Products table fields
  products-sample.json         sample product rows
  quotes-fields.json           Quotes table fields
  workflow-make-pdf.json       workflow 1 starter (placeholders)
  workflow-send-email.json     workflow 2 skeleton (add the email step in the app)
```
