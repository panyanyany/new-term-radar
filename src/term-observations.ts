import { Store } from "./store.js";
import { compact } from "./core.js";
export const termKey = (term: string) =>
  compact(term).normalize("NFKC").toLowerCase();
// 原始发现独立记录，不覆盖日报解释和证据；状态仍由应用层验证。
export function rememberDiscoveries(
  store: Store,
  rows: { term: string }[],
  now = new Date(),
) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS term_discoveries (key TEXT PRIMARY KEY, term TEXT NOT NULL, first_seen_at TEXT NOT NULL)",
  );
  const insert = store.db.prepare(
    "INSERT INTO term_discoveries(key,term,first_seen_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET first_seen_at=min(term_discoveries.first_seen_at,excluded.first_seen_at)",
  );
  store.db.transaction(() =>
    rows.forEach((r) => insert.run(termKey(r.term), r.term, now.toISOString())),
  )();
}
export function discoveredAt(store: Store, term: string): string | undefined {
  return (
    store.db
      .prepare("SELECT first_seen_at FROM term_discoveries WHERE key=?")
      .get(termKey(term)) as { first_seen_at: string } | undefined
  )?.first_seen_at;
}
