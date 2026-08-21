// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 全功能自检（node scripts/selfcheck.mjs）。
 *
 * 与三套冒烟测试的分工：
 *   smoke / frame-smoke / client-smoke  逐个函数、逐条断言地验证**实现细节**；
 *   本脚本                              走一遍**用户会走的真实链路**，按功能模块出一张
 *                                       通过/失败矩阵——用来回答「全功能是否正常」。
 *
 * 它不 mock 任何东西：真的建数据目录、真的写 JSON、真的调工具、真的走 HTTP 处理器、
 * 真的把九种场景逐步渲染一遍。跑完自动清理临时目录。
 *
 * 用法：
 *   node scripts/selfcheck.mjs          # 全部模块
 *   node scripts/selfcheck.mjs --live   # 额外探测运行中的 dsh web（默认 127.0.0.1:3080）
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 先记下真实的 DSH_HOME：下面会把它指向临时目录（免得污染真实题库），
// 但 react / react-dom 仍要从真实 profile 里解析。
const realHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
const workdir = mkdtempSync(join(tmpdir(), 'hst-selfcheck-'))
process.env.DSH_HOME = workdir

// 第 ⑦ 节会把 globalThis.fetch 换成桩去测客户端包；先把真货存下来，
// 否则第 ⑩ 节的线上探测会拿到桩返回的假 200——那种「报假通过」比没有检查更糟。
const realFetch = globalThis.fetch.bind(globalThis)

const require_ = createRequire(import.meta.url)
const reactPaths = [
  ...(process.env.HST_REACT_PATHS ?? '').split(':').filter((p) => p !== ''),
  join(realHome, 'profiles', 'web'),
  '/Users/Apple/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh',
]
let reactMod = null
try {
  reactMod = require_(require_.resolve('react', { paths: reactPaths }))
} catch {
  reactMod = null
}

const rows = []
let failed = 0

/**
 * 记录一项功能检查。
 * @param {string} area 功能模块。
 * @param {string} name 检查项。
 * @param {boolean} pass 是否通过。
 * @param {string} [detail] 细节（成功时也打印，便于人工核对数值）。
 * @returns {void}
 */
function check(area, name, pass, detail = '') {
  if (!pass) failed += 1
  rows.push({ area, name, pass, detail })
}

/** 打印矩阵。 */
function report() {
  let area = ''
  for (const row of rows) {
    if (row.area !== area) {
      area = row.area
      console.log(`\n${area}`)
    }
    console.log(`  ${row.pass ? '✓' : '✗'} ${row.name.padEnd(34, '　')} ${row.detail}`)
  }
}

const { Store } = await import('../lib/store.js')
const { createTools } = await import('../lib/tools.js')
const { createApiHandler, API_PREFIX } = await import('../lib/api.js')
const { mastery, schedule, newSrs } = await import('../lib/srs.js')
const { seedItems } = await import('../lib/seed.js')
const { parseImport } = await import('../lib/importer.js')
const { normalizeScene, SCENE_KINDS, keySteps } = await import('../lib/scene.js')
const { EXAMPLES } = await import('../lib/examples.js')
const { SHOWCASE } = await import('../lib/showcase.js')
const { frameDocument, panelDocument, frameRuntime, frameVersion } = await import('../lib/frame/index.js')
const { extractText } = await import('../lib/docs.js')
const { parsePaper, parseCourseware } = await import('../lib/paper.js')
const { makeDocx, makePptx, SAMPLE_PAPER } = await import('./fixtures.mjs')

const store = new Store(join(workdir, 'data'))
const tools = createTools(store)
const callTool = async (name, args = {}) => JSON.parse(await tools.find((t) => t.name === name).execute(args))

