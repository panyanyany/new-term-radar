import { publishSite } from "../src/site.js";
// 离线发布现有日报，不请求搜索、趋势或大模型接口。
const [
  reportFile = "report.json",
  outputDir = process.env.RADAR_SITE_DIR ?? "site",
] = process.argv.slice(2);
console.log(publishSite(reportFile, outputDir));
