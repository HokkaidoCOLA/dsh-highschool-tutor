// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 试卷/练习题切题器（纯函数，无 I/O）。
 *
 * 把一份试卷的纯文本切成结构化题目。这一步的难点不在正则，而在**中文试卷的真实排版
 * 千奇百怪**，所以规则是按「现实中确实这么排」来定的：
 *
 *   大题标题   一、单项选择题：本题共8小题…        ← 一二三 + 、．
 *   小题号     1．  1.  1、  1)  １．（全角）      ← 新题开始
 *   小问号     （1） (1) ①                        ← 属于当前题，不是新题
 *   选项       A．甲  B．乙  C．丙  D．丁          ← 常挤在一行，也可能分四行
 *   内嵌答案   【答案】B   【解析】…               ← 带解析的题库文件常见
 *   文末答案   参考答案 / 答案与解析              ← 试卷主流形态：答案单独放最后
 *
 * **答案回填**是这个模块最有价值的部分：试卷把答案统一放在文末，且常压成一行
 * 「1．B　2．A　3．C」。如果只是简单导入，题目会全部丢失答案，题库也就废了。
 * 这里把答案区按题号拆开，再按题号回填到对应题目上。
 *
 * @module dsh-highschool-tutor/paper
 */

/** 大题标题：一、二、…；也认「第Ⅰ卷」「第一部分」。 */
const RE_SECTION = /^\s*(?:第?\s*[一二三四五六七八九十]+\s*[、．.]|第\s*[ⅠⅡⅢIV]+\s*卷|第[一二三四五六七八九十]+部分)/

/** 小题号：1． 1. 1、 1) １．（全角数字与全角点都认）。 */
const RE_QUESTION = /^\s*([0-9０-９]{1,3})\s*[．.、)）]\s*/

/** 小问号：（1）(1)①——属于当前题。 */
const RE_SUBQ = /^\s*(?:[（(][0-9０-９]{1,2}[）)]|[①②③④⑤⑥⑦⑧⑨⑩])/

/** 选项行：以 A．/A. /A、开头。 */
const RE_OPTION = /^\s*[ABCD][．.、)）]\s*/

/** 文末答案区的起始行（整行就是这几个字，允许少量修饰）。 */
const RE_ANSWER_HEAD = /^\s*[【\[]?\s*(?:参考答案(?:与解析)?|答案(?:与解析|详解)?|参考解答|试卷答案|答案速查)\s*[】\]]?\s*[:：]?\s*$/

/** 内嵌答案/解析标记。 */
const RE_INLINE_ANSWER = /[【\[]\s*(?:参考)?答案\s*[】\]]\s*[:：]?/
const RE_INLINE_EXPLAIN = /[【\[]\s*(?:解析|详解|解答|分析|点评)\s*[】\]]\s*[:：]?/

/** 分值标注：（12分）/ (5分) / 【12分】。 */
const RE_SCORE = /[（(【]\s*([0-9０-９]{1,3})\s*分\s*[）)】]/

/** 学科关键词 → 学科键。 */
const SUBJECT_HINTS = [
  ['数学', 'math'], ['物理', 'physics'], ['化学', 'chemistry'], ['地理', 'geography'],
  ['语文', 'chinese'], ['英语', 'english'],
]

/** 题型关键词（从大题标题里认）。 */
const TYPE_HINTS = [
  ['单项选择', '选择题'], ['多项选择', '多选题'], ['单选', '选择题'], ['多选', '多选题'],
  ['选择题', '选择题'], ['填空', '填空题'], ['解答', '解答题'], ['计算', '计算题'],
  ['证明', '证明题'], ['实验', '实验题'], ['作图', '作图题'], ['简答', '简答题'],
  ['综合', '综合题'], ['阅读', '阅读题'], ['完形', '完形填空'], ['写作', '写作题'],
]

/**
 * 全角数字转半角。
 * @param {string} text 原文。
 * @returns {string} 结果。
 */
function halfWidthDigits(text) {
  return String(text).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

/**
 * 规整文本：统一换行、去掉页眉页脚常见噪声、压掉多余空行。
 * @param {string} text 原文。
 * @returns {string[]} 行数组。
 */
function toLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').replace(/[ \t]+$/, ''))
    // 常见页码/页眉噪声：「第 3 页 共 8 页」「- 2 -」
    .filter((l) => !/^\s*(?:第\s*\d+\s*页(?:\s*[，,]?\s*共\s*\d+\s*页)?|[-—–]\s*\d+\s*[-—–])\s*$/.test(l))
}

/**
 * 从文本头部猜学科。
 * @param {string} head 头部文本。
 * @returns {string|null} 学科键。
 */
