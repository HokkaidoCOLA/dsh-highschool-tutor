// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 持久化数据层。
 *
 * 全部数据落在 `$DSH_HOME/highschool-tutor/`（默认 `~/.dsh/highschool-tutor/`）：
 *
 *   profile.json    学情设置：年级、高考日期、启用学科、每日目标
 *   items.json      题库：错题（mistake）与知识卡（card），含各自的复习状态
 *   reviews.json    复习流水：每次评分一条，用于统计正确率/复习量/连续天数
 *   studylog.json   学习日志：按逻辑日记录各科学习分钟数、章节进度、随手笔记
 *   exams.json      模考成绩：单科分/总分/排名，用于画趋势
 *
 * 写入一律「临时文件 + rename」原子替换，避免进程被杀时留下半个 JSON。
 * host 进程是这些文件的唯一写者，因此读到内存后即缓存，写时同步回盘。
 *
 * @module dsh-highschool-tutor/store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  DAY_MS, dayEnd, dayKey, dayKeyToTs, dayStart,
  GRADES as GRADE_LEVELS, isDue, mastery, newSrs, normalizeSrs, overdueDays, schedule,
} from './srs.js'
import { SUBJECT_KEYS, toGrade, toSubject } from './subjects.js'

/** 数据文件名。 */
const FILES = {
  profile: 'profile.json',
  items: 'items.json',
  reviews: 'reviews.json',
  studylog: 'studylog.json',
  exams: 'exams.json',
  demos: 'demos.json',
}

/** 复习流水保留条数上限（超出丢弃最旧的）。 */
const REVIEW_LOG_CAP = 20_000

/** 演示保留条数上限（超出丢弃最旧的；一份演示几 KB，300 份约 1 MB）。 */
const DEMO_CAP = 300

/** 单条文本字段长度上限，防止把整篇文章塞进题库。 */
const TEXT_CAP = 6000

/**
 * 数据目录：$DSH_HOME/highschool-tutor，未设置 DSH_HOME 时退回 ~/.dsh。
 * @returns {string} 目录绝对路径。
 */
export function dataDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'highschool-tutor')
}

/**
 * 裁剪并规整文本字段。
 * @param {unknown} value 输入。
 * @param {number} cap 长度上限。
 * @returns {string} 规整后的字符串。
 */
function text(value, cap = TEXT_CAP) {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  const trimmed = s.replace(/\r\n/g, '\n').trim()
  return trimmed.length > cap ? `${trimmed.slice(0, cap)}…` : trimmed
}

/**
 * 规整标签数组。
 * @param {unknown} value 输入（数组或逗号分隔字符串）。
 * @returns {string[]} 去重后的标签。
 */
function tags(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(/[,，;；\s]+/) : []
  const out = []
  for (const t of raw) {
    const s = text(t, 40)
    if (s !== '' && !out.includes(s) && out.length < 12) out.push(s)
  }
  return out
}

/**
 * 默认高考日期：按年级推到对应年份的 6 月 7 日。
 * @param {string|null} grade 年级键。
 * @param {number} now 当前时间戳。
 * @returns {string|null} YYYY-06-07；年级未知时 null。
 */
export function defaultExamDate(grade, now) {
  const g = toGrade(grade)
  if (g === null) return null
  const d = new Date(now)
  // 6 月 7 日之后视为已进入下一学年
  const passed = d.getMonth() > 5 || (d.getMonth() === 5 && d.getDate() > 7)
  const base = d.getFullYear() + (passed ? 1 : 0)
  const offset = g === 'g3' ? 0 : g === 'g2' ? 1 : 2
  return `${base + offset}-06-07`
}