// ── ⓿ 插件规范合规（对齐 DSH 官方插件的组织约定）─────────────────────────────
{
  const root = join(import.meta.dirname, '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const entrySrc = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  const clientSrc = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

  check('⓿ 插件规范合规', 'type: module（宿主按 ESM 加载 host 半边）', pkg.type === 'module')
  check('⓿ 插件规范合规', 'main 指向 host 入口', pkg.main === './lib/index.js', pkg.main)
  check('⓿ 插件规范合规', 'exports 提供 . / ./client / ./package.json',
    ['.', './client', './package.json'].every((k) => pkg.exports?.[k] !== undefined), Object.keys(pkg.exports ?? {}).join(' '))
  check('⓿ 插件规范合规', 'dsh.client.platform 为字符串', typeof pkg.dsh?.client?.platform === 'string', pkg.dsh?.client?.platform)
  check('⓿ 插件规范合规', 'dsh.client.inject 为字符串数组',
    Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.every((x) => typeof x === 'string'),
    `[${pkg.dsh?.client?.inject?.join(' ') ?? ''}]（本包只 require 平台种子模块 react，故为空是正确的）`)
  check('⓿ 插件规范合规', 'dsh.bundle.patch 指向存在的补丁文件',
    typeof pkg.dsh?.bundle?.patch === 'string' && readFileSync(join(root, pkg.dsh.bundle.patch), 'utf8').includes('insert'))
  check('⓿ 插件规范合规', 'files 白名单只发布 lib 与补丁',
    Array.isArray(pkg.files) && pkg.files.includes('lib') && !pkg.files.includes('docs'), (pkg.files ?? []).join(' '))
  check('⓿ 插件规范合规', 'peerDependencies 声明宿主提供的运行时',
    pkg.peerDependencies?.react !== undefined, Object.keys(pkg.peerDependencies ?? {}).join(' '))

  // host 入口：具名导出、无 default
  const entry = await import('../lib/index.js')
  check('⓿ 插件规范合规', 'host 入口无 default 导出', entry.default === undefined)
  check('⓿ 插件规范合规', 'host 入口导出 name / inject / apply',
    typeof entry.name === 'string' && Array.isArray(entry.inject) && typeof entry.apply === 'function',
    `name=${entry.name} inject=[${entry.inject.join(' ')}]`)
  check('⓿ 插件规范合规', 'host 入口未用 export default 语法', !/export\s+default/.test(entrySrc))

  // 客户端半边：官方线格式
  check('⓿ 插件规范合规', 'client 半边用 __ModuleLoader__.load 注册',
    clientSrc.includes('window.__ModuleLoader__.load('))
  check('⓿ 插件规范合规', 'client 注册 id 等于包名',
    clientSrc.includes(`id: '${pkg.name}'`), pkg.name)
  check('⓿ 插件规范合规', 'client 声明 cordis 服务依赖',
    /const inject = \['slots'\]/.test(clientSrc))

  // 最关键的一条：out-of-tree 插件（link:/路径安装）不能裸导入宿主包，
  // 否则 Node 按真实路径解析符号链接会直接 ERR_MODULE_NOT_FOUND，插件整个加载不起来。
  const libFiles = [...readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => join('lib', f)),
    ...readdirSync(join(root, 'lib', 'frame')).filter((f) => f.endsWith('.js')).map((f) => join('lib', 'frame', f))]
  const bareHostImports = []
  for (const rel of libFiles) {
    const src = readFileSync(join(root, rel), 'utf8')
    for (const m of src.matchAll(/(?:^|\n)\s*import[^\n]*from\s+'([^']+)'/g)) {
      const spec = m[1]
      if (!spec.startsWith('.') && !spec.startsWith('node:')) bareHostImports.push(`${rel}→${spec}`)
    }
  }
  check('⓿ 插件规范合规', '零外部 import（只用 node: 内置与相对路径）',
    bareHostImports.length === 0, bareHostImports.join(' ') || `${libFiles.length} 个文件全部自足`)

  // 许可
  const license = readFileSync(join(root, 'LICENSE'), 'utf8')
  check('⓿ 插件规范合规', 'LICENSE 为 GPL-3.0 完整全文',
    license.includes('GNU GENERAL PUBLIC LICENSE') && license.includes('Version 3, 29 June 2007')
    && license.includes('END OF TERMS AND CONDITIONS'), `${license.split('\n').length} 行`)
  check('⓿ 插件规范合规', 'package.json license 为 SPDX 标识',
    pkg.license === 'GPL-3.0-or-later', pkg.license)
  const missingHeader = [...libFiles, ...readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => join('scripts', f))]
    .filter((rel) => !readFileSync(join(root, rel), 'utf8').startsWith('// SPDX-License-Identifier: GPL-3.0-or-later'))
  check('⓿ 插件规范合规', '每个源文件都带 SPDX 许可头', missingHeader.length === 0, missingHeader.join(' ') || '全部就位')
  // 版权行必须真实：既不能留占位符，也不能是空行（GPL 要求版权声明准确）
  const holder = /Copyright \(C\) \d{4} (\S+)/.exec(readFileSync(join(root, 'lib', 'index.js'), 'utf8'))?.[1] ?? null
  check('⓿ 插件规范合规', '版权行已填写且一致',
    holder !== null && !/PLACEHOLDER|占位|TODO:/.test(holder)
    && libFiles.every((rel) => readFileSync(join(root, rel), 'utf8').includes(`Copyright (C) 2026 ${holder}`)),
    holder === null ? '找不到版权行' : `持有人 ${holder}`)
}

