// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 客户端包冒烟测试（node scripts/client-smoke.mjs）。
 *
 * lib/client.js 是「已构建产物」形态（window.__ModuleLoader__.load 包裹的 CJS
 * 工厂），不经过编译，所以这里在 node 里把它真实跑一遍：
 *   ① 用最小 window/document/fetch 桩加载包，确认工厂能执行、CSS 能注入；
 *   ② 用假的 ctx 调 apply()，确认注册了预期的两个插槽与选项；
 *   ③ 用 react-dom/server 把面板、讲题卡/复习翻卡、徽标渲染成静态 HTML，
 *      抓出渲染路径上的拼写错误、未定义变量、Hook 误用。
 *
 * react / react-dom 从 dsh 安装目录解析（可用 HST_REACT_PATHS 覆盖，多个用 : 分隔）；
 * 找不到时本测试会跳过而不是失败。
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const req = createRequire(import.meta.url)
const candidates = [
  ...(process.env.HST_REACT_PATHS ?? '').split(':').filter((p) => p !== ''),
  join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'profiles', 'web'),
  '/Users/Apple/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh',
]

let React = null
let renderToStaticMarkup = null
try {
  // react 与 react-dom/server 必须来自同一份副本：dsh 根 node_modules 与
  // UI 轨迹子包里各带一份 react（18 / 19），各自 resolve 会拿到两个实例，
  // 跨实例渲染报 "Objects are not valid as a React child"。
  // 先解析 react-dom/server，再取其同层 node_modules 里的兄弟包 react。
  const serverPath = req.resolve('react-dom/server', { paths: candidates })
  const nmDir = dirname(dirname(serverPath))
  React = req(join(nmDir, 'react'))
  renderToStaticMarkup = req(serverPath).renderToStaticMarkup
} catch {
  // 退化：各自解析（只在环境恰好一致时可用）。
  try {
    React = req(req.resolve('react', { paths: candidates }))
    renderToStaticMarkup = req(req.resolve('react-dom/server', { paths: candidates })).renderToStaticMarkup
  } catch {
    console.log('– 跳过客户端渲染测试（未找到 react / react-dom，安装到 profile 后由浏览器验证）')
    process.exit(0)
  }
}

