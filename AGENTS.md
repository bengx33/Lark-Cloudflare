# AGENTS.md: runbook for an AI coding agent

You are setting up a quotation system: a Lark Base form, a Cloudflare Worker that makes a PDF, and Lark workflows that email it. This file is written for you to execute. `README.md` is the human version of the same process. If they disagree, trust this file, then tell the human.

Read the whole file before you start.

---

## 0. Rules (these override everything below)

1. **Never ask for, read, print, log or store a secret.** The secrets are `SHARED_SECRET` and `LARK_APP_SECRET`, plus any password, token or API key. Only the human types them, directly into Cloudflare or Lark. If a human pastes one into chat, do not use it or repeat it. Tell them to rotate it.
2. **Steps marked HUMAN you do not do.** Give the human the exact instruction, then stop and wait for them to say it is done. Do not try to bypass it.
3. **Do not put real company data into the repository.** Fill in values in a **private working copy**. Never commit or push a filled-in copy to a public repository. The tracked files keep placeholders.
4. **Use ids from real command output**, never guessed or typed from memory. Table, field, view and record ids come from `+table-list`, `+field-list`, and so on.
5. **Verify each step** with its check. If the check fails, go to its "If it fails" line. Do not move on.
6. **Before deleting or overwriting** anything in Lark or Cloudflare, look at what is there and ask the human.
7. **Do not send email to anyone except the test address the human gave you.**
8. Report each step's result in one line: done, failed (with the error text), or waiting for the human.

Step actors: **AGENT** (you do it), **HUMAN** (they do it), **BROWSER** (you do it in a browser tool where the human is signed in to Lark; if you have no browser tool, treat it as HUMAN).

---

## 1. Tools you need

| Tool | Check | Needed for |
|---|---|---|
| Node.js 20 or newer, npm | `node -v` | the Worker |
| `npx wrangler` (installed by `npm install`) | after install: `npx wrangler --version` | deploy |
| `lark-cli` | `lark-cli --version` | Lark Base steps |
| a browser tool (optional) | try opening the Lark Base URL | UI-only steps S12, S13 |
| `curl` | `curl --version` | Worker checks |

If `lark-cli` is missing, switch every AGENT Lark step to HUMAN and give the human the point-and-click route from `README.md`.

Platform notes (Windows PowerShell and others):
- JSON files you write must be **UTF-8 without a byte-order mark**. Windows PowerShell `Set-Content -Encoding utf8` adds a BOM, and `lark-cli` then rejects the file with "invalid character 'ï'". Write files with an editor tool, or strip the BOM.
- `lark-cli base +record-get` and `+record-list` write `.ndjson` and manifest files into the current folder. Run them from a temporary folder and delete the output afterwards.
- Pass JSON to `--data` or `--json` as a file (`@file.json`) where possible, to avoid shell quoting problems.
- Do not use a fixed sleep to wait for the PDF. Poll (section S14).

---

## 2. Inputs to collect from the human first

Ask for all of these in one message. Mark each as required (R) or optional (O). Do not continue until the required ones are answered.

| # | Input | Used for | |
|---|---|---|---|
| I1 | Lark brand: international Lark or Feishu (China)? | `LARK_API` (`https://open.larksuite.com` or `https://open.feishu.cn`) | R |
| I2 | Does a Base already exist, or should I create one? If it exists, its URL | S2 and S4 | R |
| I3 | Company letterhead: name, registration number, address, phone | `COMPANY` in `worker/src/template.js` | R |
| I4 | Time zone for the quote date (for example `Asia/Kuala_Lumpur`) | `fmtDate` in `worker/src/lark.js` | R |
| I5 | Currency label in the table header (default "(RM)"), validity text (default "30 DAYS"), payment-term text (default "PAYMENT TERM : 30 DAYS") | template and `lark.js` | O |
| I6 | Quote-number prefix (default `QT-`) | `Quote No` field | O |
| I7 | How many item rows per quote (default 4, code supports up to 12) | Item/Qty fields | O |
| I8 | A test email address the human owns, for the end-to-end test | S14 | R |
| I9 | Who creates and activates the email workflow, and from which mailbox the client should see | S13 | R |
| I10 | A private folder for the working copy | rule 3 | R |

