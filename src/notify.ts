import { marked } from "marked";
import { UA } from "./core.js";
import prompts from "./prompts.json" with { type: "json" };
export const recipients = (s: string) =>
  s
    .split(/[,，;；\s]+/)
    .map((p) => p.replace(/^["'<>]+|["'<>]+$/g, ""))
    .filter(Boolean);
// 邮件使用内联样式，避免 Gmail 丢弃表格边框。
export function html(md: string): string {
  const styles: Record<string, string> = prompts.emailStyles;
  const body = (
    marked.parse(md, { async: false, gfm: true }) as string
  ).replace(
    /<(h2|h3|p|table|th|td|ul|li|a)(\s[^>]*)?>/g,
    (_, tag, attrs = "") =>
      tag === "td" && attrs.includes('style="text-align')
        ? `<td${attrs}>`
        : `<${tag} style="${styles[tag]}"${attrs}>`,
  );
  return `<div style="font:14px/1.6 -apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#1f2328;max-width:900px">${body}</div>`;
}
export async function send(subject: string, md: string): Promise<string> {
  const to = recipients(process.env.RADAR_EMAIL_TO ?? "");
  if (!to.length) return "mail skipped: RADAR_EMAIL_TO not set";
  const bad = to
    .map((a, i) =>
      /^[^@\s<>"']+@[^@\s<>"']+\.[a-z]{2,}$/i.test(a) ? 0 : i + 1,
    )
    .filter(Boolean);
  if (bad.length)
    throw new Error(
      `RADAR_EMAIL_TO: ${to.length} address(es), number ${bad.join(",")} is not an email address`,
    );
  if (!process.env.EMAIL_FROM || !process.env.RESEND_API_KEY)
    throw new Error("set EMAIL_FROM and RESEND_API_KEY");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html: html(md),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
  return `mail sent (${r.status})`;
}