// ── ① 学情与排期 ──────────────────────────────────────────────────────────────
{
  const profile = store.saveProfile({ grade: 'g2', dailyReviewTarget: 40, newPerDay: 20 })
  check('① 学情与复习排期', '设置年级并推算高考日期', /^\d{4}-06-07$/.test(profile.examDate), profile.examDate)
  const overview = store.overview()
  check('① 学情与复习排期', '高考倒计时', overview.countdown.days > 0, `${overview.countdown.days} 天`)

  const seeded = store.upsertItems(seedItems())
  check('① 学情与复习排期', '导入内置卡片包（60 张）', seeded.added.length === 60, `${seeded.added.length} 张`)
  const again = store.upsertItems(seedItems())
  check('① 学情与复习排期', '重复导入按 seedKey 幂等', again.added.length === 0 && again.updated.length === 60)

  const queue = store.queue({ limit: 8 })
  check('① 学情与复习排期', '今日队列受每日新卡上限约束', queue.items.length === 8 && queue.counts.newBudget === 20, `取 ${queue.items.length} / 余额 ${queue.counts.newBudget}`)

  const first = queue.items[0]
  const graded = store.review([{ id: first.id, grade: 'good' }])
  check('① 学情与复习排期', 'good 评分推进到下一档', graded.results[0].intervalDays === 1, `间隔 ${graded.results[0].intervalDays} 天`)
  const wrong = store.review([{ id: first.id, grade: 'again' }])
  check('① 学情与复习排期', 'again 当天重练（20 分钟后）', wrong.results[0].intervalDays === 0 && wrong.results[0].state === 'learning')
  const ladder = []
  let srs = newSrs(Date.now())
  for (let i = 0; i < 6; i += 1) { srs = schedule(srs, 'good', Date.now()).srs; ladder.push(srs.intervalDays) }
  check('① 学情与复习排期', '艾宾浩斯阶梯递增', ladder.every((v, i) => i === 0 || v > ladder[i - 1]), ladder.join('→'))
  check('① 学情与复习排期', '掌握度可计算', mastery(store.db().items[0], Date.now()) >= 0)

  store.logStudy({ subject: 'math', minutes: 45, note: '导数含参讨论' })
  store.logStudy({ subject: 'chemistry', minutes: 30, chapter: '化学反应速率与化学平衡' })
  const after = store.overview()
  check('① 学情与复习排期', '学习时长与连续天数', after.study.minutes === 75 && after.study.streak >= 1, `${after.study.minutes} 分钟 / 连续 ${after.study.streak} 天`)
  store.saveExam({ name: '期中', date: '2026-04-10', scores: [{ subject: 'math', score: 128 }, { subject: 'physics', score: 82 }] })
  const stats = store.stats(14)
  check('① 学情与复习排期', '模考成绩与趋势', stats.examTrend.length === 1 && stats.examTrend[0].total === 210, `总分 ${stats.examTrend[0].total}`)
  check('① 学情与复习排期', '薄弱知识点聚合', store.weakTopics(5).length > 0, `${store.weakTopics(5).length} 项`)
}

// ── ② 四种格式的文本导入 ─────────────────────────────────────────────────────
{
  const cases = [
    ['Markdown 问答块', '## 物理\n### 抛体运动\nQ: 平抛落地时间由什么决定？\nA: 只由高度决定\n解析: t=√(2h/g)\n#易错\n---'],
    ['CSV（中文表头）', '学科,题干,答案\n化学,乙烯使溴水褪色属于什么反应,加成反应'],
    ['Markdown 表格', '| 题干 | 答案 |\n|---|---|\n| 勒夏特列原理 | 平衡向减弱改变的方向移动 |'],
    ['Anki TSV', '#separator:tab\n正面\t背面\t标签\n虚拟语气\twere/had done\t语法'],
  ]
  for (const [label, text] of cases) {
    const parsed = parseImport(text)
    check('② 文本导入（四格式）', label, parsed.items.length >= 1 && parsed.items[0].question !== '', `${parsed.format} · ${parsed.items.length} 条`)
  }
}

// ── ③ 电子资料导入 ───────────────────────────────────────────────────────────
{
  const docx = extractText(makeDocx(SAMPLE_PAPER), '期中数学.docx')
  check('③ 电子资料导入', 'docx 抽取正文', docx.ok && docx.text.includes('设集合A={1,2,3}'), `${docx.text.split('\n').length} 行`)
  const paper = parsePaper(docx.text, { source: '期中数学' })
  check('③ 电子资料导入', '试卷切题', paper.items.length === 7, `${paper.items.length} 题`)
  check('③ 电子资料导入', '文末答案按题号回填', paper.stats.withAnswer === 7, `${paper.stats.withAnswer}/7`)
  check('③ 电子资料导入', '选择题识别（无「角A、B、C」误判）', paper.stats.choice === 3, `${paper.stats.choice} 题`)
  check('③ 电子资料导入', '可信度闸门放行真试卷', paper.confidence === 'high')
  const junk = parsePaper('127.0.0.1 localhost\n255.255.255.255 x\n0.0.0.0 y')
  check('③ 电子资料导入', '可信度闸门拦住非试卷', junk.confidence === 'low', junk.confidenceReasons[0] ?? '')
  const pptx = extractText(makePptx([['化学平衡', '三因素'], ['原理', '减弱改变'], ['谢谢']]), '课件.pptx')
  const cards = parseCourseware(pptx.text)
  check('③ 电子资料导入', 'pptx 按页转知识卡', cards.items.length === 2 && cards.stats.skipped === 1, `${cards.items.length} 卡 / 跳过 ${cards.stats.skipped}`)
  const gbk = extractText(Buffer.from([0xb8, 0xdf, 0xd6, 0xd0, 0xca, 0xfd, 0xd1, 0xa7]), '卷.txt')
  check('③ 电子资料导入', 'GBK 中文文本正确解码', gbk.text === '高中数学', `${gbk.encoding} → ${gbk.text}`)
  for (const [name, bytes, keyword] of [
    ['PDF 指路（转 docx）', Buffer.from('%PDF-1.7 x'), 'docx'],
    ['图片指路（走 OCR）', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), 'OCR'],
  ]) {
    const r = extractText(bytes, name.includes('PDF') ? 'a.pdf' : 'a.png')
    check('③ 电子资料导入', name, r.ok === false && r.hint.includes(keyword))
  }
}

