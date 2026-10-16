import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// 官方客户端通过真实子进程验证 stdio，不触发任何收费工具。
it("MCP handshake, tool discovery and free leads read work through stdio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-mcp-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("src/cli.ts"), "mcp"],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (p): p is [string, string] => p[1] !== undefined,
        ),
      ),
      RADAR_STATE: dir,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "radar-integration-test", version: "1.0" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "keyword_table",
      "recent_leads",
      "run_radar",
    ]);
    const result = await client.callTool({
      name: "recent_leads",
      arguments: { days: 7 },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual({
      leads: [],
      hit_rates: { by_signal: {}, pending: 0, window_days: 60 },
    });
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
