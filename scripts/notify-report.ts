import { readFileSync, statSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as dotenv } from "dotenv";
import { jsonFetch } from "../src/core.js";
// 摘要只列优先名称和最强仓库，完整 Markdown 由 Telegram 附件承载。
export function summary(md: string): string {
  const lines = ["🛰 新词雷达"],
    cost = md.match(
      /(?:本次(?: AIsa)?数据(?:花费|成本估算)|Data cost estimate(?: this run)?)[:：]\s*(\$[0-9]+(?:\.[0-9]+)?)/i,
    );
  if (cost) lines.push(`本次数据成本估算 ${cost[1]}`);
  const rows = md
    .split("\n")
    .filter(
      (l) =>
        l.trimStart().startsWith("|") && /\*\*(优先|Prioritize)\*\*/i.test(l),
    );
  const names = rows
    .map((r) =>
      r
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim().replaceAll("*", "")),
    )
    .filter((c) => c[1] === "名字" || c[1] === "name");
  if (names.length)
    lines.push(
      "\n优先（名字与其规模）：",
      ...names
        .slice(0, 8)
        .map((c) => `· ${c[0]} — 约 ${c[4]} 次/天，${c.at(-2)}`),
    );
  const repos = [
    ...md.matchAll(
      /\|\s*(?:🆕\s*)?\[([^\]]+)\]\(https:\/\/github.com\/[^)]+\)\s*\|\s*(\d+)\s*\|/g,
    ),
  ]
    .sort((a, b) => Number(b[2]) - Number(a[2]))
    .slice(0, 3);
  if (repos.length)
    lines.push(
      "\nGitHub 爆发最高：" + repos.map((r) => `${r[1]} ★${r[2]}`).join("、"),
    );
  return lines.join("\n");
}
async function post(
  url: string,
  body: BodyInit,
  headers: Record<string, string> = {},
): Promise<boolean> {
  try {
    const b = await jsonFetch(url, { method: "POST", headers, body }, 90000);
    return b.ok === true || b.code === 0 || b.StatusCode === 0;
  } catch {
    console.error("notification request failed (credentials omitted)");
    return false;
  }
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (!argv[0]) {
    console.error("usage: pnpm notify report.md");
    return 2;
  }
  const path = argv[0];
  if (!existsSync(path)) {
    console.error(`no report at ${path}`);
    return 1;
  }
  dotenv({ quiet: true });
  const top = summary(readFileSync(path, "utf8")),
    token = process.env.TELEGRAM_BOT_TOKEN?.trim(),
    chat = process.env.TELEGRAM_CHAT_ID?.trim(),
    hook = process.env.FEISHU_GROUP_HOOK?.trim(),
    results: boolean[] = [];
  if (token && chat) {
    const url = `https://api.telegram.org/bot${token}/`,
      ok = await post(
        url + "sendMessage",
        JSON.stringify({
          chat_id: chat,
          text: (top + `\n\n完整内容见随附 ${basename(path)}。`).slice(0, 4000),
        }),
        { "Content-Type": "application/json" },
      );
    console.log(`telegram sendMessage: ${ok}`);
    results.push(ok);
    if (ok && statSync(path).size <= 45 * 1024 * 1024) {
      const form = new FormData();
      form.set("chat_id", chat);
      form.set("caption", basename(path) + " · 新词雷达日报");
      form.set(
        "document",
        new Blob([readFileSync(path)], {
          type: "text/markdown; charset=utf-8",
        }),
        basename(path),
      );
      const sent = await post(url + "sendDocument", form);
      console.log(`telegram sendDocument: ${sent}`);
      results.push(sent);
    }
  } else
    console.log(
      "telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set",
    );
  if (hook) {
    const ok = await post(
      hook,
      JSON.stringify({
        msg_type: "text",
        content: { text: top.slice(0, 18000) },
      }),
      { "Content-Type": "application/json" },
    );
    console.log(`feishu sendMessage: ${ok}`);
    results.push(ok);
  } else console.log("feishu skipped: FEISHU_GROUP_HOOK not set");
  return results.every(Boolean) ? 0 : 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((c) => {
      process.exitCode = c;
    })
    .catch(() => {
      console.error("notification failed (credentials omitted)");
      process.exitCode = 1;
    });