// ── ④ 动态演示引擎 ───────────────────────────────────────────────────────────
{
  // 用与浏览器一致的方式加载：整段拼接后一次执行
  class Rec {
    constructor() { this.calls = []; this.texts = [] }
    setTransform() {} save() {} restore() {} clearRect() {} beginPath() {} closePath() {}
    moveTo(x, y) { this.calls.push([x, y]) } lineTo(x, y) { this.calls.push([x, y]) }
    arc(x, y, r) { this.calls.push([x, y, r]) } rect() {} fill() {} stroke() {}
    fillRect(x, y, w, h) { this.calls.push([x, y, w, h]) } setLineDash() {} clip() {}
    fillText(t, x, y) { this.calls.push([x, y]); this.texts.push(String(t)) }
    measureText(t) { return { width: String(t).length * 7 } }
    createRadialGradient() { return { addColorStop() {} } }
    createLinearGradient() { return { addColorStop() {} } }
  }
  const mk = (tag) => ({
    tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {} }, attributes: [],
    _l: {}, _t: '', _c: '', clientWidth: 660, disabled: false, checked: true, value: '',
    classList: { _s: new Set(), add() {}, remove() {}, contains: () => false },
    get className() { return this._c }, set className(v) { this._c = String(v) },
    get textContent() { return this._t }, set textContent(v) { this._t = v == null ? '' : String(v); this.children.length = 0 },
    get innerHTML() { return this._h ?? '' }, set innerHTML(v) { this._h = String(v ?? '') },
    appendChild(c) { this.children.push(c); return c }, replaceChild(a, b) { return b },
    querySelectorAll: () => [], setAttribute() {},
    addEventListener(k, f) { (this._l[k] = this._l[k] ?? []).push(f) },
    getContext() { return this._ctx ?? (this._ctx = new Rec()) },
  })
  const makeEnv = () => {
    const root = mk('div')
    const doc = { documentElement: mk('html'), head: mk('head'), body: mk('body'), createElement: mk, getElementById: (i) => (i === 'hst-root' ? root : null), addEventListener() {} }
    doc.documentElement.scrollHeight = 560
    doc.body.scrollHeight = 560
    const msgs = []
    const win = { devicePixelRatio: 1, _l: {}, addEventListener(k, f) { (win._l[k] = win._l[k] ?? []).push(f) }, removeEventListener() {}, requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }
    const g = { document: doc, window: win, parent: { postMessage: (m) => msgs.push(m) }, getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: () => 0, setTimeout, clearTimeout, setInterval: () => 0, clearInterval, devicePixelRatio: 1 }
    g.globalThis = g
    new Function('globalThis', 'window', 'document', 'parent', 'getComputedStyle', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'devicePixelRatio', frameRuntime().source)(
      g, win, doc, g.parent, g.getComputedStyle, () => 0, setTimeout, clearTimeout, () => 0, clearInterval, 1)
    return { g, win, msgs }
  }

  const { g } = makeEnv()
  check('④ 动态演示引擎', '引擎整段拼接后可执行', typeof g.__HST__?.mount === 'function' && Object.keys(g.__HST__.kinds).length === 9, `${Object.keys(g.__HST__.kinds).length} 种场景`)

  // 九种场景（examples）+ 七份完整演示（showcase）逐步渲染
  const all = [
    ...Object.entries(EXAMPLES).map(([k, s]) => [`样例 ${k}`, s]),
    ...SHOWCASE.map((s) => [`演示 ${s.id}`, s.scene]),
  ]
  let minOps = Infinity
  let nanHit = null
  let stepsTotal = 0
  for (const [label, raw] of all) {
    const { scene, warnings } = normalizeScene(raw)
    if (warnings.length > 0) check('④ 动态演示引擎', `${label} 零警告`, false, warnings[0])
    const env = makeEnv()
    const player = env.g.__HST__.mount({ mode: 'panel', scene })
    const ctx = player.canvas._ctx
    for (let i = 0; i < scene.steps.length; i += 1) {
      const before = ctx.calls.length
      player.go(i)
      minOps = Math.min(minOps, ctx.calls.length - before)
      stepsTotal += 1
    }
    if (nanHit === null) {
      nanHit = ctx.calls.find((c) => c.some((v) => typeof v === 'number' && !Number.isFinite(v))) ?? null
    }
  }
  // 阈值取 8 而不是更高：有些步骤刻意只显示一两个对象（如议论文骨架第 1 步只给材料框），
  // 那是设计意图而非缺陷；这里只要求「每一步都确实画了东西」。
  check('④ 动态演示引擎', `${all.length} 份场景 × 全部步骤渲染`, minOps > 8, `共 ${stepsTotal} 步，最少 ${minOps} 次绘制`)
  check('④ 动态演示引擎', '绘制坐标无 NaN/Infinity', nanHit === null)

  // 关键计算能力
  const NS = g.__HST__
  check('④ 动态演示引擎', '表达式求值（含隐式乘法、绝对值）',
    Math.abs(NS.expr.compile('2x+|x-3|')({ x: 1 }) - 4) < 1e-9)
  check('④ 动态演示引擎', '数值求导（切线斜率）',
    Math.abs(NS.expr.derivative(NS.expr.compile('x^3'), 2) - 12) < 1e-3)
  const cube = NS.geom3.buildSolid({ shape: 'cube', w: 2 })
  const hex = NS.geom3.sectionPolygon(cube.verts, cube.edges, [1, 1, 1], [0, 0, 0])
  check('④ 动态演示引擎', '截面求交（体对角线中截面为正六边形）', hex.length === 6)
  const tetra = NS.vseprDirs('tetrahedral')
  check('④ 动态演示引擎', 'VSEPR 键角 109.47°',
    Math.abs(Math.acos(NS.v3.dot(NS.v3.norm(tetra[0]), NS.v3.norm(tetra[1]))) * 180 / Math.PI - 109.47) < 0.1)
  const nacl = NS.latticeCount(NS.latticePreset('nacl').atoms)
  check('④ 动态演示引擎', '晶胞微粒数（NaCl 4:4）', nacl.Na === 4 && nacl.Cl === 4)

  // 独立窗口页面实跑
  const envP = makeEnv()
  const byId = {}
  for (const id of ['title', 'state', 'dot', 'empty', 'follow', 'recent', 'hst-root']) byId[id] = mk('div')
  byId.follow.checked = true
  envP.g.document.getElementById = (i) => byId[i] ?? null
  const bc = []
  class FakeChannel { constructor(n) { this.name = n; FakeChannel.last = this } postMessage(m) { bc.push(m) } }
  const scripts = [...panelDocument().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  let panelErr = null
  try {
    new Function('globalThis', 'window', 'document', 'location', 'URLSearchParams', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'BroadcastChannel', scripts[scripts.length - 1])(
      envP.g, envP.g.window, envP.g.document, { search: '' }, URLSearchParams,
      async () => ({ json: async () => ({ demos: [] }) }), setTimeout, () => 0, clearTimeout, clearInterval, FakeChannel)
  } catch (err) { panelErr = err }
  check('④ 动态演示引擎', '独立窗口页面可运行', panelErr === null, panelErr?.message ?? '')
  if (panelErr === null) {
    FakeChannel.last.onmessage({ data: { t: 'scene', demo: { id: 'x', title: '测试', scene: normalizeScene(EXAMPLES.mech2d).scene } } })
    check('④ 动态演示引擎', '独立窗口收到广播即挂载', envP.g.__HST__.player !== null && byId.title.textContent.includes('测试'))
  }
  check('④ 动态演示引擎', '帧文档自带 CSP 且引擎内联', frameDocument().includes('Content-Security-Policy') && frameDocument().includes('__HST__'))
}

