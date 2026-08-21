// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 动态演示的「场景规范」（纯函数，无 I/O、无 DOM）。
 *
 * 讲题时模型不写 HTML，而是填一份声明式 JSON：场景类型 + 对象列表 + 解题步骤。
 * 浏览器帧内的引擎（lib/frame/*.browser.js）照着它画 2D/3D 图并驱动步骤动画。
 * 这样做的好处是模型只需产出几十行结构化数据（快、便宜、稳定），六科的演示
 * 手感统一，且演示能被存下来重播、被步骤时间轴精确控制。
 *
 * 表达不了的图形留了兜底：kind='html' 时直接给一段 HTML 片段，帧内原样渲染。
 *
 * ── 九种场景类型 ────────────────────────────────────────────────────────────
 *   plot2d      平面直角坐标系：函数图像、切线、面积、圆锥曲线（数学）
 *   geom3d      三维几何体：棱柱棱锥、空间向量、截面、二面角（数学）
 *   mech2d      力学场景：受力分析、斜面、抛体/圆周轨迹、场（物理）
 *   circuit     电路图：电源电阻电表开关滑动变阻器，电流流向（物理）
 *   chart2d     统计/过程曲线：平衡移动、滴定、能量图、气温降水（化/地/物）
 *   molecule3d  分子构型：VSEPR 自动摆位、键角、孤对电子（化学）
 *   lattice3d   晶胞：NaCl/CsCl/金刚石/干冰/面心立方，配位数与微粒数（化学）
 *   globe3d     地球光照：昼夜晨昏线、太阳直射点、正午太阳高度（地理）
 *   diagram2d   通用示意图：方框箭头流程、锋面、剖面、分区（六科兜底）
 *   html        自由 HTML 片段（上面都表达不了时）
 *
 * ── 步骤（steps）────────────────────────────────────────────────────────────
 * 每一步都能改变场景：show/hide 显隐对象、focus 高亮、set 改属性、view 动相机。
 * 步骤是「累积」语义——引擎把 0..n 步依次施加到初始场景上得到第 n 步的画面，
 * 因此来回拖动进度条结果完全确定，不会漂移。key:true 的步骤是重点步骤，
 * 时间轴上有醒目标记，卡片折叠态也会把它们列出来。
 *
 * @module dsh-highschool-tutor/scene
 */

import { toSubject } from './subjects.js'

/** 规范版本号（帧内引擎按它判断兼容性）。 */
export const SCENE_VERSION = 1

/** 支持的场景类型。 */
export const SCENE_KINDS = [
  'plot2d', 'geom3d', 'mech2d', 'circuit', 'chart2d',
  'molecule3d', 'lattice3d', 'globe3d', 'diagram2d', 'html',
]

/** 各类型的中文名（界面与摘要用）。 */
export const KIND_LABELS = {
  plot2d: '平面坐标系',
  geom3d: '立体几何',
  mech2d: '力学场景',
  circuit: '电路图',
  chart2d: '过程曲线',
  molecule3d: '分子构型',
  lattice3d: '晶体晶胞',
  globe3d: '地球光照',
  diagram2d: '示意图',
  html: '自定义',
}

/** 规模上限：防止一次调用塞进一整本书。 */
const LIMITS = {
  objects: 160,
  steps: 24,
  points: 400,
  text: 400,
  detail: 1200,
  html: 60_000,
  title: 80,
}