Then say back to the human, in one line each, what you will do and which steps need them (S1 approval, S5, S7, S8, S11 secret, S12 and S13 if you have no browser).

---

## 3. Steps

Each step has an actor, actions, a check, and what to do if it fails.

### S0. Preflight (AGENT)

- Run the tool checks in section 1.
- Make the private working copy: copy this repository to the folder from I10. Work only there from now on.
- Check: all required tools answer.
- If it fails: stop and tell the human what to install.

### S1. Authorise `lark-cli` (HUMAN approves, AGENT drives)

- Check the login first (`lark-cli auth status`, see the `lark-shared` skill if you have it). If logged in as the right person, skip to S2.
- To log in with the scopes the form step needs:
  `lark-cli auth login --scope "bitable:app bitable:app:readonly" --no-wait --json`
  This returns a `verification_url` and a `device_code`. Show the human the URL exactly as given, plus a QR image if you can (`lark-cli auth qrcode "<url>" --output <file>.png`). Do not change or encode the URL. **End your turn there** and ask them to reply when they have approved.
- After they reply: `lark-cli auth login --device-code <device_code>`.
- Check: the output says authorization was successful and lists the scopes.
- If it fails: the link expires after about 10 minutes. Run the login again to get a fresh link and QR.
- Wide scopes are only needed for the form API in S10. Ask only for what the next steps need.

### S2. Create the Base and the two tables (AGENT)

- If I2 gave an existing Base, resolve its token: `lark-cli base +url-resolve --url "<url>" --as user`. Use the returned `base_token`. Do not use the full URL as the token.
- Otherwise create one with its first table in one go, using the contents of `lark/products-fields.json` as the field array:
  `lark-cli base +base-create --name "<Base name>" --table-name Products --fields '<contents of products-fields.json>'`
  and note the returned token.
- Create the second table with its fields, again with the file contents:
  `lark-cli base +table-create --base-token <T> --name Quotes --fields '<contents of quotes-fields.json>'`
  If the Base already existed, create both tables this way with `+table-create`. Create `Products` first, because `Item n` links to it.
- Notes:
  - Creating a table with `--fields` avoids the default text column that a blank table has. If you create a blank table instead, rename that column to the first field and send only the remaining fields with `+field-create --base-token <T> --table-id <tbl> --json @<file>`.
  - Apply I6 (prefix in the `Quote No` rule) and I7 (add or remove `Item n` and `Qty n` pairs) to the JSON before sending.
  - `Item n` fields link to `Products`. If `link_table` by name is rejected, use the real `tbl…` id of Products.
  - Do not set a default on `Status`. It must start empty.
- Check: `lark-cli base +field-list ...` for each table. Compare the names with the files. Every name must match exactly, because the Worker reads them by name (list in `worker/src/lark.js`, object `F`, plus `Item n`, `Qty n`, and Products fields `Item code`, `Description`, `UOM`, `Selling price`). The `Status` options must be exactly: Draft, Ready for PDF, Generating, PDF ready, PDF error, Approved to send, Sent, Send error.
- If it fails: fix the field with `+field-update` after reading `+field-update --help`. Do not delete a field the human might already use without asking.

### S3. Add sample products (AGENT)

- Add the rows from `lark/products-sample.json` to `Products`: `lark-cli base +record-batch-create --base-token <T> --table-id <PRODUCTS_TABLE> --json @lark/products-sample.json` (the file already has the `{"create_records":[...]}` shape). Ask the human first whether they prefer to load their real price list instead.
- Check: `+record-list` on `Products` returns the rows. Keep their record ids for S14.
- If it fails: read the error code, fix the field names or values, and retry once.

### S4. Collect the ids (AGENT)

- `base_token` from S2.
- `QUOTES_TABLE` and `PRODUCTS_TABLE`: from `lark-cli base +table-list --base-token <T> --as user`.
- Check: both start with `tbl`.

### S5. Lark custom app (HUMAN, with admin)

Tell the human exactly this:

