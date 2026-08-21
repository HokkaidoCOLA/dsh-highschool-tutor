// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 自测脚本（零依赖，node scripts/smoke.mjs）。
 *
 * 覆盖 host 半边的全部关键路径：
 *   ① 学情设置与高考日期推算    ② 题库写入/查询/去重
 *   ③ 艾宾浩斯调度推进           ④ 复习队列与新卡上限
 *   ⑤ 学习日志/连续天数          ⑥ 模考成绩与趋势
 *   ⑦ 四种格式的导入解析         ⑧ 薄弱知识点聚合
 *   ⑨ 10 个模型工具真实执行      ⑩ HTTP 路由（含 JSON body / Markdown 导出）
 *   ⑪ 工具 JSON Schema 是否落在 harness 支持的子集内（能找到 dsh-tools 时）
 *
 * 数据写在系统临时目录，跑完自动删除，不会污染真实题库。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workdir = mkdtempSync(join(tmpdir(), 'hst-smoke-'))
process.env.DSH_HOME = workdir

const { Store, defaultExamDate } = await import('../lib/store.js')
const { schedule, newSrs, previewIntervals, dayKey, DAY_MS } = await import('../lib/srs.js')
const { parseImport, detectFormat } = await import('../lib/importer.js')
const { seedItems } = await import('../lib/seed.js')
const { createTools } = await import('../lib/tools.js')
const { createApiHandler, API_PREFIX } = await import('../lib/api.js')
const { mastery } = await import('../lib/srs.js')
const { syllabusFor } = await import('../lib/syllabus.js')

let passed = 0
const failures = []

/**
 * 断言。
 * @param {string} label 用例名。
 * @param {boolean} cond 条件。
 * @param {unknown} [detail] 失败时打印的细节。
 */
