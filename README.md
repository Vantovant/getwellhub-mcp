# Get Well Hub MCP Server

This is a small standalone server that lets Claude talk **directly** to your
Get Well Hub Supabase database — no Lovable connector, no Lovable credits used.

It is **read-only**: it can only run SELECT queries, so your live data can't
be accidentally changed or deleted through it.

---

## Step 1 — Get your database connection string from Supabase

1. Go to https://supabase.com/dashboard and open your project
   (project ref: `nqyyvqcmcyggvlcswkio` — this is the Get Well Hub database).
2. Go to **Project Settings → Database**.
3. Under **Connection string**, choose the **URI** tab and copy it.
   It looks like:
   `postgresql://postgres.nqyyvqcmcyggvlcswkio:[YOUR-PASSWORD]@aws-0-xx.pooler.supabase.com:6543/postgres`
4. Replace `[YOUR-PASSWORD]` with your database password (set when the
   project was created, or resettable on that same page).

Keep this string secret — it's the key to your database.

## Step 2 — Choose a secret API key for this server

Make up any random long string yourself, e.g. `gwh-8x2k9-mySecretKey-42`.
This is separate from Supabase — it's just to stop strangers on the internet
from calling your MCP server. You'll use this same value in two places below.

## Step 3 — Deploy the server

You need to host this somewhere it can run continuously. Easiest free/cheap
options: **Railway**, **Render**, or **Fly.io**. Steps for Railway (similar
on the others):

1. Create a free account at https://railway.app
2. Create a "New Project" → "Deploy from GitHub repo" (push this folder to
   a new GitHub repo first), or use "Empty Project" and upload the files.
3. In the project's **Variables** tab, add:
   - `DATABASE_URL` = the connection string from Step 1
   - `MCP_API_KEY` = the secret you made up in Step 2
4. Deploy. Railway will give you a public URL like
   `https://getwellhub-mcp-production.up.railway.app`.
5. Your MCP endpoint is that URL + `/mcp`, e.g.
   `https://getwellhub-mcp-production.up.railway.app/mcp`

## Step 4 — Connect it to Claude

In Claude's settings, add a **custom connector** (sometimes called
"Add MCP server" or found under Settings → Connectors):

- **URL**: your deployed `/mcp` endpoint from Step 3
- **Authorization header**: `Bearer <your MCP_API_KEY from Step 2>`

Once connected, you can ask Claude things like:
- "List the tables in Get Well Hub"
- "How many contacts do I have?"
- "Show me the 10 most recent conversations"

Claude will call this server directly — completely separate from your
Lovable usage.

## Local testing (optional)

If you want to test it on your own computer before deploying:

```bash
npm install
DATABASE_URL="your-connection-string" MCP_API_KEY="your-secret" npm start
```

Then it runs at `http://localhost:3000/mcp`.

## Maytapi / WhatsApp automation tools

On top of the generic read-only `query` tool, this server now includes tools
built specifically for your weekly Maytapi automation requests, so you don't
need to spend Lovable credits on them anymore:

- `get_maytapi_status` — daily cap, freeze state, queue counts (read-only)
- `set_maytapi_cap` — change the daily send cap
- `set_maytapi_freeze` — freeze/unfreeze all outbound sending (kill switch)
- `queue_group_post` — schedule a post to one of your **11 approved groups only**
- `get_prospector_status` — one-on-one prospecting cadence overview (read-only)
- `queue_prospector_touch` — log a one-on-one WhatsApp touch for a contact

### The 11 approved groups (hard-locked)

`queue_group_post` will only ever send to these — anything else is rejected,
no exceptions:

1. APLGO
2. APLGO | Health and Biz
3. APLGO | Health and Biz KZN
4. APLGO | Health and Biz Global Distributors
5. APLGO | Health and Biz E&W Cape
6. APLGO| Health and Biz North West
7. APLGO 4 SHO
8. Ascension Bloemfontein
9. 90 day Challenge and FB Campaign
10. Botswana APLGO Presentations
11. New Day New Life

If you ever add or remove a group from this list, that requires editing
`APPROVED_GROUPS` in `src/index.js` directly — it's intentionally not
something Claude can change through a tool call, to keep it a hard boundary.

## Notes

- The generic `query` tool only allows `SELECT` — no inserts, updates, or
  deletes outside the specific tools above.
- This same pattern can be reused for your other 3 apps — just point a new
  deployment at each app's own `DATABASE_URL`.