1. Open the Lark developer console and create a **custom app** ("Quotation PDF").
2. Enable the **Bot** capability.
3. Add the permission scope **`bitable:app`** only.
4. Create a version and release it, then have a tenant admin approve it.
5. Open the Base, three-dot menu, and add the app as a collaborator with **edit** rights ("Add document app").
6. Reply with the **App ID** (starts with `cli_`). **Do not send the App Secret.** The App Secret is entered only in step S8.

- Check (AGENT): you have an App ID. You cannot check the approval yourself. The first real check is S14.
- If the human sends the App Secret anyway: do not use it, and tell them to rotate it.

### S6. Install and configure the Worker (AGENT)

- In the private copy:
  - `cd worker && npm install`
  - Edit `wrangler.toml` `[vars]`: `LARK_API` (I1), `LARK_APP_ID` (S5), `LARK_BASE_TOKEN` (S2), `QUOTES_TABLE`, `PRODUCTS_TABLE` (S4). Remove the angle-bracket placeholders.
  - Edit `src/template.js` `COMPANY` with I3.
  - Edit `src/lark.js`: the time zone in `fmtDate` (I4); and, if I5 differs, the `validity` and remarks defaults in `buildQuote`, and the "(RM)" label in `template.js`.
- Check: `grep -rn "<your\|<the token\|<table id\|YOUR COMPANY" worker/` returns nothing, and `node --check worker/src/index.js` (or `node -e "import('./worker/src/lark.js')"`) shows no syntax error.
- If it fails: fix the file and re-check.

### S7. Log in to Cloudflare (HUMAN)

- Tell the human to run `npx wrangler login` in `worker/` and approve the browser page. If they have never used Workers, they also open the Cloudflare dashboard, Workers & Pages, and register a **workers.dev subdomain** (a free name).
- Check (AGENT): `npx wrangler whoami` shows their account.
- If it fails: ask the human to repeat the login.

### S8. Store the two secrets (HUMAN)

Give the human these two commands. They run them in `worker/` and type each value at the prompt, then tell you "done". You never see the values.

```bash
cd worker
npx wrangler secret put SHARED_SECRET
npx wrangler secret put LARK_APP_SECRET
```

- Tell them: `SHARED_SECRET` is a long random password they invent (for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). They keep a copy for S11, in their password manager. `LARK_APP_SECRET` is the App Secret from the Lark app.
- They must run the commands inside `worker/`. From another folder wrangler says the Worker name is missing.
- Check (AGENT): `npx wrangler secret list` shows both names. It shows no values.
- If it fails: ask them to repeat the command.

### S9. Deploy and check the Worker (AGENT)

- `cd worker && npx wrangler deploy`. Note the printed address, `https://quotation-pdf.<subdomain>.workers.dev`.
- Check 1: `curl <address>/` returns `quotation-pdf worker is up`.
- Check 2: `curl -s -o /dev/null -w "%{http_code}" -X POST <address>/render` returns `401`. This proves the shared-secret check works. Do not try to guess a secret.
- If Check 1 fails: `npx wrangler tail` and read the error. If the error mentions a subdomain, go back to S7.
- Layout check (optional, needs the secret): ask the human to run `curl -X POST <address>/render -H "x-api-key: <their secret>" -H "content-type: application/json" --data @sample-quote.json --output test.pdf` themselves and tell you if the PDF looks right. Do not ask for the key.

### S10. Build the staff form (AGENT)

- Create a form on `Quotes`: `lark-cli base +form-create --base-token <T> --table-id <QUOTES_TABLE> --name "New quotation" --description "Fill in the client and items, then press Make PDF on the record."`. Note the form id (`vew…`). Its question list will not include the link fields by default.
- List the form's questions with ids:
  `lark-cli api GET /open-apis/bitable/v1/apps/<BASE>/tables/<QUOTES_TABLE>/forms/<FORM_ID>/fields --as user`
  This needs the S1 scopes. Each item has `field_id`, `title`, `visible`.
- Set visibility, one field per call (write the body to a file or quote it correctly):
  `lark-cli api PATCH /open-apis/bitable/v1/apps/<BASE>/tables/<QUOTES_TABLE>/forms/<FORM_ID>/fields/<FIELD_ID> --data '{"visible":true}' --as user`
