import { readFileSync, statSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as dotenv } from "dotenv";
import { jsonFetch } from "../src/core.js";
// 摘要只列优先名称和最强仓库，完整 Markdown 由 Telegram 附件承载。
export function summary(md: string, includeCosts = true): string {
  // 简报正文保持新词、旧词两段；费用段仅在私人会话摘要和附件中保留。
  if (md.startsWith("## 1. 当天新词"))
    return (includeCosts ? md : withoutCosts(md)).trim().slice(0, 3500);
  const lines = ["🛰 新词雷达"],
    cost = md.match(
      /(?:本次(?:\s*AIsa)?\s*数据(?:花费|成本估算)|本次总成本估算|(?:Data|Total) cost estimate(?: this run)?)[:：]\s*(\$[0-9]+(?:\.[0-9]+)?)/i,
    );
  if (includeCosts && cost)
    lines.push(
      `${/(?:本次总成本|Total cost)/i.test(cost[0]) ? "本次总成本估算" : "本次数据成本估算"} ${cost[1]}`,
    );
  const unpriced = md.match(
    /(?:费用估算不完整[^\n]*|Cost estimate incomplete[^\n]*)/i,
  );
  if (includeCosts && unpriced) lines.push(unpriced[0]);
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
// 群聊附件移除费用合计、未计价提示与费用分布表，原始本地报告保留。
export function withoutCosts(md: string): string {
  md = md.replace(/^## 3\. 花费[\s\S]*$/m, "").trimEnd();
  let costTable = false;
  return md
    .split("\n")
    .filter((line) => {
      if (/^\|\s*(?:费用来源|Cost source)\s*\|/i.test(line)) {
        costTable = true;
        return false;
      }
      if (costTable && line.trimStart().startsWith("|")) return false;
      costTable = false;
      return !/(?:本次(?:\s*AIsa)?\s*数据(?:花费|成本估算)|本次总成本估算|(?:Data|Total) cost estimate|费用估算不完整|Cost estimate incomplete|^已计价合计)/i.test(
        line,
      );
    })
    .join("\n");
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
  const markdown = readFileSync(path, "utf8"),
    token = process.env.TELEGRAM_BOT_TOKEN?.trim(),
    chat = process.env.TELEGRAM_CHAT_ID?.trim(),
    hook = process.env.FEISHU_GROUP_HOOK?.trim(),
    results: boolean[] = [];
  if (token && chat) {
    // Bot API 的私聊 ID 为正整数；群/超级群为负数，频道用户名也不作为私聊。
    const privateChat = /^[1-9]\d*$/.test(chat),
      top = summary(markdown, privateChat),
      document = privateChat ? markdown : withoutCosts(markdown),
      url = `https://api.telegram.org/bot${token}/`,
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
        new Blob([document], {
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
        content: { text: summary(markdown, false).slice(0, 18000) },
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
