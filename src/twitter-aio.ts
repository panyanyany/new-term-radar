import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { type Data } from "./core.js";

export class TwitterAioError extends Error {
  override name = "TwitterAioError";
}
// 使用独立凭据或显式指定的 env 文件，不依赖相邻项目的运行时。
export function settings() {
  const file = process.env.TWITTER_AIO_ENV_FILE;
  const env = { ...(file ? parse(readFileSync(file)) : {}), ...process.env };
  const path = join(homedir(), ".twitter-aio/key");
  const key =
    env.X_TWEETS_TWITTER_AIO_API_KEY ||
    env.TWITTER_AIO_RAPIDAPI_KEY ||
    env.RAPIDAPI_KEY ||
    (existsSync(path) ? readFileSync(path, "utf8").trim() : "");
  if (!key?.trim())
    throw new TwitterAioError(
      "set TWITTER_AIO_RAPIDAPI_KEY or ~/.twitter-aio/key",
    );
  return {
    key: key.trim(),
    host:
      env.X_TWEETS_TWITTER_AIO_HOST ||
      env.TWITTER_AIO_RAPIDAPI_HOST ||
      "twitter-aio.p.rapidapi.com",
    base:
      env.X_TWEETS_TWITTER_AIO_BASE_URL ||
      env.TWITTER_AIO_RAPIDAPI_BASE_URL ||
      "https://twitter-aio.p.rapidapi.com",
  };
}
// 收费请求不自动重试；错误不携带 URL、请求头或供应商响应中的敏感信息。
export async function request(path: string, params: Data = {}): Promise<Data> {
  const cfg = settings(),
    url = new URL(path, cfg.base);
  for (const [k, v] of Object.entries(params))
    url.searchParams.set(k, String(v));
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "x-rapidapi-key": cfg.key, "x-rapidapi-host": cfg.host },
      signal: AbortSignal.timeout(40000),
    });
  } catch {
    throw new TwitterAioError(
      "Twitter AIO request failed (no automatic retry)",
    );
  }
  if (!response.ok)
    throw new TwitterAioError(`Twitter AIO HTTP ${response.status}`);
  let body: Data;
  try {
    body = await response.json();
  } catch {
    throw new TwitterAioError("Twitter AIO returned non-JSON content");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.error ||
    body.errors
  )
    throw new TwitterAioError("Twitter AIO returned an error response");
  return body;
}
// 优先使用长文正文；引用贴文保持嵌套，不冒充顶层搜索结果。
export function tweet(raw: Data): Data | null {
  const t = raw?.tweet ?? raw;
  if (
    t?.__typename === "TweetTombstone" ||
    t?.__typename === "TweetUnavailable"
  )
    return null;
  const l = t?.legacy,
    text = t?.note_tweet?.note_tweet_results?.result?.text ?? l?.full_text;
  const created = new Date(l?.created_at),
    likes = l?.favorite_count;
  if (
    !t?.rest_id ||
    typeof text !== "string" ||
    typeof likes !== "number" ||
    !Number.isFinite(likes) ||
    likes < 0 ||
    !Number.isFinite(+created)
  )
    throw new TwitterAioError("tweet missing valid id/text/likes/date");
  const author = t.core?.user_results?.result;
  const handle = author?.core?.screen_name ?? author?.legacy?.screen_name;
  return {
    id: String(t.rest_id),
    text,
    likeCount: likes,
    createdAt: created.toISOString(),
    isReply: !!l.in_reply_to_status_id_str,
    retweeted: !!(
      l.retweeted_status_result ||
      t.retweeted_status_result ||
      l.retweeted_status_id_str
    ),
    author: { userName: handle ?? "?" },
    url: handle
      ? `https://x.com/${handle}/status/${t.rest_id}`
      : `https://x.com/i/status/${t.rest_id}`,
  };
}
// 首页、分组与后续页的单条 entry 外壳采用同一遍历，避免漏读 Bottom 游标。
export function entries(rows: unknown): { tweets: Data[]; cursor?: string } {
  if (!Array.isArray(rows))
    throw new TwitterAioError("Twitter AIO missing entries array");
  const tweets: Data[] = [];
  let cursor: string | undefined;
  function visit(e: Data) {
    if (!e || typeof e !== "object")
      throw new TwitterAioError("invalid timeline entry");
    if (e.entry) {
      visit(e.entry);
      return;
    }
    if (Array.isArray(e.entries)) {
      e.entries.forEach(visit);
      return;
    }
    const c = e.content;
    if (c?.cursorType === "Bottom") {
      if (typeof c.value !== "string")
        throw new TwitterAioError("invalid Bottom cursor");
      cursor = c.value;
    }
    const raw = c?.itemContent?.tweet_results?.result;
    if (raw) {
      const t = tweet(raw);
      if (t) tweets.push(t);
    }
    // 兼容时间线内的线程模块，仅解析显式 tweet_results。
    if (Array.isArray(c?.items))
      for (const item of c.items) visit({ content: item.item });
  }
  rows.forEach(visit);
  return { tweets, cursor };
}
// 完整覆盖 30 小时才交付词表采集；固定置顶旧帖不能使第一页提前终止。
export async function userPosts(
  handle: string,
  now = new Date(),
  maxPages = 3,
): Promise<[Data[], number]> {
  const user = (
    await request(`/user/by/username/${encodeURIComponent(handle)}`)
  ).data?.user?.result;
  const actual = user?.core?.screen_name ?? user?.legacy?.screen_name;
  if (
    !user?.rest_id ||
    actual?.toLowerCase() !== handle.replace(/^@/, "").toLowerCase()
  )
    throw new TwitterAioError("Twitter AIO user lookup mismatch");
  const posts: Data[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body = await request(
      `/user/${encodeURIComponent(user.rest_id)}/tweetsAndReplies`,
      { count: 20, ...(cursor ? { cursor } : {}) },
    );
    const root = body.data?.data ?? body.data;
    const instructions = root?.user?.result?.timeline?.timeline?.instructions;
    if (!Array.isArray(instructions))
      throw new TwitterAioError("Twitter AIO missing timeline instructions");
    const batch = entries(
      instructions.flatMap(
        (i: Data) => i.entries ?? (i.entry ? [i.entry] : []),
      ),
    );
    let added = 0;
    for (const t of batch.tweets)
      if (!seen.has(t.id)) {
        if (Date.parse(t.createdAt) > +now + 300000)
          throw new TwitterAioError("tweet date is in the future");
        seen.add(t.id);
        added++;
        posts.push({
          account: handle,
          text: (t.retweeted ? "RT @" : "") + t.text,
          likes: t.likeCount,
          created: new Date(t.createdAt),
          url: t.url,
        });
      }
    if (
      !batch.cursor ||
      (batch.tweets.length &&
        Date.parse(batch.tweets.at(-1)!.createdAt) < +now - 30 * 3600000)
    )
      return [posts, 0];
    if (!added || cursors.has(batch.cursor))
      throw new TwitterAioError(
        "tweet pagination stalled; vocabulary unchanged",
      );
    cursors.add(batch.cursor);
    cursor = batch.cursor;
  }
  throw new TwitterAioError(
    `@${handle}: 30-hour coverage exceeds ${maxPages} pages; vocabulary unchanged`,
  );
}
export async function searchPage(query: string, cursor?: string) {
  const body = await request(`/search/${encodeURIComponent(query)}`, {
    category: "Top",
    count: 20,
    includeTimestamp: "false",
    ...(cursor ? { cursor } : {}),
  });
  return entries(body.entries);
}