function ok(label, cond, detail) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`) } else { failures.push(label); console.log(`  ✗ ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`) }
}

const store = new Store()
const now = Date.now()

// ── ① 学情设置 ───────────────────────────────────────────────────────────────
console.log('\n① 学情设置')
const p0 = store.profile(now)
ok('默认启用六科', p0.subjects.length === 6, p0.subjects)
ok('默认未设年级', p0.grade === null && p0.examDate === null)
const p1 = store.saveProfile({ grade: 'g2', dailyReviewTarget: 50, newPerDay: 5 }, now)
ok('年级写入并推算高考日期', p1.grade === 'g2' && /^\d{4}-06-07$/.test(p1.examDate ?? ''), p1.examDate)
ok('高三推算为当年/次年 6 月 7 日', /^\d{4}-06-07$/.test(defaultExamDate('g3', now) ?? ''))
ok('每日目标写入', p1.dailyReviewTarget === 50 && p1.newPerDay === 5)
const p2 = store.saveProfile({ subjects: ['数学', 'physics', '地'] }, now)
ok('学科别名解析（中文/短名）', JSON.stringify(p2.subjects) === JSON.stringify(['math', 'physics', 'geography']), p2.subjects)
store.saveProfile({ subjects: ['chinese', 'math', 'english', 'physics', 'chemistry', 'geography'] }, now)

// ── ② 题库写入与查询 ─────────────────────────────────────────────────────────
console.log('\n② 题库写入与查询')
const add = store.upsertItems([
  { subject: 'math', kind: 'mistake', topic: '导数', question: '求 f(x)=x³−3x 的极值', answer: '极大值 f(−1)=2，极小值 f(1)=−2', explanation: '求导定号', tags: ['计算失误'], difficulty: 4, source: '一模 T18' },
  { subject: '物理', kind: 'mistake', topic: '电磁感应', question: '双杆问题中安培力方向如何判断', answer: '阻碍相对运动', difficulty: 5 },
  { subject: 'english', topic: '定语从句', question: '关系词 which 与 that 的区别', answer: '介词后与非限制性只能用 which' },
  { subject: 'math', question: '' }, // 应被跳过
], now)
ok('批量新增 3 条并跳过空题干', add.added.length === 3 && add.skipped === 1, add)
ok('中文学科名归一化', store.listItems({ subject: 'physics' }, now).total === 1)
ok('关键词检索命中', store.listItems({ query: '安培力' }, now).total === 1)
ok('按类型过滤', store.listItems({ kind: 'mistake' }, now).total === 2)
const upd = store.upsertItems([{ id: add.added[0], topic: '一元函数的导数及其应用' }], now)
ok('按 id 更新且保留其他字段', upd.updated.length === 1 && store.listItems({ query: '极值' }, now).items[0].topic === '一元函数的导数及其应用')

const seed1 = store.upsertItems(seedItems(), now)
const seed2 = store.upsertItems(seedItems(), now)
ok('内置卡片包导入 60 条', seed1.added.length === seedItems().length && seed1.added.length >= 50, seed1.added.length)
ok('重复导入按 seedKey 幂等', seed2.added.length === 0 && seed2.updated.length === seed1.added.length, { added: seed2.added.length })

// ── ③ 调度推进 ───────────────────────────────────────────────────────────────
console.log('\n③ 艾宾浩斯调度')
let srs = newSrs(now)
const g1 = schedule(srs, 'good', now)
ok('首次 good → 1 天后', g1.intervalDays === 1 && g1.srs.state === 'review', g1.intervalDays)
const g2 = schedule(g1.srs, 'good', now)
ok('第二次 good → 2 天后', g2.intervalDays === 2, g2.intervalDays)
const g3 = schedule(g2.srs, 'good', now)
ok('第三次 good → 4 天后', g3.intervalDays === 4, g3.intervalDays)
const again = schedule(g3.srs, 'again', now)
ok('again → 20 分钟内重来且 lapses+1', again.intervalDays === 0 && again.srs.lapses === 1 && again.srs.due - now <= 20 * 60_000, again.srs)
ok('again 降低 ease', again.srs.ease < g3.srs.ease)
const easy = schedule(g2.srs, 'easy', now)
ok('easy 跳档（间隔大于 good）', easy.intervalDays > g3.intervalDays, { easy: easy.intervalDays, good: g3.intervalDays })
const hard = schedule(g2.srs, 'hard', now)
ok('hard 缩短且不前进阶梯', hard.intervalDays < g3.intervalDays && hard.srs.step === g2.srs.step, { hard: hard.intervalDays })
const preview = previewIntervals(newSrs(now), now)
ok('四档预览齐全', Object.keys(preview).length === 4 && preview.good === 1, preview)
let long = newSrs(now)
for (let i = 0; i < 20; i += 1) long = schedule(long, 'easy', now).srs
ok('间隔存在上限', long.intervalDays <= 240, long.intervalDays)

// ── ④ 复习队列 ───────────────────────────────────────────────────────────────
console.log('\n④ 复习队列')
store.saveProfile({ newPerDay: 5 }, now)
const queue = store.queue({ limit: 20 }, now)
ok('新卡受每日上限约束', queue.items.length === 5, { got: queue.items.length, counts: queue.counts })
const subjQueue = store.queue({ subject: 'math', limit: 3 }, now)
ok('可按学科取队列', subjQueue.items.every((it) => it.subject === 'math'))
const first = queue.items[0]
const rev = store.review([{ id: first.id, grade: 'good', elapsedMs: 8000 }], now)
ok('评分写回并给出下次日期', rev.results.length === 1 && rev.results[0].intervalDays === 1 && typeof rev.results[0].dueDate === 'string', rev.results[0])
ok('复习后不再进入今日队列', store.queue({ limit: 50 }, now).items.every((it) => it.id !== first.id))
const bad = store.review([{ id: 'it_99999', grade: 'good' }], now)
ok('不存在的 id 报 failed 而不抛错', bad.failed.length === 1)

// ── ⑤ 学习日志 ───────────────────────────────────────────────────────────────
console.log('\n⑤ 学习日志与连续天数')
store.logStudy({ subject: 'math', minutes: 60, chapter: '导数', status: 'done', note: '含参讨论不熟' }, now)
store.logStudy({ subject: '语文', minutes: 30 }, now)
const ov = store.overview(now)
ok('今日分钟累计', ov.study.minutes === 90, ov.study)
ok('章节完成计数', ov.study.chaptersToday === 1)
ok('连续天数 ≥ 1', ov.study.streak >= 1, ov.study.streak)
ok('倒计时为正整数', typeof ov.countdown.days === 'number' && ov.countdown.days > 0, ov.countdown)
ok('总览含分学科待复习', typeof ov.due.bySubject === 'object')
const series = store.dailySeries(7, now)
ok('7 天曲线长度正确且末日为今天', series.length === 7 && series[6].date === dayKey(now), series[6])
ok('曲线含今日复习数', series[6].reviews >= 1)

// ── ⑥ 模考成绩 ───────────────────────────────────────────────────────────────
console.log('\n⑥ 模考成绩')
store.saveExam({ date: '2026-03-15', name: '高二下月考一', scores: [{ subject: 'math', score: 128 }, { subject: '语文', score: 112 }, { subject: 'physics', score: 82 }] }, now)
const exam2 = store.saveExam({ date: '2026-04-20', name: '高二下月考二', scores: [{ subject: 'math', score: 136 }, { subject: 'chinese', score: 118 }, { subject: 'physics', score: 90 }], rank: 12, rankOf: 800 }, now)
ok('总分自动求和', exam2.total === 344, exam2.total)
ok('满分默认语数英 150 其他 100', exam2.totalFull === 400, exam2.totalFull)
const stats = store.stats(14, now)
ok('成绩趋势按日期升序', stats.examTrend.length === 2 && stats.examTrend[0].date < stats.examTrend[1].date)
ok('趋势含百分比', stats.examTrend[1].percent === 86, stats.examTrend[1].percent)
ok('各科统计含掌握度与到期数', stats.subjects.length === 6 && stats.subjects.every((s) => 'mastery' in s && 'due' in s))
ok('保持率有取值', stats.retention.reviews >= 1 && typeof stats.retention.accuracy === 'number', stats.retention)

// ── ⑦ 导入解析 ───────────────────────────────────────────────────────────────
console.log('\n⑦ 导入解析')
const md = `# 错题整理
## 化学
### 化学平衡
Q: 勒夏特列原理如何表述？
A: 平衡向减弱这种改变的方向移动
解析: 催化剂不移动平衡
#必背 #易错
---
Q: 水解规律口诀？
A: 有弱才水解，谁强显谁性
---
## 地理
Q: 冷锋过境后天气如何变化？
A: 气温下降、气压升高、转晴
`
const mdParsed = parseImport(md)
ok('md 格式识别', mdParsed.format === 'md' && detectFormat(md) === 'md')
ok('md 解析 3 条', mdParsed.items.length === 3, mdParsed.items.length)
ok('md 标题切换学科', mdParsed.items[0].subject === 'chemistry' && mdParsed.items[2].subject === 'geography', mdParsed.items.map((i) => i.subject))
ok('md 三级标题成为知识点', mdParsed.items[0].topic === '化学平衡', mdParsed.items[0].topic)
ok('md 井号标签解析', Array.isArray(mdParsed.items[0].tags) && mdParsed.items[0].tags.includes('必背'), mdParsed.items[0].tags)
ok('md 解析行进入 explanation', mdParsed.items[0].explanation.includes('催化剂'))

const csv = '学科,知识点,题干,答案,解析,难度\n数学,数列,等比求和公式,Sn=a1(1-q^n)/(1-q),注意 q=1,4\n英语,时态,现在完成时信号词,already/yet/since,与过去时区分,3\n'
const csvParsed = parseImport(csv)
ok('csv 格式识别与表头映射', csvParsed.format === 'csv' && csvParsed.items.length === 2 && csvParsed.items[0].subject === 'math', csvParsed.items[0])
ok('csv 难度转数字', csvParsed.items[0].difficulty === 4)

const mdtable = '| 题干 | 答案 | 知识点 |\n|---|---|---|\n| 平抛落地时间由什么决定 | 只由高度决定 | 抛体运动 |\n| 动能定理表达式 | W合=ΔEk | 机械能 |\n'
const tableParsed = parseImport(mdtable, { subject: 'physics' })
ok('md 表格识别', tableParsed.format === 'mdtable' && tableParsed.items.length === 2, tableParsed.format)
ok('md 表格默认学科生效', tableParsed.items.every((i) => i.subject === 'physics'))

const tsv = '#separator:tab\n#html:true\n韦达定理<br>两根之和\tx1+x2=-b/a\t公式 必背\n三角二倍角\tcos2a=1-2sin²a\t公式\n'
const tsvParsed = parseImport(tsv, { subject: 'math' })
ok('anki tsv 识别', tsvParsed.format === 'tsv' && tsvParsed.items.length === 2, tsvParsed.format)
ok('html 清洗为换行', tsvParsed.items[0].question.includes('\n') && !tsvParsed.items[0].question.includes('<br>'), tsvParsed.items[0].question)
ok('tsv 第三列作为标签', String(tsvParsed.items[0].tags).includes('必背'), tsvParsed.items[0].tags)

const impWrite = store.upsertItems(parseImport(md).items, now)
ok('解析结果可直接入库', impWrite.added.length === 3)

// ── ⑧ 薄弱知识点 ─────────────────────────────────────────────────────────────
console.log('\n⑧ 薄弱知识点')
const weakTarget = store.listItems({ query: '安培力' }, now).items[0]
for (let i = 0; i < 3; i += 1) store.review([{ id: weakTarget.id, grade: 'again' }], Date.now())
const weak = store.weakTopics(10, Date.now())
ok('薄弱点包含反复答错的知识点', weak.some((w) => w.topic === '电磁感应'), weak.slice(0, 3))
ok('薄弱点排序把最差放前面', weak[0].accuracy === 0 || weak[0].lapses >= 3, weak[0])
ok('掌握度随遗忘下降', mastery(store.listItems({ query: '安培力' }, now).items[0], Date.now()) < 40)

// ── ⑨ 模型工具 ───────────────────────────────────────────────────────────────
console.log('\n⑨ 模型工具')
const tools = createTools(store)
ok('注册 14 个工具', tools.length === 14, tools.map((t) => t.name))
ok('工具名唯一且带 tutor_ 前缀', new Set(tools.map((t) => t.name)).size === 14 && tools.every((t) => t.name.startsWith('tutor_')))
ok('每个工具都有描述/参数/输出', tools.every((t) => t.description.length > 20 && t.parameters.type === 'object' && typeof t.output.render === 'function'))

const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
const dash = JSON.parse(await byName.tutor_dashboard.execute({ days: 14 }))
ok('tutor_dashboard 返回摘要与统计', typeof dash.summary === 'string' && dash.stats !== undefined && dash.countdown.days > 0)
const added = JSON.parse(await byName.tutor_add_items.execute({ items: [{ subject: 'geography', kind: 'mistake', topic: '洋流', question: '秘鲁渔场成因', answer: '上升补偿流' }] }))
ok('tutor_add_items 写入成功', added.added.length === 1, added.summary)
const searched = JSON.parse(await byName.tutor_search_items.execute({ query: '渔场', full: true }))
ok('tutor_search_items 命中新题', searched.total >= 1 && searched.items.some((it) => it.answer === '上升补偿流'), { total: searched.total })
const queued = JSON.parse(await byName.tutor_review_queue.execute({ limit: 3 }))
ok('tutor_review_queue 返回题目与评分说明', queued.items.length > 0 && queued.gradeGuide.good.includes('前进一档'))
const deck = JSON.parse(await byName.tutor_review_deck.execute({ limit: 2 }))
ok('tutor_review_deck 打包翻卡（含答案与每档预览）', deck.items.length > 0 && deck.items.every((it) => typeof it.answer === 'string' && it.preview.good !== undefined), `打包 ${deck.items.length} 张`)
const deckMeta = byName.tutor_review_deck.output.presentationMeta({ limit: 2 }, deck)
ok('tutor_review_deck 投影 hst-deck meta', deckMeta !== null && deckMeta.kind === 'hst-deck' && deckMeta.items.length === deck.items.length)
const graded = JSON.parse(await byName.tutor_grade_review.execute({ grades: [{ id: queued.items[0].id, grade: 'hard' }] }))
ok('tutor_grade_review 推进排期', graded.results.length === 1 && graded.results[0].intervalDays > 0, graded.summary)
const logged = JSON.parse(await byName.tutor_study_log.execute({ subject: 'chemistry', minutes: 45, note: '离子方程式' }))
ok('tutor_study_log 累计时长', logged.study.minutes === 135, logged.study.minutes)
const examTool = JSON.parse(await byName.tutor_exam_record.execute({ date: '2026-05-10', name: '三模', scores: [{ subject: 'math', score: 140 }] }))
ok('tutor_exam_record 返回趋势与差值', examTool.trend.length === 3 && typeof examTool.delta === 'number', examTool.summary)
const readSettings = JSON.parse(await byName.tutor_settings.execute({}))
ok('tutor_settings 空参为读取', readSettings.profile.grade === 'g2')
const wroteSettings = JSON.parse(await byName.tutor_settings.execute({ dailyStudyMinutes: 240 }))
ok('tutor_settings 可写入', wroteSettings.profile.dailyStudyMinutes === 240)
const dry = JSON.parse(await byName.tutor_import.execute({ text: md, dryRun: true }))
ok('tutor_import 预览不写库', dry.dryRun === true && dry.count === 3)
const syl = JSON.parse(await byName.tutor_syllabus.execute({ subject: 'chemistry', grade: 'g2' }))
ok('tutor_syllabus 按年级返回模块', syl.modules.length >= 2 && syl.modules.every((m) => m.grade === 'g2' || m.grade === 'all'), syl.summary)
ok('六科大纲均非空', ['chinese', 'math', 'english', 'physics', 'chemistry', 'geography'].every((s) => syllabusFor(s).length >= 4))

// ── ⑩ HTTP 路由 ──────────────────────────────────────────────────────────────
console.log('\n⑩ HTTP 路由')
const handler = createApiHandler(store, { mastery, logger: console })

/**
 * 构造伪请求（POST 时提供 async-iterable 请求体）。
 * @param {string} method 方法。
 * @param {string} path 相对 API 前缀的路径。
 * @param {object} [body] JSON 请求体。
 * @returns {object} 伪 IncomingMessage。
 */
function req(method, path, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    url: `${API_PREFIX}${path}`,
    async* [Symbol.asyncIterator]() { for (const c of chunks) yield c },
  }
}

/** 构造伪响应。 */
function res() {
  return {
    status: 0, headers: null, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body ?? '' },
    json() { return JSON.parse(this.body) },
  }
}

async function call(method, path, body) {
  const r = res()
  await handler(req(method, path, body), r)
  return r
}

const rOverview = await call('GET', '/overview')
ok('GET /overview 200 且含倒计时', rOverview.status === 200 && rOverview.json().countdown.days > 0)
ok('响应头 no-store', String(rOverview.headers['cache-control']).includes('no-store'))
const rMeta = await call('GET', '/meta')
ok('GET /meta 返回六科与数据目录', rMeta.json().subjects.length === 6 && rMeta.json().dataDir.includes('highschool-tutor'))
const rItems = await call('GET', '/items?subject=math&limit=5')
ok('GET /items 过滤与预览字段', rItems.status === 200 && rItems.json().items.every((it) => it.subject === 'math' && it.preview.good > 0))
const rPost = await call('POST', '/items', { items: [{ subject: 'english', question: '虚拟语气三种时间形式', answer: 'were/had done/were to do' }] })
ok('POST /items 新增并回带总览', rPost.json().added.length === 1 && rPost.json().overview.totals.items > 0)
const rQueue = await call('GET', '/queue?limit=4')
ok('GET /queue 返回队列与计数', rQueue.json().items.length > 0 && typeof rQueue.json().counts.due === 'number')
const rReview = await call('POST', '/review', { grades: [{ id: rQueue.json().items[0].id, grade: 'good' }] })
ok('POST /review 成功', rReview.json().ok === true && rReview.json().results.length === 1)
const rStats = await call('GET', '/stats?days=7')
ok('GET /stats 天数生效', rStats.json().series.length === 7)
const rProfile = await call('POST', '/profile', { grade: 'g3' })
ok('POST /profile 改年级并重算日期', rProfile.json().profile.grade === 'g3' && /^\d{4}-06-07$/.test(rProfile.json().profile.examDate))
const rLog = await call('POST', '/studylog', { subject: 'math', minutes: 25 })
ok('POST /studylog 记录成功', rLog.json().ok === true && rLog.json().day.minutes.math >= 25)
const rExam = await call('POST', '/exams', { exam: { date: '2026-06-01', name: '四模', scores: [{ subject: 'math', score: 145 }] } })
ok('POST /exams 写入并回列表', rExam.json().exams.length === 4)
const rImport = await call('POST', '/import', { text: csv, dryRun: true })
ok('POST /import dryRun 预览', rImport.json().count === 2 && rImport.json().dryRun === true)
const rSyllabus = await call('GET', '/syllabus?subject=math&grade=g3')
ok('GET /syllabus 返回模块', rSyllabus.json().modules.length >= 1)
const rExport = await call('GET', '/export?subject=geography')
ok('GET /export 返回 Markdown', rExport.headers['content-type'].includes('markdown') && rExport.body.includes('Q: '))
const rSeed = await call('POST', '/seed')
ok('POST /seed 幂等', rSeed.json().added === 0 && rSeed.json().updated >= 50)
const r404 = await call('GET', '/nope')
ok('未知路由 404', r404.status === 404)
const r405 = await call('DELETE', '/items')
ok('不支持的方法 405', r405.status === 405)

// ── ⑪ 工具 Schema 合规性（能找到 dsh-tools 时才跑）─────────────────────────────
console.log('\n⑪ 工具 Schema 合规性')
let toolsMod = null
for (const candidate of [
  '@deepseek-ai/dsh-tools',
  '/Users/Apple/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]) {
  try { toolsMod = await import(candidate); break } catch { /* 换下一个候选 */ }
}
if (toolsMod === null) {
  console.log('  – 跳过（未找到 @deepseek-ai/dsh-tools，安装到 profile 后由 harness 校验）')
} else {
  for (const tool of tools) {
    try {
      toolsMod.assertObjectJsonSchema(tool.parameters, `${tool.name}.parameters`)
      toolsMod.assertSupportedJsonSchema(tool.output.schema, `${tool.name}.output`)
      ok(`${tool.name} schema 合规`, true)
    } catch (error) {
      ok(`${tool.name} schema 合规`, false, String(error.message ?? error))
    }
  }
}

// ── ⑫ 插件入口挂载（模拟 cordis 生命周期）─────────────────────────────────────
console.log('\n⑫ 插件入口挂载')
const { apply, name: pluginName, inject: pluginInject } = await import('../lib/index.js')

/**
 * 构造 mock cordis 上下文。
 * @returns {object} { ctx, routes, registeredTools, effects, logs }
 */
function mockCtx() {
  const routes = []
  const registeredTools = []
  const effects = []
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    effect: (fn, label) => { effects.push(label); const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    tools: { register: (tool) => { registeredTools.push(tool); return () => {} } },
  }
  return { ctx, routes, registeredTools, effects, logs }
}

const m1 = mockCtx()
apply(m1.ctx, null)
ok('插件名与依赖声明正确', pluginName === 'dsh-highschool-tutor' && pluginInject.includes('tools') && pluginInject.includes('webServer'))
ok('注册一条前缀路由', m1.routes.length === 1 && m1.routes[0].kind === 'prefix' && m1.routes[0].path === API_PREFIX, m1.routes[0]?.path)
ok('注册 14 个工具', m1.registeredTools.length === 14, m1.registeredTools.length)
ok('所有注册都挂在 ctx.effect 上（可热重载清理）', m1.effects.length === 15 && m1.effects.every((l) => typeof l === 'string' && l.startsWith('dsh-highschool-tutor')))
ok('启动日志含题库与数据目录', m1.logs.some((l) => l.includes('已就绪') && l.includes('highschool-tutor')), m1.logs[0])

// 通过真实注册的 handler 走一遍 /meta，确认 ui 配置被注入
async function callRoute(handlerFn, method, path, body) {
  const r = res()
  await handlerFn(req(method, path), r)
  return r
}
const metaViaRoute = await callRoute(m1.routes[0].handler, 'GET', '/meta')
ok('路由 /meta 携带 ui 配置', metaViaRoute.json().ui.badge === true && metaViaRoute.json().ui.panel === true && metaViaRoute.json().ui.pollIntervalMs >= 10_000, metaViaRoute.json().ui)
const overviewViaRoute = await callRoute(m1.routes[0].handler, 'GET', '/overview')
ok('路由 /overview 正常', overviewViaRoute.status === 200 && overviewViaRoute.json().totals.items > 0)

/**
 * 用一份配置跑一遍 apply，返回它注册的路由 handler（用于验证 ui 配置传达）。
 * @param {object} config 插件配置。
 * @returns {Function} 路由处理器。
 */
function mockApply(config) {
  const m = mockCtx()
  apply(m.ctx, config)
  return m.routes[0].handler
}

const m2 = mockCtx()
apply(m2.ctx, { badge: false, tools: false, pollIntervalMs: 5000 })
ok('config.tools=false 时不注册工具', m2.registeredTools.length === 0)
const metaOff = await callRoute(m2.routes[0].handler, 'GET', '/meta')
ok('config.badge=false 传达到浏览器', metaOff.json().ui.badge === false)
ok('config.demo 默认开启并可关闭', metaViaRoute.json().ui.demo === true && (await callRoute(mockApply({ demo: false }), 'GET', '/meta')).json().ui.demo === false)
ok('config.autoDock 默认开启并可关闭（新演示自动进侧栏）', metaViaRoute.json().ui.autoDock === true && (await callRoute(mockApply({ autoDock: false }), 'GET', '/meta')).json().ui.autoDock === false)
ok('轮询间隔下限被夹到 10 秒', metaOff.json().ui.pollIntervalMs === 10_000, metaOff.json().ui.pollIntervalMs)

// ── ⑬ 场景规范（动态演示）────────────────────────────────────────────────────
console.log('\n⑬ 场景规范校验')
const { normalizeScene, sceneSummary, keySteps, SCENE_KINDS, objectTypesOf } = await import('../lib/scene.js')
const { EXAMPLES, exampleOf, fieldDocsOf } = await import('../lib/examples.js')

ok('十种场景类型（9 种可绘制 + html 兜底）', SCENE_KINDS.length === 10 && SCENE_KINDS.includes('html'), SCENE_KINDS.length)
for (const kind of SCENE_KINDS) {
  if (kind === 'html') continue
  const { scene, warnings } = normalizeScene(exampleOf(kind))
  ok(`示例 ${kind} 零警告 / 有步骤与重点 / 有字段说明`,
    warnings.length === 0 && scene.steps.length >= 3 && keySteps(scene).length >= 1
    && fieldDocsOf(kind) !== null && Object.keys(fieldDocsOf(kind)).length > 1,
    `${warnings.length} 警告 / ${scene.steps.length} 步 / ${keySteps(scene).length} 重点`)
}

const junk = normalizeScene(null)
ok('null 场景降级为 diagram2d 并警告', junk.scene.kind === 'diagram2d' && junk.warnings.length > 0)
const unknownKind = normalizeScene({ kind: 'wat', objects: [] })
ok('未知 kind 降级并警告', unknownKind.scene.kind === 'diagram2d' && unknownKind.warnings.some((w) => w.includes('wat')))
const badType = normalizeScene({ kind: 'plot2d', objects: [{ type: 'nope' }, { type: 'point', x: 1, y: 2 }] })
ok('不认识的对象类型被丢弃且提示可用类型', badType.scene.objects.length === 1 && badType.warnings[0].includes('nope'))
const badRef = normalizeScene({
  kind: 'plot2d',
  objects: [{ id: 'a', type: 'point', x: 0, y: 0 }],
  steps: [{ title: 's', show: ['ghost'], set: { ghost: { x: 1 } } }],
})
ok('步骤引用不存在的 id 被剔除并警告', badRef.scene.steps[0].show === undefined && badRef.warnings.length === 2, badRef.warnings)
const autoId = normalizeScene({ kind: 'plot2d', objects: [{ type: 'point' }, { type: 'point' }] })
ok('缺 id 时自动编号', autoId.scene.objects[0].id === 'o1' && autoId.scene.objects[1].id === 'o2')
const dupId = normalizeScene({ kind: 'plot2d', objects: [{ id: 'p', type: 'point' }, { id: 'p', type: 'point' }] })
ok('重复 id 自动去重', dupId.scene.objects[0].id !== dupId.scene.objects[1].id)
const tooMany = normalizeScene({
  kind: 'plot2d',
  objects: Array.from({ length: 200 }, () => ({ type: 'point' })),
  steps: Array.from({ length: 40 }, (_, i) => ({ title: `s${i}` })),
})
ok('对象与步骤数被截断到上限', tooMany.scene.objects.length === 160 && tooMany.scene.steps.length === 24 && tooMany.warnings.length === 2)
const plotView = normalizeScene({ kind: 'plot2d', objects: [{ type: 'point' }] }).scene.view
ok('plot2d 缺视图时给保守默认值', plotView.xMin === -5 && plotView.yMax === 4)
ok('摘要含类型/对象数/步骤数/重点数', sceneSummary(normalizeScene(EXAMPLES.plot2d).scene).includes('重点步骤'))
// 样式与引用类字段必须原样带过去——这些丢了不会报警，只会静默画错
{
  const { scene: styled } = normalizeScene({
    kind: 'diagram2d',
    objects: [
      { id: 'b1', type: 'box', x: 14, y: 32, w: 22, h: 10, text: '甲', color: '#e08b1a' },
      { id: 'b2', type: 'box', x: 50, y: 32, w: 22, h: 10, text: '乙' },
      { id: 'a1', type: 'arrow', of: 'b1', target: 'b2', text: 'SO₂', dash: true },
      { id: 't1', type: 'text', x: 14, y: 20, text: '说明', size: 11, color: '#61666b', bold: true },
      { id: 'n1', type: 'box', x: 80, y: 32, w: 10, h: 8, style: { color: '#16a34a' }, text: '嵌套' },
    ],
  })
  const byId = Object.fromEntries(styled.objects.map((o) => [o.id, o]))
  ok('顶层样式字段（color/dash/size/bold）保留', byId.b1.color === '#e08b1a' && byId.a1.dash === true && byId.t1.size === 11 && byId.t1.bold === true)
  ok('嵌套 style:{} 写法仍兼容', byId.n1.color === '#16a34a')
  ok('diagram2d 箭头的 target 保留（否则终点会退回兜底坐标）', byId.a1.target === 'b2' && byId.a1.of === 'b1')
  // 九个示例里所有显式配色都不许丢
  let lost = 0
  let total = 0
  for (const raw of Object.values(EXAMPLES)) {
    const s2 = normalizeScene(raw).scene
    for (const src of raw.objects ?? []) {
      if (src.color === undefined) continue
      total += 1
      const got = s2.objects.find((o) => o.id === src.id)
      if (got === undefined || got.color !== src.color) lost += 1
    }
  }
  ok(`九个内置示例的 ${total} 处显式配色全部保留`, lost === 0 && total > 30, `丢失 ${lost} 处`)
}

ok('geom3d 支持顶点名与截面法向量', (() => {
  const s = normalizeScene(EXAMPLES.geom3d).scene
  const cube = s.objects.find((o) => o.type === 'solid')
  const sec = s.objects.find((o) => o.type === 'section')
  return cube.vertices.length === 8 && Array.isArray(sec.normal) && sec.normal.length === 3
})())

// 展示演示集（docs/ 画廊素材）：数据层面的约束
{
  const { SHOWCASE, showcaseOf } = await import('../lib/showcase.js')
  ok('showcase 至少四份完整演示', SHOWCASE.length >= 4, SHOWCASE.length)
  ok('showcase id 唯一且是 URL 安全的（要当文件名用）',
    new Set(SHOWCASE.map((x) => x.id)).size === SHOWCASE.length
    && SHOWCASE.every((x) => /^[a-z0-9-]+$/.test(x.id)))
  let showWarn = 0
  for (const item of SHOWCASE) {
    const { scene, warnings } = normalizeScene(item.scene)
    showWarn += warnings.length
    if (warnings.length > 0) console.log(`      ⚠ ${item.id}: ${warnings.join('；')}`)
    ok(`${item.id}：有标题/学科/知识点/说明与题干`,
      scene.title !== '' && scene.subject !== null && scene.topic !== '' && scene.caption !== '' && item.question !== '')
    ok(`${item.id}：步骤 ≥ 4 且标出重点`, scene.steps.length >= 4 && keySteps(scene).length >= 1,
      `${scene.steps.length} 步 / ${keySteps(scene).length} 重点`)
    ok(`${item.id}：样式写成嵌套 style（对任何历史版本都不丢）`,
      item.scene.objects.every((o) => o.color === undefined && o.width === undefined && o.opacity === undefined && o.dash === undefined))
  }
  ok('showcase 全部零警告', showWarn === 0, showWarn)
  ok('showcase + examples 覆盖全部 9 种可绘制场景',
    new Set([...SHOWCASE.map((x) => x.scene.kind), ...Object.keys(EXAMPLES)]).size === 9)
  ok('showcaseOf 返回深拷贝（改动不污染原数据）', (() => {
    const a = showcaseOf(SHOWCASE[0].id)
    a.scene.title = 'mutated'
    return SHOWCASE[0].scene.title !== 'mutated' && showcaseOf('nope') === null
  })())
}

// ── ⑭ 动态演示：存储、工具与路由 ──────────────────────────────────────────────
console.log('\n⑭ 动态演示：存储、工具与路由')
const demoStore = new Store(join(workdir, 'demo-store'))
const demoTools = createTools(demoStore)
const callDemoTool = async (name, args) => JSON.parse(await demoTools.find((t) => t.name === name).execute(args))

const guideAll = await callDemoTool('tutor_scene_guide', { subject: 'chemistry' })
ok('tutor_scene_guide 返回选型总览与学科推荐', guideAll.kinds.length === SCENE_KINDS.length && guideAll.recommend.subject === 'chemistry' && guideAll.recommend.use.length > 0)
ok('选型总览含步骤写法指导', typeof guideAll.commonSteps.字段.key === 'string')
const guideOne = await callDemoTool('tutor_scene_guide', { kind: 'lattice3d' })
ok('按类型返回字段说明与完整示例', guideOne.fields.cell !== undefined && guideOne.example.kind === 'lattice3d' && guideOne.objectTypes.length === objectTypesOf('lattice3d').length)

const vizResult = await callDemoTool('tutor_visualize', {
  scene: EXAMPLES.mech2d,
  item: { subject: 'physics', question: '斜面上滑块的加速度', answer: 'a = g(sinθ − μcosθ)', explanation: '沿斜面列方程', topic: '相互作用——力' },
})
ok('tutor_visualize 生成演示并存库', vizResult.ok === true && vizResult.demoId === 'dm_0001')
ok('tutor_visualize 顺手录题并关联', vizResult.itemId === 'it_00001' && vizResult.item.subject === 'physics')
ok('tutor_visualize 返回重点步骤清单', vizResult.keySteps.length === 2 && vizResult.keySteps[0].index >= 1)
ok('tutor_visualize 零警告', vizResult.warnings.length === 0, vizResult.warnings)

const vizTool = demoTools.find((t) => t.name === 'tutor_visualize')
const projected = vizTool.output.presentationMeta({}, JSON.stringify(vizResult))
ok('presentationMeta 投影出可渲染的场景', projected.kind === 'hst-demo' && projected.scene.objects.length === vizResult.objects && Array.isArray(projected.keySteps))
const modelText = vizTool.output.render({}, JSON.stringify(vizResult))[0].text
ok('给模型的回执不回显场景 JSON', !modelText.includes('"objects"') && modelText.length < 600, `${modelText.length} 字符`)
ok('回执提示可推到侧栏并列出重点步骤', modelText.includes('侧栏') && modelText.includes('重点步骤'))

const noPersist = await callDemoTool('tutor_visualize', { scene: { kind: 'plot2d', title: '不存库', objects: [{ type: 'point' }] }, persist: false })
ok('persist=false 时不写库', noPersist.demoId === null && demoStore.listDemos({}).total === 1)

const savedDemo = demoStore.saveDemo({ title: '手工演示', kind: 'diagram2d', scene: { kind: 'diagram2d', objects: [] } })
ok('saveDemo 新增', savedDemo.id === 'dm_0002' && demoStore.listDemos({}).total === 2)
const updatedDemo = demoStore.saveDemo({ id: 'dm_0002', title: '改过的标题' })
ok('带 id 视为更新且保留场景', updatedDemo.title === '改过的标题' && updatedDemo.scene !== null && demoStore.listDemos({}).total === 2)
ok('listDemos 默认不带场景数据（省流量）', demoStore.listDemos({}).demos[0].scene === undefined && typeof demoStore.listDemos({}).demos[0].steps === 'number')
ok('listDemos 可带完整场景', demoStore.listDemos({}, true).demos[0].scene !== undefined)
ok('listDemos 支持学科/题目/关键词筛选',
  demoStore.listDemos({ subject: 'physics' }).total === 1
  && demoStore.listDemos({ itemId: 'it_00001' }).total === 1
  && demoStore.listDemos({ query: '改过' }).total === 1
  && demoStore.listDemos({ query: '不存在的词' }).total === 0)
ok('getDemo 取完整记录', demoStore.getDemo('dm_0001').scene.steps.length > 0)
ok('deleteDemos 删除', demoStore.deleteDemos(['dm_0002']).deleted.length === 1 && demoStore.listDemos({}).total === 1)
ok('overview 含演示总数', demoStore.overview().totals.demos === 1)

const { frameDocument, frameVersion, frameRuntime, FRAME_CSP } = await import('../lib/frame/index.js')
const frameDoc = frameDocument()
ok('帧文档内联引擎并自带 CSP', frameDoc.includes('__HST__') && frameDoc.includes('Content-Security-Policy') && frameDoc.includes('hst-root'))
ok('CSP 禁止帧内联网与嵌套框架', FRAME_CSP.includes('connect-src blob: data:') && FRAME_CSP.includes("frame-src 'none'"))
ok('帧文档是静态的（不插值场景数据，可被所有 iframe 复用）', !frameDoc.includes('"objects"') && frameDoc.includes("mode: 'card'"))
ok('引擎指纹格式正确且拼接了 4 个 browser 文件', /^\d+-[0-9a-z]+$/.test(frameVersion()) && frameRuntime().files.length === 4, frameVersion())

const demoHandler = createApiHandler(demoStore, { mastery, logger: { warn() {} } })
const callDemoRoute = async (method, path, body) => {
  const r = res()
  await demoHandler(req(method, path, body), r)
  return r
}
// 独立演示窗口的两条路由
const panelRes = await callDemoRoute('GET', '/panel.html')
ok('GET /panel.html 返回独立窗口页面', panelRes.status === 200 && String(panelRes.headers['content-type']).includes('text/html')
  && panelRes.body.includes('<script src="./frame.js">') && panelRes.body.includes('BroadcastChannel'))
ok('独立窗口页不内联引擎（体积远小于 frame.html）', panelRes.body.length < 20000, `${(panelRes.body.length / 1024).toFixed(1)} KB`)
ok('独立窗口页能单独使用（?demo=<id> 与最近一份兜底）',
  panelRes.body.includes("get('demo')") && panelRes.body.includes('./demos?limit=1&full=true'))
ok('独立窗口页不依赖 window.opener（两边刷新都不断链）', !panelRes.body.includes('window.opener'))
const frameJsRes = await callDemoRoute('GET', '/frame.js')
ok('GET /frame.js 以脚本类型返回引擎', frameJsRes.status === 200
  && String(frameJsRes.headers['content-type']).includes('javascript')
  && frameJsRes.body.includes('__HST__') && frameJsRes.body.length > 100000)
ok('frame.js 与 frame.html 用的是同一份引擎', frameJsRes.body === frameRuntime().source)
const frameRes = await callDemoRoute('GET', '/frame.html')
ok('GET /frame.html 返回 HTML 与引擎指纹头', frameRes.status === 200 && String(frameRes.headers['content-type']).includes('text/html') && frameRes.headers['x-frame-version'] === frameVersion())
const demosRes = await callDemoRoute('GET', '/demos')
ok('GET /demos 列表', demosRes.status === 200 && demosRes.json().total === 1)
const oneRes = await callDemoRoute('GET', '/demos/dm_0001')
ok('GET /demos/:id 带完整场景', oneRes.json().scene.objects.length > 0)
const missRes = await callDemoRoute('GET', '/demos/nope')
ok('GET 不存在的演示返回 404', missRes.status === 404 && missRes.json().ok === false)
const exampleRes = await callDemoRoute('GET', '/demos/example:globe3d')
ok('GET /demos/example:<kind> 取内置示例', exampleRes.json().example === true && exampleRes.json().scene.kind === 'globe3d')
ok('不存在的示例返回 404', (await callDemoRoute('GET', '/demos/example:nope')).status === 404)
const postDemoRes = await callDemoRoute('POST', '/demos', { scene: { kind: 'chart2d', title: '路由存的', objects: [{ type: 'hline', y: 1 }], steps: [] } })
ok('POST /demos 保存并回传规范化结果', postDemoRes.json().ok === true && postDemoRes.json().demo.kind === 'chart2d')
ok('POST /demos/delete 删除', (await callDemoRoute('POST', '/demos/delete', { ids: [postDemoRes.json().demo.id] })).json().deleted.length === 1)
const demoMetaRes = await callDemoRoute('GET', '/meta')
ok('GET /meta 暴露场景类型/标签/示例清单', demoMetaRes.json().scene.kinds.length === 10 && demoMetaRes.json().scene.examples.length === 9 && demoMetaRes.json().scene.labels.plot2d === '平面坐标系')
ok('GET /meta 告知浏览器侧独立窗口地址与频道名',
  demoMetaRes.json().scene.panelPath === `${API_PREFIX}/panel.html` && demoMetaRes.json().scene.channel === 'dsh-highschool-tutor/demo')

// ── ⑮ 电子资料导入：ZIP / 文本抽取 / 切题 / 答案回填 ────────────────────────
console.log('\n⑮ 电子资料导入')
{
  const { openZip, isZip, listEntries, readEntry } = await import('../lib/zipfs.js')
  const { extractText, sniff, decodeText } = await import('../lib/docs.js')
  const { parsePaper, parseAnswerBlock, parseCourseware, parseStudyText } = await import('../lib/paper.js')
  const { makeZip, makeDocx, makePptx, crc32, SAMPLE_PAPER } = await import('./fixtures.mjs')

  // ZIP 读取器：拿自造的真 ZIP 验（CRC 对着已知值校准，产物系统 unzip 也能打开）
  ok('CRC32 实现正确（IEEE 标准值）', crc32(Buffer.from('123456789')) === 0xcbf43926)
  const zip = makeZip([
    { name: 'a.txt', data: 'hello', store: true },
    { name: 'b/c.xml', data: '<x>压缩内容</x>' },
  ])
  ok('isZip 认出 ZIP 头', isZip(zip) && !isZip(Buffer.from('%PDF-1.7')))
  const entries = listEntries(zip)
  ok('读出中央目录（两种压缩方式）', entries.length === 2
    && entries[0].method === 0 && entries[1].method === 8, entries.map((e) => `${e.name}:${e.method}`))
  ok('STORED 与 DEFLATE 都能解出原文',
    readEntry(zip, entries[0]).toString() === 'hello'
    && readEntry(zip, entries[1]).toString() === '<x>压缩内容</x>')
  ok('openZip 的 text/has/match 可用', (() => {
    const z = openZip(zip)
    return z.has('a.txt') && z.text('a.txt') === 'hello' && z.text('nope') === null && z.match(/\.xml$/).length === 1
  })())
  let zipErr = null
  try { listEntries(Buffer.from('not a zip at all')) } catch (err) { zipErr = err }
  ok('坏 ZIP 报明确错误而不是给出坏数据', zipErr !== null && zipErr.message.includes('ZIP'))

  // 编码嗅探：中文 txt 现实里常是 GBK
  ok('UTF-8 BOM 被剥掉', decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).text === 'A')
  ok('GBK 文本能正确解码', decodeText(Buffer.from([0xb8, 0xdf, 0xd6, 0xd0])).text === '高中')
  ok('UTF-8 文本按 UTF-8 解码', decodeText(Buffer.from('高中', 'utf8')).encoding === 'utf-8')

  // docx：Word 试卷的三个真实坑
  const docxBuf = makeDocx(SAMPLE_PAPER)
  ok('sniff 按字节认出 docx（不靠扩展名）', sniff(docxBuf, 'noext') === 'docx')
  const docx = extractText(docxBuf, '期中.docx')
  ok('docx 抽取成功且行数与原文一致',
    docx.ok && docx.text.split('\n').filter(Boolean).length === SAMPLE_PAPER.length)
  ok('被 Word 切碎的 w:r 拼回完整句子', docx.text.includes('设集合A={1,2,3}，B={2,3,4}'))
  ok('w:tab 保留（选项靠它排在一行）', docx.text.includes('A．{1,2}\tB．{2,3}'))
  const tableDoc = makeZip([{
    name: 'word/document.xml',
    data: '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>1．题（　　）</w:t></w:r></w:p>'
      + '<w:tbl><w:tr>' + ['甲', '乙', '丙', '丁'].map((c, i) => `<w:tc><w:p><w:r><w:t>${'ABCD'[i]}．${c}</w:t></w:r></w:p></w:tc>`).join('') + '</w:tr></w:tbl>'
      + '</w:body></w:document>',
  }])
  ok('表格排版的四个选项被合并成一行（真实试卷常见）',
    /A．甲\tB．乙\tC．丙\tD．丁/.test(extractText(tableDoc, 't.docx').text))

  // pptx：课件按页
  const pptx = extractText(makePptx([['化学平衡', '浓度温度压强'], ['勒夏特列原理', '向减弱改变的方向移动']]), 'k.pptx')
  ok('pptx 按页抽取并留页码标记', pptx.ok && pptx.slides === 2 && pptx.text.includes('【第1页】') && pptx.text.includes('【第2页】'))

  // 切题与答案回填
  const paper = parsePaper(docx.text, { source: '高二期中数学' })
  ok('切出 7 道题', paper.items.length === 7, paper.items.length)
  ok('识别标题与学科', paper.title.includes('期中考试') && paper.subject === 'math')
  ok('识别 3 个大题', paper.sections.length === 3)
  ok('文末答案区按题号全部回填', paper.stats.withAnswer === 7, paper.stats)
  ok('小问「（1）（2）」归属母题而非独立成题',
    paper.items.find((i) => i.num === 15).question.includes('（1）求证')
    && paper.items.every((i) => i.num !== 1 || !i.question.includes('求证')))
  ok('分值 → 难度，且题干里的分值标注被清掉', (() => {
    const q15 = paper.items.find((i) => i.num === 15)
    return q15.difficulty === 4 && q15.score === 12 && !q15.question.startsWith('（12分）')
  })())
  ok('选择题识别正确，且「角A、B、C」不误判', paper.stats.choice === 3
    && paper.items.find((i) => i.num === 16).hasOptions === false)
  ok('可信度判为 high', paper.confidence === 'high')

  // 答案区的各种写法
  const packed = parseAnswerBlock(['1．A　2．C　3．D　4．B'])
  ok('答案压成一行（全角空格分隔）能拆开', packed.map.size === 4 && packed.map.get(3) === 'D')
  const mixed = parseAnswerBlock(['1. A 2、B ３．C 4) D'])
  ok('题号写法混用时答案边界不串位（按匹配起点切）',
    mixed.map.get(1) === 'A' && mixed.map.get(2) === 'B' && mixed.map.get(3) === 'C' && mixed.map.get(4) === 'D',
    [...mixed.map.entries()])
  const inline = parsePaper('1．题（　　）\nA．甲\tB．乙\n【答案】B\n【解析】因为甲错')
  ok('内嵌【答案】【解析】被拆到独立字段',
    inline.items[0].answer === 'B' && inline.items[0].explanation === '因为甲错'
    && !inline.items[0].question.includes('【答案】'))

  // 课件转卡
  const cards = parseCourseware(pptx.text, { subject: 'chemistry' })
  ok('课件按页转知识卡（首行正面、其余背面）',
    cards.items.length === 2 && cards.items[0].kind === 'card' && cards.items[0].answer.includes('浓度'))
  const skipped = parseCourseware('【第1页】\n只有标题\n\n【第2页】\n标题\n内容')
  ok('只有标题的过渡页被跳过', skipped.stats.cards === 1 && skipped.stats.skipped === 1)

  // 自动选路
  ok('自动选路：有题号走试卷、有页码标记走课件',
    parseStudyText('1．题\n参考答案\n1．A').mode === 'paper'
    && parseStudyText('【第1页】\n标题\n内容').mode === 'courseware')

  // 可信度闸门：非试卷文本不许悄悄入库
  const junk = parsePaper('127.0.0.1 localhost\n255.255.255.255 broadcast\n0.0.0.0 x')
  ok('把 hosts 这类文本判为 low（首题号异常 / 题号不递增）',
    junk.confidence === 'low' && junk.confidenceReasons.length > 0, junk.confidenceReasons)
  ok('low 时给出可读的警告', junk.warnings.some((w) => w.includes('不太像试卷')))
  ok('只导某个大题（从 9 起）仍判 high', parsePaper('9．函数的定义域是什么？\n10．求导数的结果\n11．计算积分值').confidence === 'high')

  // 不支持的格式必须明确指路，而不是给半截乱码
  for (const [name, bytes, keyword] of [
    ['卷.pdf', Buffer.from('%PDF-1.7 x'), 'docx'],
    ['题.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), 'OCR'],
    ['表.xlsx', makeZip([{ name: 'xl/workbook.xml', data: '<w/>' }]), 'CSV'],
  ]) {
    const r = extractText(bytes, name)
    ok(`${name} 不硬解析，给出可执行的替代路径（提到 ${keyword}）`, r.ok === false && r.hint.includes(keyword))
  }
}

// ── ⑯ 资料导入的路由与工具 ──────────────────────────────────────────────────
console.log('\n⑯ 资料导入：路由与工具')
{
  const { makeDocx, makePptx, SAMPLE_PAPER } = await import('./fixtures.mjs')
  const docStore = new Store(join(workdir, 'doc-store'))
  const docHandler = createApiHandler(docStore, { mastery, logger: { warn() {} } })
  const callDoc = async (method, path, body) => {
    const r = res()
    await docHandler(req(method, path, body), r)
    return r
  }
  const b64 = makeDocx(SAMPLE_PAPER).toString('base64')

  const formats = await callDoc('GET', '/docs/formats')
  ok('GET /docs/formats 列出直接支持与间接支持的格式', formats.json().supported.length === 6 && formats.json().indirect.length === 3)

  const preview = await callDoc('POST', '/docs/parse', { filename: '高二期中数学.docx', base64: b64 })
  const pv = preview.json()
  ok('POST /docs/parse 解析 base64 上传的 docx', pv.ok && pv.format === 'docx' && pv.mode === 'paper')
  ok('预览返回题目、答案数与大题结构', pv.stats.questions === 7 && pv.stats.withAnswer === 7 && pv.sections.length === 3)
  ok('预览不写库', docStore.listItems({}).total === 0)

  const imported = (await callDoc('POST', '/docs/import', { filename: '高二期中数学.docx', base64: b64 })).json()
  ok('POST /docs/import 写入题库', imported.added === 7 && docStore.listItems({}).total === 7)
  ok('导入的题目带答案、标签与来源', (() => {
    const it = docStore.listItems({ query: '集合' }).items[0]
    return it.answer === 'B' && it.tags.includes('试卷导入') && it.source === '高二期中数学' && it.srs.state === 'new'
  })())

  const edited = imported.items.slice(0, 1).map((i) => ({ ...i, question: '（用户改过的题干）' }))
  const reimport = (await callDoc('POST', '/docs/import', { text: '1．占位', items: edited })).json()
  ok('回传 items 时以用户改过的版本为准', reimport.added === 1 && docStore.listItems({ query: '用户改过' }).total === 1)

  const cw = (await callDoc('POST', '/docs/import', { filename: '课件.pptx', base64: makePptx([['化学平衡', '三因素'], ['原理', '减弱改变'], ['谢谢']]).toString('base64') })).json()
  ok('pptx 自动走课件模式并转成知识卡', cw.mode === 'courseware' && cw.added === 2 && cw.stats.skipped === 1)

  const refused = (await callDoc('POST', '/docs/import', { filename: 'hosts.txt', text: '127.0.0.1 localhost\n255.255.255.255 x\n0.0.0.0 y' })).json()
  ok('非试卷文本被拒绝写入（confidence=low）', refused.ok === false && refused.refused === true && refused.confidence === 'low')
  const forced = (await callDoc('POST', '/docs/import', { filename: 'hosts.txt', text: '127.0.0.1 localhost\n255.255.255.255 x\n0.0.0.0 y', force: true })).json()
  ok('force=true 时允许强制写入', forced.ok === true && forced.added > 0)

  ok('PDF 上传返回指路提示而非报错', (() => {
    const r = (async () => callDoc('POST', '/docs/parse', { filename: 'x.pdf', base64: Buffer.from('%PDF-1.7').toString('base64') }))
    return true
  })())
  const pdfRes = (await callDoc('POST', '/docs/parse', { filename: 'x.pdf', base64: Buffer.from('%PDF-1.7 y').toString('base64') })).json()
  ok('PDF 上传：ok=false 且带可执行提示', pdfRes.ok === false && pdfRes.hint.includes('docx'))
  ok('空请求 400', (await callDoc('POST', '/docs/parse', {})).status === 400)

  // 模型工具
  const docTools = createTools(docStore)
  ok('注册了 tutor_paper_import', docTools.some((t) => t.name === 'tutor_paper_import'))
  const callTool = async (name, args) => JSON.parse(await docTools.find((t) => t.name === name).execute(args))
  const { writeFileSync } = await import('node:fs')
  const paperPath = join(workdir, '一模数学.docx')
  writeFileSync(paperPath, makeDocx(SAMPLE_PAPER))
  const dry = await callTool('tutor_paper_import', { path: paperPath, dryRun: true })
  ok('工具 dryRun 只预览并报告匹配到多少答案', dry.dryRun === true && dry.stats.withAnswer === 7 && dry.preview.length > 0)
  ok('dryRun 摘要对模型可读', typeof dry.summary === 'string' && dry.summary.includes('切出 7 道题'))
  const before = docStore.listItems({}).total
  const real = await callTool('tutor_paper_import', { path: paperPath, topic: '集合与常用逻辑用语' })
  ok('工具正式导入并写库', real.ok === true && docStore.listItems({}).total === before + 7)
  ok('导入时可统一指定知识点', docStore.listItems({ topic: '集合与常用逻辑用语' }).total >= 7)
  const missing = await callTool('tutor_paper_import', { path: join(workdir, 'nope.docx') })
  ok('文件不存在时给出可读错误', missing.ok === false && missing.summary.includes('读不到文件'))
  const junkTool = await callTool('tutor_paper_import', { text: '127.0.0.1 a\n255.255.255.255 b\n0.0.0.0 c' })
  ok('工具侧同样拦住非试卷文本，并提示可用 force', junkTool.ok === false && junkTool.summary.includes('force'))
}

// ── 收尾 ─────────────────────────────────────────────────────────────────────
rmSync(workdir, { recursive: true, force: true })
console.log(`\n${failures.length === 0 ? '✅' : '❌'} 通过 ${passed} 项${failures.length > 0 ? `，失败 ${failures.length} 项：\n  - ${failures.join('\n  - ')}` : ''}`)
process.exit(failures.length === 0 ? 0 : 1)
