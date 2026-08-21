// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 模型可调工具（10 个）。
 *
 * 设计原则：让「对话」成为最省力的录入与复习入口。你在会话里讲完一道错题，
 * 模型直接 tutor_add_items 写进错题本；你说「抽查我物理」，模型 tutor_review_queue
 * 取到期题目、出题、批改，再用 tutor_grade_review 回写评分推进艾宾浩斯排期。
 *
 *   tutor_dashboard     学情总览（倒计时/待复习/薄弱点/进度），可带 days 取统计
 *   tutor_add_items     批量录入错题或知识卡
 *   tutor_search_items  检索题库（关键词/学科/状态/薄弱）
 *   tutor_review_queue  取今日复习队列（含答案与解析，供出题与批改）
 *   tutor_grade_review  提交复习评分，推进下次复习时间
 *   tutor_study_log     记学习时长/章节进度/随手笔记
 *   tutor_exam_record   记模考成绩并返回趋势
 *   tutor_settings      读写学情设置（年级/高考日期/每日目标/启用学科）
 *   tutor_import        导入 Markdown/CSV/Anki 文本（支持 dryRun 预览）
 *   tutor_syllabus      查六科知识大纲（用于排计划、规范知识点命名）
 *   tutor_visualize     生成动态演示（声明式场景 + 解题步骤）
 *   tutor_scene_guide   取场景规范的字段说明与示例
 *   tutor_paper_import  导入电子试卷/课件（docx/pptx/文本），自动切题并回填答案
 *
 * 所有工具的返回值都是一段 JSON 字符串（含 summary 字段便于模型一眼读懂），
 * 参数 JSON Schema 只用 harness 支持的子集（type/properties/required/items/
 * enum/additionalProperties/description）。
 *
 * @module dsh-highschool-tutor/tools
 */

import { mastery } from './srs.js'
import { parseImport } from './importer.js'
import { seedItems } from './seed.js'
import { SUBJECT_KEYS, subjectLabel, toSubject } from './subjects.js'
import { syllabusFor } from './syllabus.js'
import { KIND_LABELS, SCENE_KINDS, keySteps, normalizeScene, objectTypesOf, sceneSummary } from './scene.js'
import { exampleList, exampleOf, fieldDocsOf } from './examples.js'
import { FORMAT_LABELS, extractText } from './docs.js'
import { parseStudyText } from './paper.js'
import { readFileSync } from 'node:fs'

/** 学科枚举（工具参数用）。 */
const SUBJECT_ENUM = [...SUBJECT_KEYS]

/** 评分枚举。 */
const GRADE_ENUM = ['again', 'hard', 'good', 'easy']

/**
 * 生成一个「返回 JSON 字符串」的工具定义。
 * @param {object} spec { name, description, parameters, run, meta?, text? }。
 * @returns {object} ToolDefinition。
 */
function jsonTool(spec) {
  const output = {
    schema: { type: 'string', description: 'JSON 编码的执行结果' },
    render: (args, value) => {
      // 默认把整个 JSON 交给模型；带 text 的工具只回一行确认，避免把大对象
      // （比如整份场景规范）在上下文里重复一遍。
      if (typeof spec.text === 'function') {
        try {
          return [{ type: 'text', text: spec.text(args, JSON.parse(typeof value === 'string' ? value : JSON.stringify(value))) }]
        } catch {
          /* 解析失败则退回原样输出 */
        }
      }
      return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
    },
  }
  // presentationMeta 把数据投影到 tool/result 的持久化 meta 上：
  // 浏览器侧 tool.call.toolview 插槽据此渲染富卡片，且会话重放后依然存在。
  if (typeof spec.meta === 'function') {
    output.presentationMeta = (args, value) => {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value
        return spec.meta(args, parsed) ?? null
      } catch {
        return null
      }
    }
  }
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output,
    async execute(args) {
      const value = await spec.run(args === null || typeof args !== 'object' ? {} : args)
      return JSON.stringify(value)
    },
  }
}

/**
 * 精简一条题目用于模型输出（避免把整库塞进上下文）。
 * @param {object} it 题目。
 * @param {number} now 当前时间戳。
 * @param {boolean} full 是否保留完整答案与解析。
 * @returns {object} 精简记录。
 */
function briefItem(it, now, full) {
  const cut = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s ?? '')
  return {
    id: it.id,
    kind: it.kind,
    subject: it.subject,
    subjectLabel: subjectLabel(it.subject),
    topic: it.topic,
    chapter: it.chapter || undefined,
    question: full ? it.question : cut(it.question, 300),
    answer: full ? it.answer : cut(it.answer, 200),
    explanation: full ? it.explanation : cut(it.explanation, 200) || undefined,
    tags: it.tags.length > 0 ? it.tags : undefined,
    difficulty: it.difficulty,
    source: it.source || undefined,
    state: it.srs.state,
    dueIn: Math.round(((it.srs.due - now) / 86_400_000) * 10) / 10,
    lapses: it.srs.lapses,
    reps: it.srs.reps,
    mastery: mastery(it, now),
  }
}