function guessSubject(head) {
  for (const [word, key] of SUBJECT_HINTS) {
    if (head.includes(word)) return key
  }
  return null
}

/**
 * 从大题标题猜题型。
 * @param {string} title 标题。
 * @returns {string} 题型（认不出返回空串）。
 */
function guessType(title) {
  for (const [word, label] of TYPE_HINTS) {
    if (title.includes(word)) return label
  }
  return ''
}

/**
 * 评估「这份文本真的是试卷吗」。
 *
 * 必须有这道闸门：用户会拿任意文件来试，而「行首数字 + 点」这个特征在很多非试卷
 * 文本里也成立——`/etc/hosts` 里的 `127.0.0.1` 就会被切成「第 127 题」。没有闸门的
 * 话，垃圾会被静默写进题库，比报错难查得多。
 *
 * 三个判据（都取自真实试卷的稳定性质）：
 *   ① 题号基本递增——试卷题号一路往上，IP 地址之类不会；
 *   ② 首题号不会太大——整卷从 1 开始，只导某个大题也很少超过 30；
 *   ③ 题干有实质长度——中位数太短说明切出来的是碎片。
 * @param {object[]} items 切出的题目。
 * @returns {{level: 'high'|'low', reasons: string[]}} 评估结果。
 */
function assessPaper(items) {
  const reasons = []
  if (items.length === 0) return { level: 'low', reasons: ['没有切出任何题目'] }
  const nums = items.map((i) => i.num)
  const ascending = nums.filter((n, i) => i === 0 || n > nums[i - 1]).length / nums.length
  const lens = items.map((i) => i.question.replace(/\s/g, '').length).sort((a, b) => a - b)
  const median = lens[Math.floor(lens.length / 2)]
  if (nums[0] > 30) reasons.push(`首题号是 ${nums[0]}，不像试卷的开头`)
  if (ascending < 0.8) reasons.push(`题号只有 ${Math.round(ascending * 100)}% 是递增的（试卷题号应一路往上）`)
  if (median < 6) reasons.push(`题干长度中位数只有 ${median} 个字，像是被切碎的片段`)
  return { level: reasons.length === 0 ? 'high' : 'low', reasons }
}

/**
 * 判断题干里是否真的有 ABCD 选项。
 *
 * 不能只看「出现了 A． B．」——几何题里的「角A、B、C的对边」会被误判成选择题。
 * 真实选项有两个稳定特征：出现在**行首或空白/制表符之后**，且至少凑齐 A、B、C 三个
 * 并按字母顺序出现。加上这两条约束，「角A、B、C」这类就不会再误伤。
 * @param {string} question 题干。
 * @returns {boolean} 是否为选择题。
 */
function detectOptions(question) {
  const re = /(?:^|[\s\t　])([ABCD])\s*[．.、)）]/gm
  const letters = []
  let m = re.exec(question)
  while (m !== null) {
    letters.push(m[1])
    m = re.exec(question)
  }
  if (letters.length < 3) return false
  const uniq = [...new Set(letters)]
  if (uniq.length < 3) return false
  // 必须按 A→B→C(→D) 的顺序出现
  const order = 'ABCD'
  let cursor = -1
  for (const ch of uniq) {
    const idx = order.indexOf(ch)
    if (idx <= cursor) return false
    cursor = idx
  }
  return uniq[0] === 'A'
}

/**
 * 把文末答案区拆成「题号 → 答案文本」。
 *
 * 两种形态都要吃下：
 *   ① 压成一行：`1．B　2．A　3．C`（选择题答案的主流写法）
 *   ② 每题一段：`15．（1）… （2）…`（解答题的写法，可能跨多行）
 * @param {string[]} lines 答案区的行。
 * @returns {{map: Map<number, string>, warnings: string[]}} 题号到答案的映射。
 */
export function parseAnswerBlock(lines) {
  const warnings = []
  const map = new Map()
  const text = lines.join('\n')
  // 全局扫描「题号 + 答案」：题号必须出现在行首或空白/制表符之后，
  // 否则会把题干里的「共 8 小题」之类误当题号。
  const re = /(?:^|[\n\s\t　])([0-9０-９]{1,3})\s*[．.、)）]\s*/g
  const hits = []
  let m = re.exec(text)
  while (m !== null) {
    // 同时记下「整段标记的起点」与「答案正文的起点」：
    // 上一条答案的终点必须是下一条标记的**起点**，不能靠题号长度去估——
    // 「4)」「１０．」这些标记宽度各不相同，估算会把下一个题号吃进上一条答案里。
    hits.push({ num: Number(halfWidthDigits(m[1])), mark: m.index, start: m.index + m[0].length })
    m = re.exec(text)
  }
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i]
    const end = i + 1 < hits.length ? hits[i + 1].mark : text.length
    const body = text.slice(hit.start, Math.max(hit.start, end)).trim()
    if (body === '') continue
    if (map.has(hit.num)) {
      warnings.push(`答案区里题号 ${hit.num} 出现了多次，取第一次`)
      continue
    }
    map.set(hit.num, body.replace(/\s*\n\s*/g, ' ').trim())
  }
  return { map, warnings }
}