// ── ⑤ 十四个模型工具 ─────────────────────────────────────────────────────────
{
  check('⑤ 模型工具（14 个）', '工具数量与命名', tools.length === 14 && tools.every((t) => t.name.startsWith('tutor_')), tools.length)
  const paperPath = join(workdir, '一模.docx')
  writeFileSync(paperPath, makeDocx(SAMPLE_PAPER))
  const probes = [
    ['tutor_dashboard', {}, (r) => r.summary.includes('距高考')],
    ['tutor_add_items', { items: [{ subject: 'math', question: '自检题', answer: '自检答案' }] }, (r) => r.added.length === 1],
    ['tutor_search_items', { query: '自检' }, (r) => r.total >= 1],
    ['tutor_review_queue', { limit: 3 }, (r) => r.items.length > 0 && r.gradeGuide !== undefined],
    ['tutor_study_log', { subject: 'english', minutes: 20 }, (r) => r.summary.includes('记录成功')],
    ['tutor_exam_record', { name: '自检模考', scores: [{ subject: 'math', score: 130 }] }, (r) => r.exam.total === 130],
    ['tutor_settings', {}, (r) => r.profile.grade === 'g2'],
    ['tutor_syllabus', { subject: 'chemistry' }, (r) => r.modules.length > 0],
    ['tutor_import', { text: 'Q: 自检导入\nA: 好', dryRun: true }, (r) => r.count === 1],
    ['tutor_scene_guide', { kind: 'geom3d' }, (r) => r.fields.section !== undefined],
    ['tutor_visualize', { scene: EXAMPLES.plot2d, persist: false }, (r) => r.ok && r.steps === 5],
    ['tutor_paper_import', { path: paperPath, dryRun: true }, (r) => r.stats.withAnswer === 7],
  ]
  for (const [name, args, ok] of probes) {
    let pass = false
    let detail = ''
    try {
      const r = await callTool(name, args)
      pass = ok(r)
      detail = String(r.summary ?? '').slice(0, 46)
    } catch (err) { detail = `抛错 ${err.message}` }
    check('⑤ 模型工具（14 个）', name, pass, detail)
  }
  // 复习翻卡：把今日到期题打包成对话卡片（题目/答案/每档评分预览齐全）
  const deck = await callTool('tutor_review_deck', { limit: 2 })
  const deckMeta = tools.find((t) => t.name === 'tutor_review_deck').output.presentationMeta({ limit: 2 }, deck)
  check('⑤ 模型工具（14 个）', 'tutor_review_deck',
    deck.items.length > 0
      && deck.items.every((it) => typeof it.question === 'string' && it.preview !== undefined && it.preview.good !== undefined)
      && deckMeta !== null && deckMeta.kind === 'hst-deck' && deckMeta.items.length === deck.items.length,
    `打包 ${deck.items.length} 张`)
  // 讲题卡投影：带 item 时题目/答案/评分预览进 meta，卡片可直接翻面评分
  const viz = await callTool('tutor_visualize', {
    scene: EXAMPLES.plot2d,
    persist: false,
    item: { subject: 'math', topic: '自检', question: '自检卡题干', answer: '自检卡答案', explanation: '自检解析' },
  })
  const vizMeta = tools.find((t) => t.name === 'tutor_visualize').output.presentationMeta({}, viz)
  check('⑤ 模型工具（14 个）', 'tutor_visualize 讲题卡投影',
    vizMeta.question === '自检卡题干' && vizMeta.answer === '自检卡答案'
      && vizMeta.itemId === (viz.item?.id ?? null) && vizMeta.itemPreview !== null,
    vizMeta.itemId ?? '无')
  const queue = await callTool('tutor_review_queue', { limit: 2 })
  const grade = await callTool('tutor_grade_review', { grades: queue.items.map((i) => ({ id: i.id, grade: 'good' })) })
  check('⑤ 模型工具（14 个）', 'tutor_grade_review', grade.results.length === queue.items.length, grade.summary.slice(0, 46))
}