/** 各场景类型允许的对象 type。 */
const OBJECT_TYPES = {
  plot2d: ['func', 'param', 'point', 'line', 'segment', 'vector', 'circle', 'ellipse', 'polygon', 'area', 'tangent', 'label', 'angle', 'mark'],
  geom3d: ['solid', 'point3', 'segment3', 'face', 'vector3', 'plane', 'section', 'angle3', 'label3', 'sphere3'],
  mech2d: ['body', 'incline', 'ground', 'spring', 'rope', 'pulley', 'force', 'velocity', 'accel', 'path', 'field', 'charge', 'label', 'dim', 'angle'],
  circuit: ['battery', 'resistor', 'rheostat', 'lamp', 'switch', 'ammeter', 'voltmeter', 'capacitor', 'wire', 'junction', 'label'],
  chart2d: ['series', 'bar', 'marker', 'region', 'hline', 'vline', 'label', 'arrow'],
  molecule3d: ['molecule', 'atom', 'bond', 'lonepair', 'anglelabel', 'label3'],
  lattice3d: ['cell', 'atom', 'bond', 'label3'],
  globe3d: ['globe', 'point', 'arc', 'terminator', 'sunray', 'label'],
  diagram2d: ['box', 'arrow', 'text', 'region', 'line', 'bracket', 'icon'],
  html: [],
}

/**
 * 裁剪字符串。
 * @param {unknown} value 输入。
 * @param {number} cap 上限。
 * @returns {string} 结果。
 */
function str(value, cap = LIMITS.text) {
  if (value === null || value === undefined) return ''
  const s = (typeof value === 'string' ? value : String(value)).replace(/\r\n/g, '\n').trim()
  return s.length > cap ? `${s.slice(0, cap)}…` : s
}

/**
 * 有限数值，非法时给默认值。
 * @param {unknown} value 输入。
 * @param {number} fallback 默认值。
 * @returns {number} 结果。
 */
function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 可选数值：给了非法值就当没给。
 * @param {unknown} value 输入。
 * @returns {number|undefined} 结果。
 */
function optNum(value) {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 布尔值（未给时返回 undefined，让帧内用自己的默认）。
 * @param {unknown} value 输入。
 * @returns {boolean|undefined} 结果。
 */
function optBool(value) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/**
 * 二维点数组：接受 [[x,y],...] 或 [{x,y},...]。
 * @param {unknown} value 输入。
 * @param {number} dim 维度（2 或 3）。
 * @returns {number[][]} 点数组。
 */
function points(value, dim = 2) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const p of value.slice(0, LIMITS.points)) {
    if (Array.isArray(p)) {
      const row = []
      for (let i = 0; i < dim; i += 1) row.push(num(p[i]))
      out.push(row)
    } else if (p !== null && typeof p === 'object') {
      const row = [num(p.x), num(p.y)]
      if (dim === 3) row.push(num(p.z))
      out.push(row)
    }
  }
  return out
}

/**
 * 样式字段（帧内自行取默认色）。
 * @param {unknown} raw 输入。
 * @returns {object} 样式。
 */
function style(raw) {
  const s = raw !== null && typeof raw === 'object' ? raw : {}
  const out = {}
  const color = str(s.color, 24)
  if (color !== '') out.color = color
  const fill = str(s.fill, 24)
  if (fill !== '') out.fill = fill
  const width = optNum(s.width)
  if (width !== undefined) out.width = Math.min(12, Math.max(0.5, width))
  const opacity = optNum(s.opacity)
  if (opacity !== undefined) out.opacity = Math.min(1, Math.max(0.05, opacity))
  const dash = optBool(s.dash)
  if (dash !== undefined) out.dash = dash
  const size = optNum(s.size)
  if (size !== undefined) out.size = Math.min(48, Math.max(1, size))
  return out
}

/**
 * 规范化一个场景对象：保留该 type 认识的字段，其余丢弃。
 * @param {object} raw 原始对象。
 * @param {string} kind 场景类型。
 * @param {number} seq 序号（用于生成 id）。
 * @param {string[]} warnings 警告收集器。
 * @returns {object|null} 规范化对象，非法时 null。
 */