/**
 * 构造全部工具定义。
 * @param {import('./store.js').Store} store 数据仓库。
 * @returns {object[]} ToolDefinition 数组。
 */
export function createTools(store) {
  return [
    // ── 1. 总览 ─────────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_dashboard',
      description: '查看高中学习总览：高考倒计时、今日待复习数量（分学科）、今日学习时长与连续天数、薄弱知识点排行、最近模考成绩。传 days 时附带该时间窗的统计（每日复习量/学习时长曲线、各科掌握度、记忆保持率、成绩趋势）。开始任何辅导、排计划或抽查前先调用它。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', description: '附带统计的天数窗口（1-180），省略则只返回总览' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const overview = store.overview(now)
        const out = {
          summary: `距高考 ${overview.countdown.days ?? '未设置'} 天 · 今日待复习 ${overview.due.total + overview.due.new} 条（到期 ${overview.due.total} / 新卡 ${overview.due.new}）· 今日已复习 ${overview.study.reviewedToday}/${overview.study.reviewTarget} 条 · 学习 ${overview.study.minutes}/${overview.study.target} 分钟 · 连续 ${overview.study.streak} 天`,
          ...overview,
        }
        if (Number.isFinite(args.days)) out.stats = store.stats(args.days, now)
        return out
      },
    }),

    // ── 2. 录题 ─────────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_add_items',
      description: '把错题或知识卡片批量写入题库，写入后自动进入艾宾浩斯复习排期。用户在对话里讲完一道题、你讲解完一个知识点、或整理出一批必背内容时都应主动调用。kind=mistake 表示错题（需带解析与来源），kind=card 表示知识/公式/古诗文卡片。topic 请使用课本口径的知识点名（可先用 tutor_syllabus 查）。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '待写入的题目列表（1-50 条）',
            items: {
              type: 'object',
              properties: {
                subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科' },
                kind: { type: 'string', enum: ['mistake', 'card'], description: 'mistake=错题，card=知识卡（默认 card）' },
                topic: { type: 'string', description: '知识点，如「一元函数的导数及其应用」' },
                chapter: { type: 'string', description: '教材章节，如「选择性必修第二册」' },
                grade: { type: 'string', enum: ['g1', 'g2', 'g3'], description: '所属年级' },
                question: { type: 'string', description: '题干/卡片正面（必填）' },
                answer: { type: 'string', description: '答案/卡片背面' },
                explanation: { type: 'string', description: '解析、错因、易错提醒' },
                tags: { type: 'array', items: { type: 'string' }, description: '标签，如「计算失误」「必背」' },
                difficulty: { type: 'integer', description: '难度 1-5，默认 3' },
                source: { type: 'string', description: '来源，如「2024 浙江一模 T18」' },
                id: { type: 'string', description: '传入已有 id 表示更新该条（复习进度保留）' },
              },
              required: ['subject', 'question'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const list = Array.isArray(args.items) ? args.items.slice(0, 50) : []
        const result = store.upsertItems(list, now)
        const overview = store.overview(now)
        return {
          summary: `新增 ${result.added.length} 条、更新 ${result.updated.length} 条${result.skipped > 0 ? `、跳过 ${result.skipped} 条（题干为空）` : ''}；题库共 ${overview.totals.items} 条，今日待复习 ${overview.due.total + overview.due.new} 条（到期 ${overview.due.total} / 新卡 ${overview.due.new}）`,
          added: result.added,
          updated: result.updated,
          skipped: result.skipped,
          items: result.items.map((it) => ({ id: it.id, subject: it.subject, kind: it.kind, topic: it.topic, dueDate: new Date(it.srs.due).toISOString().slice(0, 10) })),
          totals: overview.totals,
        }
      },
    }),

    // ── 3. 检索 ─────────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_search_items',
      description: '检索题库：按关键词、学科、知识点、类型或状态筛选。status=weak 取薄弱题（错得多或掌握度低），status=due 取今日到期，status=new 取还没学过的新卡。用于「我以前错过类似的题吗」「把导数的错题都调出来」这类请求，以及讲解前查重避免重复录入。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，匹配题干/答案/解析/知识点/来源/标签' },
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '限定学科' },
          kind: { type: 'string', enum: ['mistake', 'card'], description: '限定类型' },
          topic: { type: 'string', description: '知识点或章节包含该文本' },
          status: { type: 'string', enum: ['all', 'due', 'new', 'learning', 'review', 'weak', 'archived'], description: '状态筛选，默认 all' },
          sort: { type: 'string', enum: ['updated', 'created', 'due', 'mastery', 'difficulty'], description: '排序，默认 updated；mastery 为掌握度升序（最差在前）' },
          limit: { type: 'integer', description: '返回条数（1-50），默认 20' },
          full: { type: 'boolean', description: 'true 时返回完整答案与解析，默认截断' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const limit = Number.isFinite(args.limit) ? Math.min(50, Math.max(1, Math.trunc(args.limit))) : 20
        const result = store.listItems({ ...args, limit }, now)
        return {
          summary: `命中 ${result.total} 条，返回 ${result.items.length} 条`,
          total: result.total,
          items: result.items.map((it) => briefItem(it, now, args.full === true)),
        }
      },
    }),

    // ── 4. 复习队列 ─────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_review_queue',
      description: '取今日该复习的题目（逾期最久的优先，再按每日新卡上限补充新卡），返回完整题干、答案与解析。用它来抽查用户：先只念题干让用户作答，再对照答案批改，最后用 tutor_grade_review 回写评分。用户说「抽查我」「今天复习什么」「考考我物理」时调用。',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '只取该学科' },
          limit: { type: 'integer', description: '取几条（1-30），默认 8' },
          includeNew: { type: 'boolean', description: '是否包含从未学过的新卡，默认 true' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const limit = Number.isFinite(args.limit) ? Math.min(30, Math.max(1, Math.trunc(args.limit))) : 8
        const result = store.queue({ ...args, limit }, now)
        return {
          summary: `取到 ${result.items.length} 条（到期 ${result.counts.due} 条、新卡池 ${result.counts.new} 条、今日新卡余额 ${result.counts.newBudget}）；批改后请调用 tutor_grade_review 回写评分`,
          counts: result.counts,
          items: result.items.map((it) => briefItem(it, now, true)),
          gradeGuide: {
            again: '完全不会/又错了 → 20 分钟后再来一遍',
            hard: '答对但很吃力 → 间隔缩短、留在当前阶梯',
            good: '正常掌握 → 前进一档（1→2→4→7→15→30→60→120 天）',
            easy: '一眼秒杀 → 直接跳两档',
          },
        }
      },
    }),

    // ── 5. 提交评分 ─────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_grade_review',
      description: '提交一次或多次复习评分，推进艾宾浩斯排期并记入复习流水（统计正确率、连续天数都依赖它）。批改用户作答后必须调用，否则这次复习不算数。答错的题会在 20 分钟后重新进入队列。',
      parameters: {
        type: 'object',
        properties: {
          grades: {
            type: 'array',
            description: '评分列表',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '题目 id（来自 tutor_review_queue / tutor_search_items）' },
                grade: { type: 'string', enum: GRADE_ENUM, description: 'again=不会，hard=吃力，good=掌握，easy=秒杀' },
                elapsedMs: { type: 'integer', description: '本题作答耗时（毫秒），可省略' },
              },
              required: ['id', 'grade'],
              additionalProperties: false,
            },
          },
        },
        required: ['grades'],
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const result = store.review(Array.isArray(args.grades) ? args.grades : [], now)
        const overview = store.overview(now)
        const again = result.results.filter((r) => r.grade === 'again').length
        return {
          summary: `记录 ${result.results.length} 条评分（其中 ${again} 条需当天重来）${result.failed.length > 0 ? `，${result.failed.length} 条 id 不存在` : ''}；今日已复习 ${overview.study.reviewedToday}/${overview.study.reviewTarget}，剩余待复习 ${overview.due.total + overview.due.new}`,
          results: result.results,
          failed: result.failed,
          due: overview.due,
          study: overview.study,
        }
      },
    }),

    // ── 6. 学习日志 ─────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_study_log',
      description: '记一笔学习：某科学习了多少分钟、完成了哪个章节、或一句随手笔记。用户说「今天数学刷了一小时」「化学选必一第二章看完了」时调用，用于进度统计、连续天数与每日目标达成率。',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科' },
          minutes: { type: 'integer', description: '学习分钟数（可为负数用于纠正误记）' },
          chapter: { type: 'string', description: '章节名（配合 status 记录进度）' },
          status: { type: 'string', enum: ['todo', 'doing', 'done'], description: '章节状态，默认 done' },
          note: { type: 'string', description: '随手笔记，如「导数含参讨论还是不熟」' },
          date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天（凌晨 4 点前算前一天）' },
        },
        required: ['subject'],
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const day = store.logStudy(args, now)
        const overview = store.overview(now)
        return {
          summary: `${day.date} 记录成功：今日共学习 ${overview.study.minutes}/${overview.study.target} 分钟，连续 ${overview.study.streak} 天`,
          day,
          study: overview.study,
        }
      },
    }),

    // ── 7. 模考成绩 ─────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_exam_record',
      description: '记录一次模考/月考成绩（单科分数 + 可选排名），返回历次趋势。缺考的科目不填即可；总分未给时按各科之和计算。用户报成绩时调用，之后可结合 tutor_dashboard 分析哪科掉分最多。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '考试日期 YYYY-MM-DD，默认今天' },
          name: { type: 'string', description: '考试名称，如「高二下第一次月考」' },
          scores: {
            type: 'array',
            description: '各科分数',
            items: {
              type: 'object',
              properties: {
                subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科' },
                score: { type: 'number', description: '得分' },
                full: { type: 'number', description: '满分，默认语数英 150、其他 100' },
              },
              required: ['subject', 'score'],
              additionalProperties: false,
            },
          },
          total: { type: 'number', description: '总分（省略则取各科之和）' },
          totalFull: { type: 'number', description: '总分满分，默认各科满分之和' },
          rank: { type: 'integer', description: '名次' },
          rankOf: { type: 'integer', description: '参考总人数' },
          note: { type: 'string', description: '备注，如「理综时间不够」' },
        },
        required: ['scores'],
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const record = store.saveExam(args, now)
        const stats = store.stats(30, now)
        const trend = stats.examTrend
        const prev = trend.length >= 2 ? trend[trend.length - 2] : null
        const delta = prev !== null ? Math.round((record.total - prev.total) * 10) / 10 : null
        return {
          summary: `已记录「${record.name}」（${record.date}）总分 ${record.total}/${record.totalFull}${delta !== null ? `，较上次 ${delta >= 0 ? '+' : ''}${delta} 分` : ''}`,
          exam: record,
          delta,
          trend,
        }
      },
    }),

    // ── 8. 学情设置 ─────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_settings',
      description: '读或写学情设置：不传参数=读取当前设置；传参数则更新。年级决定默认高考日期（高一+2年、高二+1年、高三当年 6 月 7 日）与大纲默认范围。用户说「我现在高二」「每天复习 60 条」「地理不用管」时调用。',
      parameters: {
        type: 'object',
        properties: {
          grade: { type: 'string', enum: ['g1', 'g2', 'g3'], description: '当前年级' },
          examDate: { type: 'string', description: '高考日期 YYYY-MM-DD（覆盖按年级的推算）' },
          region: { type: 'string', description: '考区/教材版本，如「新高考 I 卷 · 人教版」' },
          subjects: { type: 'array', items: { type: 'string', enum: SUBJECT_ENUM }, description: '启用的学科（影响队列与统计）' },
          dailyReviewTarget: { type: 'integer', description: '每日复习条数目标' },
          dailyStudyMinutes: { type: 'integer', description: '每日学习分钟目标' },
          newPerDay: { type: 'integer', description: '每日新卡上限' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const keys = Object.keys(args)
        if (keys.length === 0) {
          const profile = store.profile(now)
          return { summary: `当前：${profile.grade ?? '未设年级'} · 高考 ${profile.examDate ?? '未设置'} · 启用 ${profile.subjects.map(subjectLabel).join('/')} · 每日复习 ${profile.dailyReviewTarget} 条 / 学习 ${profile.dailyStudyMinutes} 分钟`, profile }
        }
        const profile = store.saveProfile(args, now)
        const overview = store.overview(now)
        return {
          summary: `设置已更新：${profile.grade ?? '未设年级'} · 高考 ${profile.examDate ?? '未设置'}（剩 ${overview.countdown.days ?? '—'} 天）· 每日复习 ${profile.dailyReviewTarget} 条 / 学习 ${profile.dailyStudyMinutes} 分钟`,
          profile,
          countdown: overview.countdown,
        }
      },
    }),

    // ── 9. 导入 ─────────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_import',
      description: '把一段文本批量导入题库，自动识别格式：Markdown 问答块（Q:/A:/解析:）、Markdown 表格、CSV、Anki 导出的 TSV。先用 dryRun=true 预览解析结果并向用户确认条数，再正式导入。用户粘贴一大段错题整理、或让你把某个文件的内容入库时使用（文件内容需先用其他工具读出来再传入）。也可传 seed=true 一键导入内置的六科高频卡片包。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待导入的文本内容' },
          format: { type: 'string', enum: ['auto', 'md', 'mdtable', 'csv', 'tsv'], description: '格式，默认 auto 自动识别' },
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '未在文本中指明学科时使用的默认学科' },
          kind: { type: 'string', enum: ['mistake', 'card'], description: '默认类型' },
          topic: { type: 'string', description: '默认知识点' },
          source: { type: 'string', description: '默认来源标注' },
          dryRun: { type: 'boolean', description: 'true 只解析预览、不写库' },
          seed: { type: 'boolean', description: 'true 时忽略 text，导入内置六科高频卡片包（按 seedKey 幂等）' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        if (args.seed === true) {
          const result = store.upsertItems(seedItems(), now)
          return { summary: `内置卡片包导入完成：新增 ${result.added.length} 条、更新 ${result.updated.length} 条`, added: result.added.length, updated: result.updated.length }
        }
        const parsed = parseImport(args.text ?? '', { ...args, format: args.format === 'auto' ? undefined : args.format })
        if (args.dryRun === true) {
          return {
            summary: `预览：识别为 ${parsed.format} 格式，可导入 ${parsed.items.length} 条${parsed.warnings.length > 0 ? `，${parsed.warnings.length} 条提示` : ''}`,
            dryRun: true,
            format: parsed.format,
            count: parsed.items.length,
            warnings: parsed.warnings.slice(0, 10),
            preview: parsed.items.slice(0, 5),
          }
        }
        const result = store.upsertItems(parsed.items, now)
        return {
          summary: `导入完成（${parsed.format}）：新增 ${result.added.length} 条、更新 ${result.updated.length} 条、跳过 ${result.skipped} 条`,
          format: parsed.format,
          added: result.added.length,
          updated: result.updated.length,
          skipped: result.skipped,
          warnings: parsed.warnings.slice(0, 10),
        }
      },
    }),

    // ── 10. 知识大纲 ────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_syllabus',
      description: '查询六科的人教版新教材知识大纲（教材册次 → 章节，含贯穿三年的能力专题）。排学习计划、给知识点起规范名称、判断某内容属于哪一册时使用；录题前查一下能让 topic 口径统一，薄弱点统计才准确。',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科；省略则返回六科全部大纲' },
          grade: { type: 'string', enum: ['g1', 'g2', 'g3'], description: '只看该年级（能力专题始终包含）' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const subject = toSubject(args.subject)
        const grade = args.grade ?? null
        if (subject !== null) {
          const modules = syllabusFor(subject, grade)
          return {
            summary: `${subjectLabel(subject)}：${modules.length} 个模块、${modules.reduce((a, m) => a + m.chapters.length, 0)} 个章节`,
            subject,
            modules,
          }
        }
        const all = Object.fromEntries(SUBJECT_KEYS.map((k) => [k, syllabusFor(k, grade)]))
        return {
          summary: `返回六科大纲（${SUBJECT_KEYS.map((k) => `${subjectLabel(k)} ${all[k].reduce((a, m) => a + m.chapters.length, 0)} 章`).join(' / ')}）`,
          all,
        }
      },
    }),
    // ── 11. 动态演示 ────────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_visualize',
      description: '给当前正在讲的题目生成一张**可交互的动态演示图**，直接显示在对话里，并可一键推到右侧栏放大看。讲解数学、物理、化学、地理题目时应当主动调用——凡是「图形/空间/过程/受力/结构」类的题，一张能分步演示的图胜过一大段文字。\n\n用法：把图形写成声明式的 scene（场景规范），引擎负责绘制与交互（2D 可平移缩放，3D 可拖拽旋转）。scene.steps 是解题步骤，每一步可以 show/hide 对象、focus 高亮、set 改属性，key:true 标出关键步骤——学生看到的就是「按你的讲解节奏逐步长出来的图」。\n\n九种场景类型：plot2d 函数图像/切线/面积 · geom3d 立体几何（能自动求截面）· mech2d 受力与运动 · circuit 电路 · chart2d 过程曲线（平衡/滴定/能量/气候）· molecule3d 分子构型（按 VSEPR 自动摆位）· lattice3d 晶胞（自动算每胞微粒数）· globe3d 地球光照（自动算晨昏线与正午太阳高度）· diagram2d 通用示意图；都表达不了时用 kind="html" 直接写 HTML 片段。\n\n**第一次画某种类型前先调用 tutor_scene_guide 取该类型的字段说明与完整示例**，照着改比凭空写准得多。可同时传 item 把这道题一并录入错题本（省一次 tutor_add_items）。',
      parameters: {
        type: 'object',
        properties: {
          scene: {
            type: 'object',
            description: '场景规范。必填 kind；按类型填 view/objects/steps（字段见 tutor_scene_guide）；kind="html" 时填 html',
            properties: {
              kind: { type: 'string', enum: SCENE_KINDS, description: '场景类型' },
              title: { type: 'string', description: '演示标题（一句话说清这张图画的是什么）' },
              caption: { type: 'string', description: '副标题：这张图要说明的核心结论' },
              subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科' },
              topic: { type: 'string', description: '知识点（建议用 tutor_syllabus 的课本口径）' },
              view: { type: 'object', description: '视图：2D 给 xMin/xMax/yMin/yMax，3D 给 yaw/pitch', additionalProperties: true },
              objects: {
                type: 'array',
                description: '场景对象列表，每个必须有 type，建议给有意义的 id 供步骤引用',
                items: { type: 'object', additionalProperties: true },
              },
              steps: {
                type: 'array',
                description: '解题步骤：{ title, detail, formula, key, show[], hide[], focus[], set{} }',
                items: { type: 'object', additionalProperties: true },
              },
              html: { type: 'string', description: 'kind="html" 时的 HTML 片段' },
            },
            required: ['kind'],
            additionalProperties: true,
          },
          item: {
            type: 'object',
            description: '可选：同时把这道题录入错题本（字段同 tutor_add_items 的单条），录入后演示会与该题关联，复习时能再打开',
            properties: {
              subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科' },
              kind: { type: 'string', enum: ['mistake', 'card'], description: 'mistake=错题，card=知识卡' },
              topic: { type: 'string', description: '知识点' },
              question: { type: 'string', description: '题干' },
              answer: { type: 'string', description: '答案' },
              explanation: { type: 'string', description: '解析与易错点' },
              source: { type: 'string', description: '来源' },
              difficulty: { type: 'integer', description: '难度 1-5' },
            },
            required: ['subject', 'question'],
            additionalProperties: false,
          },
          itemId: { type: 'string', description: '可选：关联已存在的题目 id（来自 tutor_review_queue / tutor_search_items）' },
          persist: { type: 'boolean', description: '是否存入演示库以便日后重播，默认 true' },
        },
        required: ['scene'],
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        const { scene, warnings } = normalizeScene(args.scene, {
          subject: args.item?.subject,
          topic: args.item?.topic,
        })
        const summary = sceneSummary(scene)
        const keys = keySteps(scene)

        // 顺手录题：讲完一道错题往往既要图也要进错题本，合成一次调用省一轮往返
        let itemId = typeof args.itemId === 'string' ? args.itemId : ''
        let added = null
        if (args.item !== null && typeof args.item === 'object') {
          const result = store.upsertItems([{ ...args.item, id: itemId || undefined }], now)
          const touched = result.items[0]
          if (touched !== undefined) {
            itemId = touched.id
            added = { id: touched.id, subject: touched.subject, topic: touched.topic }
          }
        }

        let demo = null
        if (args.persist !== false) {
          demo = store.saveDemo({
            title: scene.title,
            kind: scene.kind,
            subject: scene.subject,
            topic: scene.topic,
            summary,
            keySteps: keys,
            itemId,
            scene,
          }, now)
        }

        return {
          ok: true,
          demoId: demo?.id ?? null,
          kind: scene.kind,
          kindLabel: KIND_LABELS[scene.kind] ?? scene.kind,
          title: scene.title,
          summary,
          objects: scene.objects.length,
          steps: scene.steps.length,
          keySteps: keys,
          warnings,
          item: added,
          itemId: itemId || null,
          scene,
        }
      },
      // 给模型的回执只有一行：场景 JSON 是模型自己刚写的，再回显一遍纯属浪费上下文
      text: (_args, value) => {
        const warn = value.warnings.length > 0 ? `\n注意：${value.warnings.slice(0, 5).join('；')}` : ''
        const keys = value.keySteps.length > 0
          ? `重点步骤：${value.keySteps.map((s) => `第${s.index}步 ${s.title}`).join('；')}。`
          : ''
        return `已生成动态演示「${value.title}」（${value.summary}）并显示在对话中，用户可点「侧栏展开」放大交互。${keys}${value.itemId !== null ? `已关联题目 ${value.itemId}。` : ''}${value.demoId !== null ? `演示已存库（${value.demoId}），复习时可重播。` : ''}${warn}\n接下来用文字讲解时，可以直接引用图上的步骤编号，不要重复描述整张图。`
      },
      // 场景数据投影到持久化 meta：浏览器侧据此渲染，会话重放后依然能画出来
      meta: (_args, value) => ({
        kind: 'hst-demo',
        demoId: value.demoId,
        title: value.title,
        sceneKind: value.kind,
        summary: value.summary,
        keySteps: value.keySteps,
        itemId: value.itemId,
        scene: value.scene,
      }),
    }),

    // ── 13. 电子资料导入 ────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_paper_import',
      description: '把一份**电子试卷 / 课件 / 练习题**读进题库：给文件路径（.docx / .pptx / .txt / .md / .csv / .html）或直接给文本，工具会自动切分题目、识别 ABCD 选项、并把文末「参考答案」区按题号回填到每道题上，然后写入题库进入复习排期。用户说「把这份卷子导进来」「这个课件整理成卡片」时调用。\n\n先用 dryRun=true 预览切出多少题、多少题匹配到答案，向用户确认后再正式导入。\n\nPDF 与图片不能直接解析：PDF 请让用户先用 Word/WPS 另存为 .docx；扫描件/手机拍的题请让用户直接发图片，你用视觉工具读出来后改用 tutor_add_items 写入（那样更准，因为你能同时看懂图和公式）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径（.docx/.pptx/.txt/.md/.csv/.html）；与 text 二选一' },
          text: { type: 'string', description: '直接给出的试卷/课件文本；与 path 二选一' },
          mode: { type: 'string', enum: ['auto', 'paper', 'courseware'], description: 'auto 自动判断（默认）；paper 按试卷切题；courseware 按课件页转知识卡' },
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '学科；省略则从标题自动识别' },
          topic: { type: 'string', description: '统一知识点（建议先用 tutor_syllabus 查课本口径）' },
          grade: { type: 'string', enum: ['g1', 'g2', 'g3'], description: '所属年级' },
          source: { type: 'string', description: '来源标注，如「2024 浙江一模」；省略则取文件名或试卷标题' },
          dryRun: { type: 'boolean', description: 'true 只预览不写库（建议先预览一次）' },
          force: { type: 'boolean', description: '解析结果被判定为「不像试卷」时，确认无误后带 true 强制写入' },
          limit: { type: 'integer', description: '最多导入前几题（用于大卷子分批导入）' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const now = Date.now()
        let text = typeof args.text === 'string' ? args.text : ''
        let source = args.source
        let format = 'text'
        let label = '直接给出的文本'
        const warnings = []

        if (text === '' && typeof args.path === 'string' && args.path !== '') {
          let buf
          try {
            buf = readFileSync(args.path)
          } catch (error) {
            return { ok: false, summary: `读不到文件：${args.path}（${error instanceof Error ? error.message : String(error)}）` }
          }
          const extracted = extractText(buf, args.path)
          format = extracted.format
          label = extracted.label
          if (!extracted.ok) {
            return {
              ok: false,
              format,
              label,
              summary: `${label} 不能直接解析。${extracted.hint}`,
              hint: extracted.hint,
            }
          }
          text = extracted.text
          warnings.push(...extracted.warnings)
          if (source === undefined) source = args.path.split('/').pop().replace(/\.[a-z0-9]+$/i, '')
        }
        if (text.trim() === '') return { ok: false, summary: '没有内容可解析：请给出 path 或 text' }

        const parsed = parseStudyText(text, {
          mode: args.mode === 'auto' ? undefined : args.mode,
          subject: args.subject,
          topic: args.topic,
          grade: args.grade,
          source,
        })
        warnings.push(...parsed.warnings)
        const limit = Number.isFinite(args.limit) ? Math.max(1, Math.trunc(args.limit)) : 200
        const items = parsed.items.slice(0, limit)

        const brief = items.slice(0, 5).map((it) => ({
          num: it.num ?? it.page,
          question: it.question.length > 80 ? `${it.question.slice(0, 80)}…` : it.question,
          answer: it.answer === '' ? null : (it.answer.length > 40 ? `${it.answer.slice(0, 40)}…` : it.answer),
          tags: it.tags,
        }))

        if (args.dryRun === true) {
          return {
            ok: true,
            dryRun: true,
            mode: parsed.mode,
            format,
            label,
            title: parsed.title ?? '',
            subject: parsed.subject ?? null,
            sections: parsed.sections ?? [],
            stats: parsed.stats,
            confidence: parsed.confidence ?? 'high',
            reasons: parsed.confidenceReasons ?? [],
            count: items.length,
            preview: brief,
            warnings: warnings.slice(0, 10),
            summary: parsed.mode === 'paper'
              ? `预览（${label}）：切出 ${parsed.stats.questions} 道题，其中 ${parsed.stats.withAnswer} 道匹配到答案、${parsed.stats.withExplanation} 道带解析；识别到 ${(parsed.sections ?? []).length} 个大题。${parsed.stats.answerBlock ? '找到了文末答案区。' : '没有找到文末答案区。'}${warnings.length > 0 ? `注意：${warnings.slice(0, 3).join('；')}` : ''}`
              : `预览（${label}）：${parsed.stats.pages} 页里转出 ${parsed.stats.cards} 张知识卡${parsed.stats.skipped > 0 ? `，跳过 ${parsed.stats.skipped} 页过渡页` : ''}。`,
          }
        }

        // 可信度闸门：不像试卷就别悄悄写进题库（用户拿任意文件来试是常态）
        if (parsed.confidence === 'low' && args.force !== true) {
          return {
            ok: false,
            mode: parsed.mode,
            format,
            label,
            confidence: 'low',
            reasons: parsed.confidenceReasons ?? [],
            count: items.length,
            preview: brief,
            summary: `这份${label}不太像试卷，已拒绝写入题库：${(parsed.confidenceReasons ?? []).join('；')}。`
              + `切出的 ${items.length} 条内容见 preview——先给用户看一眼，确认确实是题目再带 force=true 重试；`
              + `若本来就不是试卷（比如配置文件、说明文档），请换用 tutor_add_items 手工录入需要的部分。`,
          }
        }

        const result = store.upsertItems(items, now)
        const overview = store.overview(now)
        return {
          ok: true,
          mode: parsed.mode,
          format,
          label,
          added: result.added.length,
          updated: result.updated.length,
          skipped: result.skipped,
          stats: parsed.stats,
          preview: brief,
          warnings: warnings.slice(0, 10),
          summary: `已从${label}导入 ${result.added.length} 条${parsed.mode === 'paper' ? `（${parsed.stats.withAnswer} 道带答案）` : '（知识卡）'}${result.skipped > 0 ? `，跳过 ${result.skipped} 条` : ''}；题库共 ${overview.totals.items} 条，今日待复习 ${overview.due.total + overview.due.new} 条。${parsed.stats.withAnswer !== undefined && parsed.stats.questions > parsed.stats.withAnswer ? `有 ${parsed.stats.questions - parsed.stats.withAnswer} 道题没匹配到答案，建议提醒用户补。` : ''}`,
        }
      },
    }),

    // ── 12. 场景规范速查 ────────────────────────────────────────────────────
    jsonTool({
      name: 'tutor_scene_guide',
      description: '取动态演示「场景规范」的字段说明与完整示例。第一次给某类题目画图前先调用它（传 kind），拿到该场景类型的全部对象类型、字段含义和一份可直接改的真实示例，再调 tutor_visualize。不传 kind 时返回九种类型的选型指南。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: SCENE_KINDS, description: '场景类型；省略则返回选型总览' },
          subject: { type: 'string', enum: SUBJECT_ENUM, description: '按学科推荐适用的场景类型' },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const kind = SCENE_KINDS.includes(args.kind) ? args.kind : null
        if (kind === null) {
          const bySubject = {
            math: ['plot2d（函数图像、切线、面积、圆锥曲线）', 'geom3d（立体几何、空间向量、截面、二面角）'],
            physics: ['mech2d（受力分析、斜面、抛体、圆周、场）', 'circuit（电路与电表）', 'chart2d（v−t、图像类问题）', 'plot2d（函数关系）'],
            chemistry: ['molecule3d（分子构型与键角）', 'lattice3d（晶胞与微粒数）', 'chart2d（平衡移动、滴定、能量图）', 'diagram2d（工业流程）'],
            geography: ['globe3d（光照、昼夜、正午太阳高度）', 'chart2d（气温降水、人口）', 'diagram2d（锋面、环流、剖面）'],
            chinese: ['diagram2d（结构梳理、论证脉络）'],
            english: ['diagram2d（篇章逻辑、语法结构）'],
          }
          const subject = toSubject(args.subject)
          return {
            summary: '九种场景类型的选型指南；确定类型后再用 kind 参数调一次本工具取字段说明与示例',
            kinds: SCENE_KINDS.map((k) => ({
              kind: k,
              label: KIND_LABELS[k],
              objectTypes: objectTypesOf(k),
              example: EXAMPLE_TITLES[k] ?? '',
            })),
            recommend: subject !== null ? { subject, use: bySubject[subject] ?? [] } : bySubject,
            commonSteps: {
              说明: 'steps 是解题步骤，按讲课顺序排，学生点步骤或自动播放时图会跟着变',
              字段: {
                title: '这一步在做什么（短句）',
                detail: '为什么这样做、易错点（1-3 句）',
                formula: '这一步用到的公式或算式（支持 x^2、v_0 写法）',
                key: 'true = 关键步骤，时间轴上高亮标「重点」，通常是「最容易卡住的那一步」',
                show: '本步开始显示的对象 id 数组（配合对象上的 hidden:true 做逐步呈现）',
                hide: '本步隐藏的对象 id 数组',
                focus: '本步高亮（加光晕）的对象 id 数组——「这一步看这里」',
                set: '{ 对象id: { 字段: 新值 } } 修改对象属性，如把切点移到另一处',
              },
              建议: '3-6 步最好；每步只讲一件事；把 hidden:true 用足，让图跟着讲解一点点长出来',
            },
          }
        }
        const example = exampleOf(kind)
        const { scene } = example !== null ? normalizeScene(example) : { scene: null }
        return {
          summary: `${KIND_LABELS[kind]}（${kind}）：${objectTypesOf(kind).length} 种对象类型，附一份完整示例`,
          kind,
          label: KIND_LABELS[kind],
          objectTypes: objectTypesOf(kind),
          fields: fieldDocsOf(kind),
          example: scene,
          tips: [
            '对象的 id 要有意义（tan、G1、b2），步骤里靠它引用',
            '想让图跟着讲解逐步出现：对象加 hidden:true，再在某一步 show',
            'key:true 只标真正的关键步骤（1-2 个），标多了就失去重点',
            'label 支持 x^2 / v_0 写法，会自动渲染成 x²、v₀',
            '不确定坐标就先按示例的量级填，用户可以拖动和缩放',
          ],
        }
      },
    }),
  ]
}

/** 各场景类型的示例标题（选型总览里给模型一个直观印象）。 */
const EXAMPLE_TITLES = Object.fromEntries(exampleList().map((e) => [e.kind, e.title]))