// ── ⑥ HTTP 路由 ──────────────────────────────────────────────────────────────
{
  const handler = createApiHandler(store, { mastery, logger: { warn() {} } })
  const call = (method, path, body) => new Promise((resolve) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = { method, url: API_PREFIX + path, [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c } }
    let status = 0
    let headers = {}
    let text = ''
    handler(req, { writeHead: (s, h) => { status = s; headers = h ?? {} }, end: (b) => { text = b ?? ''; resolve({ status, headers, text }) } })
  })
  const gets = ['/overview', '/meta', '/items', '/queue', '/stats?days=7', '/profile', '/exams', '/progress', '/syllabus', '/export', '/demos', '/docs/formats', '/frame.html', '/frame.js', '/panel.html']
  const bad = []
  for (const path of gets) {
    const r = await call('GET', path)
    if (r.status !== 200) bad.push(`${path}=${r.status}`)
  }
  check('⑥ HTTP 路由', `${gets.length} 条 GET 全部 200`, bad.length === 0, bad.join(' ') || gets.length + ' 条')
  const posts = [
    ['/items', { items: [{ subject: 'geography', question: '路由自检', answer: 'ok' }] }],
    ['/studylog', { subject: 'geography', minutes: 5 }],
    ['/exams', { exam: { name: '路由自检', scores: [{ subject: 'geography', score: 88 }] } }],
    ['/import', { text: 'Q: 路由导入\nA: 好', dryRun: true }],
    ['/demos', { scene: { kind: 'diagram2d', title: '路由存图', objects: [{ type: 'box', x: 50, y: 20, text: 'x' }], steps: [] } }],
    ['/docs/parse', { text: '1．路由切题（　　）\nA．甲\tB．乙\n参考答案\n1．A' }],
    ['/profile', { grade: 'g3' }],
    ['/seed', {}],
  ]
  const badPost = []
  for (const [path, body] of posts) {
    const r = await call('POST', path, body)
    if (r.status !== 200 || JSON.parse(r.text).ok === false) badPost.push(`${path}=${r.status}`)
  }
  check('⑥ HTTP 路由', `${posts.length} 条 POST 全部成功`, badPost.length === 0, badPost.join(' ') || posts.length + ' 条')
  const r404 = await call('GET', '/nope')
  check('⑥ HTTP 路由', '未知路由 404 且带可读错误', r404.status === 404 && JSON.parse(r404.text).error.includes('未知路由'))
  const rExport = await call('GET', '/export')
  check('⑥ HTTP 路由', '导出 Markdown 与导入格式互逆', rExport.text.includes('Q: ') && rExport.text.includes('A: '),
    `${(rExport.text.length / 1024).toFixed(1)} KB`)
  const noStore = await call('GET', '/overview')
  check('⑥ HTTP 路由', '响应禁用缓存', String(noStore.headers['cache-control']).includes('no-store'))
}

