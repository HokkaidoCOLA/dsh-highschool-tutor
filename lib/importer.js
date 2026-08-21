// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 批量导入解析器（Markdown / CSV / Markdown 表格 / Anki TSV）。
 *
 * 目标：让「已经存在别处的题目」以最低成本进库，不必手工一条条敲。
 * 支持四种输入，格式可自动识别（format: 'auto'）：
 *
 * ① Markdown 问答块（最自由，推荐手写）
 *      ## 数学            ← 二级标题里出现学科名 → 切换当前学科
 *      ### 导数           ← 三级标题 → 当前知识点（topic）
 *      Q: 导数的几何意义是什么？
 *      A: 曲线在该点处切线的斜率
 *      解析: 由极限定义推出
 *      #易错 #必背        ← 井号标签行
 *      ---                ← 分隔下一张卡（也可用空行 + 新的 Q:）
 *    问答前缀兼容：Q/问/题/题干/正面/front、A/答/答案/背面/back、解析/E/explanation。
 *
 * ② Markdown 表格（从对话里直接复制表格）
 *      | 题干 | 答案 | 解析 | 知识点 |
 *      |---|---|---|---|
 *
 * ③ CSV（含表头时按表头映射，无表头按 题干,答案,解析 顺序）
 *
 * ④ Anki 导出的 TSV（`#separator:tab` 注释行会被忽略，HTML 标签会被清洗）
 *
 * 解析器只负责「文本 → 结构化记录」，写库与去重交给 Store.upsertItems。
 *
 * @module dsh-highschool-tutor/importer
 */

import { toGrade, toSubject } from './subjects.js'

/** 表头别名 → 内部字段。 */
const HEADER_ALIAS = new Map(Object.entries({
  subject: 'subject', 学科: 'subject', 科目: 'subject',
  kind: 'kind', 类型: 'kind', 种类: 'kind',
  topic: 'topic', 知识点: 'topic', 考点: 'topic',
  chapter: 'chapter', 章节: 'chapter', 单元: 'chapter', 教材: 'chapter',
  question: 'question', 题干: 'question', 题目: 'question', 问题: 'question', 正面: 'question', front: 'question',
  answer: 'answer', 答案: 'answer', 背面: 'answer', back: 'answer',
  explanation: 'explanation', 解析: 'explanation', 解答: 'explanation', 分析: 'explanation', 备注: 'explanation',
  tags: 'tags', 标签: 'tags', tag: 'tags',
  difficulty: 'difficulty', 难度: 'difficulty',
  source: 'source', 来源: 'source', 出处: 'source',
  grade: 'grade', 年级: 'grade',
}))

/** 问答前缀识别。 */
const Q_PREFIX = /^\s*(?:[Qq]|问|题|题干|正面|front)\s*[:：.、]\s*/
const A_PREFIX = /^\s*(?:[Aa]|答|答案|背面|back)\s*[:：.、]\s*/
const E_PREFIX = /^\s*(?:[Ee]|解析|解答|分析|explanation)\s*[:：.、]\s*/
const T_PREFIX = /^\s*(?:标签|tags?)\s*[:：.、]\s*/
const S_PREFIX = /^\s*(?:来源|出处|source)\s*[:：.、]\s*/

/**
 * 清洗 HTML（Anki 导出常带 <br>、<div>、&nbsp;）。
 * @param {string} value 原始文本。
 * @returns {string} 纯文本。
 */