function normalizeObject(raw, kind, seq, warnings) {
  if (raw === null || typeof raw !== 'object') return null
  const allowed = OBJECT_TYPES[kind] ?? []
  const type = str(raw.type, 24)
  if (!allowed.includes(type)) {
    warnings.push(`场景 ${kind} 不认识对象类型「${type || '(空)'}」，已忽略（可用：${allowed.join(' / ')}）`)
    return null
  }

  const out = {
    id: str(raw.id, 40) || `o${seq}`,
    type,
    // 样式两种写法都收：嵌套 style:{color} 与顶层 color。字段说明
    // （examples.js 的 FIELD_DOCS）通篇按顶层写，模型也几乎只写顶层，
    // 所以顶层放后面覆盖嵌套值。缺了第二行会把所有配色/线宽静默丢掉。
    ...style(raw.style),
    ...style(raw),
  }
  // 通用可选字段
  const label = str(raw.label, 80)
  if (label !== '') out.label = label
  const text = str(raw.text, LIMITS.text)
  if (text !== '') out.text = text
  if (raw.hidden === true) out.hidden = true

  /** 把一组标量字段按名字搬过去。 */
  const take = (...names) => {
    for (const n of names) {
      const v = optNum(raw[n])
      if (v !== undefined) out[n] = v
    }
  }
  /** 把一组字符串字段搬过去。 */
  const takeStr = (...names) => {
    for (const n of names) {
      const v = str(raw[n], 120)
      if (v !== '') out[n] = v
    }
  }
  /** 把一组布尔字段搬过去。 */
  const takeBool = (...names) => {
    for (const n of names) {
      const v = optBool(raw[n])
      if (v !== undefined) out[n] = v
    }
  }

  // 坐标类字段（几乎所有 2D 对象都会用到一部分）
  take('x', 'y', 'z', 'x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'cx', 'cy', 'cz',
    'r', 'a', 'b', 'c', 'k', 'w', 'h', 'd', 'from', 'to', 'at', 'angle', 'rotate',
    'mass', 'value', 'samples', 'scale', 'lat', 'lon', 'declination', 'n')
  takeStr('expr', 'exprX', 'exprY', 'expr2', 'of', 'target', 'anchor', 'shape', 'unit',
    'element', 'center', 'ligand', 'geometry', 'kind', 'preset', 'orient', 'axis', 'dir')
  takeBool('close', 'extend', 'fillArea', 'dashed', 'arrow', 'both', 'open', 'wire', 'hollow', 'bold')

  if (Array.isArray(raw.points)) out.points = points(raw.points, /3$|3d$/.test(type) || kind.endsWith('3d') ? 3 : 2)
  if (Array.isArray(raw.data)) out.data = points(raw.data, 2)
  // 顶点名：立体几何里 ABCD-A₁B₁C₁D₁ 这类标注，按几何体顶点顺序对应
  if (Array.isArray(raw.vertices)) out.vertices = raw.vertices.slice(0, 32).map((s) => str(s, 8))
  // 平面/截面的法向量与过点
  if (Array.isArray(raw.normal)) out.normal = points([raw.normal], 3)[0]
  if (Array.isArray(raw.through)) out.through = points([raw.through], 3)[0]
  if (Array.isArray(raw.ligands)) out.ligands = raw.ligands.slice(0, 12).map((l) => str(l, 12)).filter((l) => l !== '')
  if (Array.isArray(raw.atoms)) out.atoms = raw.atoms.slice(0, 60).map((a) => (a !== null && typeof a === 'object' ? { element: str(a.element, 4), x: num(a.x), y: num(a.y), z: num(a.z), label: str(a.label, 20) } : null)).filter((a) => a !== null)
  if (Array.isArray(raw.bonds)) out.bonds = raw.bonds.slice(0, 90).map((b) => (Array.isArray(b) ? [str(b[0], 40), str(b[1], 40), num(b[2], 1)] : null)).filter((b) => b !== null)
  if (Array.isArray(raw.forces)) out.forces = raw.forces.slice(0, 12).map((f) => (f !== null && typeof f === 'object' ? { angle: num(f.angle), mag: num(f.mag, 1), label: str(f.label, 20) } : null)).filter((f) => f !== null)

  return out
}

/**
 * 规范化视图设置（2D 取值域，3D 取相机）。
 * @param {unknown} raw 原始。
 * @param {string} kind 场景类型。
 * @returns {object} 视图。
 */