// ── ⑦ 浏览器半边 ─────────────────────────────────────────────────────────────
if (reactMod === null) {
  check('⑦ 浏览器半边', '跳过（未在 profile 中找到 react）', true, '装入 web profile 后本节自动生效')
} else {
  const styleTags = []
  let loaded = null
  globalThis.document = {
    createElement: () => ({ dataset: {}, setAttribute() {}, set textContent(v) { this._t = v }, get textContent() { return this._t } }),
    head: { appendChild: (el) => styleTags.push(el) },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { style: { setProperty() {} } },
    body: {},
    addEventListener() {},
  }
  globalThis.window = {
    __ModuleLoader__: { load: ({ id, factory }) => { loaded = { id, exports: factory((d) => (d === 'react' ? reactMod : {})) } } },
    setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true,
    addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {} },
  }
  globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => '' })
  await import('../lib/client.js')
  check('⑦ 浏览器半边', '客户端包加载并注册模块', loaded !== null && loaded.id === '@dsh-external/dsh-highschool-tutor')
  check('⑦ 浏览器半边', '样式注入一次', styleTags.length === 1)
  const mod = loaded.exports
  const registered = []
  const injected = []
  mod.apply({
    slots: { inject: (n, cb) => { injected.push(n); cb() }, register: (o) => { registered.push(o); return () => {} } },
    inject: () => {},
  })
  const names = registered.map((r) => r.name)
  check('⑦ 浏览器半边', '注册六处 UI 插槽', registered.length === 6, names.map((n) => n.split('.').pop()).join('/'))
  check('⑦ 浏览器半边', '讲题卡/翻卡按工具名 keyed', registered.some((r) => r.name === 'tool.call.toolview' && r.key === 'tutor_visualize')
    && registered.some((r) => r.name === 'tool.call.toolview' && r.key === 'tutor_review_deck'))
  check('⑦ 浏览器半边', 'better-sidebar 为可选依赖', mod.bs.service === null && mod.bs.usable() === false)
  check('⑦ 浏览器半边', '独立窗口桥就绪', mod.panel.path === '/api/highschool-tutor/panel.html')
  check('⑦ 浏览器半边', '自动进侧栏的判定可用', typeof mod.autoDock.should === 'function' && mod.autoDock.should('x', mod.autoDock.bootAt + 9999) === true)
  const theme = mod.resolveTheme()
  check('⑦ 浏览器半边', '主题桥输出完整色板', ['fg', 'bg', 'line', 'brand', 'bad', 'warn'].every((k) => typeof theme[k] === 'string' && theme[k] !== ''))
  // 归还真实 fetch，别让桩泄漏到后面的线上探测
  globalThis.fetch = realFetch
}

