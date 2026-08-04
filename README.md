# Get Well Hub MCP Server

Connects Claude directly to your Get Well Hub app via a locked-down Supabase
Edge Function ("mcp-bridge") — no Lovable credits used, no raw database
password needed anywhere.

## How it fits together

Claude → this server (on Railway) → Lovable's `mcp-bridge` edge function → your database

## Step 1 — Get your bridge token

1. Open your Lovable project editor
2. Go to **Secrets** in the left sidebar
3. Find **`MCP_BRIDGE_TOKEN`** and copy its value

## Step 2 — Choose a secret API key for this server

Make up any random long string yourself, e.g. `gwh-8x2k9-mySecretKey-42`.
This is separate from the bridge token — it protects this Railway server
specifically.

## Step 3 — Set variables in Railway

In your Railway service's **Variables** tab, add:

- `MCP_BRIDGE_TOKEN` = the value copied in Step 1
- `MCP_API_KEY` = the secret you made up in Step 2

Then deploy. Railway will give you a public URL like
`https://getwellhub-mcp-production.up.railway.app`. Your MCP endpoint is
that URL + `/mcp`.

## Step 4 — Connect it to Claude

In Claude's settings, add a **custom connector**:

- **URL**: your deployed `/mcp` endpoint
- **Authorization header**: `Bearer <your MCP_API_KEY from Step 2>`

Once connected, you can ask Claude things like:
- "What's the Maytapi status?"
- "Freeze Maytapi sending"
- "Queue a post to APLGO for tomorrow at 5pm saying ..."
- "What's the prospector status?"

## Available tools

- `get_maytapi_status` — daily cap, freeze state, queue counts (read-only)
- `set_maytapi_cap` — change the daily send cap
- `set_maytapi_freeze` — freeze/unfreeze all outbound sending (kill switch)
- `queue_group_post` — schedule a post to one of your **11 approved groups only**
- `get_prospector_status` — one-on-one prospecting cadence overview (read-only)
- `queue_prospector_touch` — log a one-on-one WhatsApp touch for a contact

### The 11 approved groups (enforced by the bridge itself, not just this server)

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

Any other group name is rejected by the Lovable edge function itself, so
this protection holds even if this server's code is ever changed.

## Local testing (optional)

```bash
npm install
MCP_BRIDGE_TOKEN="your-bridge-token" MCP_API_KEY="your-secret" npm start
```

Then it runs at `http://localhost:3000/mcp`.

## Notes

- Currently, `queue_group_post` inserts posts with status `queued`. Lovable's
  own dispatcher watches for `pending` to auto-send — so queued posts won't
  go out automatically yet. Ask to fix this once you're ready for it to be
  fully automatic (small follow-up change on the Lovable side).
- This same pattern (a bridge edge function + a Railway MCP server) can be
  reused for your other 3 apps.