function normalizeView(raw, kind) {
  const v = raw !== null && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const n of ['xMin', 'xMax', 'yMin', 'yMax', 'yaw', 'pitch', 'zoom', 'tMax']) {
    const value = optNum(v[n])
    if (value !== undefined) out[n] = value
  }
  for (const n of ['grid', 'axis', 'equal', 'perspective', 'wireframe', 'hideBack']) {
    const value = optBool(v[n])
    if (value !== undefined) out[n] = value
  }
  const xLabel = str(v.xLabel, 40)
  if (xLabel !== '') out.xLabel = xLabel
  const yLabel = str(v.yLabel, 40)
  if (yLabel !== '') out.yLabel = yLabel
  const y2Label = str(v.y2Label, 40)
  if (y2Label !== '') out.y2Label = y2Label
  // 2D 场景给一套保守默认值，避免模型漏填时画面空白
  if (kind === 'plot2d') {
    if (out.xMin === undefined || out.xMax === undefined || out.xMax <= out.xMin) { out.xMin = -5; out.xMax = 5 }
    if (out.yMin === undefined || out.yMax === undefined || out.yMax <= out.yMin) { out.yMin = -4; out.yMax = 4 }
  }
  if (kind === 'diagram2d' || kind === 'mech2d' || kind === 'circuit') {
    if (out.xMin === undefined) out.xMin = 0
    if (out.xMax === undefined) out.xMax = 100
    if (out.yMin === undefined) out.yMin = 0
    if (out.yMax === undefined) out.yMax = 60
  }
  return out
}

/**
 * 规范化一个解题步骤。
 * @param {object} raw 原始。
 * @param {number} seq 序号。
 * @param {Set<string>} ids 合法对象 id 集合。
 * @param {string[]} warnings 警告收集器。
 * @returns {object|null} 步骤。
 */
function normalizeStep(raw, seq, ids, warnings) {
  if (raw === null || typeof raw !== 'object') return null
  /** 过滤出确实存在的 id。 */
  const idList = (value) => {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    const out = []
    for (const item of list.slice(0, 60)) {
      const id = str(item, 40)
      if (id === '') continue
      if (!ids.has(id)) { warnings.push(`第 ${seq} 步引用了不存在的对象 id「${id}」`); continue }
      if (!out.includes(id)) out.push(id)
    }
    return out
  }

  const step = {
    title: str(raw.title, 120) || `第 ${seq} 步`,
    detail: str(raw.detail, LIMITS.detail),
    formula: str(raw.formula, 300),
    key: raw.key === true,
  }
  const show = idList(raw.show)
  if (show.length > 0) step.show = show
  const hide = idList(raw.hide)
  if (hide.length > 0) step.hide = hide
  const focus = idList(raw.focus ?? raw.highlight)
  if (focus.length > 0) step.focus = focus

  if (raw.set !== null && typeof raw.set === 'object' && !Array.isArray(raw.set)) {
    const set = {}
    for (const [id, patch] of Object.entries(raw.set).slice(0, 40)) {
      if (!ids.has(id)) { warnings.push(`第 ${seq} 步 set 引用了不存在的对象 id「${id}」`); continue }
      if (patch === null || typeof patch !== 'object') continue
      const clean = {}
      for (const [k, v] of Object.entries(patch).slice(0, 24)) {
        if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v
        else if (typeof v === 'string') clean[k] = str(v, 200)
        else if (typeof v === 'boolean') clean[k] = v
        else if (Array.isArray(v)) clean[k] = points(v, 3)
        else if (v !== null && typeof v === 'object') clean[k] = style(v)
      }
      if (Object.keys(clean).length > 0) set[id] = clean
    }
    if (Object.keys(set).length > 0) step.set = set
  }

  const view = normalizeView(raw.view, 'patch')
  if (Object.keys(view).length > 0) step.view = view
  const at = optNum(raw.at)
  if (at !== undefined) step.at = at
  return step
}

