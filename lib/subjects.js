// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 学科定义（host 侧唯一事实来源）。
 *
 * 六科固定键名（英文键便于做文件/查询参数），中文名与短名用于展示。
 * client 侧有一份同构副本（浏览器包独立打包，不能跨包 import）。
 *
 * @module dsh-highschool-tutor/subjects
 */

/** 六科定义：key = 稳定标识，label = 全称，short = 单字/双字短名，color = 主题色。 */
export const SUBJECTS = [
  { key: 'chinese', label: '语文', short: '语', color: '#d4483b' },
  { key: 'math', label: '数学', short: '数', color: '#2f6df6' },
  { key: 'english', label: '英语', short: '英', color: '#8b5cf6' },
  { key: 'physics', label: '物理', short: '物', color: '#0f9d8f' },
  { key: 'chemistry', label: '化学', short: '化', color: '#e08b1a' },
  { key: 'geography', label: '地理', short: '地', color: '#6b8f2f' },
]

/** 学科键数组。 */
export const SUBJECT_KEYS = SUBJECTS.map((s) => s.key)

/** 中文名 → 键的反查表（模型/导入文件里常写中文）。 */
const ALIAS = new Map()
for (const s of SUBJECTS) {
  ALIAS.set(s.key, s.key)
  ALIAS.set(s.label, s.key)
  ALIAS.set(s.short, s.key)
}
ALIAS.set('语', 'chinese')
ALIAS.set('数', 'math')
ALIAS.set('英', 'english')
ALIAS.set('物', 'physics')
ALIAS.set('化', 'chemistry')
ALIAS.set('地', 'geography')
ALIAS.set('chinese literature', 'chinese')
ALIAS.set('maths', 'math')
ALIAS.set('mathematics', 'math')
ALIAS.set('geo', 'geography')

/** 年级定义。 */
export const GRADES = [
  { key: 'g1', label: '高一' },
  { key: 'g2', label: '高二' },
  { key: 'g3', label: '高三' },
]

/** 年级键数组。 */
export const GRADE_KEYS = GRADES.map((g) => g.key)

/**
 * 把任意写法解析成合法学科键。
 * @param {unknown} value 输入（'math' / '数学' / '数'）。
 * @returns {string|null} 学科键，无法识别时 null。
 */
export function toSubject(value) {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase()
  return ALIAS.get(key) ?? ALIAS.get(value.trim()) ?? null
}

/**
 * 学科中文名。
 * @param {string} key 学科键。
 * @returns {string} 中文名（未知时回显原键）。
 */
export function subjectLabel(key) {
  return SUBJECTS.find((s) => s.key === key)?.label ?? String(key)
}

/**
 * 把任意写法解析成合法年级键。
 * @param {unknown} value 输入（'g1' / '高一' / 1）。
 * @returns {string|null} 年级键，无法识别时 null。
 */
export function toGrade(value) {
  if (value === 1 || value === '1' || value === 'g1' || value === '高一') return 'g1'
  if (value === 2 || value === '2' || value === 'g2' || value === '高二') return 'g2'
  if (value === 3 || value === '3' || value === 'g3' || value === '高三') return 'g3'
  return null
}
