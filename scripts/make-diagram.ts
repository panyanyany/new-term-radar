import { writeFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import scenes from "../docs/diagram-scenes.json" with { type: "json" };
// SVG 场景模板保留既有图形，运动采样和媒体导出统一使用 Node。
const scene = scenes as unknown as {
  width: number;
  height: number;
  paths: [string, [number, number][], string, boolean, number, number][];
  variants: Record<string, { head: string; body: string }>;
};
function at(points: [number, number][], f: number): [number, number] {
  const seg = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let left = f * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const k = seg[i] ? left / seg[i] : 0;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * k,
        points[i][1] + (points[i + 1][1] - points[i][1]) * k,
      ];
    }
    left -= seg[i];
  }
  return points.at(-1)!;
}
function main(): void {
  const variant = process.argv[2] ?? "oss-zh",
    base = process.argv[3] ?? `docs/radar-${variant}`,
    v = scene.variants[variant];
  if (!v) throw new Error("variant: prod-zh | oss-zh | oss-en");
  const smil = scene.paths
    .map(
      ([id, , c, , dur, b]) =>
        `<circle r="4" fill="${c}"><animateMotion dur="${dur}s" repeatCount="indefinite" begin="${b}s"><mpath href="#${id}"/></animateMotion></circle>`,
    )
    .join("\n");
  writeFileSync(base + ".svg", v.head + v.body + smil + "\n</svg>\n");
  if (process.argv.includes("--svg-only")) return;
  const temp = mkdtempSync(join(tmpdir(), "radar-diagram-"));
  try {
    for (let n = 0; n < 72; n++) {
      const tm = n / 15,
        dots = scene.paths
          .map(([, p, c, , dur, b]) => {
            const [x, y] = at(p, ((((tm - b) % dur) + dur) % dur) / dur);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${c}"/>`;
          })
          .join(""),
        file = join(temp, `f${String(n).padStart(3, "0")}.svg`);
      writeFileSync(
        file,
        v.head.replaceAll("context-stroke", "#888780") +
          v.body +
          dots +
          "\n</svg>\n",
      );
      execFileSync("rsvg-convert", [
        "-w",
        String(scene.width * 2),
        "-b",
        "white",
        file,
        "-o",
        file.replace(".svg", ".png"),
      ]);
    }
    const frames = [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      "15",
      "-i",
      join(temp, "f%03d.png"),
    ];
    execFileSync("ffmpeg", [
      ...frames,
      "-vf",
      "scale=1020:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none",
      base + ".gif",
    ]);
    execFileSync("ffmpeg", [
      ...frames,
      "-vf",
      "scale=1360:-2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      base + ".mp4",
    ]);
    copyFileSync(join(temp, "f030.png"), base + ".png");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
main();
