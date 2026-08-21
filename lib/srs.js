// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 复习调度内核（纯函数，无 I/O、无依赖）。
 *
 * 调度=艾宾浩斯固定阶梯 + SM-2 风格的难度因子（ease）微调：
 *
 *   阶梯 STEPS（天）：1 → 2 → 4 → 7 → 15 → 30 → 60 → 120
 *
 * 每次复习给出四档评分，语义按「高中错题/知识卡」的实际使用场景定义：
 *
 *   again  完全不会 / 又错了 → 20 分钟后重来（当天再练一遍），ease −0.25，lapses+1
 *   hard   会了但很吃力      → 停在当前阶梯，间隔取本档的 0.6 倍，ease −0.10
 *   good   正常掌握          → 前进一档，间隔取本档标称值 × (ease/2.5)
 *   easy   一眼秒杀          → 直接跳两档，间隔再 ×1.3，ease +0.15
 *
 * 超过阶梯末档后按 ease 指数增长，上限 MAX_INTERVAL_DAYS 天（高三阶段没有
 * 必要把间隔排到高考之后）。
 *
 * 「今天到期」的判定统一走 dayEnd()：以 CUTOFF_HOUR（凌晨 4 点）为一天的
 * 分界——高中生 0 点后还在做题时，队列不应该突然跳到「明天」。
 *
 * @module dsh-highschool-tutor/srs
 */

/** 一天的毫秒数。 */
export const DAY_MS = 86_400_000

/** 逻辑日切分小时（本地时间）：凌晨 4 点前算作前一天。 */
export const CUTOFF_HOUR = 4

/** 艾宾浩斯复习阶梯（天）。 */
export const STEPS = [1, 2, 4, 7, 15, 30, 60, 120]

/** 间隔上限（天）。 */
export const MAX_INTERVAL_DAYS = 240

/** 答错后的当日重练延迟（毫秒）。 */
export const RELEARN_MS = 20 * 60_000

/** ease 取值区间。 */
export const MIN_EASE = 1.3
export const MAX_EASE = 3.0

/** 合法评分档位。 */
export const GRADES = ['again', 'hard', 'good', 'easy']

/** 评分对 ease 的增量。 */
const EASE_DELTA = { again: -0.25, hard: -0.1, good: 0, easy: 0.15 }

/**
 * 数值裁剪。
 * @param {number} value 输入值。
 * @param {number} min 下界。
 * @param {number} max 上界。
 * @returns {number} 落在 [min, max] 的值。
 */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

/**
 * 逻辑日的起点时间戳（本地时间，含 CUTOFF_HOUR 偏移）。
 * @param {number} ts 参考时间戳。
 * @returns {number} 该逻辑日 04:00 的时间戳。
 */
export function dayStart(ts) {
  const d = new Date(ts)
  if (d.getHours() < CUTOFF_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(CUTOFF_HOUR, 0, 0, 0)
  return d.getTime()
}

/**
 * 逻辑日的终点时间戳（= 次日 04:00）。
 * @param {number} ts 参考时间戳。
 * @returns {number} 该逻辑日结束的时间戳。
 */
export function dayEnd(ts) {
  return dayStart(ts) + DAY_MS
}

/**
 * 逻辑日的日期键（YYYY-MM-DD，本地时区）。
 * @param {number} ts 参考时间戳。
 * @returns {string} 日期键。
 */
export function dayKey(ts) {
  const d = new Date(dayStart(ts))
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * 日期键 → 该逻辑日起点时间戳。
 * @param {string} key YYYY-MM-DD。
 * @returns {number} 时间戳；键非法时返回 NaN。
 */
export function dayKeyToTs(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''))
  if (m === null) return Number.NaN
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), CUTOFF_HOUR, 0, 0, 0).getTime()
}

/**
 * 全新卡片的初始调度状态：立即可学。
 * @param {number} now 当前时间戳。
 * @returns {object} 新的 srs 状态。
 */
export function newSrs(now) {
  return {
    state: 'new',
    step: 0,
    reps: 0,
    lapses: 0,
    ease: 2.5,
    intervalDays: 0,
    due: now,
    lastReviewedAt: 0,
  }
}

/**
 * 把任意来源的 srs 字段补全成合法状态（导入/手工编辑的数据可能缺字段）。
 * @param {object|null|undefined} raw 原始状态。
 * @param {number} now 当前时间戳。
 * @returns {object} 合法的 srs 状态。
 */
export function normalizeSrs(raw, now) {
  const base = newSrs(now)
  if (raw === null || typeof raw !== 'object') return base
  const state = ['new', 'learning', 'review'].includes(raw.state) ? raw.state : base.state
  return {
    state,
    step: Number.isFinite(raw.step) ? clamp(Math.trunc(raw.step), 0, 32) : 0,
    reps: Number.isFinite(raw.reps) ? Math.max(0, Math.trunc(raw.reps)) : 0,
    lapses: Number.isFinite(raw.lapses) ? Math.max(0, Math.trunc(raw.lapses)) : 0,
    ease: Number.isFinite(raw.ease) ? clamp(raw.ease, MIN_EASE, MAX_EASE) : 2.5,
    intervalDays: Number.isFinite(raw.intervalDays) ? clamp(raw.intervalDays, 0, MAX_INTERVAL_DAYS) : 0,
    due: Number.isFinite(raw.due) ? raw.due : now,
    lastReviewedAt: Number.isFinite(raw.lastReviewedAt) ? raw.lastReviewedAt : 0,
  }
}

