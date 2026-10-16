import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import defaults from "./defaults.json" with { type: "json" };
import messages from "./messages.json" with { type: "json" };
import prompts from "./prompts.json" with { type: "json" };
// 上游 JSON 与可选信号共用开放字段；核心日期、序列和接口另外约束。
export type Data = Record<string, any>;
export type Point = [string, number, ...number[]];
export type Config = Omit<
  typeof defaults,
  | "x_accounts"
  | "sitemaps"
  | "topics"
  | "known_terms"
  | "stop_words"
  | "gsc"
  | "new_sites"
> & {
  _dir: string;
  x_accounts: { labs: string[]; bloggers: string[] };
  sitemaps: Record<
    string,
    { index: string; shards?: string; pause?: number; strip_locale?: boolean }
  >;
  topics: Record<string, string>;
  known_terms: string[];
  stop_words: string[];
  gsc: { site?: string; token_file?: string };
  new_sites: Omit<typeof defaults.new_sites, "queries"> & {
    queries: Record<string, string>;
  };
};
export const UA = "new-term-radar/0.2.1";
// 业务日期沿用服务器本地日历，Trends 服务窗口单独使用 UTC。
export const utcToday = () => new Date().toISOString().slice(0, 10);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const shift = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const days = (a: string, b: string) =>
  (Date.parse(a) - Date.parse(b)) / 86400000;
export const unique = <T>(a: T[]) => [...new Set(a)];
export const mean = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
export const median = (a: number[]) => {
  const s = [...a].sort((a, b) => a - b);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2
    : null;
};
// Python 使用银行家舍入，保留旧报告阈值与快照结果。
export function round(v: number, d = 0): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  view.setFloat64(0, Math.abs(v));
  const bits = view.getBigUint64(0),
    exp = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  let numerator = exp ? fraction + (1n << 52n) : fraction,
    denominator = 1n;
  const power = (exp ? exp - 1023 : -1022) - 52;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  if (d >= 0) numerator *= 10n ** BigInt(d);
  else denominator *= 10n ** BigInt(-d);
  let q = numerator / denominator;
  const remainder = numerator % denominator;
  if (
    remainder * 2n > denominator ||
    (remainder * 2n === denominator && q % 2n !== 0n)
  )
    q++;
  return ((v < 0 ? -1 : 1) * Number(q)) / 10 ** d;
}
export const compact = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
export const errorText = (e: unknown) =>
  e instanceof Error
    ? `${e.name}: ${compact(e.message).slice(0, 160)}`
    : compact(e).slice(0, 160);
let lang = 0;
export function setLang(value: string) {
  lang = value.startsWith("zh") ? 1 : 0;
}
export function t(key: string, args: Data = {}): string {
  const value = (messages as Record<string, string[]>)[key]?.[lang] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, k) => String(args[k] ?? `{${k}}`));
}
export const STOP = new Set<string>(prompts.stop);
export function loadConfig(path: string): Config {
  if (!existsSync(path))
    throw new Error(`${path} not found: copy config.example.json and edit it`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const cfg: Data = {};
  for (const [k, v] of Object.entries(defaults)) {
    cfg[k] =
      v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length
        ? { ...v, ...raw[k] }
        : (raw[k] ?? v);
  }
  cfg._dir = dirname(resolve(path));
  setLang(cfg.lang);
  // 每次加载都以当前配置重建，避免 MCP 连续实验时残留上次的停用词。
  STOP.clear();
  for (const w of prompts.stop) STOP.add(w);
  for (const w of cfg.stop_words) STOP.add(w.toLowerCase());
  return cfg as Config;
}
export function known(cfg: Config, term: string) {
  return (
    cfg.known_terms
      .map((s: string) => s.toLowerCase())
      .find((k: string) => k && (term.includes(k) || k.includes(term))) ?? ""
  );
}
export function loadSnap<T>(state: string, name: string): T | null {
  const p = join(state, `${name}.json.gz`);
  return existsSync(p)
    ? JSON.parse(gunzipSync(readFileSync(p)).toString())
    : null;
}
// 原子替换防止中断损坏原有 gzip JSON，格式与 Python 兼容。
export function saveSnap(state: string, name: string, data: unknown) {
  mkdirSync(state, { recursive: true });
  const p = join(state, `${name}.json.gz`);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, gzipSync(JSON.stringify(data)));
  renameSync(tmp, p);
}
export async function jsonFetch(
  url: string,
  init: RequestInit = {},
  timeout = 40000,
): Promise<Data> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeout),
    headers: { "user-agent": UA, ...init.headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Data;
}
