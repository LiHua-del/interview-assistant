import test from "node:test";
import assert from "node:assert/strict";
import { createResumeDocument, resolveResumeAnchor } from "./document.ts";

test("阅读稿保留原文字词和来源页码，重复转换保持段落标识", () => {
  const pages = [{ text: "教育背景\n示例大学 软件工程\n性能提升 30%，基线 100ms。", page: 1 }];
  const document = createResumeDocument(pages, "pdf");
  assert.deepEqual(document.blocks.map((block) => block.text), pages[0].text.split("\n"));
  assert.equal(document.blocks[0].kind, "heading");
  assert.ok(document.blocks.every((block) => block.page === 1));
  assert.equal(createResumeDocument(pages, "pdf").id, document.id);
  assert.notEqual(createResumeDocument([{ text: "另一版简历", page: 1 }], "pdf").id, document.id);
  assert.match(document.markdown, /PDF 第 1 页/);
});

test("跨行和跨页引用还原为各段落的精确字符范围", () => {
  const document = createResumeDocument([
    { text: "项目介绍：使用 Redis 预扣减", page: 1 },
    { text: "库存，并异步落库。其余描述", page: 2 },
  ], "pdf");
  const result = resolveResumeAnchor(document, "使用Redis预扣减库存，并异步落库");
  assert.equal(result.status, "matched");
  assert.equal(result.spans.length, 2);
  const quotes = result.spans.map((span) => document.blocks.find((block) => block.id === span.blockId).text.slice(span.start, span.end));
  assert.deepEqual(quotes, ["使用 Redis 预扣减", "库存，并异步落库"]);
});

test("重复经历中的相同文字拒绝自动定位", () => {
  const document = createResumeDocument([{ text: "项目一\n负责 Redis 缓存开发\n项目二\n负责 Redis 缓存开发", page: 1 }], "pdf");
  assert.deepEqual(resolveResumeAnchor(document, "负责Redis缓存开发"), { documentId: document.id, status: "ambiguous", spans: [] });
});

test("不删除技术符号或数字，避免 C++、C# 及指标误匹配", () => {
  const document = createResumeDocument([{ text: "熟悉 C++ 并发编程，性能提升 30%", page: 1 }], "pdf");
  assert.equal(resolveResumeAnchor(document, "熟悉 C++ 并发编程").status, "matched");
  assert.equal(resolveResumeAnchor(document, "熟悉 C# 并发编程").status, "missing");
  assert.equal(resolveResumeAnchor(document, "性能提升 300%").status, "missing");
});

test("空引用、过短引用和缺失引用不会产生高亮", () => {
  const document = createResumeDocument([{ text: "参与系统后端开发", page: null }], "legacy");
  assert.equal(resolveResumeAnchor(document, "").status, "none");
  assert.equal(resolveResumeAnchor(document, "后端").status, "missing");
  assert.equal(resolveResumeAnchor(document, "参与数据库迁移改造").status, "missing");
});

test("同段落多个题目分别定位，不互相覆盖", () => {
  const document = createResumeDocument([{ text: "实现库存预扣减，使用消息队列异步通知。", page: 1 }], "pdf");
  const first = resolveResumeAnchor(document, "实现库存预扣减");
  const second = resolveResumeAnchor(document, "使用消息队列异步通知");
  assert.equal(first.status, "matched");
  assert.equal(second.status, "matched");
  assert.equal(first.spans[0].blockId, second.spans[0].blockId);
  assert.ok(first.spans[0].end < second.spans[0].start);
});

test("原文的 HTML 与链接标记作为文字导出，不解释为可执行内容", () => {
  const document = createResumeDocument([{ text: "## 项目经历\n<script>alert(1)</script>\n[链接](javascript:alert(1))", page: null }], "markdown");
  assert.equal(document.blocks[0].kind, "heading");
  assert.equal(document.blocks[1].text, "<script>alert(1)</script>");
  assert.ok(document.markdown.includes("\\<script\\>"));
  assert.ok(document.markdown.includes("\\[链接\\]\\("));
});
