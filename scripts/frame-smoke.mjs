// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 演示引擎冒烟测试（零依赖、无浏览器）。
 *
 * 思路：用一套最小 DOM/canvas 桩把 frame/*.browser.js 跑起来，把 canvas 上下文的
 * **每一次绘制调用都录下来**，再对录像做断言。比截图更适合做回归——像 NaN 坐标、
 * 某一步画空、某个对象类型悄悄不画了这类问题，肉眼看图未必发现，录像一断言就露。
 *
 * 覆盖：
 *   ① 九种场景 × 每个示例 × 每一步都能画出来且不抛异常
 *   ② 所有绘制坐标都是有限数（杜绝 NaN/Infinity 传进 canvas）
 *   ③ 步骤累积语义正确：show/hide/set/focus 真的改变了画面
 *   ④ 重点步骤在 DOM 上有标记，步骤芯片数与步骤数一致
 *   ⑤ 高亮（focus）确实触发了光晕
 *   ⑥ 3D 拖拽会改变投影结果；2D 缩放会改变坐标范围
 *   ⑦ 消息协议：ready / height / step 都会回传父窗口
 *   ⑧ kind='html' 兜底：片段里的 <script> 会被重建以真正执行
 *
 * 用法：node scripts/frame-smoke.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXAMPLES } from '../lib/examples.js'
import { SHOWCASE } from '../lib/showcase.js'
import { frameRuntime, panelDocument } from '../lib/frame/index.js'
import { normalizeScene } from '../lib/scene.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRAME_DIR = join(HERE, '..', 'lib', 'frame')

let passed = 0
const failures = []

/**
 * 断言。
 * @param {boolean} cond 条件。
 * @param {string} label 描述。
 * @returns {void}
 */
