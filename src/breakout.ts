import {
  jsonFetch,
  round,
  shift,
  today,
  loadSnap,
  saveSnap,
  t,
  type Data,
  type Config,
} from "./core.js";
// GitHub 公共接口可选令牌，仅提升限流额度。
export function get(path: string): Promise<Data> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return jsonFetch(
    "https://api.github.com" + path,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    30000,
  );
}
export const repoTerm = (name: string) =>
  name
    .replace(/[-_.]+/g, " ")
    .trim()
    .toLowerCase();
export function score(
  repos: Data[],
  before: Record<string, number> | null,
  now: Date,
  velocityMin = 200,
  deltaMin = 400,
): Data[] {
  return repos
    .flatMap((r) => {
      const age = Math.max((+now - Date.parse(r.created_at)) / 86400000, 1),
        velocity = r.stargazers_count / age,
        delta =
          before && r.full_name in before
            ? r.stargazers_count - before[r.full_name]
            : null;
      if (velocity < velocityMin && (delta == null || delta < deltaMin))
        return [];
      const [owner, name] = r.full_name.split("/");
      return [
        {
          repo: r.full_name,
          owner,
          name,
          stars: r.stargazers_count,
          velocity: round(velocity),
          delta,
          age_days: round(age, 1),
          description: (r.description ?? "").slice(0, 120),
        },
      ];
    })
    .sort(
      (a, b) =>
        Math.max(b.velocity, b.delta ?? 0) - Math.max(a.velocity, a.delta ?? 0),
    )
    .slice(0, 15);
}
export function variants(row: Data, display: string): string[] {
  const term = repoTerm(row.name),
    out = [term, `${row.owner.toLowerCase()} ${term}`],
    first = (display || "").split(" ")[0].toLowerCase();
  if (first && first !== row.owner.toLowerCase() && /^[a-z]+$/.test(first))
    out.push(`${first} ${term}`);
  return out;
}
export async function breakouts(cfg: Config, state: string): Promise<Data> {
  const c = cfg.breakout,
    day = today(),
    q = encodeURIComponent(
      `created:>=${shift(day, -c.window_days)} stars:>=${c.min_stars}`,
    ),
    repos: Data[] = [];
  for (let page = 1; page <= 2; page++) {
    const items =
      (
        await get(
          `/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`,
        )
      ).items ?? [];
    repos.push(...items);
    if (items.length < 100) break;
  }
  const before = loadSnap<Record<string, number>>(state, "gh_stars"),
    rows = score(repos, before, new Date(), c.velocity_min, c.delta_min);
  if (repos.length)
    saveSnap(
      state,
      "gh_stars",
      Object.fromEntries(repos.map((r) => [r.full_name, r.stargazers_count])),
    );
  const flagged = loadSnap<Record<string, string>>(state, "gh_flagged") ?? {};
  for (const r of rows) {
    r.new = !(r.repo in flagged);
    flagged[r.repo] ??= day;
  }
  saveSnap(
    state,
    "gh_flagged",
    Object.fromEntries(
      Object.entries(flagged).filter(([, d]) => d >= shift(day, -30)),
    ),
  );
  const terms: Data[] = [];
  for (const r of rows.filter((r) => r.new)) {
    let display = "";
    try {
      display = (await get(`/users/${r.owner}`)).name ?? "";
    } catch {}
    r.variants = variants(r, display);
    terms.push({
      term: r.variants[0],
      recent: 1,
      variants: r.variants,
      repo: r.repo,
      note: t("note_breakout", {
        ...r,
        gain:
          r.delta != null ? t("note_breakout_gain", { delta: r.delta }) : "",
      }),
      examples: [`${r.repo}: ${r.description}`],
    });
  }
  return {
    searched: repos.length,
    first_run: before === null,
    repos: rows,
    terms,
    window_days: c.window_days,
  };
}
