#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { loadConfig, round, type Data } from "./core.js";
import { main, keptLeads, keywordTable, SKIPPABLE } from "./cli.js";
import { degraded } from "./usecases.js";
const answer = (data: Data) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
// 工具直接捕获运行器输出，不让报告混入 stdio MCP 协议。
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "new-term-radar", version: "0.2.1" },
    {
      instructions:
        "Start with recent_leads (free). keyword_table and run_radar call paid APIs and are slow; say so before using them. Keep keyword_table to one or two names.",
    },
  );
  const config = () => process.env.RADAR_CONFIG ?? "config.json",
    state = () => process.env.RADAR_STATE ?? "state";
  server.registerTool(
    "recent_leads",
    {
      description: "Local leads, review verdicts and hit rates. Free.",
      inputSchema: { days: z.number().int().min(0).default(7) },
    },
    async ({ days }) => answer(keptLeads(state(), days)),
  );
  server.registerTool(
    "keyword_table",
    {
      description:
        "Paid: investigate names, generic keywords, volume and Trends.",
      inputSchema: {
        names: z.array(z.string().trim().min(1)).min(1).max(8),
        repos: z.record(z.string(), z.string()).optional(),
      },
    },
    async ({ names, repos }) => {
      const [uc, text] = await keywordTable(
        loadConfig(config()),
        state(),
        names,
        repos ?? {},
      );
      return answer({
        table_markdown: text,
        run_id: uc.run_id,
        usage: uc.usage,
        unpriced_calls: uc.unpriced_calls ?? 0,
        rows: uc.rows ?? [],
        incomplete: degraded(uc),
        cost_usd: round((uc.cost_micros ?? 0) / 1e6, 4),
        model_unpriced_calls: uc.model_unpriced_calls ?? 0,
      });
    },
  );
  server.registerTool(
    "run_radar",
    {
      description:
        "Paid: run sources or daily, update persistent state, return report.",
      inputSchema: {
        command: z.enum(["sources", "daily"]).default("sources"),
        skip: z.array(z.enum(SKIPPABLE as [string, ...string[]])).default([]),
      },
    },
    async ({ command, skip }) => {
      const dir = mkdtempSync(join(tmpdir(), "radar-")),
        out = join(dir, "report.md");
      try {
        await main(
          [
            command,
            "--config",
            config(),
            "--state",
            state(),
            "--out",
            out,
            "--skip",
            skip.join(","),
          ],
          () => {},
        );
        return answer({
          report_markdown: existsSync(out) ? readFileSync(out, "utf8") : "",
          wrote_report: existsSync(out),
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  return server;
}
export async function serve(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  serve().catch((e) => {
    console.error(e.name);
    process.exitCode = 1;
  });