/**
 * 解析一份试卷。
 * @param {string} raw 试卷纯文本。
 * @param {object} [opts] 选项：subject（覆盖自动识别）、source（来源标注）、topic、grade。
 * @returns {object} { title, subject, sections, items, warnings, stats }
 */
export function parsePaper(raw, opts = {}) {
  const warnings = []
  const lines = toLines(raw)

  // ── ① 切出文末答案区 ──────────────────────────────────────────────────────
  let answerStart = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (RE_ANSWER_HEAD.test(lines[i])) { answerStart = i; break }
  }
  const bodyLines = answerStart >= 0 ? lines.slice(0, answerStart) : lines
  const answerLines = answerStart >= 0 ? lines.slice(answerStart + 1) : []
  const answers = parseAnswerBlock(answerLines)
  warnings.push(...answers.warnings)

  // ── ② 标题与学科 ─────────────────────────────────────────────────────────
  const headLines = []
  for (const line of bodyLines) {
    if (RE_SECTION.test(line) || RE_QUESTION.test(line)) break
    if (line.trim() !== '') headLines.push(line.trim())
    if (headLines.length >= 4) break
  }
  const head = headLines.join(' ')
  const title = headLines.length > 0 ? headLines.slice(0, 2).join(' ').slice(0, 80) : ''
  const subject = opts.subject ?? guessSubject(head) ?? null

  // ── ③ 按大题/小题切分 ────────────────────────────────────────────────────
  const sections = []
  const items = []
  let section = { title: '', type: '' }
  let current = null

  /** 收尾当前题目。 */
  const flush = () => {
    if (current === null) return
    const text = current.lines.join('\n').trim()
    if (text === '') { current = null; return }
    items.push({ ...current, text })
    current = null
  }

  for (const line of bodyLines) {
    if (line.trim() === '') {
      if (current !== null) current.lines.push('')
      continue
    }
    if (RE_SECTION.test(line) && !RE_QUESTION.test(line)) {
      flush()
      section = { title: line.trim(), type: guessType(line) }
      sections.push(section)
      continue
    }
    const q = RE_QUESTION.exec(line)
    // 小问「（1）」不能当新题；选项行也不能（选项里没有数字开头，这里主要防「1）」歧义）
    if (q !== null && !RE_SUBQ.test(line)) {
      flush()
      const num = Number(halfWidthDigits(q[1]))
      const score = RE_SCORE.exec(line)
      current = {
        num,
        section: section.title,
        type: section.type,
        score: score === null ? null : Number(halfWidthDigits(score[1])),
        lines: [line.slice(q[0].length).trim()],
      }
      continue
    }
    if (current === null) {
      // 题号之前的零散行（试卷说明等）忽略
      continue
    }
    current.lines.push(line.trim() === '' ? '' : line)
  }
  flush()

  if (items.length === 0) {
    warnings.push('没有识别出任何题目：这份文本里找不到「1．」这样的题号。若是课件或知识点整理，请改用「课件/知识点」模式导入。')
  }

  // ── ④ 拆出内嵌答案/解析、回填文末答案 ────────────────────────────────────
  const seen = new Map()
  const out = []
  for (const item of items) {
    let question = item.text
    let answer = ''
    let explanation = ''

    // 内嵌【解析】：先切解析（它总在答案之后）
    const eIdx = question.search(RE_INLINE_EXPLAIN)
    if (eIdx >= 0) {
      const m = RE_INLINE_EXPLAIN.exec(question.slice(eIdx))
      explanation = question.slice(eIdx + m[0].length).trim()
      question = question.slice(0, eIdx).trim()
    }
    // 内嵌【答案】
    const aIdx = question.search(RE_INLINE_ANSWER)
    if (aIdx >= 0) {
      const m = RE_INLINE_ANSWER.exec(question.slice(aIdx))
      answer = question.slice(aIdx + m[0].length).trim()
      question = question.slice(0, aIdx).trim()
    }
    // 文末答案区回填（内嵌答案优先）
    if (answer === '' && answers.map.has(item.num)) {
      answer = answers.map.get(item.num)
    }

    if (seen.has(item.num)) {
      warnings.push(`题号 ${item.num} 重复出现（第 ${seen.get(item.num) + 1} 题与第 ${out.length + 1} 题），答案回填可能串位`)
    } else {
      seen.set(item.num, out.length)
    }

    // 去掉题干开头的分值标注（「（12分）」对做题没用，留着只是噪声）
    question = question.replace(/^\s*[（(【]\s*[0-9０-９]{1,3}\s*分\s*[）)】]\s*/, '').trim()

    const tags = ['试卷导入']
    if (item.type !== '') tags.push(item.type)
    const hasOptions = detectOptions(question)
    if (hasOptions && !tags.includes('选择题')) tags.push('选择题')

    out.push({
      num: item.num,
      subject: subject ?? 'math',
      kind: 'mistake',
      topic: opts.topic ?? '',
      question,
      answer,
      explanation,
      tags,
      difficulty: item.score === null ? 3 : item.score <= 5 ? 2 : item.score <= 10 ? 3 : 4,
      source: opts.source ?? (title !== '' ? title : ''),
      grade: opts.grade,
      section: item.section,
      score: item.score,
      hasOptions,
    })
  }

  const withAnswer = out.filter((i) => i.answer !== '').length
  if (answerStart >= 0 && withAnswer === 0 && out.length > 0) {
    warnings.push('找到了答案区但一道题都没匹配上，请检查答案区的题号写法')
  }

  const assessment = assessPaper(out)
  if (assessment.level === 'low' && out.length > 0) {
    warnings.push(`这份文本不太像试卷（${assessment.reasons.join('；')}），导入前请先核对预览结果`)
  }

  return {
    title,
    subject,
    confidence: assessment.level,
    confidenceReasons: assessment.reasons,
    sections: sections.map((s) => s.title),
    items: out,
    warnings,
    stats: {
      questions: out.length,
      withAnswer,
      withExplanation: out.filter((i) => i.explanation !== '').length,
      choice: out.filter((i) => i.hasOptions).length,
      answerBlock: answerStart >= 0,
      answersParsed: answers.map.size,
    },
  }
}