// ── ⑧ 数据落盘 ───────────────────────────────────────────────────────────────
{
  const dir = join(workdir, 'data')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  check('⑧ 数据落盘', '六个数据文件齐备', files.length === 6, files.join(' '))
  let broken = []
  for (const f of files) {
    try { JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { broken.push(f) }
  }
  check('⑧ 数据落盘', '全部为合法 JSON', broken.length === 0, broken.join(' '))
  check('⑧ 数据落盘', '无 .tmp 残留（原子写完成）', readdirSync(dir).every((f) => !f.endsWith('.tmp')))
  const reopened = new Store(dir)
  check('⑧ 数据落盘', '重新打开数据一致', reopened.overview().totals.items === store.overview().totals.items,
    `${reopened.overview().totals.items} 条`)
}

// ── ⑨ 画廊产物 ───────────────────────────────────────────────────────────────
{
  const docsDir = join(import.meta.dirname, '..', 'docs')
  let pages = []
  try { pages = readdirSync(docsDir).filter((f) => f.endsWith('.html')) } catch { pages = [] }
  check('⑨ 画廊产物 docs/', '页面已生成', pages.length === SHOWCASE.length + Object.keys(EXAMPLES).length + 1, `${pages.length} 页`)
  const index = pages.includes('index.html') ? readFileSync(join(docsDir, 'index.html'), 'utf8') : ''
  const links = [...index.matchAll(/href="\.\/([a-z0-9-]+)\.html"/g)].map((m) => m[1])
  check('⑨ 画廊产物 docs/', '首页链接全部存在', links.length > 0 && links.every((l) => pages.includes(`${l}.html`)), `${links.length} 个链接`)
  check('⑨ 画廊产物 docs/', '引擎只出一份（各页共享）', pages.every((p) => p === 'index.html' || readFileSync(join(docsDir, p), 'utf8').includes('src="./hst-engine.js"')))
  const engine = readFileSync(join(docsDir, 'hst-engine.js'), 'utf8')
  check('⑨ 画廊产物 docs/', '引擎与当前源码一致', engine === frameRuntime().source, `${(engine.length / 1024).toFixed(0)} KB · 指纹 ${frameVersion()}`)
  const subjects = new Set(SHOWCASE.map((s) => normalizeScene(s.scene).scene.subject))
  check('⑨ 画廊产物 docs/', '完整演示覆盖六科', subjects.size === 6, [...subjects].join(' '))
  const kinds = new Set([...SHOWCASE.map((s) => s.scene.kind), ...Object.keys(EXAMPLES)])
  check('⑨ 画廊产物 docs/', '覆盖九种可绘制场景', kinds.size === 9, `${kinds.size} 种`)
  check('⑨ 画廊产物 docs/', '全站零外部资源请求', pages.every((p) => {
    const html = readFileSync(join(docsDir, p), 'utf8')
    return [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].every((m) => m[1].startsWith('https://github.com'))
  }))
}

// ── ⑩ 运行中的服务（可选）────────────────────────────────────────────────────
if (process.argv.includes('--live')) {
  const base = 'http://127.0.0.1:3080/api/highschool-tutor'
  const probe = async (path) => {
    try {
      const r = await realFetch(`${base}${path}`, { cache: 'no-store' })
      return { ok: r.ok, status: r.status, headers: r.headers, text: await r.text() }
    } catch (err) { return { ok: false, status: 0, text: '', error: err.message } }
  }
  const live = await probe('/overview')
  check('⑩ 运行中的 dsh web', '插件后端可达', live.ok, live.ok ? `HTTP ${live.status}` : (live.error ?? '未启动'))
  if (live.ok) {
    // 只看状态码不够：路由缺失时宿主可能仍以 JSON 形式回话，
    // 所以每条都校验响应里必须出现的特征串。
    const routes = [
      ['/frame.html', '__HST__'],
      ['/frame.js', '__HST__'],
      ['/panel.html', 'BroadcastChannel'],
      ['/demos', 'total'],
      ['/docs/formats', 'supported'],
    ]
    for (const [path, marker] of routes) {
      const r = await probe(path)
      const mounted = r.ok && r.text.includes(marker)
      check('⑩ 运行中的 dsh web', `${path} 已挂载`, mounted,
        mounted ? `HTTP ${r.status}` : `HTTP ${r.status}${r.text.includes('未知路由') ? '（未知路由——host 需重启）' : ''}`)
    }
    const frameLive = await probe('/frame.html')
    const liveVer = frameLive.headers?.get?.('x-frame-version') ?? null
    check('⑩ 运行中的 dsh web', '线上引擎与本地源码同版本', liveVer === frameVersion(),
      `线上 ${liveVer ?? '（无此响应头）'} / 本地 ${frameVersion()}`)
    const metaLive = await probe('/meta')
    let meta = null
    try { meta = JSON.parse(metaLive.text) } catch { meta = null }
    check('⑩ 运行中的 dsh web', '场景类型已暴露', meta?.scene?.kinds?.length === 10, `${meta?.scene?.kinds?.length ?? '?'} 种`)
    check('⑩ 运行中的 dsh web', '独立窗口地址与频道名已暴露',
      meta?.scene?.panelPath !== undefined && meta?.scene?.channel !== undefined,
      meta?.scene?.panelPath ?? '（缺，host 需重启）')
    check('⑩ 运行中的 dsh web', 'autoDock 配置已暴露',
      meta?.ui?.autoDock !== undefined, meta?.ui?.autoDock === undefined ? '（缺，host 需重启）' : String(meta.ui.autoDock))
  }
}

report()
rmSync(workdir, { recursive: true, force: true })
const total = rows.length
console.log(`\n${failed === 0 ? '✅' : '❌'} 全功能自检：${total - failed}/${total} 项通过${failed > 0 ? `，${failed} 项失败` : ''}`)
process.exit(failed === 0 ? 0 : 1)
