import {
  unique,
  loadSnap,
  saveSnap,
  t,
  today,
  shift,
  STOP,
  compact,
  jsonFetch,
  type Data,
  type Config,
} from "./core.js";
import { names, dropNested } from "./terms.js";
import { userPosts } from "./x.js";
export const accounts = (cfg: Config) =>
  unique<string>([...cfg.x_accounts.labs, ...cfg.x_accounts.bloggers]);
// 过滤转发、旧帖和已见名称，单帖最多保留三个强名称。
export function novelNames(
  posts: Data[],
  vocab: Record<string, string>,
  now: Date,
): Data[] {
  const found: Record<string, Data> = {};
  for (const p of posts) {
    if (
      !p.created ||
      +new Date(p.created) < +now - 30 * 3600000 ||
      p.text.startsWith("RT @")
    )
      continue;
    const strong = names(p.text, true);
    for (const term of names(p.text)) {
      if (term in vocab) continue;
      const r = (found[term] ??= {
        term,
        sources: new Set<string>(),
        likes: 0,
        examples: [],
        posts: [],
        strong: false,
      });
      if (!r.sources.has(p.account)) {
        r.likes += p.likes;
        r.examples.push(`@${p.account}: ${compact(p.text).slice(0, 80)}`);
        r.posts.push({
          account: p.account,
          text: compact(p.text),
          url: p.url ?? "",
          likes: p.likes,
        });
      }
      r.sources.add(p.account);
      r.strong ||= strong.has(term);
    }
  }
  const rows = Object.values(found)
      .filter((r) => r.sources.size >= 2 || (r.strong && r.likes >= 100))
      .sort(
        (a, b) =>
          b.sources.size - a.sources.size || b.term.length - a.term.length,
      ),
    counts: Record<string, number> = {},
    kept: Data[] = [];
  for (const r of rows) {
    if (r.sources.size === 1) {
      const post = r.examples[0];
      if ((counts[post] ?? 0) >= 3) continue;
      counts[post] = (counts[post] ?? 0) + 1;
    }
    delete r.strong;
    r.recent = r.sources.size;
    r.note = t("note_x", { n: r.recent, likes: r.likes });
    r.sources = [...r.sources].sort();
    kept.push(r);
  }
  return dropNested(
    kept.sort((a, b) => b.recent - a.recent || b.likes - a.likes),
  ).slice(0, 25);
}
export async function xNew(cfg: Config, state: string): Promise<Data> {
  const handles = accounts(cfg);
  if (!handles.length) return { skipped: true };
  const posts: Data[] = [];
  let cost = 0;
  const now = new Date();
  for (const h of handles) {
    const [p, c] = await userPosts(h, now);
    posts.push(...p);
    cost += c;
  }
  const old = loadSnap<Record<string, string>>(state, "x_vocab"),
    rows = old === null ? [] : novelNames(posts, old, new Date()),
    vocab = old ?? {},
    day = today();
  for (const p of posts) for (const name of names(p.text)) vocab[name] = day;
  if (posts.length)
    saveSnap(
      state,
      "x_vocab",
      Object.fromEntries(
        Object.entries(vocab).filter(([, d]) => d >= shift(day, -60)),
      ),
    );
  return {
    accounts: handles.length,
    answered: handles.length,
    posts: posts.length,
    cost_micros: cost,
    first_run: old === null,
    terms: rows,
  };
}
export function baseName(id: string): string {
  let name = id.split("/").at(-1)!;
  for (let i = 0; i < 4; i++)
    name = name.replace(
      /[-_.](gguf|ggml|awq|gptq|fp8|fp16|bf16|int[48]|mlx|exl2|onnx|uncensored|abliterated|instruct|chat|it|base|preview|turbo|lora|q\d\w*|\d+(\.\d+)?b|a\d+(\.\d+)?b)(?=[-_.]|$)/gi,
      "",
    );
  return name.replace(/[-_]+/g, " ").trim().toLowerCase();
}
export async function hfNew(_cfg: Config, state: string): Promise<Data> {
  const models = (await jsonFetch(
    "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=100",
  )) as unknown as Data[];
  if (!Array.isArray(models)) throw new Error("HF missing models array");
  const old = loadSnap<string[]>(state, "hf_top");
  if (models.length)
    saveSnap(
      state,
      "hf_top",
      models.map((m) => m.id),
    );
  if (old === null)
    return { models: models.length, first_run: true, terms: [] };
  const grouped: Record<string, Data> = {};
  models.slice(0, 50).forEach((m, i) => {
    if (old.includes(m.id)) return;
    const term = baseName(m.id);
    if (!term || STOP.has(term)) return;
    const r = (grouped[term] ??= {
      term,
      rank: i + 1,
      copies: 0,
      examples: [],
    });
    r.copies++;
    r.examples.push(`${m.id} (${m.pipeline_tag || "?"}, ♥${m.likes ?? 0})`);
  });
  const rows = Object.values(grouped).sort((a, b) => a.rank - b.rank);
  for (const r of rows) {
    r.recent = r.copies;
    r.note =
      t("note_hf", { rank: r.rank }) +
      (r.copies > 1 ? t("note_hf_copies", { n: r.copies }) : "");
  }
  return { models: models.length, first_run: false, terms: rows.slice(0, 25) };
}