/**
 * 某一档阶梯的标称间隔（天），已含 ease 缩放与末档指数延伸。
 * @param {number} step 阶梯序号（0 起）。
 * @param {number} ease 难度因子。
 * @returns {number} 间隔天数（保留 1 位小数）。
 */
export function intervalFor(step, ease) {
  const idx = clamp(Math.trunc(step), 0, 64)
  const last = STEPS.length - 1
  const base = STEPS[Math.min(idx, last)]
  const overflow = idx > last ? Math.pow(clamp(ease, MIN_EASE, MAX_EASE), idx - last) : 1
  const scaled = base * overflow * (clamp(ease, MIN_EASE, MAX_EASE) / 2.5)
  return Math.min(MAX_INTERVAL_DAYS, Math.round(Math.max(1, scaled) * 10) / 10)
}

/**
 * 对一次复习评分做调度推进。
 * @param {object} srs 当前状态（会被规范化，不做原地修改）。
 * @param {string} grade again|hard|good|easy。
 * @param {number} now 当前时间戳。
 * @returns {{srs: object, intervalDays: number, due: number, graduated: boolean}} 新状态与本次间隔。
 */
export function schedule(srs, grade, now) {
  const cur = normalizeSrs(srs, now)
  const g = GRADES.includes(grade) ? grade : 'good'
  const ease = clamp(cur.ease + EASE_DELTA[g], MIN_EASE, MAX_EASE)

  if (g === 'again') {
    const next = {
      ...cur,
      state: 'learning',
      step: 0,
      reps: cur.reps + 1,
      lapses: cur.lapses + 1,
      ease,
      intervalDays: 0,
      due: now + RELEARN_MS,
      lastReviewedAt: now,
    }
    return { srs: next, intervalDays: 0, due: next.due, graduated: false }
  }

  let step = cur.step
  let intervalDays
  if (g === 'hard') {
    intervalDays = Math.max(1, Math.round(intervalFor(step, ease) * 0.6 * 10) / 10)
  } else if (g === 'good') {
    intervalDays = intervalFor(step, ease)
    step = cur.step + 1
  } else {
    intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalFor(cur.step + 1, ease) * 1.3 * 10) / 10)
    step = cur.step + 2
  }

  const next = {
    ...cur,
    state: 'review',
    step,
    reps: cur.reps + 1,
    ease,
    intervalDays,
    due: now + Math.round(intervalDays * DAY_MS),
    lastReviewedAt: now,
  }
  return { srs: next, intervalDays, due: next.due, graduated: cur.state !== 'review' }
}

/**
 * 四个按钮各自将把这张卡排到多久之后——用于界面上直接标在按钮里。
 * @param {object} srs 当前状态。
 * @param {number} now 当前时间戳。
 * @returns {Record<string, number>} 每档的间隔天数（again 为 0，表示当天重来）。
 */
export function previewIntervals(srs, now) {
  const out = {}
  for (const g of GRADES) out[g] = schedule(srs, g, now).intervalDays
  return out
}

/**
 * 是否在指定时刻之前到期（默认按「今天结束」判定）。
 * @param {object} srs 状态。
 * @param {number} now 当前时间戳。
 * @returns {boolean} 是否属于今天该复习的卡。
 */
export function isDue(srs, now) {
  const s = normalizeSrs(srs, now)
  if (s.state === 'new') return true
  if (s.state === 'learning') return s.due <= now
  return s.due <= dayEnd(now)
}

/**
 * 逾期天数（负值表示尚未到期），用于队列排序：越逾期越靠前。
 * @param {object} srs 状态。
 * @param {number} now 当前时间戳。
 * @returns {number} 逾期天数。
 */
export function overdueDays(srs, now) {
  const s = normalizeSrs(srs, now)
  return Math.round(((now - s.due) / DAY_MS) * 10) / 10
}

/**
 * 单卡掌握度（0-100）：间隔长度占 6 成、ease 占 2 成、正确率占 2 成，
 * 新卡恒为 0，遗忘次数按每次 −4 分惩罚。
 * @param {object} item 卡片（读取 srs 与 stats）。
 * @param {number} now 当前时间戳。
 * @returns {number} 掌握度整数。
 */
export function mastery(item, now) {
  const s = normalizeSrs(item?.srs, now)
  if (s.reps === 0) return 0
  const st = item?.stats ?? {}
  const right = (st.hard ?? 0) + (st.good ?? 0) + (st.easy ?? 0)
  const total = right + (st.again ?? 0)
  const accuracy = total > 0 ? right / total : 0.5
  const intervalScore = clamp(s.intervalDays / 60, 0, 1)
  const easeScore = clamp((s.ease - MIN_EASE) / (MAX_EASE - MIN_EASE), 0, 1)
  const raw = 100 * (0.6 * intervalScore + 0.2 * easeScore + 0.2 * accuracy) - 4 * s.lapses
  return Math.round(clamp(raw, 0, 100))
}
