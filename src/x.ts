import * as aio from "./twitter-aio.js";
import * as scrappa from "./scrappa.js";
import * as aisa from "./aisa.js";
import { shift, type Data } from "./core.js";
// 备选按用途显式切换，不在失败后隐式触发另一家收费请求。
export function provider(kind: "timeline" | "search") {
  const value =
    process.env[
      kind === "timeline" ? "X_TIMELINE_PROVIDER" : "X_SEARCH_PROVIDER"
    ] || "twitter-aio";
  if (
    value !== "twitter-aio" &&
    value !== (kind === "timeline" ? "scrappa" : "aisa")
  )
    throw new Error(`unsupported X ${kind} provider`);
  return value;
}
export async function userPosts(
  handle: string,
  now = new Date(),
): Promise<[Data[], number]> {
  return provider("timeline") === "scrappa"
    ? scrappa.userPosts(handle, now)
    : aio.userPosts(handle, now);
}
// 两家搜索使用相同本地契约，检查顶层正文，避免引用贴文与同词片段误匹配。
export function matches(
  t: Data,
  name: string,
  since: string,
  now = Date.now(),
) {
  const escaped = name
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
    "iu",
  );
  const date = Date.parse(t.createdAt);
  return (
    !!t.id &&
    typeof t.text === "string" &&
    pattern.test(t.text) &&
    typeof t.likeCount === "number" &&
    Number.isFinite(t.likeCount) &&
    t.likeCount >= 50 &&
    Number.isFinite(date) &&
    date >= Date.parse(since) &&
    date <= now &&
    t.isReply === false &&
    !t.inReplyToId
  );
}
// 最多五页、收集十二条合格证据即停止；分页异常显式报错而非返回伪空结果。
export async function search(
  name: string,
  day: string,
  maxPages = 5,
): Promise<[Data[], number]> {
  const source = provider("search"),
    since = shift(day, -14);
  const phrase = name.replace(/["\\]/g, " ");
  const query = `"${phrase}" min_faves:50 -filter:replies since:${since}`;
  const out: Data[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined,
    cost = 0;
  for (let page = 0; page < maxPages; page++) {
    let tweets: Data[], next: string | undefined;
    if (source === "twitter-aio") {
      const batch = await aio.searchPage(query, cursor);
      cost += aio.REQUEST_COST_MICROS;
      tweets = batch.tweets;
      next = batch.cursor;
    } else {
      const [data, c] = await aisa.call([
        {
          call_id: "s",
          tool: "get_twitter_tweet_advanced_search",
          arguments: { query, queryType: "Top", ...(cursor ? { cursor } : {}) },
        },
      ]);
      cost += c;
      const body = data.s?.data ?? data.s;
      if (!Array.isArray(body?.tweets))
        throw new Error("AIsa search missing tweets array");
      tweets = body.tweets;
      if (body.has_next_page) {
        if (typeof body.next_cursor !== "string" || !body.next_cursor)
          throw new Error("AIsa search missing next cursor");
        next = body.next_cursor;
      }
    }
    let added = 0;
    for (const t of tweets) {
      if (
        !t.id ||
        typeof t.text !== "string" ||
        !Number.isFinite(Date.parse(t.createdAt)) ||
        typeof t.isReply !== "boolean" ||
        typeof t.likeCount !== "number" ||
        !Number.isFinite(t.likeCount)
      )
        throw new Error("X search tweet missing required fields");
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      added++;
      if (matches(t, name, since)) out.push(t);
    }
    if (out.length >= 12 || !next)
      return [out.sort((a, b) => b.likeCount - a.likeCount).slice(0, 12), cost];
    if (!added || cursors.has(next))
      throw new Error("X search pagination stalled");
    cursors.add(next);
    cursor = next;
  }
  return [out.sort((a, b) => b.likeCount - a.likeCount).slice(0, 12), cost];
}