/**
 * 规范化整份场景规范。永不抛错：不认识的内容进 warnings，让演示尽量画出来。
 * @param {unknown} raw 模型给的原始 scene。
 * @param {object} [defaults] 缺省值：subject、title、topic。
 * @returns {{scene: object, warnings: string[]}} 规范化结果。
 */
export function normalizeScene(raw, defaults = {}) {
  const warnings = []
  const src = raw !== null && typeof raw === 'object' ? raw : {}
  let kind = str(src.kind, 24)
  if (!SCENE_KINDS.includes(kind)) {
    if (kind !== '') warnings.push(`未知场景类型「${kind}」，已按 diagram2d 处理`)
    kind = typeof src.html === 'string' && src.html.trim() !== '' ? 'html' : 'diagram2d'
  }

  const scene = {
    v: SCENE_VERSION,
    kind,
    title: str(src.title ?? defaults.title, LIMITS.title) || KIND_LABELS[kind],
    subject: toSubject(src.subject ?? defaults.subject) ?? null,
    topic: str(src.topic ?? defaults.topic, 60),
    caption: str(src.caption, 300),
    view: normalizeView(src.view, kind),
    objects: [],
    steps: [],
  }

  if (kind === 'html') {
    const html = typeof src.html === 'string' ? src.html : ''
    scene.html = html.length > LIMITS.html ? html.slice(0, LIMITS.html) : html
    if (scene.html.trim() === '') warnings.push('kind=html 但 html 字段为空')
  } else {
    const rawObjects = Array.isArray(src.objects) ? src.objects : []
    if (rawObjects.length > LIMITS.objects) warnings.push(`对象数超过上限 ${LIMITS.objects}，已截断`)
    let seq = 0
    const seen = new Set()
    for (const item of rawObjects.slice(0, LIMITS.objects)) {
      seq += 1
      const obj = normalizeObject(item, kind, seq, warnings)
      if (obj === null) continue
      if (seen.has(obj.id)) obj.id = `${obj.id}_${seq}`
      seen.add(obj.id)
      scene.objects.push(obj)
    }
    if (scene.objects.length === 0) warnings.push('场景里没有任何可绘制对象')
  }

  const ids = new Set(scene.objects.map((o) => o.id))
  const rawSteps = Array.isArray(src.steps) ? src.steps : []
  if (rawSteps.length > LIMITS.steps) warnings.push(`步骤数超过上限 ${LIMITS.steps}，已截断`)
  let stepSeq = 0
  for (const item of rawSteps.slice(0, LIMITS.steps)) {
    stepSeq += 1
    const step = normalizeStep(item, stepSeq, ids, warnings)
    if (step !== null) scene.steps.push(step)
  }

  return { scene, warnings }
}

/**
 * 一行摘要：模型与界面都用它快速了解这份演示画了什么。
 * @param {object} scene 已规范化的场景。
 * @returns {string} 摘要。
 */
export function sceneSummary(scene) {
  const kind = KIND_LABELS[scene?.kind] ?? scene?.kind ?? '未知'
  const objects = Array.isArray(scene?.objects) ? scene.objects.length : 0
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  const keys = steps.filter((s) => s.key === true).length
  const parts = [`${kind}`, scene?.kind === 'html' ? '自定义 HTML' : `${objects} 个对象`, `${steps.length} 个步骤`]
  if (keys > 0) parts.push(`${keys} 个重点步骤`)
  return parts.join(' · ')
}

/**
 * 重点步骤清单（卡片折叠态与工具返回值里都要展示）。
 * @param {object} scene 场景。
 * @returns {Array<{index: number, title: string}>} 重点步骤。
 */
export function keySteps(scene) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  return steps
    .map((s, i) => ({ index: i + 1, title: s.title, key: s.key === true }))
    .filter((s) => s.key)
    .map(({ index, title }) => ({ index, title }))
}

/**
 * 某场景类型允许的对象 type 列表（给 tutor_scene_guide 用）。
 * @param {string} kind 场景类型。
 * @returns {string[]} type 列表。
 */
export function objectTypesOf(kind) {
  return [...(OBJECT_TYPES[kind] ?? [])]
}