/** 学情设置的默认值。 */
function defaultProfile(now) {
  return {
    version: 1,
    grade: null,
    examDate: null,
    region: '新高考 · 人教版',
    subjects: [...SUBJECT_KEYS],
    dailyReviewTarget: 40,
    dailyStudyMinutes: 180,
    newPerDay: 20,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 题库/复习数据仓库。一个实例对应一个数据目录。
 */
export class Store {
  /**
   * @param {string} [dir] 数据目录，默认 {@link dataDir}()。
   */
  constructor(dir = dataDir()) {
    this.dir = dir
    /** @type {Map<string, any>} 文件内容缓存（host 是唯一写者）。 */
    this.cache = new Map()
  }

  /**
   * 读一个数据文件（带缓存与损坏兜底）。
   * @param {string} name FILES 的键。
   * @param {() => any} fallback 缺失/损坏时的初始值工厂。
   * @returns {any} 文件内容。
   */
  read(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name)
    const path = join(this.dir, FILES[name])
    let value
    try {
      value = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback()
      if (value === null || typeof value !== 'object') value = fallback()
    } catch {
      value = fallback() // 文件损坏：不让整个插件挂掉，回到空库
    }
    this.cache.set(name, value)
    return value
  }

  /**
   * 原子写回一个数据文件。
   * @param {string} name FILES 的键。
   * @param {any} value 要写入的内容。
   * @returns {void}
   */
  write(name, value) {
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, FILES[name])
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
    this.cache.set(name, value)
  }

  // ── 学情设置 ───────────────────────────────────────────────────────────────

  /**
   * 读取学情设置（缺字段补默认值，examDate 未设时按年级推算）。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 学情设置。
   */
  profile(now = Date.now()) {
    const raw = this.read('profile', () => defaultProfile(now))
    const base = defaultProfile(now)
    const subjects = Array.isArray(raw.subjects)
      ? raw.subjects.map(toSubject).filter((s) => s !== null)
      : base.subjects
    return {
      ...base,
      ...raw,
      grade: toGrade(raw.grade),
      subjects: subjects.length > 0 ? [...new Set(subjects)] : base.subjects,
      examDate: typeof raw.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.examDate)
        ? raw.examDate
        : defaultExamDate(raw.grade, now),
      dailyReviewTarget: Number.isFinite(raw.dailyReviewTarget) ? Math.max(0, Math.trunc(raw.dailyReviewTarget)) : base.dailyReviewTarget,
      dailyStudyMinutes: Number.isFinite(raw.dailyStudyMinutes) ? Math.max(0, Math.trunc(raw.dailyStudyMinutes)) : base.dailyStudyMinutes,
      newPerDay: Number.isFinite(raw.newPerDay) ? Math.max(0, Math.trunc(raw.newPerDay)) : base.newPerDay,
    }
  }

  /**
   * 更新学情设置（仅覆盖传入字段）。
   * @param {object} patch 待更新字段。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 更新后的设置。
   */
  saveProfile(patch, now = Date.now()) {
    const cur = this.profile(now)
    const next = { ...cur }
    if (patch.grade !== undefined) {
      next.grade = toGrade(patch.grade)
      // 年级变化且用户没显式给日期 → 重新推算高考日期
      if (patch.examDate === undefined) next.examDate = defaultExamDate(next.grade, now)
    }
    if (patch.examDate !== undefined) {
      next.examDate = typeof patch.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.examDate)
        ? patch.examDate
        : defaultExamDate(next.grade, now)
    }
    if (patch.region !== undefined) next.region = text(patch.region, 60)
    if (patch.subjects !== undefined) {
      const list = (Array.isArray(patch.subjects) ? patch.subjects : []).map(toSubject).filter((s) => s !== null)
      next.subjects = list.length > 0 ? [...new Set(list)] : next.subjects
    }
    if (patch.dailyReviewTarget !== undefined) next.dailyReviewTarget = Math.max(0, Math.trunc(Number(patch.dailyReviewTarget) || 0))
    if (patch.dailyStudyMinutes !== undefined) next.dailyStudyMinutes = Math.max(0, Math.trunc(Number(patch.dailyStudyMinutes) || 0))
    if (patch.newPerDay !== undefined) next.newPerDay = Math.max(0, Math.trunc(Number(patch.newPerDay) || 0))
    next.updatedAt = now
    this.write('profile', next)
    return this.profile(now)
  }

  // ── 题库 ──────────────────────────────────────────────────────────────────

  /**
   * 题库文件（内部结构）。
   * @returns {{version: number, seq: number, items: object[]}} 题库。
   */
  db() {
    const raw = this.read('items', () => ({ version: 1, seq: 0, items: [] }))
    if (!Array.isArray(raw.items)) raw.items = []
    if (!Number.isFinite(raw.seq)) raw.seq = raw.items.length
    return raw
  }

  /**
   * 规范化一条待写入的题目/卡片。
   * @param {object} raw 输入数据。
   * @param {object|null} existing 已存在的同 id 记录（更新时保留其复习进度）。
   * @param {number} now 当前时间戳。
   * @param {number} seq 新 id 序号。
   * @returns {object} 规范化后的记录。
   */
  normalizeItem(raw, existing, now, seq) {
    const subject = toSubject(raw.subject) ?? existing?.subject ?? 'math'
    const kind = raw.kind === 'card' || raw.kind === 'mistake'
      ? raw.kind
      : existing?.kind ?? (text(raw.explanation) !== '' || text(raw.source) !== '' ? 'mistake' : 'card')
    const difficulty = Number.isFinite(raw.difficulty)
      ? Math.min(5, Math.max(1, Math.trunc(raw.difficulty)))
      : existing?.difficulty ?? 3
    return {
      id: existing?.id ?? `it_${String(seq).padStart(5, '0')}`,
      kind,
      subject,
      grade: toGrade(raw.grade) ?? existing?.grade ?? null,
      topic: raw.topic !== undefined ? text(raw.topic, 60) : existing?.topic ?? '',
      chapter: raw.chapter !== undefined ? text(raw.chapter, 80) : existing?.chapter ?? '',
      question: raw.question !== undefined ? text(raw.question) : existing?.question ?? '',
      answer: raw.answer !== undefined ? text(raw.answer) : existing?.answer ?? '',
      explanation: raw.explanation !== undefined ? text(raw.explanation) : existing?.explanation ?? '',
      tags: raw.tags !== undefined ? tags(raw.tags) : existing?.tags ?? [],
      difficulty,
      source: raw.source !== undefined ? text(raw.source, 120) : existing?.source ?? '',
      seedKey: raw.seedKey !== undefined ? text(raw.seedKey, 80) : existing?.seedKey ?? '',
      archived: raw.archived !== undefined ? Boolean(raw.archived) : existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      srs: existing?.srs ?? newSrs(now),
      stats: existing?.stats ?? { again: 0, hard: 0, good: 0, easy: 0 },
    }
  }

  /**
   * 批量新增/更新题目。传 id 视为更新（复习进度保留），否则新增。
   * @param {object[]} list 待写入的记录。
   * @param {number} [now] 当前时间戳。
   * @returns {{added: string[], updated: string[], skipped: number, items: object[]}} 结果。
   */
  upsertItems(list, now = Date.now()) {
    const db = this.db()
    const added = []
    const updated = []
    let skipped = 0
    const touched = []
    for (const raw of Array.isArray(list) ? list : []) {
      if (raw === null || typeof raw !== 'object') { skipped += 1; continue }
      const existing = raw.id ? db.items.find((it) => it.id === raw.id) ?? null : null
      // 内置卡片包用 seedKey 去重，避免重复导入
      const seeded = existing === null && text(raw.seedKey, 80) !== ''
        ? db.items.find((it) => it.seedKey === text(raw.seedKey, 80)) ?? null
        : null
      const target = existing ?? seeded
      if (target === null && text(raw.question) === '') { skipped += 1; continue }
      if (target === null) {
        db.seq += 1
        const item = this.normalizeItem(raw, null, now, db.seq)
        db.items.push(item)
        added.push(item.id)
        touched.push(item)
      } else {
        const item = this.normalizeItem(raw, target, now, db.seq)
        const idx = db.items.findIndex((it) => it.id === target.id)
        db.items[idx] = item
        updated.push(item.id)
        touched.push(item)
      }
    }
    this.write('items', db)
    return { added, updated, skipped, items: touched }
  }

  /**
   * 删除题目。
   * @param {string[]} ids 要删除的 id。
   * @returns {{deleted: string[]}} 实际删除的 id。
   */
  deleteItems(ids) {
    const db = this.db()
    const set = new Set(Array.isArray(ids) ? ids : [])
    const deleted = db.items.filter((it) => set.has(it.id)).map((it) => it.id)
    db.items = db.items.filter((it) => !set.has(it.id))
    this.write('items', db)
    return { deleted }
  }

  /**
   * 按 id 取一条题目。
   * @param {string} id 题目 id。
   * @returns {object|null} 题目记录，找不到返回 null。
   */
  getItem(id) {
    const key = typeof id === 'string' ? id : ''
    if (key === '') return null
    return this.db().items.find((it) => it.id === key) ?? null
  }

  /**
   * 条件查询题库。
   * @param {object} [filter] 过滤条件。
   * @param {number} [now] 当前时间戳。
   * @returns {{items: object[], total: number}} 命中记录（已按 sort 排序、分页）。
   */
  listItems(filter = {}, now = Date.now()) {
    const db = this.db()
    const subject = toSubject(filter.subject)
    const kind = filter.kind === 'card' || filter.kind === 'mistake' ? filter.kind : null
    const status = typeof filter.status === 'string' ? filter.status : 'all'
    const q = text(filter.query, 120).toLowerCase()
    const topic = text(filter.topic, 60).toLowerCase()
    const grade = toGrade(filter.grade)

    let rows = db.items.filter((it) => {
      if (subject !== null && it.subject !== subject) return false
      if (kind !== null && it.kind !== kind) return false
      if (grade !== null && it.grade !== grade) return false
      if (topic !== '' && !`${it.topic} ${it.chapter}`.toLowerCase().includes(topic)) return false
      if (status === 'archived') { if (!it.archived) return false } else if (it.archived && filter.includeArchived !== true) return false
      if (status === 'due' && !isDue(it.srs, now)) return false
      if (status === 'new' && it.srs.state !== 'new') return false
      if (status === 'learning' && it.srs.state !== 'learning') return false
      if (status === 'review' && it.srs.state !== 'review') return false
      if (status === 'weak' && !(it.srs.lapses >= 2 || (it.srs.reps > 0 && mastery(it, now) < 40))) return false
      if (q !== '') {
        const hay = `${it.question} ${it.answer} ${it.explanation} ${it.topic} ${it.chapter} ${it.source} ${it.tags.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const sort = typeof filter.sort === 'string' ? filter.sort : 'updated'
    const cmp = {
      due: (a, b) => a.srs.due - b.srs.due,
      created: (a, b) => b.createdAt - a.createdAt,
      updated: (a, b) => b.updatedAt - a.updatedAt,
      mastery: (a, b) => mastery(a, now) - mastery(b, now),
      difficulty: (a, b) => b.difficulty - a.difficulty,
    }[sort] ?? ((a, b) => b.updatedAt - a.updatedAt)
    rows = rows.slice().sort(cmp)

    const total = rows.length
    const offset = Number.isFinite(filter.offset) ? Math.max(0, Math.trunc(filter.offset)) : 0
    const limit = Number.isFinite(filter.limit) ? Math.min(500, Math.max(1, Math.trunc(filter.limit))) : 50
    return { items: rows.slice(offset, offset + limit), total }
  }

  // ── 复习队列与评分 ─────────────────────────────────────────────────────────

  /**
   * 今日复习队列：先逾期最久的旧卡，再按每日上限补充新卡。
   * @param {object} [opts] 选项：subject、limit、includeNew、subjects。
   * @param {number} [now] 当前时间戳。
   * @returns {{items: object[], counts: object}} 队列与计数。
   */
  queue(opts = {}, now = Date.now()) {
    const db = this.db()
    const profile = this.profile(now)
    const subject = toSubject(opts.subject)
    const limit = Number.isFinite(opts.limit) ? Math.min(200, Math.max(1, Math.trunc(opts.limit))) : 20
    const includeNew = opts.includeNew !== false
    const pool = db.items.filter((it) => !it.archived
      && (subject === null || it.subject === subject)
      && profile.subjects.includes(it.subject))

    const dueOld = pool.filter((it) => it.srs.state !== 'new' && isDue(it.srs, now))
      .sort((a, b) => overdueDays(b.srs, now) - overdueDays(a.srs, now))
    const fresh = pool.filter((it) => it.srs.state === 'new')
      .sort((a, b) => b.difficulty - a.difficulty || a.createdAt - b.createdAt)

    const introducedToday = this.reviewsOn(dayKey(now)).filter((r) => r.first === true).length
    const newBudget = includeNew ? Math.max(0, profile.newPerDay - introducedToday) : 0
    const items = [...dueOld.slice(0, limit)]
    if (items.length < limit) items.push(...fresh.slice(0, Math.min(newBudget, limit - items.length)))

    return {
      items,
      counts: {
        due: dueOld.length,
        new: fresh.length,
        newBudget,
        learning: pool.filter((it) => it.srs.state === 'learning').length,
        pool: pool.length,
      },
    }
  }

  /**
   * 提交复习评分（可批量），推进调度并写入流水。
   * @param {Array<{id: string, grade: string, elapsedMs?: number, note?: string}>} grades 评分列表。
   * @param {number} [now] 当前时间戳。
   * @returns {{results: object[], failed: string[]}} 每条的新间隔与失败 id。
   */
  review(grades, now = Date.now()) {
    const db = this.db()
    const log = this.reviewLog()
    const results = []
    const failed = []
    for (const entry of Array.isArray(grades) ? grades : []) {
      const id = typeof entry?.id === 'string' ? entry.id : ''
      const idx = db.items.findIndex((it) => it.id === id)
      if (idx < 0) { failed.push(id); continue }
      const item = db.items[idx]
      const grade = ['again', 'hard', 'good', 'easy'].includes(entry.grade) ? entry.grade : 'good'
      const first = item.srs.state === 'new'
      const next = schedule(item.srs, grade, now)
      item.srs = next.srs
      item.stats = { ...item.stats, [grade]: (item.stats?.[grade] ?? 0) + 1 }
      item.updatedAt = now
      db.items[idx] = item
      log.log.push({
        ts: now,
        itemId: item.id,
        subject: item.subject,
        topic: item.topic,
        grade,
        intervalDays: next.intervalDays,
        first,
        elapsedMs: Number.isFinite(entry.elapsedMs) ? Math.max(0, Math.trunc(entry.elapsedMs)) : 0,
      })
      results.push({
        id: item.id,
        grade,
        intervalDays: next.intervalDays,
        due: next.srs.due,
        dueDate: dayKey(next.srs.due),
        state: next.srs.state,
        ease: Math.round(next.srs.ease * 100) / 100,
        mastery: mastery(item, now),
      })
    }
    if (log.log.length > REVIEW_LOG_CAP) log.log = log.log.slice(-REVIEW_LOG_CAP)
    this.write('items', db)
    this.write('reviews', log)
    return { results, failed }
  }

  /**
   * 复习流水文件。
   * @returns {{version: number, log: object[]}} 流水。
   */
  reviewLog() {
    const raw = this.read('reviews', () => ({ version: 1, log: [] }))
    if (!Array.isArray(raw.log)) raw.log = []
    return raw
  }

  /**
   * 某个逻辑日的复习流水。
   * @param {string} key 日期键 YYYY-MM-DD。
   * @returns {object[]} 该日流水。
   */
  reviewsOn(key) {
    const start = dayKeyToTs(key)
    if (!Number.isFinite(start)) return []
    const end = start + DAY_MS
    return this.reviewLog().log.filter((r) => r.ts >= start && r.ts < end)
  }

  // ── 学习日志 ──────────────────────────────────────────────────────────────

  /**
   * 学习日志文件。
   * @returns {{version: number, days: Record<string, object>}} 日志。
   */
  studyLog() {
    const raw = this.read('studylog', () => ({ version: 1, days: {} }))
    if (raw.days === null || typeof raw.days !== 'object') raw.days = {}
    return raw
  }

  /**
   * 记一笔学习：分钟数、章节进度或随手笔记。
   * @param {object} entry { subject, minutes?, note?, chapter?, status?, date? }。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 当日记录。
   */
  logStudy(entry, now = Date.now()) {
    const log = this.studyLog()
    const key = typeof entry?.date === 'string' && Number.isFinite(dayKeyToTs(entry.date)) ? entry.date : dayKey(now)
    const day = log.days[key] ?? { minutes: {}, notes: [], chapters: [] }
    const subject = toSubject(entry?.subject)
    const minutes = Number.isFinite(entry?.minutes) ? Math.trunc(entry.minutes) : 0
    if (subject !== null && minutes !== 0) {
      day.minutes[subject] = Math.max(0, (day.minutes[subject] ?? 0) + minutes)
    }
    const note = text(entry?.note, 300)
    if (note !== '') day.notes.push({ ts: now, subject, text: note })
    const chapter = text(entry?.chapter, 80)
    if (chapter !== '') {
      const status = ['todo', 'doing', 'done'].includes(entry?.status) ? entry.status : 'done'
      const idx = day.chapters.findIndex((c) => c.subject === subject && c.chapter === chapter)
      const row = { subject, chapter, status, ts: now }
      if (idx >= 0) day.chapters[idx] = row
      else day.chapters.push(row)
    }
    log.days[key] = day
    this.write('studylog', log)
    return { date: key, ...day }
  }

  /**
   * 最近 N 个逻辑日的学习+复习汇总（升序）。
   * @param {number} days 天数。
   * @param {number} [now] 当前时间戳。
   * @returns {object[]} 每日一条。
   */
  dailySeries(days, now = Date.now()) {
    const log = this.studyLog()
    const reviews = this.reviewLog().log
    const out = []
    const n = Math.min(180, Math.max(1, Math.trunc(days) || 14))
    for (let i = n - 1; i >= 0; i -= 1) {
      const ts = dayStart(now) - i * DAY_MS
      const key = dayKey(ts)
      const day = log.days[key] ?? { minutes: {}, notes: [], chapters: [] }
      const minutes = Object.values(day.minutes ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
      const dayReviews = reviews.filter((r) => r.ts >= ts && r.ts < ts + DAY_MS)
      out.push({
        date: key,
        minutes,
        minutesBySubject: { ...(day.minutes ?? {}) },
        reviews: dayReviews.length,
        again: dayReviews.filter((r) => r.grade === 'again').length,
        chapters: (day.chapters ?? []).filter((c) => c.status === 'done').length,
      })
    }
    return out
  }

  /**
   * 章节进度汇总：把逐日记录的章节状态压成「学科 → 章节 → 最新状态」。
   * @returns {Record<string, Record<string, {status: string, date: string}>>} 进度表。
   */
  chapterProgress() {
    const log = this.studyLog()
    const out = {}
    for (const [date, day] of Object.entries(log.days)) {
      for (const c of day.chapters ?? []) {
        if (typeof c?.subject !== 'string' || c.subject === '' || typeof c?.chapter !== 'string') continue
        const bucket = out[c.subject] ?? {}
        const prev = bucket[c.chapter]
        if (prev === undefined || prev.date <= date) bucket[c.chapter] = { status: c.status ?? 'done', date }
        out[c.subject] = bucket
      }
    }
    return out
  }

  /**
   * 最近的随手笔记（倒序）。
   * @param {number} [limit] 条数。
   * @returns {object[]} 笔记。
   */
  recentNotes(limit = 20) {
    const log = this.studyLog()
    const rows = []
    for (const [date, day] of Object.entries(log.days)) {
      for (const n of day.notes ?? []) rows.push({ date, ...n })
    }
    rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    return rows.slice(0, Math.max(1, Math.trunc(limit) || 20))
  }

  /**
   * 连续学习天数（今天有复习或有学习时长即算，向前连续累计）。
   * @param {number} [now] 当前时间戳。
   * @returns {number} 连续天数。
   */
  streak(now = Date.now()) {
    const log = this.studyLog()
    const reviews = this.reviewLog().log
    let streak = 0
    for (let i = 0; i < 400; i += 1) {
      const ts = dayStart(now) - i * DAY_MS
      const key = dayKey(ts)
      const day = log.days[key]
      const minutes = Object.values(day?.minutes ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
      const reviewed = reviews.some((r) => r.ts >= ts && r.ts < ts + DAY_MS)
      if (minutes > 0 || reviewed) streak += 1
      else if (i > 0) break
      else if (i === 0) continue // 今天还没开始不算断签
    }
    return streak
  }

  // ── 模考成绩 ──────────────────────────────────────────────────────────────

  /**
   * 成绩文件。
   * @returns {{version: number, seq: number, exams: object[]}} 成绩集合。
   */
  examDb() {
    const raw = this.read('exams', () => ({ version: 1, seq: 0, exams: [] }))
    if (!Array.isArray(raw.exams)) raw.exams = []
    if (!Number.isFinite(raw.seq)) raw.seq = raw.exams.length
    return raw
  }

  /**
   * 新增/更新一次模考成绩。
   * @param {object} exam { id?, date, name, scores: [{subject, score, full}], total?, rank?, note? }。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 写入后的记录。
   */
  saveExam(exam, now = Date.now()) {
    const db = this.examDb()
    const scores = {}
    const rawScores = Array.isArray(exam?.scores) ? exam.scores : []
    for (const s of rawScores) {
      const key = toSubject(s?.subject)
      if (key === null) continue
      const score = Number(s.score)
      if (!Number.isFinite(score)) continue
      const full = Number.isFinite(Number(s.full)) && Number(s.full) > 0 ? Number(s.full) : (key === 'math' || key === 'chinese' || key === 'english' ? 150 : 100)
      scores[key] = { score: Math.round(score * 10) / 10, full }
    }
    const sum = Object.values(scores).reduce((a, s) => a + s.score, 0)
    const sumFull = Object.values(scores).reduce((a, s) => a + s.full, 0)
    const record = {
      id: typeof exam?.id === 'string' && exam.id !== '' ? exam.id : `ex_${String(db.seq + 1).padStart(4, '0')}`,
      date: typeof exam?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exam.date) ? exam.date : dayKey(now),
      name: text(exam?.name, 60) || '模考',
      scores,
      total: Number.isFinite(Number(exam?.total)) && Number(exam.total) > 0 ? Math.round(Number(exam.total) * 10) / 10 : Math.round(sum * 10) / 10,
      totalFull: Number.isFinite(Number(exam?.totalFull)) && Number(exam.totalFull) > 0 ? Number(exam.totalFull) : (sumFull > 0 ? sumFull : 750),
      rank: Number.isFinite(Number(exam?.rank)) ? Math.trunc(Number(exam.rank)) : null,
      rankOf: Number.isFinite(Number(exam?.rankOf)) ? Math.trunc(Number(exam.rankOf)) : null,
      note: text(exam?.note, 200),
      createdAt: now,
    }
    const idx = db.exams.findIndex((e) => e.id === record.id)
    if (idx >= 0) db.exams[idx] = { ...db.exams[idx], ...record }
    else { db.seq += 1; db.exams.push(record) }
    db.exams.sort((a, b) => a.date.localeCompare(b.date))
    this.write('exams', db)
    return record
  }

  /**
   * 成绩列表（按日期升序）。
   * @returns {object[]} 成绩。
   */
  listExams() {
    return this.examDb().exams.slice()
  }

  /**
   * 删除成绩。
   * @param {string[]} ids id 列表。
   * @returns {{deleted: string[]}} 实际删除的 id。
   */
  deleteExams(ids) {
    const db = this.examDb()
    const set = new Set(Array.isArray(ids) ? ids : [])
    const deleted = db.exams.filter((e) => set.has(e.id)).map((e) => e.id)
    db.exams = db.exams.filter((e) => !set.has(e.id))
    this.write('exams', db)
    return { deleted }
  }

  // ── 动态演示 ──────────────────────────────────────────────────────────────

  /**
   * 演示文件。
   * @returns {{version: number, seq: number, demos: object[]}} 演示集合。
   */
  demoDb() {
    const raw = this.read('demos', () => ({ version: 1, seq: 0, demos: [] }))
    if (!Array.isArray(raw.demos)) raw.demos = []
    if (!Number.isFinite(raw.seq)) raw.seq = raw.demos.length
    return raw
  }

  /**
   * 保存一份动态演示（讲题时由 tutor_visualize 写入，也可由界面手工保存）。
   *
   * 场景规范本身的校验在 scene.js 里做，这里只负责元数据与持久化；传 id 视为更新。
   * @param {object} demo { id?, title, kind, subject, topic, scene, itemId?, summary?, keySteps?, callId? }。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 写入后的记录。
   */
  saveDemo(demo, now = Date.now()) {
    const db = this.demoDb()
    const existing = typeof demo?.id === 'string' && demo.id !== ''
      ? db.demos.find((d) => d.id === demo.id) ?? null
      : null
    const scene = demo?.scene !== null && typeof demo?.scene === 'object' ? demo.scene : existing?.scene ?? null
    const record = {
      id: existing?.id ?? `dm_${String(db.seq + 1).padStart(4, '0')}`,
      title: text(demo?.title, 120) || scene?.title || '动态演示',
      kind: text(demo?.kind, 24) || scene?.kind || 'diagram2d',
      subject: toSubject(demo?.subject ?? scene?.subject) ?? existing?.subject ?? null,
      topic: text(demo?.topic ?? scene?.topic, 60) || existing?.topic || '',
      summary: text(demo?.summary, 200) || existing?.summary || '',
      itemId: text(demo?.itemId, 40) || existing?.itemId || '',
      callId: text(demo?.callId, 80) || existing?.callId || '',
      keySteps: Array.isArray(demo?.keySteps)
        ? demo.keySteps.slice(0, 24).map((s) => ({ index: Math.trunc(Number(s?.index) || 0), title: text(s?.title, 120) }))
        : existing?.keySteps ?? [],
      scene,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const idx = db.demos.findIndex((d) => d.id === record.id)
    if (idx >= 0) db.demos[idx] = record
    else { db.seq += 1; db.demos.push(record) }
    // 超出上限时丢最旧的
    if (db.demos.length > DEMO_CAP) {
      db.demos.sort((a, b) => a.updatedAt - b.updatedAt)
      db.demos = db.demos.slice(db.demos.length - DEMO_CAP)
    }
    this.write('demos', db)
    return record
  }

  /**
   * 演示列表（最近更新在前）。
   * @param {object} [filter] 过滤：subject、kind、itemId、query、limit。
   * @param {boolean} [withScene] 是否带上完整场景（列表页不需要，省流量）。
   * @returns {{demos: object[], total: number}} 结果。
   */
  listDemos(filter = {}, withScene = false) {
    const db = this.demoDb()
    const subject = toSubject(filter.subject)
    const kind = text(filter.kind, 24)
    const itemId = text(filter.itemId, 40)
    const q = text(filter.query, 120).toLowerCase()
    let rows = db.demos.filter((d) => {
      if (subject !== null && d.subject !== subject) return false
      if (kind !== '' && d.kind !== kind) return false
      if (itemId !== '' && d.itemId !== itemId) return false
      if (q !== '' && !`${d.title} ${d.topic} ${d.summary}`.toLowerCase().includes(q)) return false
      return true
    })
    rows = rows.slice().sort((a, b) => b.updatedAt - a.updatedAt)
    const total = rows.length
    const limit = Number.isFinite(filter.limit) ? Math.min(200, Math.max(1, Math.trunc(filter.limit))) : 40
    const page = rows.slice(0, limit)
    return {
      total,
      demos: withScene ? page : page.map(({ scene, ...rest }) => ({ ...rest, steps: (scene?.steps ?? []).length })),
    }
  }

  /**
   * 取一份完整演示。
   * @param {string} id 演示 id。
   * @returns {object|null} 演示。
   */
  getDemo(id) {
    return this.demoDb().demos.find((d) => d.id === id) ?? null
  }

  /**
   * 删除演示。
   * @param {string[]} ids id 列表。
   * @returns {{deleted: string[]}} 实际删除的 id。
   */
  deleteDemos(ids) {
    const db = this.demoDb()
    const set = new Set(Array.isArray(ids) ? ids : [])
    const deleted = db.demos.filter((d) => set.has(d.id)).map((d) => d.id)
    db.demos = db.demos.filter((d) => !set.has(d.id))
    this.write('demos', db)
    return { deleted }
  }

  // ── 汇总视图 ──────────────────────────────────────────────────────────────

  /**
   * 薄弱知识点排行：按学科+知识点聚合，正确率低/遗忘多/掌握度低者靠前。
   * @param {number} [limit] 返回条数。
   * @param {number} [now] 当前时间戳。
   * @returns {object[]} 薄弱点。
   */
  weakTopics(limit = 8, now = Date.now()) {
    const db = this.db()
    const groups = new Map()
    for (const it of db.items) {
      if (it.archived) continue
      const topic = it.topic !== '' ? it.topic : it.chapter !== '' ? it.chapter : '未归类'
      const key = `${it.subject}\u0000${topic}`
      const g = groups.get(key) ?? { subject: it.subject, topic, items: 0, lapses: 0, right: 0, wrong: 0, masterySum: 0, due: 0, reviewed: 0 }
      g.items += 1
      g.lapses += it.srs.lapses
      g.right += (it.stats?.hard ?? 0) + (it.stats?.good ?? 0) + (it.stats?.easy ?? 0)
      g.wrong += it.stats?.again ?? 0
      g.masterySum += mastery(it, now)
      if (it.srs.reps > 0) g.reviewed += 1
      if (isDue(it.srs, now)) g.due += 1
      groups.set(key, g)
    }
    const rows = [...groups.values()].map((g) => {
      const total = g.right + g.wrong
      return {
        subject: g.subject,
        topic: g.topic,
        items: g.items,
        due: g.due,
        lapses: g.lapses,
        accuracy: total > 0 ? Math.round((g.right / total) * 100) : null,
        mastery: Math.round(g.masterySum / g.items),
      }
    })
    // 排序：先看正确率（null 视为 60 分，未复习不代表薄弱），再看遗忘次数与掌握度
    rows.sort((a, b) => {
      const ka = (a.accuracy ?? 60) - a.lapses * 6 + a.mastery * 0.4
      const kb = (b.accuracy ?? 60) - b.lapses * 6 + b.mastery * 0.4
      return ka - kb
    })
    return rows.slice(0, Math.min(30, Math.max(1, Math.trunc(limit) || 8)))
  }

  /**
   * 首屏总览：倒计时、今日待复习、今日学习、连续天数、薄弱点、最近成绩。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 总览。
   */
  overview(now = Date.now()) {
    const profile = this.profile(now)
    const db = this.db()
    const todayKey = dayKey(now)
    const dueBySubject = {}
    const newBySubject = {}
    const totalBySubject = {}
    let dueTotal = 0
    let newTotal = 0
    for (const it of db.items) {
      if (it.archived) continue
      totalBySubject[it.subject] = (totalBySubject[it.subject] ?? 0) + 1
      if (it.srs.state === 'new') {
        newBySubject[it.subject] = (newBySubject[it.subject] ?? 0) + 1
        newTotal += 1
      } else if (isDue(it.srs, now)) {
        dueBySubject[it.subject] = (dueBySubject[it.subject] ?? 0) + 1
        dueTotal += 1
      }
    }
    const todayReviews = this.reviewsOn(todayKey)
    const studyDay = this.studyLog().days[todayKey] ?? { minutes: {}, notes: [], chapters: [] }
    const minutesToday = Object.values(studyDay.minutes ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
    const examTs = profile.examDate !== null ? dayKeyToTs(profile.examDate) : Number.NaN
    const exams = this.listExams()
    return {
      today: todayKey,
      now,
      profile,
      countdown: {
        examDate: profile.examDate,
        days: Number.isFinite(examTs) ? Math.max(0, Math.ceil((examTs - dayStart(now)) / DAY_MS)) : null,
      },
      due: {
        total: dueTotal,
        bySubject: dueBySubject,
        new: newTotal,
        newBySubject,
        learning: db.items.filter((it) => !it.archived && it.srs.state === 'learning').length,
      },
      totals: {
        items: db.items.filter((it) => !it.archived).length,
        mistakes: db.items.filter((it) => !it.archived && it.kind === 'mistake').length,
        cards: db.items.filter((it) => !it.archived && it.kind === 'card').length,
        demos: this.demoDb().demos.length,
        bySubject: totalBySubject,
      },
      study: {
        minutes: minutesToday,
        minutesBySubject: { ...(studyDay.minutes ?? {}) },
        target: profile.dailyStudyMinutes,
        reviewedToday: todayReviews.length,
        reviewTarget: profile.dailyReviewTarget,
        againToday: todayReviews.filter((r) => r.grade === 'again').length,
        chaptersToday: (studyDay.chapters ?? []).filter((c) => c.status === 'done').length,
        streak: this.streak(now),
      },
      weakTopics: this.weakTopics(6, now),
      recentExams: exams.slice(-3),
    }
  }

  /**
   * 统计视图：每日曲线、各科掌握度、记忆保持率、模考趋势。
   * @param {number} [days] 曲线天数。
   * @param {number} [now] 当前时间戳。
   * @returns {object} 统计。
   */
  stats(days = 14, now = Date.now()) {
    const db = this.db()
    const profile = this.profile(now)
    const series = this.dailySeries(days, now)
    const reviews = this.reviewLog().log
    const windowStart = dayStart(now) - (Math.max(1, Math.trunc(days) || 14) - 1) * DAY_MS
    const recent = reviews.filter((r) => r.ts >= windowStart)
    const bySubject = profile.subjects.map((key) => {
      const rows = db.items.filter((it) => !it.archived && it.subject === key)
      const reviewed = rows.filter((it) => it.srs.reps > 0)
      const subjectReviews = recent.filter((r) => r.subject === key)
      const right = subjectReviews.filter((r) => r.grade !== 'again').length
      return {
        subject: key,
        items: rows.length,
        mistakes: rows.filter((it) => it.kind === 'mistake').length,
        due: rows.filter((it) => isDue(it.srs, now)).length,
        newItems: rows.filter((it) => it.srs.state === 'new').length,
        mastery: reviewed.length > 0 ? Math.round(reviewed.reduce((a, it) => a + mastery(it, now), 0) / reviewed.length) : 0,
        accuracy: subjectReviews.length > 0 ? Math.round((right / subjectReviews.length) * 100) : null,
        reviews: subjectReviews.length,
        minutes: series.reduce((a, d) => a + (d.minutesBySubject[key] ?? 0), 0),
      }
    })
    const matured = recent.filter((r) => r.first !== true)
    return {
      range: { days: series.length, from: series[0]?.date ?? null, to: series[series.length - 1]?.date ?? null },
      series,
      subjects: bySubject,
      retention: {
        reviews: recent.length,
        accuracy: recent.length > 0 ? Math.round((recent.filter((r) => r.grade !== 'again').length / recent.length) * 100) : null,
        matureAccuracy: matured.length > 0 ? Math.round((matured.filter((r) => r.grade !== 'again').length / matured.length) * 100) : null,
      },
      examTrend: this.listExams().map((e) => ({
        id: e.id,
        date: e.date,
        name: e.name,
        total: e.total,
        totalFull: e.totalFull,
        percent: e.totalFull > 0 ? Math.round((e.total / e.totalFull) * 1000) / 10 : null,
        scores: e.scores,
        rank: e.rank,
        rankOf: e.rankOf,
      })),
    }
  }
}

export { GRADE_LEVELS, dayKey, dayKeyToTs, isDue, mastery, normalizeSrs, overdueDays }