- Visible: Client company, Contact (ATTN), Address, Phone, Email, every `Item n`, every `Qty n`, Remarks, Prepared by, Designation.
- Hidden (`"visible":false`): Status, PDF, Lines snapshot, Error message.
- **Do not use `+form-questions-delete` to hide a question.** It deletes the underlying table field.
- Check: list the fields again and compare with the lists above.
- If it fails: if the API says a view id was not found (code 1254042), the form was recreated by someone. List forms (`+form-list`) and use the current id.
- Do not turn on the form's share link. That is the human's decision, and it should be limited to people inside the company.

### S11. Workflow 1: Ready for PDF, then call the Worker (AGENT, then HUMAN for the secret)

- Copy `lark/workflow-make-pdf.json` into the private working copy. Replace `YOUR-SUBDOMAIN` with the real subdomain. Change `client_token` to a new unique value. **Leave `PASTE-YOUR-SHARED-SECRET-HERE` as it is.**
- Create it: `lark-cli base +workflow-create --base-token <T> --json @<file>`. It is created disabled. Note the returned workflow id (`wkf…`).
- HUMAN: open the Base, Automations, this workflow, edit the HTTP step, and replace the placeholder in the `x-api-key` header with their `SHARED_SECRET`. Save.
- After they confirm: `lark-cli base +workflow-enable --base-token <T> --workflow-id <wkf…>`.
- Check: `+workflow-list` shows it enabled.
- If it fails: error 800004006 means a select value must be written as `{"value_type":"option","value":{"name":"Ready for PDF"}}`. Table and field names in the workflow must match the Base exactly.

### S12. The "Make PDF" button and its workflow (BROWSER or HUMAN)

The CLI and API cannot create button fields or button workflows. Do this in the Lark app.

1. Open the `Quotes` table grid. Toolbar: **Customize Field**, then **New field**.
2. Field title `Make PDF`. Field type: search for and pick **Button**.
3. Button text: `Make / re-make PDF`. Under Action choose **Run Workflow**, then **+ New Workflow**. A new tab opens with a workflow that starts "When a button is clicked" (Button field, table `Quotes`).
4. Click **Then do this**, choose **Update record**. Table: `Quotes`. Select record: **Step 1 action**. Set record content: add the field `Status` and choose `Ready for PDF`.
5. Rename the workflow to `Button - Make PDF`. Names cannot contain `/ \ ? * [ ] :`.
6. Click **Save and Activate** and wait for the "Workflow saved and activated" message.

- Check: `lark-cli base +workflow-list` shows the new workflow. Check that a field `Make PDF` exists with `+field-list`.
- The grid view may not show the button column without scrolling. Open a record (the expand icon in the first column) and press the button in the record panel.
- If it fails: if the Run Workflow list says "No available workflows", choose "+ New Workflow" in that list. That is expected the first time.

### S13. Workflow 2: Approved to send, then email the client (BROWSER or HUMAN)

The "Send a Lark email" step cannot be created by the CLI.

1. Create the skeleton (AGENT): copy `lark/workflow-send-email.json`, change its `client_token`, run `+workflow-create`.
2. In the Lark app, open that workflow and insert, **before** the "Mark as Sent" step, an action **Send a Lark email**:
   - To: the record's `Email`
   - Subject: `Quotation ` plus the record's `Quote No`
   - Body: the standard wording from the human
   - Attachment: the record's `PDF` field
3. **Save and Activate**, signed in as the person from I9. The email is sent from that person's mailbox.

- Check: the workflow shows three steps (trigger, email, mark as Sent) and is enabled.
- If it fails: report the exact step that will not save.

### S14. End-to-end test (AGENT, then HUMAN confirms the email)

Use only the address from I8.

1. **Create a test quote.** Using real record ids from S3, create a record in `Quotes` with `+record-upsert`:
   - `Client company`, `Contact (ATTN)`, `Address`, `Phone`, `Email` = the I8 address, `Prepared by`, `Designation`
   - `Item 1` = `[{"id":"<product record id>"}]`, `Qty 1` = 3; the same for `Item 2` and `Qty 2`
   - `Status` = `Ready for PDF` (this simulates the Make PDF button)
