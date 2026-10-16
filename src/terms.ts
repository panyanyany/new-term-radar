import { STOP, round, type Data } from "./core.js";
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9.+#]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 3 || /\d/.test(w));
// 文本词项按来源去重，避免单一高频来源制造热度。
export function terms(text: string): Set<string> {
  const ws = words(text || ""),
    parts = words((text || "").replace(/(?<=[a-z])(?=[A-Z])/g, " "));
  const out = new Set(
    [...ws, ...parts].filter((w) => !STOP.has(w) && !/^\d+$/.test(w)),
  );
  for (let i = 1; i < ws.length; i++) {
    const a = ws[i - 1],
      b = ws[i];
    if (a !== b && ![a, b].some((w) => STOP.has(w) || /^\d+$/.test(w)))
      out.add(`${a} ${b}`);
  }
  return out;
}
// 连续名称最多三词；标点和中文会切断名称，纯数字只能接在名称之后。
export function names(text: string, strong = false): Set<string> {
  text = (text || "").replace(/https?:\/\/\S+|@\w+/g, " ");
  const out = new Set<string>();
  let run: [string, boolean][] = [],
    end = 0;
  const flush = () => {
    for (let i = 0; i < run.length; i++)
      for (let j = i + 1; j <= Math.min(i + 3, run.length); j++) {
        const p = run.slice(i, j),
          ws = p.map(([w]) => w.toLowerCase().replace(/^[.\-]+|[.\-]+$/g, ""));
        if (
          /^\d+$/.test(ws[0].replaceAll(".", "")) ||
          ws.every((w) => STOP.has(w)) ||
          (strong && !p.some(([, s]) => s))
        )
          continue;
        const phrase = ws.join(" ");
        if (phrase.length >= 3) out.add(phrase);
      }
    run = [];
  };
  for (const m of text.matchAll(/[A-Za-z0-9][\w.+\-]*[\w+]|[A-Za-z0-9]/g)) {
    if (text.slice(end, m.index).trim()) flush();
    end = m.index! + m[0].length;
    const w = m[0].replace(/\.+$/, ""),
      number = /^\d+$/.test(w.replaceAll(".", "")),
      sure =
        /[A-Z]/.test(w.slice(1)) ||
        (/\d/.test(w) && !number) ||
        (/^[A-Z\d\W]+$/.test(w) && /[A-Z]/.test(w) && w.length >= 3);
    if (sure || /^[A-Z]/.test(w) || (number && run.length)) run.push([w, sure]);
    else flush();
  }
  flush();
  return out;
}
export function bySource(items: [string, string][]) {
  const out: Record<string, Set<string>> = {};
  for (const [s, text] of items)
    for (const w of terms(text)) (out[w] ??= new Set()).add(s);
  return out;
}
export function dropNested(rows: Data[]): Data[] {
  const kept: Data[] = [];
  for (const r of rows)
    if (
      !kept.some(
        (k) => k.term.split(" ").includes(r.term) && r.recent <= k.recent,
      )
    )
      kept.push(r);
  return kept;
}
export function surges(
  recent: Record<string, Set<string>>,
  base: Record<string, Set<string>>,
  ratio: number,
  min: number,
  top: number,
) {
  return dropNested(
    Object.entries(recent)
      .filter(([, s]) => s.size >= min)
      .map(([term, s]) => ({
        term,
        recent: s.size,
        baseline: base[term]?.size ?? 0,
        lift: round(s.size / ((base[term]?.size ?? 0) * ratio + 1), 1),
      }))
      .sort((a, b) => b.lift - a.lift || b.recent - a.recent),
  ).slice(0, top);
}
