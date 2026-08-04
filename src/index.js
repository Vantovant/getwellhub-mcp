// Get Well Hub — standalone MCP server
// Connects Claude to the Get Well Hub app via a locked-down Supabase Edge
// Function ("mcp-bridge") instead of a direct database connection.
// Runs independently of Lovable — no Lovable credits/tokens are used.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration (set these as environment variables wherever you host this)
// ---------------------------------------------------------------------------
const BRIDGE_URL = "https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/mcp-bridge";
const BRIDGE_TOKEN = process.env.MCP_BRIDGE_TOKEN; // from Lovable Project Settings -> Secrets
const MCP_API_KEY = process.env.MCP_API_KEY;       // shared secret you invent, protects THIS server
const PORT = process.env.PORT || 3000;

if (!BRIDGE_TOKEN) {
  console.error("Missing MCP_BRIDGE_TOKEN environment variable. Copy it from Lovable > Project Settings > Secrets.");
  process.exit(1);
}
if (!MCP_API_KEY) {
  console.error("Missing MCP_API_KEY environment variable. Set any secret string you choose.");
  process.exit(1);
}

// Calls the Lovable edge function with the given action + payload.
async function callBridge(action, payload = {}) {
  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mcp-token": BRIDGE_TOKEN,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Bridge call failed with status ${res.status}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// The 11 approved WhatsApp groups (also enforced server-side by the bridge,
// this copy is just for the tool description so Claude sees valid options).
// ---------------------------------------------------------------------------
const APPROVED_GROUPS = [
  "APLGO",
  "APLGO | Health and Biz",
  "APLGO | Health and Biz KZN",
  "APLGO | Health and Biz Global Distributors",
  "APLGO | Health and Biz E&W Cape",
  "APLGO| Health and Biz North West",
  "APLGO 4 SHO",
  "Ascension Bloemfontein",
  "90 day Challenge and FB Campaign",
  "Botswana APLGO Presentations",
  "New Day New Life",
];

// ---------------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------------
function buildServer() {
  const server = new McpServer({
    name: "getwellhub-mcp",
    version: "2.1.0",
  });

  server.registerTool(
    "get_maytapi_status",
    {
      title: "Get Maytapi status",
      description:
        "Show the current Maytapi WhatsApp automation status: daily send cap, " +
        "whether outbound sending is frozen, and a count of scheduled group " +
        "posts by status over the last 7 days.",
      inputSchema: {},
    },
    async () => {
      const data = await callBridge("get_maytapi_status");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "set_maytapi_cap",
    {
      title: "Set Maytapi daily cap",
      description: "Update the maximum number of WhatsApp/Maytapi sends allowed per day.",
      inputSchema: { cap: z.number().int().positive().describe("New daily cap, e.g. 40") },
    },
    async ({ cap }) => {
      const data = await callBridge("set_maytapi_cap", { cap });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

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
      const data = await callBridge("set_maytapi_freeze", { frozen });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "queue_group_post",
    {
      title: "Queue a WhatsApp group post",
      description:
        "Schedule a WhatsApp post to one of the 11 approved groups only. " +
        "Requests for any group not on the approved list are rejected by the server.",
      inputSchema: {
        group_name: z.string().describe(
          "Must exactly match one of the 11 approved group names: " + APPROVED_GROUPS.join(", ")
        ),
        message_content: z.string().describe("The text to post"),
        scheduled_at: z.string().describe("ISO 8601 timestamp for when to send, e.g. 2026-08-10T17:00:00Z"),
        image_url: z.string().optional().describe("Optional image URL to attach"),
      },
    },
    async ({ group_name, message_content, scheduled_at, image_url }) => {
      const data = await callBridge("queue_group_post", {
        group_name,
        message_content,
        scheduled_at,
        image_url,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

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
      const data = await callBridge("get_prospector_status");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "queue_prospector_touch",
    {
      title: "Log a one-on-one prospector touch",
      description:
        "Record a one-on-one WhatsApp prospecting message as queued for a contact.",
      inputSchema: {
        contact_id: z.string().describe("UUID of the contact"),
        phone_normalized: z.string().describe("Normalized phone number, e.g. +27831234567"),
        touch_number: z.number().int().describe("Which touch in the sequence this is, e.g. 1, 2, 3"),
        message_body: z.string().describe("The message text to send"),
      },
    },
    async ({ contact_id, phone_normalized, touch_number, message_body }) => {
      const data = await callBridge("queue_prospector_touch", {
        contact_id,
        phone_normalized,
        touch_number,
        message_body,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------
  // Contact management tools (added for daily operational use)
  // ---------------------------------------------------------------------

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description:
        "Read contacts, optionally filtered by lead_type, temperature, tag, or " +
        "free-text search on name/phone. Returns up to 100 contacts.",
      inputSchema: {
        lead_type: z.enum(["prospect", "registered", "buyer", "vip"]).optional()
          .describe("Filter by lead type"),
        temperature: z.enum(["hot", "warm", "cold"]).optional()
          .describe("Filter by temperature"),
        tag: z.string().optional().describe("Filter by a single tag"),
        search: z.string().optional().describe("Free-text search on name or phone number"),
        limit: z.number().int().positive().max(100).optional()
          .describe("Max results to return, default 25, max 100"),
      },
    },
    async ({ lead_type, temperature, tag, search, limit }) => {
      const data = await callBridge("list_contacts", { lead_type, temperature, tag, search, limit });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get a single contact",
      description:
        "Get full detail for one contact by id or phone number, including their " +
        "last 10 activity log entries.",
      inputSchema: {
        contact_id: z.string().optional().describe("UUID of the contact"),
        phone_normalized: z.string().optional().describe("Normalized phone number, e.g. +27831234567"),
      },
    },
    async ({ contact_id, phone_normalized }) => {
      const data = await callBridge("get_contact", { contact_id, phone_normalized });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update a contact",
      description:
        "Edit specific fields on a contact (name, email, lead_type, temperature, tags, " +
        "do_not_contact). Only the fields you provide are changed — everything else " +
        "is left untouched.",
      inputSchema: {
        contact_id: z.string().describe("UUID of the contact to update"),
        name: z.string().optional().describe("New name"),
        email: z.string().optional().describe("New email address"),
        lead_type: z.enum(["prospect", "registered", "buyer", "vip"]).optional()
          .describe("New lead type"),
        temperature: z.enum(["hot", "warm", "cold"]).optional().describe("New temperature"),
        tags: z.array(z.string()).optional().describe("Replaces the full tags list"),
        do_not_contact: z.boolean().optional().describe("Set do-not-contact flag"),
      },
    },
    async ({ contact_id, name, email, lead_type, temperature, tags, do_not_contact }) => {
      const data = await callBridge("update_contact", {
        contact_id, name, email, lead_type, temperature, tags, do_not_contact,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "add_contact_note",
    {
      title: "Add a note to a contact",
      description:
        "Append a timestamped note to a contact's notes field. This is strictly " +
        "additive — it never overwrites or removes existing notes — and also logs " +
        "a note_added activity entry.",
      inputSchema: {
        contact_id: z.string().describe("UUID of the contact"),
        note: z.string().describe("The note text to append"),
      },
    },
    async ({ contact_id, note }) => {
      const data = await callBridge("add_contact_note", { contact_id, note });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
  const queryKey = req.query.key;
  const authorized =
    auth === `Bearer ${MCP_API_KEY}` || queryKey === MCP_API_KEY;
  if (!authorized) {
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
