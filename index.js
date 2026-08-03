// Get Well Hub — standalone MCP server
// Connects Claude directly to your Supabase Postgres database.
// Runs independently of Lovable — no Lovable credits/tokens are used.

import express from "express";
import pg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Configuration (set these as environment variables wherever you host this)
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL; // Supabase Postgres connection string
const MCP_API_KEY = process.env.MCP_API_KEY;   // Shared secret you invent, to protect this server
const PORT = process.env.PORT || 3000;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable. See README for setup instructions.");
  process.exit(1);
}
if (!MCP_API_KEY) {
  console.error("Missing MCP_API_KEY environment variable. Set any secret string you choose.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ---------------------------------------------------------------------------
// The 11 approved WhatsApp groups — this is the ONLY set of groups the
// queue_group_post tool is allowed to send to. Any other group name is
// rejected outright, no exceptions.
// ---------------------------------------------------------------------------
const APPROVED_GROUPS = {
  "APLGO": "120363032143899916@g.us",
  "APLGO | Health and Biz": "120363419298058298@g.us",
  "APLGO | Health and Biz KZN": "120363404533688349@g.us",
  "APLGO | Health and Biz Global Distributors": "120363399379886948@g.us",
  "APLGO | Health and Biz E&W Cape": "120363404117530335@g.us",
  "APLGO| Health and Biz North West": "120363423102007941@g.us",
  "APLGO 4 SHO": "120363407419020070@g.us",
  "Ascension Bloemfontein": "120363400140965880@g.us",
  "90 day Challenge and FB Campaign": "120363142874335444@g.us",
  "Botswana APLGO Presentations": "120363220708374009@g.us",
  "New Day New Life": "120363315770201775@g.us",
};

// ---------------------------------------------------------------------------
// Safety helpers
// ---------------------------------------------------------------------------
// This server is READ-ONLY by design: it only ever executes SELECT statements.
// This protects your production data from accidental or malicious writes,
// since this server will be reachable over the internet.
function assertReadOnly(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstWord !== "select" && firstWord !== "with") {
    throw new Error(
      "Only SELECT queries are allowed through this server. " +
      "Rejected statement starting with: " + firstWord
    );
  }
  if (/;/.test(trimmed)) {
    throw new Error("Multiple statements are not allowed. Send exactly one SELECT query.");
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------------
function buildServer() {
  const server = new McpServer({
    name: "getwellhub-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "list_tables",
    {
      title: "List tables",
      description: "List all tables available in the Get Well Hub database.",
      inputSchema: {},
    },
    async () => {
      const { rows } = await pool.query(
        `select table_name from information_schema.tables
         where table_schema = 'public' order by table_name;`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(rows.map(r => r.table_name), null, 2) }],
      };
    }
  );

  server.registerTool(
    "describe_table",
    {
      title: "Describe table",
      description: "List the columns and types for a given table.",
      inputSchema: { table: z.string().describe("Table name, e.g. 'contacts'") },
    },
    async ({ table }) => {
      const { rows } = await pool.query(
        `select column_name, data_type, is_nullable
         from information_schema.columns
         where table_schema = 'public' and table_name = $1
         order by ordinal_position;`,
        [table]
      );
      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No table named "${table}" found.` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "query",
    {
      title: "Run a read-only SQL query",
      description:
        "Run a single SELECT query against the Get Well Hub database and return the rows as JSON. " +
        "Only SELECT statements are permitted; writes are blocked for safety.",
      inputSchema: {
        sql: z.string().describe("A single SELECT statement, e.g. 'select * from contacts limit 20'"),
      },
    },
    async ({ sql }) => {
      const safeSql = assertReadOnly(sql);
      const { rows } = await pool.query(safeSql);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // -------------------------------------------------------------------
  // Maytapi status — read-only overview of cap, freeze flag, and queue
  // -------------------------------------------------------------------
  server.registerTool(
    "get_maytapi_status",
    {
      title: "Get Maytapi status",
      description:
        "Show the current Maytapi WhatsApp automation status: daily send cap, " +
        "whether outbound sending is frozen, and a count of scheduled group " +
        "posts by status (queued/sent/failed/cancelled).",
      inputSchema: {},
    },
    async () => {
      const settings = await pool.query(
        `select key, value from integration_settings
         where key in ('maytapi_daily_cap','maytapi_outbound_frozen','reactivation_campaign_enabled');`
      );
      const queue = await pool.query(
        `select status, count(*) as count from scheduled_group_posts
         where scheduled_at > now() - interval '7 days'
         group by status order by count desc;`
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ settings: settings.rows, last_7_days_queue: queue.rows }, null, 2),
        }],
      };
    }
  );

  // -------------------------------------------------------------------
  // Set the daily send cap
  // -------------------------------------------------------------------
  server.registerTool(
    "set_maytapi_cap",
    {
      title: "Set Maytapi daily cap",
      description: "Update the maximum number of WhatsApp/Maytapi sends allowed per day.",
      inputSchema: { cap: z.number().int().positive().describe("New daily cap, e.g. 40") },
    },
    async ({ cap }) => {
      await pool.query(
        `update integration_settings set value = $1, updated_at = now() where key = 'maytapi_daily_cap';`,
        [String(cap)]
      );
      return { content: [{ type: "text", text: `Daily Maytapi cap set to ${cap}.` }] };
    }
  );

  // -------------------------------------------------------------------
  // Freeze / unfreeze outbound sending (kill switch)
  // -------------------------------------------------------------------
  server.registerTool(
    "set_maytapi_freeze",
    {
      title: "Freeze or unfreeze Maytapi sending",
      description:
        "Turn the Maytapi outbound kill-switch on (freeze, stop all sending) " +
        "or off (unfreeze, resume sending).",
      inputSchema: { frozen: z.boolean().describe("true = freeze/stop sending, false = resume sending") },
    },
    async ({ frozen }) => {
      await pool.query(
        `update integration_settings set value = $1, updated_at = now() where key = 'maytapi_outbound_frozen';`,
        [frozen ? "true" : "false"]
      );
      return {
        content: [{
          type: "text",
          text: frozen ? "Maytapi outbound sending is now FROZEN." : "Maytapi outbound sending is now RESUMED.",
        }],
      };
    }
  );

  // -------------------------------------------------------------------
  // Queue a post to one of the 11 approved groups — nothing else
  // -------------------------------------------------------------------
  server.registerTool(
    "queue_group_post",
    {
      title: "Queue a WhatsApp group post",
      description:
        "Schedule a WhatsApp post to one of the 11 approved groups only. " +
        "Requests for any group not on the approved list are rejected.",
      inputSchema: {
        group_name: z.string().describe(
          "Must exactly match one of the 11 approved group names: " + Object.keys(APPROVED_GROUPS).join(", ")
        ),
        message_content: z.string().describe("The text to post"),
        scheduled_at: z.string().describe("ISO 8601 timestamp for when to send, e.g. 2026-08-10T17:00:00Z"),
        image_url: z.string().optional().describe("Optional image URL to attach"),
      },
    },
    async ({ group_name, message_content, scheduled_at, image_url }) => {
      const jid = APPROVED_GROUPS[group_name];
      if (!jid) {
        return {
          content: [{
            type: "text",
            text: `Rejected: "${group_name}" is not one of the 11 approved groups. ` +
              `Approved groups are: ${Object.keys(APPROVED_GROUPS).join(", ")}`,
          }],
          isError: true,
        };
      }
      const { rows } = await pool.query(
        `insert into scheduled_group_posts
           (target_group_name, target_group_jid, message_content, image_url, scheduled_at, status, source)
         values ($1, $2, $3, $4, $5, 'queued', 'mcp-direct')
         returning id, target_group_name, scheduled_at, status;`,
        [group_name, jid, message_content, image_url || null, scheduled_at]
      );
      return { content: [{ type: "text", text: JSON.stringify(rows[0], null, 2) }] };
    }
  );

  // -------------------------------------------------------------------
  // One-on-one prospector — status and queue a next touch
  // -------------------------------------------------------------------
  server.registerTool(
    "get_prospector_status",
    {
      title: "Get one-on-one prospector status",
      description:
        "Show one-on-one WhatsApp prospecting cadence status: how many contacts " +
        "are active/paused/completed, and upcoming sends.",
      inputSchema: {},
    },
    async () => {
      const byStatus = await pool.query(
        `select status, count(*) as count from prospect_cadence_state group by status order by count desc;`
      );
      const upcoming = await pool.query(
        `select contact_id, sequence_key, current_step, next_send_at
         from prospect_cadence_state
         where status = 'active' and next_send_at is not null
         order by next_send_at asc limit 20;`
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ by_status: byStatus.rows, next_20_upcoming: upcoming.rows }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    "queue_prospector_touch",
    {
      title: "Log a one-on-one prospector touch",
      description:
        "Record a one-on-one WhatsApp prospecting message as queued for a contact " +
        "(logs into prospect_invite_touches for the dispatcher to pick up).",
      inputSchema: {
        contact_id: z.string().describe("UUID of the contact"),
        phone_normalized: z.string().describe("Normalized phone number, e.g. +27831234567"),
        touch_number: z.number().int().describe("Which touch in the sequence this is, e.g. 1, 2, 3"),
        message_body: z.string().describe("The message text to send"),
      },
    },
    async ({ contact_id, phone_normalized, touch_number, message_body }) => {
      const { rows } = await pool.query(
        `insert into prospect_invite_touches
           (contact_id, phone_normalized, touch_number, message_body, status)
         values ($1, $2, $3, $4, 'queued')
         returning id, contact_id, touch_number, status;`,
        [contact_id, phone_normalized, touch_number, message_body]
      );
      return { content: [{ type: "text", text: JSON.stringify(rows[0], null, 2) }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP transport (stateless streamable HTTP, one server instance per request)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${MCP_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Get Well Hub MCP server listening on port ${PORT}`);
});
