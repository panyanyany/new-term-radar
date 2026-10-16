import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { today, shift, unique, median, type Data } from "./core.js";
export const SCHEMA = `CREATE TABLE IF NOT EXISTS leads (term TEXT PRIMARY KEY,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,signals TEXT NOT NULL DEFAULT '[]',notes TEXT NOT NULL DEFAULT '[]',named REAL,variants TEXT NOT NULL DEFAULT '[]',reviewed_at TEXT,verdict TEXT,lead_days INTEGER,trends TEXT)`;
// 直接复用旧 SQLite 表，首次发现与复盘状态不会在更新线索时重置。
export class Store {
  db: Database.Database;
  constructor(state: string) {
    mkdirSync(state, { recursive: true });
    this.db = new Database(join(state, "radar.db"));
    this.db.exec(SCHEMA);
  }
  close() {
    this.db.close();
  }
  record(rows: Data[], day = today()): number {
    this.db.transaction(() => {
      for (const r of rows) {
        const old = this.db
          .prepare("SELECT * FROM leads WHERE term=?")
          .get(r.term) as Data | undefined;
        const kinds = unique<string>([
            ...(old ? JSON.parse(old.signals) : []),
            ...r.kinds,
          ]).sort(),
          notes = unique<string>([
            ...(old ? JSON.parse(old.notes) : []),
            ...r.signals,
          ]).slice(-10),
          variants = unique<string>([
            ...(old ? JSON.parse(old.variants) : []),
            ...(r.variants ?? []),
          ]);
        this.db
          .prepare(
            `INSERT INTO leads(term,first_seen,last_seen,signals,notes,named,variants) VALUES(?,?,?,?,?,?,?) ON CONFLICT(term) DO UPDATE SET last_seen=excluded.last_seen,signals=excluded.signals,notes=excluded.notes,named=excluded.named,variants=excluded.variants`,
          )
          .run(
            r.term,
            old?.first_seen ?? day,
            day,
            JSON.stringify(kinds),
            JSON.stringify(notes),
            r.named ?? old?.named ?? null,
            JSON.stringify(variants),
          );
      }
    })();
    return rows.length;
  }
  due(day: string, after: number, limit: number): [string, string, string[]][] {
    return (
      this.db
        .prepare(
          "SELECT term,first_seen,variants FROM leads WHERE reviewed_at IS NULL AND first_seen<=? ORDER BY first_seen,term LIMIT ?",
        )
        .all(shift(day, -after), limit) as Data[]
    ).map((r) => [r.term, r.first_seen, JSON.parse(r.variants)]);
  }
  saveVerdict(
    term: string,
    verdict: string,
    lead: number | null,
    trends: Data,
    day = today(),
  ) {
    this.db
      .prepare(
        "UPDATE leads SET reviewed_at=?,verdict=?,lead_days=?,trends=? WHERE term=?",
      )
      .run(day, verdict, lead, JSON.stringify(trends), term);
  }
  recentSources(day = today()): Data[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM leads WHERE last_seen>=? ORDER BY last_seen DESC,term",
        )
        .all(shift(day, -1)) as Data[]
    )
      .map((r) => ({
        term: r.term,
        kinds: JSON.parse(r.signals),
        note: JSON.parse(r.notes).at(-1) ?? "",
        named: r.named,
      }))
      .filter((r) => r.kinds.some((k: string) => ["x", "hf"].includes(k)))
      .slice(0, 20);
  }
  summary(day = today()): Data {
    const by: Data = {};
    for (const r of this.db
      .prepare(
        "SELECT * FROM leads WHERE reviewed_at>=? AND verdict IS NOT NULL",
      )
      .all(shift(day, -60)) as Data[])
      for (const k of JSON.parse(r.signals).length
        ? JSON.parse(r.signals)
        : ["?"]) {
        const s = (by[k] ??= { checked: 0, hit: 0, leads: [] });
        s.checked++;
        if (r.verdict === "hit") {
          s.hit++;
          s.leads.push(r.lead_days);
        }
      }
    for (const s of Object.values(by)) {
      s.median_lead = median(s.leads);
      delete s.leads;
    }
    return {
      by_signal: by,
      pending: (
        this.db
          .prepare("SELECT count(*) AS n FROM leads WHERE reviewed_at IS NULL")
          .get() as Data
      ).n,
      window_days: 60,
    };
  }
  leads(n = 7, day = today()): Data[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM leads WHERE last_seen>=? ORDER BY last_seen DESC,first_seen DESC,term",
        )
        .all(shift(day, -n)) as Data[]
    ).map((r) => ({
      term: r.term,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      signals: JSON.parse(r.signals),
      note: JSON.parse(r.notes).at(-1) ?? "",
      name_score: r.named,
      variants: JSON.parse(r.variants),
      verdict: r.verdict,
      days_ahead: r.lead_days,
    }));
  }
}