/**
 * 解析课件（pptx 抽出的文本，按「【第N页】」分页）成知识卡。
 *
 * 每页一张卡：首行当正面（标题），其余当背面。只有一行的页跳过——那多半是过渡页。
 * @param {string} raw 课件文本。
 * @param {object} [opts] 选项：subject、topic、source。
 * @returns {object} { items, warnings, stats }
 */
export function parseCourseware(raw, opts = {}) {
  const warnings = []
  const text = String(raw ?? '')
  const blocks = text.split(/【第(\d+)页】/).slice(1)
  const items = []
  let skipped = 0
  for (let i = 0; i + 1 < blocks.length; i += 2) {
    const page = Number(blocks[i])
    const lines = blocks[i + 1].split('\n').map((l) => l.trim()).filter((l) => l !== '')
    if (lines.length < 2) { skipped += 1; continue }
    items.push({
      subject: opts.subject ?? guessSubject(text.slice(0, 400)) ?? 'math',
      kind: 'card',
      topic: opts.topic ?? lines[0].slice(0, 40),
      question: lines[0],
      answer: lines.slice(1).join('\n'),
      explanation: '',
      tags: ['课件导入', `第${page}页`],
      difficulty: 3,
      source: opts.source ?? '',
      grade: opts.grade,
      page,
    })
  }
  if (items.length === 0) warnings.push('没有识别出可用的页面（每页至少要有标题 + 一行内容）')
  else if (skipped > 0) warnings.push(`跳过 ${skipped} 页只有标题、没有内容的过渡页`)
  return { items, warnings, stats: { pages: items.length + skipped, cards: items.length, skipped } }
}

/**
 * 自动选择解析方式。
 * @param {string} text 纯文本。
 * @param {object} [opts] 选项（透传）。
 * @returns {object} 解析结果，附带 mode 字段说明走了哪条路。
 */
export function parseStudyText(text, opts = {}) {
  const src = String(text ?? '')
  const wanted = opts.mode
  const looksCourseware = /【第\d+页】/.test(src)
  const questionHits = (src.match(/(?:^|\n)\s*[0-9０-９]{1,3}\s*[．.、)）]/g) ?? []).length

  if (wanted === 'courseware' || (wanted === undefined && looksCourseware && questionHits < 3)) {
    return { mode: 'courseware', ...parseCourseware(src, opts) }
  }
  if (wanted === 'paper' || wanted === undefined) {
    const result = parsePaper(src, opts)
    if (result.items.length > 0 || wanted === 'paper') return { mode: 'paper', ...result }
    // 试卷模式认不出题号，且看起来像课件 → 再试课件模式
    if (looksCourseware) return { mode: 'courseware', ...parseCourseware(src, opts) }
    return { mode: 'paper', ...result }
  }
  return { mode: 'paper', ...parsePaper(src, opts) }
}
