/**
 * 按顺序跑多个分类的重生成，一个跑完再跑下一个。
 *
 * 为什么不在外层并发：每个 regen-answers.mjs 结束时会写同一张表，
 * 两个进程同时收尾会抢 SQLite 写锁。分类之间没有依赖，串行只慢一点点，
 * 但换来「任何时刻最多一个写库进程」，中断后状态也简单。
 *
 * 用法：node scripts/regen-all.mjs 分类A 分类B 分类C
 */
import { spawn } from "node:child_process";

const cats = process.argv.slice(2);
if (!cats.length) {
  console.error("用法：node scripts/regen-all.mjs <分类> [分类...]");
  process.exit(1);
}

const run = (cat) =>
  new Promise((resolve) => {
    console.log(`\n========== ${cat} ==========`);
    const p = spawn(
      process.execPath,
      ["scripts/regen-answers.mjs", "--category", cat, "--concurrency", "4"],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    p.on("exit", (code) => {
      console.log(`---------- ${cat} 结束，exit=${code} ----------`);
      resolve(code);
    });
  });

const summary = [];
for (const cat of cats) {
  const code = await run(cat);
  summary.push({ cat, code });
}

console.log("\n===== 全部完成 =====");
for (const s of summary) console.log(`${s.cat}: exit=${s.code}`);