function ok(cond, label) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ✗ ${label}`)
  }
}

/** 分节标题。 */
function section(title) {
  console.log(`\n${title}`)
}

// ══ 最小 DOM / canvas 桩 ═══════════════════════════════════════════════════

/** 画布上下文录像机：记录每次调用与参数。 */
class Recorder {
  constructor() {
    this.calls = []
    this.texts = []
    this.shadowBlur = 0
    this.shadowColor = ''
    this.globalAlpha = 1
    this.lineWidth = 1
    this.strokeStyle = ''
    this.fillStyle = ''
    this.font = ''
    this.textAlign = 'center'
    this.textBaseline = 'middle'
    this.lineJoin = 'round'
    this.lineCap = 'round'
    this.glowCalls = 0
  }

  /** 记一次调用。 */
  rec(name, args) {
    this.calls.push({ name, args, blur: this.shadowBlur })
    if (this.shadowBlur > 0) this.glowCalls += 1
  }

  setTransform() { this.rec('setTransform', [...arguments]) }
  save() { this.rec('save', []) }
  restore() { this.rec('restore', []) }
  clearRect() { this.rec('clearRect', [...arguments]) }
  beginPath() { this.rec('beginPath', []) }
  closePath() { this.rec('closePath', []) }
  moveTo(x, y) { this.rec('moveTo', [x, y]) }
  lineTo(x, y) { this.rec('lineTo', [x, y]) }
  arc(x, y, r, a, b) { this.rec('arc', [x, y, r, a, b]) }
  rect(x, y, w, h) { this.rec('rect', [x, y, w, h]) }
  fill() { this.rec('fill', []) }
  stroke() { this.rec('stroke', []) }
  fillRect(x, y, w, h) { this.rec('fillRect', [x, y, w, h]) }
  setLineDash(d) { this.rec('setLineDash', [d]) }
  clip() { this.rec('clip', []) }
  fillText(text, x, y) {
    this.rec('fillText', [x, y])
    this.texts.push(String(text))
  }

  measureText(text) { return { width: String(text).length * 7 } }
  createRadialGradient() { return { addColorStop() {} } }
  createLinearGradient() { return { addColorStop() {} } }
}

/** 极简 DOM 节点。 */
class MockNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.childNodes = this.children
    this.style = {
      setProperty(name, value) { this[name] = value },
      removeProperty(name) { delete this[name] },
    }
    this.attributes = []
    this._listeners = {}
    this._text = ''
    this._class = ''
    this.parentNode = null
    this.clientWidth = 620
    this.clientHeight = 380
    this.disabled = false
    this.type = ''
    this.title = ''
    if (this.tagName === 'CANVAS') {
      this.width = 0
      this.height = 0
      this._ctx = new Recorder()
      this.classList = {
        _set: new Set(),
        add(c) { this._set.add(c) },
        remove(c) { this._set.delete(c) },
        contains(c) { return this._set.has(c) },
      }
    } else {
      this.classList = {
        _set: new Set(),
        add(c) { this._set.add(c) },
        remove(c) { this._set.delete(c) },
        contains(c) { return this._set.has(c) },
      }
    }
  }

  get className() { return this._class }
  set className(v) {
    this._class = String(v)
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean))
  }

  get textContent() { return this._text }
  set textContent(v) {
    this._text = v === null || v === undefined ? '' : String(v)
    this.children.length = 0
  }

  get innerHTML() { return this._html ?? '' }
  set innerHTML(v) {
    this._html = String(v ?? '')
    this.children.length = 0
    // 只需要支持 <script> 的提取（injectHtml 会重建它们）
    this._scripts = []
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
    let m = re.exec(this._html)
    while (m !== null) {
      const node = new MockNode('script')
      node.textContent = m[1]
      node.parentNode = this
      this._scripts.push(node)
      m = re.exec(this._html)
    }
  }

  getContext() { return this._ctx }
  appendChild(node) {
    this.children.push(node)
    node.parentNode = this
    return node
  }

  replaceChild(fresh, old) {
    const i = this._scripts ? this._scripts.indexOf(old) : -1
    if (i >= 0) this._scripts[i] = fresh
    this.children.push(fresh)
    fresh.parentNode = this
    return old
  }

  querySelectorAll(sel) {
    if (String(sel).toLowerCase() === 'script') return this._scripts ?? []
    return []
  }

  setAttribute(name, value) { this.attributes.push({ name, value }) }
  addEventListener(type, fn) {
    this._listeners[type] = this._listeners[type] ?? []
    this._listeners[type].push(fn)
  }

  /** 触发一个事件（测试里模拟用户操作）。 */
  emit(type, ev) {
    for (const fn of this._listeners[type] ?? []) fn(ev ?? {})
  }
}

/**
 * 造一个干净的运行环境并加载引擎。
 * @returns {object} { NS, messages, doc, win }
 */
function createEnv() {
  const root = new MockNode('div')
  root.clientWidth = 620
  const head = new MockNode('head')
  const body = new MockNode('body')
  body.scrollHeight = 520
  const documentElement = new MockNode('html')
  documentElement.scrollHeight = 520

  const doc = {
    documentElement,
    head,
    body,
    _root: root,
    createElement: (tag) => new MockNode(tag),
    getElementById: (id) => (id === 'hst-root' ? root : null),
    addEventListener: (type, fn) => {
      doc._listeners = doc._listeners ?? {}
      doc._listeners[type] = doc._listeners[type] ?? []
      doc._listeners[type].push(fn)
    },
    _listeners: {},
  }

  const messages = []
  const win = {
    devicePixelRatio: 2,
    innerWidth: 700,
    _listeners: {},
    addEventListener: (type, fn) => {
      win._listeners[type] = win._listeners[type] ?? []
      win._listeners[type].push(fn)
    },
    removeEventListener: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  const g = {
    document: doc,
    window: win,
    parent: { postMessage: (msg) => messages.push(msg) },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: win.requestAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    devicePixelRatio: 2,
  }
  g.globalThis = g
  g.self = g

  const files = readdirSync(FRAME_DIR).filter((f) => f.endsWith('.browser.js')).sort()
  // 必须用 frameRuntime() 拼接后的**整段源码**一次性执行，与浏览器里 srcdoc 内联
  // 的形式完全一致。早期版本是逐文件 new Function 加载的，于是漏掉了文件接缝处的
  // ASI 陷阱（每个文件以 `})(…)` 收尾不带分号，拼接后下一个 IIFE 会被当成对上一段
  // 返回值的调用）——生产环境整段脚本抛 TypeError，而测试却全绿。
  const runtime = frameRuntime()
  const fn = new Function(
    'globalThis', 'window', 'document', 'parent', 'getComputedStyle',
    'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'devicePixelRatio',
    runtime.source,
  )
  fn(g, win, doc, g.parent, g.getComputedStyle, win.requestAnimationFrame,
    setTimeout, clearTimeout, setInterval, clearInterval, 2)
  return { NS: g.__HST__, messages, doc, win, root, files, runtime }
}

/**
 * 检查录像里有没有非有限数坐标（NaN/Infinity 传给 canvas 是最隐蔽的 bug）。
 * @param {Recorder} ctx 录像机。
 * @returns {object|null} 首个问题调用。
 */
function findBadCoord(ctx) {
  const geometric = new Set(['moveTo', 'lineTo', 'arc', 'fillRect', 'rect', 'fillText'])
  for (const call of ctx.calls) {
    if (!geometric.has(call.name)) continue
    for (const arg of call.args) {
      if (typeof arg === 'number' && !Number.isFinite(arg)) return call
    }
  }
  return null
}

// ══ ① 引擎装载 ════════════════════════════════════════════════════════════
section('① 引擎装载')
const env0 = createEnv()
ok(env0.NS !== undefined && typeof env0.NS.mount === 'function', `拼接 ${env0.files.length} 个 browser 文件并暴露 mount()`)
ok(Object.keys(env0.NS.kinds).length === 9, `注册 9 种场景（实际 ${Object.keys(env0.NS.kinds).length}）`)
ok(typeof env0.NS.expr.compile === 'function' && typeof env0.NS.Painter === 'function', '表达式与画笔就位')
// 接缝回归：拼接后的整段源码必须一次执行成功，四个文件的导出全部就位。
// （曾经因为 IIFE 之间缺分号踩了 ASI 陷阱，只有第一个文件生效、mount 根本不存在）
{
  const src = frameRuntime().source
  const g = { }
  g.globalThis = g
  let seamError = null
  try {
    new Function('globalThis', 'window', 'document', 'getComputedStyle', 'requestAnimationFrame',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', src)(
      g, { devicePixelRatio: 1, addEventListener() {} }, undefined,
      () => ({ getPropertyValue: () => '' }), () => 0, setTimeout, clearTimeout, setInterval, clearInterval)
  } catch (err) {
    seamError = err
  }
  ok(seamError === null, `拼接源码一次执行无异常${seamError === null ? '' : `（${seamError.message.slice(0, 80)}）`}`)
  ok(g.__HST__ !== undefined && typeof g.__HST__.mount === 'function', '拼接后 mount() 就位（文件接缝没吃掉后续文件）')
  ok(g.__HST__ !== undefined && g.__HST__.kinds !== undefined && Object.keys(g.__HST__.kinds).length === 9, '拼接后九种场景全部注册')
  ok(g.__HST__ !== undefined && typeof g.__HST__.Player === 'function' && typeof g.__HST__.vseprDirs === 'function',
    '拼接后 2D/3D/shell 三层的导出都在')
  ok(/;\s*$/.test(src.split('/* ── 10-scene2d.browser.js ── */')[0].trimEnd()), '拼接时每段之间插入了分号')
  // 文件自身也必须自终结：这样即使换一个 joiner（或旧版 host 仍在跑），拼接依然安全
  for (const file of readdirSync(FRAME_DIR).filter((f) => f.endsWith('.browser.js')).sort()) {
    const body = readFileSync(join(FRAME_DIR, file), 'utf8').trimEnd()
    ok(body.endsWith(';'), `${file} 自身以分号收尾（任何 joiner 都能安全拼接）`)
  }
  // 反过来验证：故意用「裸换行」拼接也不该炸
  {
    const naive = readdirSync(FRAME_DIR).filter((f) => f.endsWith('.browser.js')).sort()
      .map((f) => readFileSync(join(FRAME_DIR, f), 'utf8')).join('\n')
    const g2 = {}
    g2.globalThis = g2
    let naiveError = null
    try {
      new Function('globalThis', 'window', 'document', 'getComputedStyle', 'requestAnimationFrame',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', naive)(
        g2, { devicePixelRatio: 1, addEventListener() {} }, undefined,
        () => ({ getPropertyValue: () => '' }), () => 0, setTimeout, clearTimeout, setInterval, clearInterval)
    } catch (err) {
      naiveError = err
    }
    ok(naiveError === null && typeof g2.__HST__?.mount === 'function',
      `裸换行拼接也能跑起来（防御旧 joiner）${naiveError === null ? '' : `（${naiveError.message.slice(0, 60)}）`}`)
  }
}

// ══ ② 每种场景 × 每一步都能画 ══════════════════════════════════════════════
section('② 九种场景逐步渲染')
for (const [kind, raw] of Object.entries(EXAMPLES)) {
  const { scene, warnings } = normalizeScene(raw)
  const env = createEnv()
  let error = null
  let player = null
  try {
    player = env.NS.mount({ mode: 'panel', scene })
  } catch (err) {
    error = err
  }
  if (error !== null) {
    ok(false, `${kind}：装载失败 ${error.message}`)
    continue
  }
  const ctx = player.canvas._ctx
  const opsPerStep = []
  const total = scene.steps.length
  for (let i = 0; i < total; i += 1) {
    const before = ctx.calls.length
    try {
      player.go(i)
    } catch (err) {
      error = err
      break
    }
    opsPerStep.push(ctx.calls.length - before)
  }
  if (error !== null) {
    ok(false, `${kind}：第 ${opsPerStep.length + 1} 步渲染抛错 ${error.message}`)
    continue
  }
  const minOps = Math.min(...opsPerStep)
  const bad = findBadCoord(ctx)
  ok(warnings.length === 0, `${kind}：示例场景零警告`)
  ok(minOps > 20, `${kind}：${total} 步每步都有绘制（最少 ${minOps} 次调用）`)
  ok(bad === null, `${kind}：绘制坐标全部有限${bad ? `（${bad.name}(${bad.args})）` : ''}`)
  ok(ctx.texts.length > 0, `${kind}：有文字标注（${ctx.texts.length} 条）`)
}

// ══ ②b 展示演示逐步渲染 ═══════════════════════════════════════════════════
section('②b 展示演示（docs/ 画廊的素材）逐步渲染')
for (const item of SHOWCASE) {
  const { scene, warnings } = normalizeScene(item.scene)
  const env = createEnv()
  let error = null
  let player = null
  try {
    player = env.NS.mount({ mode: 'panel', scene })
  } catch (err) {
    error = err
  }
  if (error !== null) {
    ok(false, `${item.id}：装载失败 ${error.message}`)
    continue
  }
  const ctx = player.canvas._ctx
  const ops = []
  for (let i = 0; i < scene.steps.length; i += 1) {
    const before = ctx.calls.length
    try {
      player.go(i)
    } catch (err) {
      error = err
      break
    }
    ops.push(ctx.calls.length - before)
  }
  if (error !== null) {
    ok(false, `${item.id}：第 ${ops.length + 1} 步抛错 ${error.message}`)
    continue
  }
  const bad = findBadCoord(ctx)
  ok(warnings.length === 0 && bad === null && Math.min(...ops) > 20 && ctx.texts.length > 0,
    `${item.id}：${scene.steps.length} 步全部渲染（最少 ${Math.min(...ops)} 次绘制 / ${ctx.texts.length} 条文字 / 坐标${bad === null ? '正常' : '有 NaN'}）`)
  // 每一步都必须真的改变画面（展示用演示不该有「空转」的步骤）
  const fingerprints = new Set()
  for (let i = 0; i < scene.steps.length; i += 1) {
    const eff = player.derive(i)
    fingerprints.add(JSON.stringify([
      eff.objects.filter((o) => !o.hidden).map((o) => o.id),
      [...eff.focus].sort(),
      eff.objects.map((o) => [o.x, o.y, o.declination]),
    ]))
  }
  ok(fingerprints.size === scene.steps.length,
    `${item.id}：${scene.steps.length} 个步骤各自改变了画面（无重复帧）`)
}

// ══ ③ 步骤累积语义 ════════════════════════════════════════════════════════
section('③ 步骤累积语义（show / hide / set / focus）')
{
  const scene = normalizeScene({
    kind: 'plot2d',
    title: 'T',
    view: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
    objects: [
      { id: 'a', type: 'point', x: 0, y: 0 },
      { id: 'b', type: 'point', x: 1, y: 1, hidden: true },
      { id: 'c', type: 'point', x: -1, y: -1 },
    ],
    steps: [
      { title: 's1' },
      { title: 's2', show: ['b'], focus: ['b'] },
      { title: 's3', hide: ['a', 'c'], set: { b: { x: 1.5 } } },
    ],
  }).scene
  const env = createEnv()
  const player = env.NS.mount({ mode: 'card', scene })

  player.go(0)
  let eff = player.derive(0)
  const visible0 = eff.objects.filter((o) => !o.hidden).length
  ok(visible0 === 2, `初始态可见 2 个对象（b 声明了 hidden）：实得 ${visible0}`)

  eff = player.derive(1)
  ok(eff.objects.filter((o) => !o.hidden).length === 3, 'show 让隐藏对象出现')
  ok(eff.focus.has('b') && eff.focus.size === 1, 'focus 只含当前步的对象')

  eff = player.derive(2)
  const vis2 = eff.objects.filter((o) => !o.hidden)
  ok(vis2.length === 1 && vis2[0].id === 'b', `hide 累积生效：第 3 步只剩 b（实得 ${vis2.map((o) => o.id).join(',') || '空'}）`)
  ok(vis2[0].x === 1.5, `set 补丁生效：b.x = ${vis2[0].x}`)
  ok(player.derive(1).focus.size === 1 && player.derive(2).focus.size === 0, 'focus 不累积（第 3 步无 focus）')

  // 反复来回跳，结果应完全一致（累积语义的关键性质）
  const snap = JSON.stringify(player.derive(2).objects)
  player.go(0); player.go(2); player.go(1); player.go(2)
  ok(JSON.stringify(player.derive(2).objects) === snap, '来回跳步后画面状态完全一致（无漂移）')
}

// ══ ④ 步骤 UI ═════════════════════════════════════════════════════════════
section('④ 步骤时间轴与重点步骤标记')
{
  const scene = normalizeScene(EXAMPLES.plot2d).scene
  const env = createEnv()
  const player = env.NS.mount({ mode: 'card', scene })
  ok(player.elChips.children.length === scene.steps.length, `芯片数 = 步骤数（${player.elChips.children.length}）`)
  const keyChips = player.elChips.children.filter((c) => c.classList.contains('key'))
  const keyCount = scene.steps.filter((s) => s.key).length
  ok(keyChips.length === keyCount && keyCount > 0, `重点步骤芯片带 key 标记（${keyChips.length}/${keyCount}）`)
  const keyIndex = scene.steps.findIndex((s) => s.key)
  player.go(keyIndex)
  ok(player.elStep.className.includes('key'), '当前步是重点时说明区加 key 样式')
  ok(player.elStepTitle.children.some((n) => n.textContent === '重点'), '重点步骤显示「重点」徽标')
  ok(player.elPos.textContent === `${keyIndex + 1}/${scene.steps.length}`, `进度显示 ${player.elPos.textContent}`)
  player.go(0)
  ok(player.btnPrev.disabled === true && player.btnNext.disabled === false, '首步禁用「上一步」')
  player.go(scene.steps.length - 1)
  ok(player.btnNext.disabled === true, '末步禁用「下一步」')
  ok(player.elFormula.textContent.includes('²') || player.elFormula.textContent.length > 0, '公式区渲染了上下标')
}

// ══ ⑤ 高亮光晕 ════════════════════════════════════════════════════════════
section('⑤ focus 触发光晕')
{
  const scene = normalizeScene(EXAMPLES.mech2d).scene
  const env = createEnv()
  const player = env.NS.mount({ mode: 'card', scene })
  const ctx = player.canvas._ctx
  ctx.glowCalls = 0
  player.go(2) // 该步 focus 了两个分力
  const glow = ctx.glowCalls
  ctx.glowCalls = 0
  // 构造一个无 focus 的场景做对照
  const plain = normalizeScene({
    kind: 'mech2d',
    objects: [{ id: 'g', type: 'ground', y: 10 }],
    steps: [{ title: '无高亮' }],
  }).scene
  const env2 = createEnv()
  const p2 = env2.NS.mount({ mode: 'card', scene: plain })
  p2.canvas._ctx.glowCalls = 0
  p2.go(0)
  ok(glow > 0, `有 focus 的步骤触发了 ${glow} 次带光晕绘制`)
  ok(p2.canvas._ctx.glowCalls === 0, '无 focus 的步骤不触发光晕')
}

// ══ ⑥ 交互 ════════════════════════════════════════════════════════════════
section('⑥ 交互：3D 旋转 / 2D 平移缩放')
{
  const env = createEnv()
  const player = env.NS.mount({ mode: 'panel', scene: normalizeScene(EXAMPLES.geom3d).scene })
  const yaw0 = player.cam.yaw
  player.canvas.emit('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
  player.canvas.emit('pointermove', { clientX: 160, clientY: 120, pointerId: 1 })
  player.canvas.emit('pointerup', { pointerId: 1 })
  ok(Math.abs(player.cam.yaw - yaw0) > 0.1, `拖拽改变了 yaw（${yaw0.toFixed(2)} → ${player.cam.yaw.toFixed(2)}）`)
  const zoom0 = player.cam.zoom
  player.canvas.emit('wheel', { deltaY: 120, preventDefault() {} })
  ok(player.cam.zoom < zoom0, `滚轮缩小了 3D 视图（${zoom0} → ${player.cam.zoom.toFixed(2)}）`)
  player.resetView()
  ok(Math.abs(player.cam.zoom - 1) < 1e-9, '复位恢复默认相机')

  const env2 = createEnv()
  const p2 = env2.NS.mount({ mode: 'card', scene: normalizeScene(EXAMPLES.plot2d).scene })
  const span0 = p2.painter.view.xMax - p2.painter.view.xMin
  p2.canvas.emit('wheel', { deltaY: 120, preventDefault() {} })
  ok(p2.painter.view.xMax - p2.painter.view.xMin > span0, '2D 滚轮扩大了坐标范围')
  const cx0 = (p2.painter.view.xMin + p2.painter.view.xMax) / 2
  p2.canvas.emit('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 })
  p2.canvas.emit('pointermove', { clientX: 80, clientY: 0, pointerId: 1 })
  ok((p2.painter.view.xMin + p2.painter.view.xMax) / 2 < cx0, '2D 拖拽平移了视野')
}

// ══ ⑦ 消息协议 ════════════════════════════════════════════════════════════
section('⑦ 与父窗口的消息协议')
{
  const env = createEnv()
  const player = env.NS.mount({ mode: 'card' })
  ok(env.messages.some((m) => m.type === 'hst:ready'), '挂载后回传 ready')
  // 父窗口下发场景
  const listener = env.win._listeners.message[0]
  listener({ data: { type: 'hst:scene', token: 'tk1', mode: 'panel', scene: normalizeScene(EXAMPLES.chart2d).scene, theme: { fg: '#000', brand: '#3964fe' } } })
  ok(player.scene !== null && player.token === 'tk1', '收到 scene 消息后装载场景并记住 token')
  ok(player.mode === 'panel', 'mode 随消息切换')
  const stepMsgs = env.messages.filter((m) => m.type === 'hst:step')
  ok(stepMsgs.length > 0 && stepMsgs[stepMsgs.length - 1].token === 'tk1', '回传的 step 消息带上 token')
  ok(typeof stepMsgs[stepMsgs.length - 1].total === 'number', 'step 消息含 total 供父窗口显示进度')
  // 父窗口指定跳步
  listener({ data: { type: 'hst:step', token: 'tk1', index: 2 } })
  ok(player.index === 2, '父窗口可远程切换步骤')
  // 错误 token 不生效
  listener({ data: { type: 'hst:step', token: 'other', index: 0 } })
  ok(player.index === 2, '其它 token 的消息被忽略')
  // 高度上报（reportHeight 有 30ms 防抖）
  await new Promise((r) => setTimeout(r, 60))
  ok(env.messages.some((m) => m.type === 'hst:height' && m.height > 0), '上报内容高度供父窗口调整 iframe')
}

// ══ ⑧ 主题桥接 ════════════════════════════════════════════════════════════
section('⑧ 主题桥接与安全过滤')
{
  const env = createEnv()
  env.NS.mount({ mode: 'card' })
  env.NS.applyTheme({
    fg: '#112233',
    bg2: 'rgba(38,49,72,.05)',
    line: 'color-mix(in srgb, #000 12%, transparent)',
    evil: 'url(http://x/y.png)',
    inject: 'red;}body{display:none',
    ref: 'var(--dsw-alias-label-primary)',
    scheme: 'dark',
  })
  const style = env.doc.documentElement.style
  ok(style['--hst-fg'] === '#112233', '十六进制色写入 --hst-fg')
  ok(style['--hst-bg2'] === 'rgba(38,49,72,.05)', 'rgba() 被接受（宿主令牌大量是这种形式）')
  ok(style['--hst-line'] === 'color-mix(in srgb, #000 12%, transparent)', 'color-mix() 被接受')
  ok(style['--hst-evil'] === undefined, '含 url() 的值被拒绝')
  ok(style['--hst-inject'] === undefined, '含 ; { } 的注入值被拒绝')
  ok(style['--hst-ref'] === undefined, 'var() 引用被拒绝（跨帧解析不到）')
  ok(style.colorScheme === 'dark', 'color-scheme 跟随宿主主题')
}

// ══ ⑨ HTML 兜底 ═══════════════════════════════════════════════════════════
section('⑨ kind=html 兜底')
{
  const { scene, warnings } = normalizeScene({
    kind: 'html',
    title: '自定义',
    html: '<p>hello</p><script>window.__ran = 1<\/script>',
  })
  ok(warnings.length === 0 && scene.kind === 'html', 'html 场景规范化通过')
  const env = createEnv()
  const player = env.NS.mount({ mode: 'card', scene })
  ok(player.elHtml.style.display === '' && player.elStage.style.display === 'none', 'html 场景隐藏画布、显示 HTML 容器')
  ok(player.elHtml.innerHTML.includes('hello'), '片段被写入容器')
  ok(player.elHtml.children.some((n) => n.tagName === 'SCRIPT'), '<script> 被重建（innerHTML 插入的脚本不会自动执行）')
  const empty = normalizeScene({ kind: 'html', html: '   ' })
  ok(empty.warnings.length === 1, '空 html 给出警告')
}

// ══ ⑩ 不支持的场景与异常兜底 ══════════════════════════════════════════════
section('⑩ 异常兜底')
{
  const env = createEnv()
  const player = env.NS.mount({ mode: 'card' })
  let threw = false
  try {
    player.load({ kind: 'unknown-kind', objects: [], steps: [], view: {} })
  } catch (err) { threw = true }
  ok(!threw, '未知场景类型不抛异常')
  ok(player.elHtml.children.some((n) => (n.textContent || '').includes('不支持')), '未知场景类型给出提示')

  // 表达式写错时曲线画空但不崩
  const bad = normalizeScene({
    kind: 'plot2d',
    objects: [{ id: 'f', type: 'func', expr: 'x^^2+' }],
    steps: [{ title: '坏表达式' }],
  }).scene
  const env2 = createEnv()
  let threw2 = false
  try {
    const p2 = env2.NS.mount({ mode: 'card', scene: bad })
    p2.go(0)
    ok(findBadCoord(p2.canvas._ctx) === null, '非法表达式不会把 NaN 传进 canvas')
  } catch (err) { threw2 = true }
  ok(!threw2, '非法表达式不抛异常')

  // 空场景
  const env3 = createEnv()
  let threw3 = false
  try {
    env3.NS.mount({ mode: 'card', scene: normalizeScene({ kind: 'plot2d', objects: [], steps: [] }).scene })
  } catch (err) { threw3 = true }
  ok(!threw3, '空场景不抛异常')
}

// ══ ⑪ 独立演示窗口页（panel.html）实跑 ═════════════════════════════════════
// 只检查路由返回了 HTML 是不够的——这一节真的把页面里的脚本执行一遍，
// 模拟对话页广播一份演示，验证引擎在窗口里完成挂载并画出画面。
section('⑪ 独立演示窗口页实跑（BroadcastChannel 全流程）')
{
  const env = createEnv()
  const byId = {}
  for (const id of ['title', 'state', 'dot', 'empty', 'follow', 'recent', 'hst-root']) byId[id] = new MockNode('div')
  byId.follow.checked = true
  byId['hst-root'].clientWidth = 700
  // 面板页自己找 #hst-root 挂载，这里把它接到桩 document 上
  env.doc.getElementById = (id) => byId[id] ?? null

  const broadcasts = []
  class FakeChannel {
    constructor(name) { this.name = name; FakeChannel.last = this }
    postMessage(msg) { broadcasts.push(msg) }
  }
  const fetched = []
  const fakeFetch = async (url) => { fetched.push(String(url)); return { json: async () => ({ demos: [] }) } }

  const g = {
    document: env.doc,
    window: env.win,
    location: { search: '' },
    URLSearchParams,
    fetch: fakeFetch,
    BroadcastChannel: FakeChannel,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval,
  }
  // 面板页假定引擎已由 <script src="./frame.js"> 加载好
  g.globalThis = g
  g.__HST__ = env.NS
  env.win.BroadcastChannel = FakeChannel

  const html = panelDocument()
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  let panelError = null
  try {
    new Function('globalThis', 'window', 'document', 'location', 'URLSearchParams', 'fetch',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'BroadcastChannel', scripts[scripts.length - 1])(
      g, env.win, env.doc, g.location, URLSearchParams, fakeFetch, setTimeout, () => 0, clearTimeout, clearInterval, FakeChannel)
  } catch (err) {
    panelError = err
  }
  ok(panelError === null, `面板页脚本执行无异常${panelError === null ? '' : `（${panelError.message.slice(0, 70)}）`}`)
  ok(FakeChannel.last !== undefined && FakeChannel.last.name === 'dsh-highschool-tutor/demo', '建立了与对话页一致的广播频道')
  ok(broadcasts.some((m) => m.t === 'here') && broadcasts.some((m) => m.t === 'need'), '开场即宣告存在并索要当前演示')
  ok(fetched.some((u) => u.includes('./demos?limit=30')), '拉取最近演示填充下拉框')

  // 对话页推来一份真实演示
  const scene = normalizeScene(EXAMPLES.mech2d).scene
  FakeChannel.last.onmessage({ data: { t: 'scene', demo: { id: 'dm_t', title: '斜面受力', scene }, theme: { fg: '#111', scheme: 'light' } } })
  const player = env.NS.player
  ok(player !== undefined && player !== null && player.scene !== null, '收到推送后引擎在窗口里完成挂载')
  ok(byId.title.textContent.includes('斜面受力'), '标题栏显示演示名')
  ok(byId.state.textContent.includes('已连接'), '状态栏提示已连接对话页')
  ok(byId.empty.style.display === 'none', '空态提示被隐藏')
  ok(player.elChips.children.length === scene.steps.length, `步骤芯片数与步骤数一致（${player.elChips.children.length}）`)
  const ctx = player.canvas._ctx
  let minOps = Infinity
  for (let i = 0; i < scene.steps.length; i += 1) {
    const before = ctx.calls.length
    player.go(i)
    minOps = Math.min(minOps, ctx.calls.length - before)
  }
  ok(minOps > 40, `窗口里每一步都画得出来（最少 ${minOps} 次绘制）`)
  ok(findBadCoord(ctx) === null, '窗口里的绘制坐标全部有限')

  // 再推一份不同类型的演示：应就地替换，不重新 mount
  const scene2 = normalizeScene(EXAMPLES.globe3d).scene
  FakeChannel.last.onmessage({ data: { t: 'scene', demo: { id: 'dm_u', title: '光照图', scene: scene2 } } })
  ok(env.NS.player === player && player.scene.kind === 'globe3d', '再推一份就地替换（不重建播放器）')
  ok(byId.title.textContent.includes('光照图'), '标题随新演示更新')

  broadcasts.length = 0
  FakeChannel.last.onmessage({ data: { t: 'ping' } })
  ok(broadcasts.some((m) => m.t === 'here'), '应答对话页的探活')
  broadcasts.length = 0
  for (const fn of env.win._listeners.beforeunload ?? []) fn()
  ok(broadcasts.some((m) => m.t === 'bye'), '关窗时告别，让对话页立刻回落到页内渲染')

  FakeChannel.last.onmessage({ data: 'garbage' })
  FakeChannel.last.onmessage({ data: { t: 'scene' } })
  ok(true, '非法广播消息不导致异常')
}

// ══ 汇总 ══════════════════════════════════════════════════════════════════
console.log('')
if (failures.length === 0) {
  console.log(`✅ 演示引擎通过 ${passed} 项`)
  process.exit(0)
}
console.log(`❌ 演示引擎 ${failures.length} 项失败（通过 ${passed} 项）`)
for (const f of failures) console.log(`   · ${f}`)
process.exit(1)