2. **Poll** the record with `+record-get` every 15 seconds for up to 3 minutes (use a background wait, not a long sleep). Expected path: `Ready for PDF`, then `Generating`, then `PDF ready` with a file in `PDF` and a JSON text in `Lines snapshot`. Expect about 10 to 60 seconds.
3. **Failure test.** Create a second record with the same fields but `Qty 1` empty and no `Qty 2`, then `Status` = `Ready for PDF`. Expected: `PDF error` and `Error message` = "No items with a quantity were found on this quote."
4. **Re-run test.** Fix that record's `Qty 1`, then set `Status` to `Ready for PDF` again. Expected: it reaches `PDF ready`.
5. **HUMAN check:** ask the human to open the PDF in Lark and confirm the letterhead, items, prices and totals.
6. **Send test:** with the human's OK, set the first record's `Status` to `Approved to send`. Expected: `Sent`.
7. **HUMAN check:** the human confirms the email arrived at the test address with the PDF attached.
8. **Cleanup:** ask the human before deleting the test records.

- If the PDF never arrives and `Status` stays `Ready for PDF`: workflow 1 is off or its trigger or secret is wrong. Check it is enabled, then `npx wrangler tail` and look for a request.
- If `Status` is `PDF error`: read `Error message`. A Lark error code means the app is not on the Base with edit rights (S5 step 5), the ids in `wrangler.toml` are wrong, or the scope is missing.
- If `Status` is `Sent` but no email arrives: check the workflow 2 step settings and the spam folder, and confirm the mailbox from I9.

### S15. Hand over (AGENT)

Give the human, in plain words:
- The Worker address and the Base address.
- What you changed, and in which private folder.
- What is still manual: staff press the button, review the PDF, and set `Approved to send`. Sharing the form link is the human's decision.
- Reminders: rotate `SHARED_SECRET` if it was ever shown in chat, and watch the Cloudflare free-plan limits.
- Anything you could not verify.

---

## 4. Definition of done

All of these are true:

- [ ] `GET <worker>/` returns `quotation-pdf worker is up`; `POST <worker>/render` without a key returns 401
- [ ] Both secrets are listed by `wrangler secret list`
- [ ] Workflow 1, the button workflow and workflow 2 are enabled
- [ ] The test quote reached `PDF ready`, the human confirmed the PDF
- [ ] The error test gave `PDF error` with the expected message, and the re-run worked
- [ ] The test email reached the human with the PDF attached, and `Status` became `Sent`
- [ ] No secret, App Secret or filled-in company data is in a tracked or committed file

---

## 5. Hard facts the code depends on

- Table and field names are matched by exact text. Renaming a field breaks the Worker.
- `Status` must change **to** `Ready for PDF` to trigger workflow 1. Setting it to the same value does nothing. After an error, the value is `PDF error`, so setting it again works.
- The Worker only does work if `Status` is `Ready for PDF` when it starts. Otherwise it skips.
- Prices are copied into `Lines snapshot` when the PDF is made.
- The Worker takes only the first linked product in each `Item n` field.
- The Worker reads up to 12 item slots.
- `POST /lark` answers 202 immediately and finishes in the background, so the result shows up in the record, not in the HTTP response.

## 6. Verification status

Tested in a real Lark and Cloudflare account: the Worker, the PDF render, the Lark API calls, workflow 1, the button workflow, workflow 2 with the email to an outside Gmail address, the form-visibility API, and the error and re-run paths.

Syntax checked against each command's `--help`, but not executed exactly as written here: `+base-create`, `+table-create` with the full field files, `+record-batch-create` with the sample file, `+form-create`, `+workflow-enable`, `+workflow-list`, `wrangler whoami` and `wrangler secret list`. Whether `--fields` and `--json` accept `@file` is confirmed for `+field-create --json` and `+workflow-create --json`; for the others pass the file contents inline if `@file` is rejected. If anything differs, use the real syntax from `--help` and tell the human.