function stripHtml(value) {
  return String(value)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:div|p|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 识别输入格式。
 * @param {string} text 输入文本。
 * @returns {'tsv'|'mdtable'|'csv'|'md'} 格式标识。
 */
export function detectFormat(text) {
  const src = String(text ?? '')
  const lines = src.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return 'md'
  if (/^#separator:/im.test(src) || /^#html:/im.test(src)) return 'tsv'
  const tabbed = lines.filter((l) => l.includes('\t')).length
  if (tabbed >= Math.max(1, Math.floor(lines.length * 0.6))) return 'tsv'
  const first = lines[0].trim()
  if (first.startsWith('|') && lines.length > 1 && /^\|?[\s:|-]+\|/.test(lines[1].trim())) return 'mdtable'
  if (Q_PREFIX.test(src) || /^#{1,6}\s/m.test(src)) return 'md'
  const commas = lines.filter((l) => l.includes(',')).length
  if (commas >= Math.max(1, Math.floor(lines.length * 0.6))) return 'csv'
  return 'md'
}

/**
 * 解析带引号的分隔符文本（CSV/TSV 通用，支持字段内换行与 "" 转义）。
 * @param {string} text 输入。
 * @param {string} delim 分隔符。
 * @returns {string[][]} 行×列。
 */
function parseDelimited(text, delim) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delim) { row.push(field); field = ''; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * 把一行单元格按表头映射成记录。
 * @param {string[]|null} headers 内部字段名数组（null 表示按 order 顺序）。
 * @param {string[]} cells 单元格。
 * @param {object} defaults 默认字段（subject/kind/topic 等）。
 * @param {string[]} order 无表头时的列顺序。
 * @returns {object|null} 记录，题干为空时 null。
 */
function mapRow(headers, cells, defaults, order = ['question', 'answer', 'explanation', 'tags']) {
  const out = { ...defaults }
  if (headers === null) {
    for (let i = 0; i < order.length; i += 1) {
      if (cells[i] === undefined) continue
      const value = stripHtml(cells[i])
      if (value !== '') out[order[i]] = value
    }
  } else {
    for (let i = 0; i < headers.length; i += 1) {
      const field = headers[i]
      if (field === null) continue
      const raw = stripHtml(cells[i] ?? '')
      if (raw === '') continue
      if (field === 'subject') { const s = toSubject(raw); if (s !== null) out.subject = s; continue }
      if (field === 'grade') { const g = toGrade(raw); if (g !== null) out.grade = g; continue }
      if (field === 'difficulty') { const n = Number(raw); if (Number.isFinite(n)) out.difficulty = n; continue }
      if (field === 'kind') { out.kind = /错|mistake|wrong/i.test(raw) ? 'mistake' : 'card'; continue }
      out[field] = raw
    }
  }
  if (String(out.question ?? '').trim() === '') return null
  return out
}

/**
 * 解析 CSV / TSV。
 * @param {string} text 输入。
 * @param {string} delim 分隔符。
 * @param {object} defaults 默认字段。
 * @returns {{items: object[], warnings: string[]}} 结果。
 */
function parseTable(text, delim, defaults) {
  const warnings = []
  const body = String(text ?? '').split('\n').filter((l) => !/^\s*#(?:separator|html|tags column|notetype|deck|columns)/i.test(l)).join('\n')
  const rows = parseDelimited(body, delim)
  if (rows.length === 0) return { items: [], warnings: ['没有解析到任何数据行'] }
  const headerCells = rows[0].map((c) => HEADER_ALIAS.get(c.trim().toLowerCase()) ?? HEADER_ALIAS.get(c.trim()) ?? null)
  const hasHeader = headerCells.filter((h) => h !== null).length >= 2
  const dataRows = hasHeader ? rows.slice(1) : rows
  // Anki 导出的 TSV 惯例是「正面 / 背面 / 标签」，CSV 手写惯例是「题干 / 答案 / 解析 / 标签」
  const order = delim === '\t'
    ? ['question', 'answer', 'tags', 'explanation']
    : ['question', 'answer', 'explanation', 'tags']
  if (!hasHeader) warnings.push(`未识别到表头，按「${order.map((f) => ({ question: '题干', answer: '答案', explanation: '解析', tags: '标签' })[f]).join(', ')}」顺序解析`)
  const items = []
  for (const cells of dataRows) {
    const item = mapRow(hasHeader ? headerCells : null, cells, defaults, order)
    if (item !== null) items.push(item)
    else warnings.push(`跳过一行（题干为空）：${cells.join(delim === '\t' ? ' | ' : ',').slice(0, 40)}`)
  }
  return { items, warnings }
}

/**
 * 解析 Markdown 表格。
 * @param {string} text 输入。
 * @param {object} defaults 默认字段。
 * @returns {{items: object[], warnings: string[]}} 结果。
 */
function parseMdTable(text, defaults) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  const cells = lines
    .filter((l) => !/^\|?[\s:|-]+\|?$/.test(l))
    .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
  if (cells.length === 0) return { items: [], warnings: ['没有解析到表格行'] }
  const headerCells = cells[0].map((c) => HEADER_ALIAS.get(c.toLowerCase()) ?? HEADER_ALIAS.get(c) ?? null)
  const hasHeader = headerCells.filter((h) => h !== null).length >= 2
  const items = []
  const warnings = hasHeader ? [] : ['未识别到表头，按「题干, 答案, 解析, 标签」顺序解析']
  for (const row of hasHeader ? cells.slice(1) : cells) {
    const item = mapRow(hasHeader ? headerCells : null, row, defaults)
    if (item !== null) items.push(item)
  }
  return { items, warnings }
}

/**
 * 解析 Markdown 问答块。
 * @param {string} text 输入。
 * @param {object} defaults 默认字段。
 * @returns {{items: object[], warnings: string[]}} 结果。
 */
function parseMarkdown(text, defaults) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const items = []
  const warnings = []
  let ctx = { ...defaults }
  let cur = null
  let field = null

  const flush = () => {
    if (cur === null) return
    const question = String(cur.question ?? '').trim()
    if (question === '') { warnings.push('跳过一块（没有题干）'); cur = null; return }
    items.push({ ...ctx, ...cur, question })
    cur = null
    field = null
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*(?:-{3,}|\*{3,}|={3,})\s*$/.test(line)) { flush(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flush()
      const title = heading[2].replace(/[#*`]/g, '').trim()
      // 标题里出现学科名 → 切学科；否则整条标题作为知识点
      const parts = title.split(/[·|/｜>》\s]+/).filter((p) => p !== '')
      let matchedSubject = null
      const rest = []
      for (const p of parts) {
        const s = toSubject(p)
        if (s !== null && matchedSubject === null) matchedSubject = s
        else rest.push(p)
      }
      if (matchedSubject !== null) ctx = { ...ctx, subject: matchedSubject }
      const topic = rest.join(' ').trim()
      if (topic !== '') ctx = { ...ctx, topic }
      continue
    }

    if (Q_PREFIX.test(line)) {
      flush()
      cur = { question: line.replace(Q_PREFIX, '').trim() }
      field = 'question'
      continue
    }
    if (A_PREFIX.test(line)) {
      if (cur === null) cur = { question: '' }
      cur.answer = line.replace(A_PREFIX, '').trim()
      field = 'answer'
      continue
    }
    if (E_PREFIX.test(line) || /^\s*>\s+/.test(line)) {
      if (cur === null) cur = { question: '' }
      const value = E_PREFIX.test(line) ? line.replace(E_PREFIX, '').trim() : line.replace(/^\s*>\s+/, '').trim()
      cur.explanation = cur.explanation ? `${cur.explanation}\n${value}` : value
      field = 'explanation'
      continue
    }
    if (T_PREFIX.test(line)) {
      if (cur === null) cur = { question: '' }
      cur.tags = line.replace(T_PREFIX, '').trim()
      field = null
      continue
    }
    if (S_PREFIX.test(line)) {
      if (cur === null) cur = { question: '' }
      cur.source = line.replace(S_PREFIX, '').trim()
      field = null
      continue
    }
    // 纯 #标签 行
    if (/^\s*(?:#[^\s#]+\s*)+$/.test(line) && cur !== null) {
      const found = line.match(/#([^\s#]+)/g)?.map((t) => t.slice(1)) ?? []
      cur.tags = [...(Array.isArray(cur.tags) ? cur.tags : String(cur.tags ?? '').split(/[,，\s]+/).filter((t) => t !== '')), ...found]
      continue
    }
    if (line.trim() === '') { field = null; continue }
    // 续行：接到当前字段末尾
    if (cur !== null && field !== null) {
      cur[field] = `${cur[field] ?? ''}\n${line.trim()}`.trim()
      continue
    }
    // 没有 Q: 前缀的裸文本：视为新卡的题干（宽松模式）
    if (cur === null) { cur = { question: line.trim() }; field = 'question' }
  }
  flush()
  return { items, warnings }
}

/**
 * 解析导入文本。
 * @param {string} text 输入文本。
 * @param {object} [opts] 选项：format、subject、kind、topic、chapter、grade、source。
 * @returns {{items: object[], format: string, warnings: string[]}} 解析结果（未写库）。
 */
export function parseImport(text, opts = {}) {
  const format = ['md', 'csv', 'tsv', 'mdtable'].includes(opts.format) ? opts.format : detectFormat(text)
  const defaults = {}
  const subject = toSubject(opts.subject)
  if (subject !== null) defaults.subject = subject
  const grade = toGrade(opts.grade)
  if (grade !== null) defaults.grade = grade
  if (opts.kind === 'mistake' || opts.kind === 'card') defaults.kind = opts.kind
  if (typeof opts.topic === 'string' && opts.topic.trim() !== '') defaults.topic = opts.topic.trim()
  if (typeof opts.chapter === 'string' && opts.chapter.trim() !== '') defaults.chapter = opts.chapter.trim()
  if (typeof opts.source === 'string' && opts.source.trim() !== '') defaults.source = opts.source.trim()

  const parsed = format === 'tsv' ? parseTable(text, '\t', defaults)
    : format === 'csv' ? parseTable(text, ',', defaults)
      : format === 'mdtable' ? parseMdTable(text, defaults)
        : parseMarkdown(text, defaults)

  // 兜底：没给学科的记录默认落到 defaults.subject 或 math，避免写库失败
  const items = parsed.items.map((it) => ({
    ...it,
    subject: toSubject(it.subject) ?? defaults.subject ?? 'math',
    kind: it.kind ?? defaults.kind ?? 'card',
  }))
  return { items, format, warnings: parsed.warnings }
}

/**
 * 把题库导出成 Markdown 问答块（与 parseImport 的 md 格式互逆）。
 * @param {object[]} items 题目列表。
 * @param {(key: string) => string} labelOf 学科键 → 中文名。
 * @returns {string} Markdown 文本。
 */
export function toMarkdown(items, labelOf) {
  const bySubject = new Map()
  for (const it of items) {
    const list = bySubject.get(it.subject) ?? []
    list.push(it)
    bySubject.set(it.subject, list)
  }
  const out = ['# 高中助学题库导出', '']
  for (const [subject, list] of bySubject) {
    out.push(`## ${labelOf(subject)}`, '')
    for (const it of list) {
      if (it.topic !== '') out.push(`### ${it.topic}`)
      out.push(`Q: ${it.question}`)
      if (it.answer !== '') out.push(`A: ${it.answer}`)
      if (it.explanation !== '') out.push(`解析: ${it.explanation}`)
      if (it.tags.length > 0) out.push(it.tags.map((t) => `#${t}`).join(' '))
      if (it.source !== '') out.push(`来源: ${it.source}`)
      out.push('', '---', '')
    }
  }
  return out.join('\n')
}
