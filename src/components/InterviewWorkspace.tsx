"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import type { InterviewQuestion } from "@/lib/db/schema";
import { resolveResumeAnchor, type ResumeBlock, type ResumeDocument } from "@/lib/resume/document";
import { QuestionDetails } from "./QuestionList";
import "./interview-workspace.css";

type Filter = "全部" | "必问" | "选问" | "备用";

export function InterviewWorkspace({ candidate, document, questions, expectedLevels, selectedSetId, sets }: {
  candidate: { id: string; name: string; hasOriginal: boolean; format: "pdf" | "markdown" };
  document: ResumeDocument;
  questions: InterviewQuestion[];
  expectedLevels?: number;
  selectedSetId: string;
  sets: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("全部");
  const [selected, setSelected] = useState(() => Math.max(0, questions.findIndex((q) => q.priority === "必问")));
  const [preview, setPreview] = useState<number | null>(null);
  const resumePanel = useRef<HTMLDivElement>(null);
  const questionPanel = useRef<HTMLDivElement>(null);
  // 历史引用、旧版本坐标均以当前原文重新核对；重复命中时不猜位置。
  const references = useMemo(() => questions.map((q) => resolveResumeAnchor(document, q.resumeAnchor)), [document, questions]);
  const ranges = useMemo(() => {
    const result = new Map<string, { start: number; end: number; question: number }[]>();
    references.forEach((reference, question) => reference.spans.forEach((span) => {
      result.set(span.blockId, [...(result.get(span.blockId) ?? []), { ...span, question }]);
    }));
    return result;
  }, [references]);
  const highlighted = preview ?? selected;
  const visible = questions.map((question, index) => ({ question, index })).filter(({ question }) => filter === "全部" || question.priority === filter);

  function reveal(panel: HTMLDivElement | null, selector: string) {
    const element = panel?.querySelector<HTMLElement>(selector);
    if (!panel || !element) return;
    const bounds = panel.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    if (target.top >= bounds.top + 16 && target.bottom <= bounds.bottom - 16) return;
    panel.scrollTo({ top: panel.scrollTop + target.top - bounds.top - 24, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  function selectQuestion(index: number, fromResume = false) {
    setSelected(index);
    setPreview(null);
    if (fromResume && filter !== "全部" && questions[index].priority !== filter) setFilter("全部");
    requestAnimationFrame(() => {
      if (fromResume) reveal(questionPanel.current, `[data-question-index="${index}"]`);
      else {
        const span = references[index]?.spans[0];
        if (span) reveal(resumePanel.current, `[data-block-id="${span.blockId}"]`);
      }
    });
  }

  function renderBlock(block: ResumeBlock) {
    const blockRanges = ranges.get(block.id) ?? [];
    const boundaries = [...new Set([0, block.text.length, ...blockRanges.flatMap((range) => [range.start, range.end])])].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, i) => {
      const end = boundaries[i + 1];
      const related = blockRanges.filter((range) => range.start < end && range.end > start).map((range) => range.question);
      const text = block.text.slice(start, end);
      if (!related.length) return <span key={start}>{text}</span>;
      const active = related.includes(highlighted);
      return <button
        type="button"
        key={start}
        className={`resume-highlight ${active ? "is-active" : ""}`}
        aria-label={`${text}；对应第 ${related.map((index) => index + 1).join("、")} 题，点击切换`}
        onClick={() => selectQuestion(related[(related.indexOf(selected) + 1) % related.length], true)}
      >{text}<sup>{related.map((index) => index + 1).join("·")}</sup></button>;
    });
  }

  const linkStatus = (index: number) => {
    const reference = references[index];
    if (reference.status === "none") return "无直接简历引用";
    if (reference.status === "ambiguous") return "原文多处重复 · 待核对";
    if (reference.status === "missing") return "原文未定位 · 待核对";
    const pages = [...new Set(reference.spans.map((span) => document.blocks.find((block) => block.id === span.blockId)?.page).filter((page): page is number => page != null))];
    return pages.length ? `已关联原文 · 第 ${pages.join("、")} 页` : "已关联原文";
  };

  return <div className="interview-page">
    <div className="interview-topbar">
      <div><Link href={`/candidates/${candidate.id}`} className="interview-back">← 返回候选人详情</Link><h1>{candidate.name}<span>面试模式</span></h1></div>
      {sets.length > 0 && <label className="interview-set-label">当前题单
        <select aria-label="当前题单" value={selectedSetId} disabled={pending} onChange={(event) => {
          const id = event.target.value;
          startTransition(() => router.push(`/candidates/${candidate.id}/interview?setId=${encodeURIComponent(id)}`));
        }}>{sets.map((set) => <option value={set.id} key={set.id}>{set.label}</option>)}</select>
        {pending && <span role="status">正在切换题单…</span>}
      </label>}
    </div>
    <div className="interview-columns">
      <section className="interview-pane resume-pane" aria-label="候选人简历">
        <div className="interview-pane-heading"><h2>候选人简历</h2><div className="interview-links">
          <a href={`/api/candidates/${candidate.id}/resume?format=markdown`} download>下载 Markdown</a>
          {candidate.hasOriginal && <a href={`/api/candidates/${candidate.id}/resume`} target="_blank" rel="noreferrer">{candidate.format === "pdf" ? "查看原始 PDF ↗" : "下载原文件"}</a>}
        </div></div>
        <div className="interview-scroll resume-content" ref={resumePanel}>
          <p className="interview-hint">原文阅读稿 · 浅色标记可提问片段，点击可查看对应题目。</p>
          {document.source === "pdf" && <p className="interview-hint">按 PDF 文本层整理；如有多栏错序或缺字，请对照原始 PDF。</p>}
          {document.warnings.map((warning) => <p className="interview-warning" key={warning}>{warning}</p>)}
          {document.blocks.length === 0 && <p className="interview-warning">暂无可阅读的简历文本，请核对原文件。</p>}
          {document.blocks.map((block, index) => <div key={block.id} data-block-id={block.id}>
            {block.page !== null && block.page !== document.blocks[index - 1]?.page && <div className="resume-page-number">PDF · 第 {block.page} 页</div>}
            {block.kind === "heading" ? <h3>{renderBlock(block)}</h3> : <p className={block.kind === "bullet" ? "resume-bullet" : ""}>{renderBlock(block)}</p>}
          </div>)}
        </div>
      </section>
      <section className="interview-pane questions-pane" aria-label="面试题">
        <div className="interview-pane-heading"><h2>面试题 <span>{questions.length}</span></h2><span className="interview-hint">悬停对照 · 点击固定并定位</span></div>
        <div className="interview-filters" aria-label="题目优先级">{(["全部", "必问", "选问", "备用"] as const).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => {
          setFilter(value);
          setPreview(null);
          if (value !== "全部" && questions[selected]?.priority !== value) setSelected(questions.findIndex((q) => q.priority === value));
        }}>{value} <span>{value === "全部" ? questions.length : questions.filter((q) => q.priority === value).length}</span></button>)}</div>
        <div className="interview-scroll question-content" ref={questionPanel}>
          {!questions.length && <div className="interview-empty"><p>还没有题单，简历已可以阅读。</p><Link href={`/candidates/${candidate.id}#generate`}>去生成题单 →</Link></div>}
          {questions.length > 0 && !visible.length && <p className="interview-empty">当前分类没有题目，可切换到“全部”。</p>}
          {visible.map(({ question, index }) => <article key={index} data-question-index={index} className={`interview-question ${selected === index ? "is-selected" : ""}`} onPointerEnter={() => setPreview(index)} onPointerLeave={() => setPreview(null)}>
            <button type="button" className="interview-question-main" aria-expanded={selected === index} aria-controls={`question-detail-${index}`} onFocus={() => setPreview(index)} onBlur={() => setPreview(null)} onClick={() => selectQuestion(index)}>
              <span className="interview-question-labels"><span className="interview-question-number">{String(index + 1).padStart(2, "0")}</span><span className="interview-tag">{question.priority} · {question.tech || question.category}</span>{question.scene && <span>{question.scene}</span>}</span>
              <span className="interview-question-text">{question.question}</span>
              <span className="interview-question-meta"><span className={references[index].status === "ambiguous" || references[index].status === "missing" ? "interview-unmatched" : ""}>{linkStatus(index)}</span><span>{selected === index ? "已固定" : `${question.followups.length} 层追问`}</span></span>
            </button>
            <div id={`question-detail-${index}`} hidden={selected !== index}>
              {expectedLevels !== undefined && question.followups.length < expectedLevels && <p className="interview-warning">追问 {question.followups.length}/{expectedLevels} 层，尚未完整生成。</p>}
              <QuestionDetails question={question} />
            </div>
          </article>)}
        </div>
      </section>
    </div>
    <div className="interview-footer"><span>悬停不移动页面；点击题目才定位原文。高亮仅表示引用关联。</span><span aria-live="polite">{selected >= 0 && questions[selected] ? `已固定第 ${selected + 1} 题 · ${linkStatus(selected)}` : "未选中题目"}</span></div>
  </div>;
}