let passed = 0
const failures = []
function ok(label, cond, detail) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`) } else { failures.push(label); console.log(`  ✗ ${label}${detail === undefined ? '' : ` → ${detail}`}`) }
}

// ── 浏览器环境最小桩 ─────────────────────────────────────────────────────────
let loaded = null
const styleTags = []
globalThis.HTMLElement = class HTMLElement {}
globalThis.document = {
  hidden: false,
  head: { appendChild: (tag) => styleTags.push(tag) },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, textContent: '', click() {}, remove() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = {
  __ModuleLoader__: { load: ({ id, factory }) => { loaded = { id, exports: factory((dep) => (dep === 'react' ? React : req(dep))) } } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (t) => clearInterval(t),
  confirm: () => true,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => '' })

// ── ① 加载包 ────────────────────────────────────────────────────────────────
console.log('\n① 加载客户端包')
await import(pathToFileURL(new URL('../lib/client.js', import.meta.url).pathname).href)
ok('工厂已执行并注册模块', loaded !== null && loaded.exports !== undefined)
ok('模块 id 为包名', loaded.id === '@dsh-external/dsh-highschool-tutor', loaded?.id)
ok('样式已注入一次', styleTags.length === 1)
const mod = loaded.exports
ok('导出 apply / inject', typeof mod.apply === 'function' && Array.isArray(mod.inject))
ok('声明 slots 依赖', mod.inject.includes('slots'), JSON.stringify(mod.inject))
ok('导出面板与徽标组件', typeof mod.TutorPanel === 'function' && typeof mod.TutorBadge === 'function')
ok('间隔文案格式化', mod.fmtInterval(0) === '20 分钟' && mod.fmtInterval(1) === '1 天' && mod.fmtInterval(60) === '2 月', `${mod.fmtInterval(0)}/${mod.fmtInterval(60)}`)

// ── ② 插槽注册 ──────────────────────────────────────────────────────────────
console.log('\n② 插槽注册')
const registered = []
const injected = []
mod.apply({
  slots: {
    inject: (name, cb) => { injected.push(name); cb() },
    register: (options, component) => { registered.push({ options, component }); return () => {} },
  },
})
ok('注册六处 UI（分区 / 徽标 / 讲题卡 / 复习翻卡 / 侧栏面板 / 侧栏入口）', registered.length === 6, String(registered.length))
const section = registered.find((r) => r.options.name === 'settings.section')
const badge = registered.find((r) => r.options.name === 'conversation.session.header.utilities')
const toolviews = registered.filter((r) => r.options.name === 'tool.call.toolview')
const dockSlot = registered.find((r) => r.options.name === 'shell.overlay')
const launcher = registered.find((r) => r.options.name === 'sidebar.footer.action')
ok('设置页分区 id/label 正确', section !== undefined && section.options.id === 'highschool-tutor' && section.options.label() === '高中助学')
ok('徽标注册在标题栏工具行且排在左侧', badge !== undefined && badge.options.id === 'highschool-tutor-badge' && badge.options.order < 0)
ok('讲题卡与复习翻卡分别按工具名 keyed 注册', toolviews.length === 2
  && toolviews.some((t) => t.options.key === 'tutor_visualize' && t.options.id === 'highschool-tutor-demo')
  && toolviews.some((t) => t.options.key === 'tutor_review_deck' && t.options.id === 'highschool-tutor-deck'))
ok('侧栏面板挂在 shell.overlay（加性浮层）', dockSlot !== undefined && dockSlot.options.id === 'highschool-tutor-dock')
ok('左侧栏底部注册了演示入口', launcher !== undefined && launcher.options.id === 'highschool-tutor-demo-launcher')
ok('先 inject 再 register', injected.length === 6 && injected.includes('settings.section') && injected.includes('shell.overlay'))

// ── ③ 静态渲染 ──────────────────────────────────────────────────────────────
console.log('\n③ 静态渲染（effect 不执行，检查渲染路径）')
function render(label, element) {
  try {
    const html = renderToStaticMarkup(element)
    ok(label, true)
    return html
  } catch (error) {
    ok(label, false, String(error.message ?? error))
    return ''
  }
}

const panelHtml = render('面板首屏（加载态）', React.createElement(mod.TutorPanel))
ok('首屏提示加载中', panelHtml.includes('正在加载'), panelHtml.slice(0, 80))
const badgeHtml = render('徽标（无数据时不占位）', React.createElement(mod.TutorBadge))
ok('徽标无数据时渲染为空', badgeHtml === '')
const cssText = styleTags[0]?.textContent ?? ''
ok('复习卡字体保持可读下限（14/13/12）', cssText.includes('.hst_q{font-size:14px;line-height:1.7') && cssText.includes('.hst_a{font-size:13px') && cssText.includes('.hst_expl{font-size:12px'))
ok('对话内嵌演示卡片画布固定 16:9', cssText.includes('.hst_frameCard{aspect-ratio:16 / 9;height:auto}'))

// 带真实数据形态的面板：伪造 overview 响应后再渲染，覆盖各标签页渲染路径
const overview = {
  today: '2026-08-20', now: Date.now(),
  profile: { grade: 'g2', examDate: '2027-06-07', region: '新高考 · 人教版', subjects: ['chinese', 'math', 'english', 'physics', 'chemistry', 'geography'], dailyReviewTarget: 40, dailyStudyMinutes: 180, newPerDay: 20 },
  countdown: { examDate: '2027-06-07', days: 290 },
  due: { total: 12, bySubject: { math: 7, physics: 5 }, new: 3, newBySubject: { chemistry: 3 }, learning: 1 },
  totals: { items: 66, mistakes: 6, cards: 60, bySubject: { math: 20 } },
  study: { minutes: 90, minutesBySubject: { math: 60, chinese: 30 }, target: 180, reviewedToday: 8, reviewTarget: 40, againToday: 2, chaptersToday: 1, streak: 4 },
  weakTopics: [{ subject: 'physics', topic: '电磁感应', items: 4, due: 2, lapses: 3, accuracy: 25, mastery: 18 }],
  recentExams: [],
}
const stats = {
  range: { days: 14, from: '2026-08-07', to: '2026-08-20' },
  series: Array.from({ length: 14 }, (_, i) => ({ date: `2026-08-${String(7 + i).padStart(2, '0')}`, minutes: 60 + i, minutesBySubject: { math: 30 }, reviews: 5 + i, again: 1, chapters: 0 })),
  subjects: [{ subject: 'math', items: 20, mistakes: 4, due: 7, newItems: 2, mastery: 62, accuracy: 78, reviews: 30, minutes: 300 }],
  retention: { reviews: 120, accuracy: 81, matureAccuracy: 88 },
  examTrend: [{ id: 'ex_0001', date: '2026-03-15', name: '月考一', total: 322, totalFull: 400, percent: 80.5, scores: { math: { score: 128, full: 150 } }, rank: 20, rankOf: 800 }],
}
globalThis.fetch = async (url) => {
  const path = String(url)
  const body = path.includes('/stats') ? stats
    : path.includes('/docs/formats') ? { supported: [{ format: 'docx', label: 'Word 文档', note: 'x' }], indirect: [{ format: 'pdf', label: 'PDF', note: '先转 docx' }], modes: [] }
      : path.includes('/meta') ? { subjects: [], grades: [], dataDir: '/tmp/x', syllabus: { math: { modules: 6, chapters: 30 } }, seedCount: 60, ui: { badge: true, panel: true, pollIntervalMs: 60000 } }
      : path.includes('/progress') ? { chapters: { math: { 数列: { status: 'done', date: '2026-08-19' } } }, notes: [{ date: '2026-08-19', subject: 'math', text: '含参讨论不熟' }] }
        : path.includes('/syllabus') ? { subject: 'math', label: '数学', modules: [{ book: '必修第一册', grade: 'g1', chapters: ['集合与常用逻辑用语'] }] }
          : path.includes('/items') ? { total: 1, items: [{ id: 'it_00001', kind: 'mistake', subject: 'math', topic: '导数', chapter: '', question: '求极值', answer: '2 与 −2', explanation: '求导定号', tags: ['计算失误'], difficulty: 4, source: '一模', srs: { state: 'review', due: Date.now() + 86400000, reps: 2, lapses: 1, ease: 2.4, intervalDays: 2 }, preview: { again: 0, hard: 1, good: 2, easy: 4 }, masteryScore: 55 }] }
            : path.includes('/queue') ? { counts: { due: 1, new: 0, newBudget: 20, learning: 0, pool: 1 }, items: [] }
              : overview
  return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => '' }
}

// 直接渲染各标签页组件（今日/设置由 props 提供数据，覆盖真实渲染路径）
const todayHtml = render('今日页（含倒计时/进度/薄弱点）', React.createElement(mod.TodayTab, { overview, onGoLibrary: () => {} }))
ok('今日页显示倒计时天数', todayHtml.includes('290'))
ok('今日页显示待复习合计', todayHtml.includes('15'), '12 到期 + 3 新卡 = 15')
ok('今日页列出薄弱知识点', todayHtml.includes('电磁感应'))
ok('今日页保留小卡片抽题入口，也提示对话翻卡', todayHtml.includes('开始复习') && todayHtml.includes('全科复习') && todayHtml.includes('抽查我'))
const settingsHtml = render('设置页（表单+说明）', React.createElement(mod.SettingsTab, { overview, meta: { dataDir: '/tmp/hst', seedCount: 60, syllabus: { math: { modules: 6, chapters: 30 } } } }))
ok('设置页显示数据目录', settingsHtml.includes('/tmp/hst'))
ok('设置页列出工具用法', settingsHtml.includes('tutor_add_items'))
render('题库页（首帧）', React.createElement(mod.LibraryTab, { initialFilter: null, onConsumeFilter: () => {} }))
render('计划页（首帧）', React.createElement(mod.PlanTab, { overview }))
render('统计页（首帧）', React.createElement(mod.StatsTab, { overview }))
render('面板（含头部信息）', React.createElement(mod.TutorPanel))

// ── ④ 动态演示 UI ───────────────────────────────────────────────────────────
console.log('\n④ 动态演示 UI')

/** 一份最小但完整的场景（与 host 侧 scene.js 规范化后的形状一致）。 */
const scene = {
  v: 1,
  kind: 'plot2d',
  title: '二次函数最值',
  subject: 'math',
  topic: '一元二次函数',
  caption: '配方后顶点即最值点',
  view: { xMin: -1, xMax: 5, yMin: -3, yMax: 6 },
  objects: [
    { id: 'f', type: 'func', expr: 'x^2-4x+3', label: 'f(x)=x^2-4x+3' },
    { id: 'v', type: 'point', x: 2, y: -1, label: '顶点', hidden: true },
  ],
  steps: [
    { title: '配方', detail: '化成顶点式', formula: 'f(x)=(x-2)^2-1', key: false },
    { title: '读出顶点', detail: '开口向上，顶点即最小值', formula: '最小值 −1', key: true, show: ['v'], focus: ['v'] },
  ],
}

/** 已结算的工具调用切片（DSH 传给 tool.call.toolview 的形状）：讲题卡带题目与答案。 */
const settledBlock = {
  kind: 'tool-result',
  isError: false,
  content: [{ type: 'text', text: '已生成动态演示「二次函数最值」' }],
  meta: {
    kind: 'hst-demo',
    demoId: 'dm_0001',
    title: '二次函数最值',
    sceneKind: 'plot2d',
    summary: '平面坐标系 · 2 个对象 · 2 个步骤 · 1 个重点步骤',
    keySteps: [{ index: 2, title: '读出顶点' }],
    itemId: 'it_00001',
    scene,
    question: '求 f(x)=x^2-4x+3 在 x∈[0,5] 上的最小值',
    answer: '−1',
    explanation: '配方得顶点 (2,−1)，开口向上，对称轴在区间内',
    subject: 'math',
    topic: '一元二次函数',
    difficulty: 2,
    itemPreview: { again: 0, hard: 1, good: 2, easy: 4 },
  },
}

const cardHtml = render('讲题卡（已结算）', React.createElement(mod.DemoToolView, { callId: 'c1', toolName: 'tutor_visualize', block: settledBlock }))
ok('卡片显示演示标题', cardHtml.includes('二次函数最值'))
ok('卡片显示场景摘要', cardHtml.includes('平面坐标系'))
ok('卡片列出重点步骤（折叠态也能看到重点）', cardHtml.includes('读出顶点') && cardHtml.includes('重点'))
ok('卡片提供「独立窗口」与「侧栏」两个入口', cardHtml.includes('独立窗口') && cardHtml.includes('侧栏'))
ok('讲题卡显示题目并默认不露答案', cardHtml.includes('求 f(x)') && !cardHtml.includes('−1') && cardHtml.includes('显示答案'))
ok('讲题卡答案区随样式提供四档评分组件', cssText.includes('.hst_grades{') && cssText.includes('.hst_gradeBtn{'))

const runningHtml = render('演示卡片（生成中）', React.createElement(mod.DemoToolView, { callId: 'c2', toolName: 'tutor_visualize', block: { running: true } }))
ok('运行中只占一行', runningHtml.includes('生成中'))

const errorHtml = render('演示卡片（失败）', React.createElement(mod.DemoToolView, {
  callId: 'c3',
  toolName: 'tutor_visualize',
  block: { kind: 'tool-result', isError: true, content: [{ type: 'text', text: '场景规范非法\n第二行不该显示' }], meta: null },
}))
ok('失败时只显示首行错误', errorHtml.includes('场景规范非法') && !errorHtml.includes('第二行不该显示'))

const legacyHtml = render('演示卡片（无 meta 的旧记录）', React.createElement(mod.DemoToolView, {
  callId: 'c4',
  toolName: 'tutor_visualize',
  block: { kind: 'tool-result', isError: false, content: [{ type: 'text', text: '演示已生成' }], meta: null },
}))
ok('缺 meta 时退回文本行而不是崩溃', legacyHtml.includes('演示已生成'))

// ── 复习翻卡套组（tutor_review_deck 的工具视图走同一组件） ─────────────────────
const deckMeta = {
  kind: 'hst-deck',
  subject: 'math',
  counts: { due: 2, new: 1, newBudget: 20, learning: 0, pool: 5 },
  items: [{
    id: 'it_00001', kind: 'mistake', subject: 'math', topic: '导数', difficulty: 3,
    question: '求 f(x)=x^3-3x 的极值', answer: '极大值 2，极小值 −2',
    explanation: 'f\'(x)=3x^2-3=0 → x=±1，定号即可', source: '一模',
    srs: { state: 'review', reps: 2, lapses: 1 },
    preview: { again: 0, hard: 1, good: 2, easy: 4 }, masteryScore: 55,
  }],
}
const deckHtml = render('复习翻卡套组（首张）', React.createElement(mod.DeckToolView, { callId: 'd1', toolName: 'tutor_review_deck', block: { kind: 'tool-result', isError: false, content: [{ type: 'text', text: '已把 1 张卡片放进对话' }], meta: deckMeta } }))
ok('翻卡显示题干与进度、不露答案', deckHtml.includes('求 f(x)=x^3-3x') && deckHtml.includes('1 / 1') && deckHtml.includes('显示答案') && !deckHtml.includes('极大值 2'))
ok('翻卡头部有学科/难度与评分说明', deckHtml.includes('难度 3') && deckHtml.includes('空格翻面'))
const deckRunningHtml = render('复习翻卡（运行中）', React.createElement(mod.DeckToolView, { callId: 'd2', toolName: 'tutor_review_deck', block: { running: true } }))
ok('翻卡套组运行中不崩（hook 数量稳定）', deckRunningHtml.includes('复习翻卡') && deckRunningHtml.includes('生成中'))
render('设置页小卡片抽题（取队列中）', React.createElement(mod.QueueRunner, { onExit: () => {} }))
const quizHtml = render('设置页小卡片抽题（宽屏弹层）', React.createElement(mod.QueueRunner, { onExit: () => {} }))
ok('小卡片抽题以宽屏居中弹层呈现（横版观感）', quizHtml.includes('hst_quizWrap') && quizHtml.includes('hst_quiz'))

// ── 与 dsh-better-sidebar 集成 ──────────────────────────────────────────────
{
  // 这个插件是**可选**依赖：先确认没装它时一切照常（前面的测试已在这个前提下全过）
  ok('未装 better-sidebar 时服务为空且不影响其它功能', mod.bs.service === null && mod.bs.usable() === false)

  // 用一个带 ctx.inject 与 betterSidebar 服务的 mock ctx 再跑一次 apply
  const registered = []
  const calls = []
  const fakeService = {
    version: '0.13.1',
    features: ['badge', 'tabLifecycle', 'updateTab', 'openFile', 'targetedOpen', 'stateSubscription', 'tabMeta', 'pluginSettings'],
    registerTab: (d) => { registered.push(d); return () => calls.push(['disposeTab', d.id]) },
    registerFileViewer: () => () => {},
    isTabEnabled: () => true,
    openTab: (seed) => calls.push(['openTab', seed]),
    closeTab: (id) => calls.push(['closeTab', id]),
    updateTab: (id, patch) => calls.push(['updateTab', id, patch]),
    getSnapshot: () => ({ sessionId: 's1', state: { panelOpen: true }, prefs: {} }),
    subscribeState: () => () => {},
  }
  const effects = []
  const scoped = {
    betterSidebar: fakeService,
    effect: (fn, label) => { effects.push(label); const d = fn(); return () => { if (typeof d === 'function') d() } },
  }
  const disposers = []
  mod.apply({
    slots: { inject: (name, cb) => cb(), register: () => () => {} },
    inject: (deps, cb) => { if (deps.includes('betterSidebar')) { const r = cb(scoped); disposers.push(r); return r } },
  })

  ok('通过 ctx.inject 做可选依赖（没装也不会拖垮整个 client 半边）', effects.length === 1 && String(effects[0]).includes('better-sidebar'))
  ok('注册了一个侧栏页签', registered.length === 1)
  const desc = registered[0]
  ok('页签 id 带插件前缀', desc.id === mod.BS_TAB_ID && desc.id === 'highschool-tutor:demo')
  ok('标题与图标按契约给（可为函数）', typeof desc.title === 'function' && desc.title() === '动态演示' && typeof desc.icon === 'function')
  ok('声明单实例（再次打开只聚焦，不开重复页）', desc.single === true)
  ok('提供组件', typeof desc.component === 'function')
  ok('服务已被桥接', mod.bs.service === fakeService && mod.bs.usable() === true)
  ok('按 features 清单探测能力', mod.bs.can('updateTab') === true && mod.bs.can('nonexistent') === false)

  // bs.show()：面板已展开时只 openTab + updateTab
  calls.length = 0
  const demo = { id: 'dm_7', callId: 'live-7', title: '正方体截面', kind: 'geom3d', keySteps: [], scene }
  ok('show() 送达成功', mod.bs.show(demo) === true)
  const opened = calls.find((c) => c[0] === 'openTab')
  ok('openTab 带上类型/标题/内容种子', opened !== undefined && opened[1].type === 'highschool-tutor:demo' && opened[1].path === 'dm_7' && opened[1].title === '正方体截面')
  ok('updateTab 同步标题与 meta（页签是单实例，去重聚焦时 path 不一定生效）',
    calls.some((c) => c[0] === 'updateTab' && c[2].title === '正方体截面' && c[2].meta.demoId === 'dm_7'))
  ok('未折叠时不多余地关页签', !calls.some((c) => c[0] === 'closeTab'))
  ok('内容写进共享 store（页签据此渲染）', mod.dock.state.demo.id === 'dm_7')

  // 面板收起时：先 closeTab 再 openTab，借宿主的「内容打开」自动展开
  calls.length = 0
  fakeService.getSnapshot = () => ({ sessionId: 's1', state: { panelOpen: false }, prefs: {} })
  mod.bs.show(demo)
  ok('面板收起时先关后开，借「内容打开」把面板展开',
    calls[0] !== undefined && calls[0][0] === 'closeTab' && calls.some((c) => c[0] === 'openTab'))
  fakeService.getSnapshot = () => ({ sessionId: 's1', state: { panelOpen: true }, prefs: {} })

  // 用户在侧栏设置里关掉该页签 → 不再送，交回其它落点
  fakeService.isTabEnabled = () => false
  ok('页签被用户禁用时 show() 拒绝送达', mod.bs.usable() === false && mod.bs.show(demo) === false)
  fakeService.isTabEnabled = () => true

  // 服务抛错不能把调用方带崩
  const boom = { ...fakeService, openTab: () => { throw new Error('boom') } }
  mod.bs.attach(boom)
  ok('服务抛错时 show() 返回 false 而不是崩溃', mod.bs.show(demo) === false)
  mod.bs.attach(fakeService)

  // 页签组件渲染
  mod.dock.set({ demo, step: null, token: 'bs-1' })
  const tabHtml = render('侧栏页签（有演示）', React.createElement(mod.DemoSidebarTab, { visible: true }))
  ok('页签显示标题与「自动」开关', tabHtml.includes('正方体截面') && tabHtml.includes('自动'))
  ok('页签提供「最近」与「独立窗口」入口', tabHtml.includes('最近') && tabHtml.includes('独立窗口'))
  const bgHtml = render('侧栏页签（后台）', React.createElement(mod.DemoSidebarTab, { visible: false }))
  ok('页签在后台时不渲染画布（省掉无谓工作）', !bgHtml.includes('hst_frame') && bgHtml.includes('后台'))
  mod.dock.set({ demo: null })
  const emptyTab = render('侧栏页签（空态）', React.createElement(mod.DemoSidebarTab, { visible: true }))
  ok('空态给出引导与「打开最近一份」', emptyTab.includes('还没有演示') && emptyTab.includes('打开最近一份演示'))

  // 卡片让位给侧栏页签
  mod.dock.set({ demo, step: null, token: 'bs-1' })
  const cardBs = render('卡片（演示在侧栏页签）', React.createElement(mod.DemoToolView, { callId: 'live-7', toolName: 'tutor_visualize', block: settledBlock }))
  ok('卡片提示「正在侧栏页签显示」并让位', cardBs.includes('正在侧栏页签显示') && !cardBs.includes('hst_frame'))

  // 服务被回收（插件卸载 / HMR）→ 回落到自带浮层
  mod.bs.attach(null)
  ok('服务消失后回落（usable=false）', mod.bs.usable() === false)
  mod.dock.set({ demo: null, token: null })
}

// ── 独立演示窗口（BroadcastChannel 桥）───────────────────────────────────────
{
  const P = mod.panel
  ok('面板地址指向 host 的 panel.html', P.path === '/api/highschool-tutor/panel.html')
  // ① 浏览器不支持 BroadcastChannel 时必须优雅退化，不能抛
  let degraded = true
  try {
    P.connect()
    P.push({ id: 'x', callId: 'c', title: 't', scene })
    P.ping()
  } catch (err) {
    degraded = false
  }
  ok('不支持 BroadcastChannel 时不崩（功能自然退化）', degraded && P.channel === null && P.alive === false)

  // ② 注入一个假频道，验证握手与推送
  const sent = []
  class FakeChannel {
    constructor(name) { this.name = name; FakeChannel.last = this }
    postMessage(msg) { sent.push(msg) }
  }
  globalThis.window.BroadcastChannel = FakeChannel
  P.channel = null
  const ch = P.connect()
  ok('频道名与 host 侧一致', ch !== null && ch.name === 'dsh-highschool-tutor/demo')

  const demo = { id: 'dm_9', callId: 'live-9', title: '二次函数最值', kind: 'plot2d', keySteps: [], scene }
  P.push(demo)
  const scenePush = sent.find((m) => m.t === 'scene')
  ok('push() 发出 scene 消息且带主题', scenePush !== undefined && scenePush.demo.callId === 'live-9' && typeof scenePush.theme === 'object')

  let notified = null
  const off = P.on((v) => { notified = v })
  ch.onmessage({ data: { t: 'here' } })
  ok('收到 here → 判定窗口存活并通知订阅者', P.alive === true && notified === true)

  sent.length = 0
  ch.onmessage({ data: { t: 'need' } })
  ok('收到 need → 把最近一份补推过去（窗口刷新后自愈）', sent.some((m) => m.t === 'scene' && m.demo.callId === 'live-9'))

  sent.length = 0
  ch.onmessage({ data: { t: 'ping' } })
  ok('对话页不理会 ping（那是窗口该应答的）', sent.length === 0)

  ch.onmessage({ data: { t: 'bye' } })
  ok('收到 bye → 判定窗口已关', P.alive === false && notified === false)
  ch.onmessage({ data: 'garbage' })
  ok('非法消息被忽略', P.alive === false)
  off()

  // ③ 窗口活着时，卡片让位给窗口
  ch.onmessage({ data: { t: 'here' } })
  const winHtml = render('卡片（演示在独立窗口）', React.createElement(mod.DemoToolView, { callId: 'live-9', toolName: 'tutor_visualize', block: settledBlock }))
  ok('窗口活着时卡片提示「正在独立窗口显示」', winHtml.includes('正在独立窗口显示'))
  ok('窗口活着时卡片不再自己渲染画布', !winHtml.includes('hst_frame'))
  ok('窗口活着时按钮变成「聚焦窗口」', winHtml.includes('聚焦窗口'))
  ch.onmessage({ data: { t: 'bye' } })
  delete globalThis.window.BroadcastChannel
  P.channel = null
}

// ── 自动推送到侧栏 ─────────────────────────────────────────────────────────
// 这段行为的难点是「区分新演示与刷新页面时重放的历史演示」，所以要分别验证。
mod.dock.close()
mod.dock.setAuto(true)

// ① 历史重放：卡片直接以已结算状态挂载，且距页面加载不足 1.8s ⇒ 不该抢侧栏
const replayHtml = render('卡片（历史重放）', React.createElement(mod.DemoToolView, { callId: 'replay-1', toolName: 'tutor_visualize', block: settledBlock }))
ok('历史重放的卡片不自动占用侧栏', mod.dock.state.open === false)
ok('未进侧栏时卡片自己渲染画布', replayHtml.includes('hst_frame') || replayHtml.includes('hst_frameSkeleton'))

// ② 当场生成：先以「运行中」渲染一次（留下记号），再结算 ⇒ 应自动进侧栏
render('卡片（运行中）', React.createElement(mod.DemoToolView, { callId: 'live-1', toolName: 'tutor_visualize', block: { running: true } }))
renderToStaticMarkup(React.createElement(mod.DemoToolView, { callId: 'live-1', toolName: 'tutor_visualize', block: settledBlock }))
// 静态渲染不跑 effect，这里直接验证判定函数与 dock 行为的组合结果
mod.dock.show({ id: 'dm_x', callId: 'live-1', title: '二次函数最值', kind: 'plot2d', keySteps: settledBlock.meta.keySteps, scene })
ok('侧栏被打开且记住了来源 callId', mod.dock.state.open === true && mod.dock.state.demo.callId === 'live-1')
ok('dock.showing() 能识别「这张卡正在侧栏显示」', mod.dock.showing('live-1') === true && mod.dock.showing('other') === false)

// ③ 已在侧栏时，卡片让位：不再渲染第二个 iframe
mod.dock.set({ token: 'dock-9' })
const dockedHtml = render('卡片（已在侧栏 → 让位）', React.createElement(mod.DemoToolView, { callId: 'live-1', toolName: 'tutor_visualize', block: settledBlock }))
ok('让位后不再渲染画布（同一场景不画两遍）', !dockedHtml.includes('hst_frame'))
ok('让位后提示「正在右侧栏显示」', dockedHtml.includes('正在右侧栏显示'))
ok('让位后按钮变成「收起侧栏」', dockedHtml.includes('收起侧栏') && !dockedHtml.includes('侧栏展开'))
ok('让位后仍列出重点步骤（点它驱动侧栏跳步）', dockedHtml.includes('读出顶点'))
ok('让位态带专用样式类', dockedHtml.includes('hst_toolCardDocked'))

// ④ 关掉自动后不再抢侧栏
mod.dock.close()
mod.dock.setAuto(false)
ok('关掉「自动」后偏好被记住', mod.dock.state.auto === false)
mod.dock.setAuto(true)
ok('重新打开「自动」', mod.dock.state.auto === true)

// ⑤ 自动推送的判定逻辑（纯函数，可注入时间——静态渲染跑不到 effect）
{
  const A = mod.autoDock
  const T0 = A.bootAt
  A.reset()
  mod.dock.setAuto(true)
  ok('初始重放窗口内、没跑过运行态 ⇒ 不自动推送', A.should('c1', T0 + 500) === false)
  ok('超过重放窗口 ⇒ 自动推送', A.should('c1', T0 + A.quietMs + 1) === true)
  A.reset()
  A.markRunning('c2')
  ok('见过运行态 ⇒ 立刻自动推送（哪怕还在重放窗口内）', A.should('c2', T0 + 100) === true)
  A.markShown('c2')
  ok('推送过一次就不再重复（卡片重挂载不会反复弹）', A.should('c2', T0 + 99999) === false)
  A.reset()
  mod.dock.setAuto(false)
  ok('关掉「自动」后一律不推送', A.should('c3', T0 + 99999) === false)
  mod.dock.setAuto(true)
  ok('重新开启后恢复推送', A.should('c3', T0 + 99999) === true)
  A.reset()
}

// ⑥ 侧栏头部有「自动」开关
mod.dock.show({ id: 'dm_y', callId: 'live-2', title: '演示', kind: 'plot2d', keySteps: [], scene })
const dockUi = render('侧栏（含自动开关）', React.createElement(mod.TutorDock))
ok('侧栏头部提供「自动」勾选框', dockUi.includes('自动') && dockUi.includes('type="checkbox"'))
mod.dock.close()

// 停靠面板：默认关闭 → 空；show() 之后渲染出面板
const dockClosed = render('侧栏面板（关闭态）', React.createElement(mod.TutorDock))
ok('未打开时不渲染任何东西', dockClosed === '')
mod.dock.show({ id: 'dm_0001', title: '二次函数最值', kind: 'plot2d', keySteps: [{ index: 2, title: '读出顶点' }], scene })
const dockOpen = render('侧栏面板（打开态）', React.createElement(mod.TutorDock))
ok('打开后显示标题与关闭按钮', dockOpen.includes('二次函数最值') && dockOpen.includes('关闭'))
ok('面板带宽度拖拽手柄', dockOpen.includes('hst_dockGrip'))
ok('面板宽度在合理区间', mod.dock.state.width >= 320 && mod.dock.state.width <= 760, String(mod.dock.state.width))
mod.dock.close()
ok('close() 后回到关闭态', mod.dock.state.open === false)

render('演示标签页（首帧）', React.createElement(mod.DemosTab))

const launchWide = render('侧栏入口（展开态）', React.createElement(mod.TutorDockLauncher, { wide: true }))
ok('展开态显示文字标签', launchWide.includes('hst_launchLabel') && launchWide.includes('动态演示'))
ok('展开态是一整行按钮', launchWide.includes('hst_launch') && !launchWide.includes('hst_launchRail'))
const launchRail = render('侧栏入口（56px 轨道态）', React.createElement(mod.TutorDockLauncher, { wide: false }))
ok('轨道态只画图标（无文字标签元素，title 提示仍保留）', launchRail.includes('hst_launchRail') && !launchRail.includes('hst_launchLabel') && launchRail.includes('title='))
ok('轨道态图标更大（18 对 16）', launchRail.includes('width="18"') && launchWide.includes('width="16"'))

// ── 资料导入页签 ────────────────────────────────────────────────────────────
{
  const docsHtml = render('资料页签（首帧）', React.createElement(mod.DocsTab))
  ok('提供文件选择框并限定可用扩展名', docsHtml.includes('type="file"') && docsHtml.includes('.docx'))
  ok('提供粘贴文本的入口', docsHtml.includes('粘贴') || docsHtml.includes('textarea'))
  ok('提供模式/学科/知识点/来源四个选项', docsHtml.includes('自动判断') && docsHtml.includes('试卷（切题')
    && docsHtml.includes('统一知识点') && docsHtml.includes('来源'))
  ok('先解析预览、不直接入库（按钮文案即契约）', docsHtml.includes('解析预览') && !docsHtml.includes('直接导入'))
  ok('说明里点出 PDF 的替代路径', docsHtml.includes('先转 docx') || docsHtml.includes('PDF'))
  ok('面板把「资料」列入标签页', React.createElement(mod.TutorPanel) !== null)
}

// 主题桥接：把宿主令牌翻译成帧内变量
const theme = mod.resolveTheme()
ok('主题桥输出必需的颜色变量', ['fg', 'fg2', 'bg', 'line', 'brand', 'bad', 'warn'].every((k) => typeof theme[k] === 'string' && theme[k] !== ''))
ok('主题桥给出 color-scheme', theme.scheme === 'light' || theme.scheme === 'dark')

console.log(`\n${failures.length === 0 ? '✅' : '❌'} 通过 ${passed} 项${failures.length > 0 ? `，失败 ${failures.length} 项：\n  - ${failures.join('\n  - ')}` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
