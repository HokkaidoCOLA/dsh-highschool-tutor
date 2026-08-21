// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 浏览器侧 JSON API（同源路由，无鉴权需求）。
 *
 * 全部挂在前缀 `/api/highschool-tutor` 下，供 client 半边（设置页面板 +
 * 标题栏徽标）调用。所有响应都是 `application/json; charset=utf-8`、
 * `cache-control: no-store`（学习数据随时在变，缓存只会带来困惑），
 * 唯一例外是 `GET export` 返回 Markdown 纯文本。
 *
 *   GET  /overview            首屏总览：倒计时、今日待复习、学习进度、薄弱点
 *   GET  /meta                静态元数据：六科定义、年级、数据目录、大纲规模
 *   GET  /items               题库查询（subject/kind/status/query/topic/sort/limit/offset）
 *   POST /items               批量新增或更新（body: { items: [...] }）
 *   POST /items/delete        批量删除（body: { ids: [...] }）
 *   GET  /queue               今日复习队列（附每档评分的下次间隔预览）
 *   POST /review              提交评分（body: { grades: [{ id, grade, elapsedMs }] }）
 *   GET  /stats?days=14       统计视图：每日曲线、各科掌握度、保持率、模考趋势
 *   GET  /profile             学情设置
 *   POST /profile             更新学情设置
 *   GET  /exams               模考成绩列表
 *   POST /exams               新增/更新一次成绩
 *   POST /exams/delete        删除成绩
 *   POST /studylog            记一笔学习（分钟数/章节/笔记）
 *   GET  /syllabus            知识大纲（subject/grade 可选）
 *   POST /import              导入 Markdown/CSV/TSV（dryRun=true 只预览）
 *   GET  /export              导出 Markdown
 *   POST /seed                导入内置起始卡片包（按 seedKey 幂等）
 *
 * 动态演示（讲题时生成的 2D/3D 交互图，见 scene.js 与 frame/）：
 *   GET  /frame.html          演示帧文档（静态、内联引擎，供 iframe srcdoc 复用）
 *   GET  /frame.js            引擎脚本（供独立窗口等同源页面 <script src> 加载）
 *   GET  /panel.html          **独立演示窗口**页面（BroadcastChannel 接收推送，可单独打开）
 *   GET  /demos               演示列表（subject/kind/itemId/query/limit）
 *   GET  /demos/:id           取一份完整演示；id=example:<kind> 取内置示例
 *   POST /demos               保存/更新一份演示（带 id 即更新）
 *   POST /demos/delete        批量删除演示
 *
 * 电子资料导入（试卷 / 课件 / 练习题，见 docs.js 与 paper.js）：
 *   GET  /docs/formats        支持的格式清单与各自说明
 *   POST /docs/parse          解析一份资料（body: { filename, base64 | text, mode?, subject? }），只预览不写库
 *   POST /docs/import         解析并写入题库（同上参数 + items 可携带用户改过的题目）
 *
 * @module dsh-highschool-tutor/api
 */

import { previewIntervals } from './srs.js'
import { dataDir } from './store.js'
import { parseImport, toMarkdown } from './importer.js'
import { seedItems } from './seed.js'
import { GRADES, SUBJECTS, subjectLabel, toSubject } from './subjects.js'
import { SYLLABUS, syllabusFor, syllabusSize } from './syllabus.js'
import { PANEL_CHANNEL, frameDocument, frameRuntime, frameVersion, panelDocument } from './frame/index.js'
import { KIND_LABELS, SCENE_KINDS, keySteps, normalizeScene, sceneSummary } from './scene.js'
import { exampleList, exampleOf } from './examples.js'
import { FORMAT_LABELS, extractText } from './docs.js'
import { parseStudyText } from './paper.js'

/** 浏览器可见的 API 前缀。 */
export const API_PREFIX = '/api/highschool-tutor'

/**
 * 请求体上限。
 * 12 MB：粘贴文本用不了这么多，但上传 docx/pptx 走 base64（体积 ×4/3），
 * 一份带图的课件几 MB 很常见，2 MB 会直接把正常使用挡在门外。
 */
const BODY_CAP = 12 * 1024 * 1024

/**
 * 写 JSON 响应。
 * @param {object} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {unknown} body 响应体。
 * @returns {void}
 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * 读取并解析 JSON 请求体（空体返回 {}）。
 * @param {object} req 请求对象（node IncomingMessage）。
 * @returns {Promise<object>} 解析后的对象。
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_CAP) throw new Error('请求体过大（上限 2 MB）')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/**
 * 数字查询参数。
 * @param {URLSearchParams} params 查询串。
 * @param {string} key 参数名。
 * @param {number|undefined} fallback 缺省值。
 * @returns {number|undefined} 数值。
 */
function num(params, key, fallback) {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 给队列/查询结果补上界面需要的派生字段（下次间隔预览、掌握度）。
 * @param {object[]} items 题目。
 * @param {number} now 当前时间戳。
 * @param {(item: object, now: number) => number} masteryOf 掌握度函数。
 * @returns {object[]} 带 preview/mastery 的题目。
 */
function decorate(items, now, masteryOf) {
  return items.map((it) => ({
    ...it,
    preview: previewIntervals(it.srs, now),
    masteryScore: masteryOf(it, now),
  }))
}

/**
 * 构造 webServer 处理器。
 * @param {import('./store.js').Store} store 数据仓库。
 * @param {{mastery: Function, logger?: object}} deps 依赖注入（掌握度函数、日志）。
 * @returns {(req: object, res: object) => Promise<void>} 处理器。
 */
export function createApiHandler(store, deps) {
  const masteryOf = deps.mastery

  return async function handle(req, res) {
    const now = Date.now()
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const tail = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname
      const route = tail.replace(/^\/+/, '').replace(/\/+$/, '')
      const method = (req.method ?? 'GET').toUpperCase()
      const q = url.searchParams

      // ── 读接口 ──────────────────────────────────────────────────────────
      if (method === 'GET' || method === 'HEAD') {
        if (route === '' || route === 'overview') return sendJson(res, 200, store.overview(now))

        if (route === 'meta') {
          return sendJson(res, 200, {
            subjects: SUBJECTS,
            grades: GRADES,
            dataDir: dataDir(),
            syllabus: Object.fromEntries(Object.keys(SYLLABUS).map((k) => [k, syllabusSize(k)])),
            seedCount: seedItems().length,
            scene: {
              kinds: SCENE_KINDS,
              labels: KIND_LABELS,
              frameVersion: frameVersion(),
              examples: exampleList(),
              panelPath: `${API_PREFIX}/panel.html`,
              channel: PANEL_CHANNEL,
            },
          })
        }

        // 演示帧文档：完全静态，浏览器侧取一次即可给所有 iframe 复用。
        // 带上 frameVersion 做缓存键，引擎改动后自然失效。
        if (route === 'frame.html') {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-version': frameVersion(),
          })
          return res.end(frameDocument())
        }

        // 引擎单独成文件：供**独立演示窗口**这类同源页面用 <script src> 加载。
        // 沙箱 iframe 是不透明源、加载不了同源脚本，所以那条路仍走 frame.html 内联。
        if (route === 'frame.js') {
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-version': frameVersion(),
          })
          return res.end(frameRuntime().source)
        }

        // 独立演示窗口：普通同源页面，靠 BroadcastChannel 接收对话页推送的演示；
        // 直接打开也能用（?demo=<id> 指定某份，或自动显示最近一份）。
        if (route === 'panel.html') {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-version': frameVersion(),
          })
          return res.end(panelDocument())
        }

        if (route === 'docs/formats') {
          return sendJson(res, 200, {
            supported: [
              { format: 'docx', label: FORMAT_LABELS.docx, note: 'Word 试卷/练习题，解析最可靠（含表格排版的选项）' },
              { format: 'pptx', label: FORMAT_LABELS.pptx, note: '课件，按页切成知识卡' },
              { format: 'txt', label: FORMAT_LABELS.txt, note: '纯文本，自动识别 UTF-8 / GBK' },
              { format: 'md', label: FORMAT_LABELS.md, note: 'Markdown 整理' },
              { format: 'csv', label: FORMAT_LABELS.csv, note: '题干/答案两列表格' },
              { format: 'html', label: FORMAT_LABELS.html, note: '网页导出/复制' },
            ],
            indirect: [
              { format: 'pdf', label: FORMAT_LABELS.pdf, note: '先用 Word/WPS 另存为 .docx 再导入；扫描版请把图片发在对话里' },
              { format: 'image', label: FORMAT_LABELS.image, note: '把图片发在对话里，由模型 OCR 后写入题库' },
              { format: 'xlsx', label: FORMAT_LABELS.xlsx, note: '另存为 CSV 后导入' },
            ],
            modes: [
              { mode: 'auto', label: '自动判断' },
              { mode: 'paper', label: '试卷/练习题（切题 + 回填答案）' },
              { mode: 'courseware', label: '课件（按页转知识卡）' },
            ],
          })
        }

        if (route === 'demos') {
          const result = store.listDemos({
            subject: q.get('subject'),
            kind: q.get('kind'),
            itemId: q.get('itemId'),
            query: q.get('query'),
            limit: num(q, 'limit', 40),
          }, q.get('full') === 'true')
          return sendJson(res, 200, result)
        }

        if (route.startsWith('demos/')) {
          const id = route.slice('demos/'.length)
          // 示例演示：id 形如 example:plot2d
          if (id.startsWith('example:')) {
            const kind = id.slice('example:'.length)
            const example = exampleOf(kind)
            if (example === null) return sendJson(res, 404, { ok: false, error: `没有 ${kind} 的示例` })
            const { scene } = normalizeScene(example)
            return sendJson(res, 200, {
              id, title: scene.title, kind: scene.kind, subject: scene.subject, topic: scene.topic,
              summary: sceneSummary(scene), keySteps: keySteps(scene), scene, example: true,
            })
          }
          const demo = store.getDemo(id)
          if (demo === null) return sendJson(res, 404, { ok: false, error: `没有演示 ${id}` })
          return sendJson(res, 200, demo)
        }

        if (route === 'items') {
          const result = store.listItems({
            subject: q.get('subject'),
            kind: q.get('kind'),
            status: q.get('status') ?? 'all',
            query: q.get('query'),
            topic: q.get('topic'),
            grade: q.get('grade'),
            sort: q.get('sort') ?? 'updated',
            limit: num(q, 'limit', 50),
            offset: num(q, 'offset', 0),
            includeArchived: q.get('includeArchived') === 'true',
          }, now)
          return sendJson(res, 200, { ...result, items: decorate(result.items, now, masteryOf) })
        }

        if (route === 'queue') {
          const result = store.queue({
            subject: q.get('subject'),
            limit: num(q, 'limit', 20),
            includeNew: q.get('includeNew') !== 'false',
          }, now)
          return sendJson(res, 200, { ...result, items: decorate(result.items, now, masteryOf) })
        }

        if (route === 'stats') return sendJson(res, 200, store.stats(num(q, 'days', 14), now))
        if (route === 'profile') return sendJson(res, 200, store.profile(now))
        if (route === 'exams') return sendJson(res, 200, { exams: store.listExams() })

        if (route === 'progress') {
          return sendJson(res, 200, {
            chapters: store.chapterProgress(),
            notes: store.recentNotes(num(q, 'notes', 20)),
          })
        }

        if (route === 'syllabus') {
          const subject = toSubject(q.get('subject'))
          const grade = q.get('grade')
          if (subject !== null) {
            return sendJson(res, 200, { subject, label: subjectLabel(subject), modules: syllabusFor(subject, grade) })
          }
          return sendJson(res, 200, {
            all: Object.fromEntries(SUBJECTS.map((s) => [s.key, syllabusFor(s.key, grade)])),
          })
        }

        if (route === 'export') {
          const result = store.listItems({
            subject: q.get('subject'),
            kind: q.get('kind'),
            status: q.get('status') ?? 'all',
            limit: 500,
          }, now)
          const text = toMarkdown(result.items, subjectLabel)
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
          return res.end(text)
        }

        return sendJson(res, 404, { ok: false, error: `未知路由 GET ${route}` })
      }

      // ── 写接口 ──────────────────────────────────────────────────────────
      if (method === 'POST') {
        const body = await readJsonBody(req)

        if (route === 'items') {
          const result = store.upsertItems(body.items ?? [], now)
          return sendJson(res, 200, {
            ok: true,
            added: result.added,
            updated: result.updated,
            skipped: result.skipped,
            overview: store.overview(now),
          })
        }

        if (route === 'items/delete') {
          const result = store.deleteItems(body.ids ?? [])
          return sendJson(res, 200, { ok: true, ...result, overview: store.overview(now) })
        }

        if (route === 'review') {
          const result = store.review(body.grades ?? [], now)
          return sendJson(res, 200, { ok: true, ...result, overview: store.overview(now) })
        }

        if (route === 'profile') {
          return sendJson(res, 200, { ok: true, profile: store.saveProfile(body, now) })
        }

        if (route === 'studylog') {
          return sendJson(res, 200, { ok: true, day: store.logStudy(body, now), overview: store.overview(now) })
        }

        if (route === 'exams') {
          const record = store.saveExam(body.exam ?? body, now)
          return sendJson(res, 200, { ok: true, exam: record, exams: store.listExams() })
        }

        if (route === 'exams/delete') {
          const result = store.deleteExams(body.ids ?? [])
          return sendJson(res, 200, { ok: true, ...result, exams: store.listExams() })
        }

        if (route === 'import') {
          const parsed = parseImport(body.text ?? '', body)
          if (body.dryRun === true) {
            return sendJson(res, 200, {
              ok: true,
              dryRun: true,
              format: parsed.format,
              count: parsed.items.length,
              warnings: parsed.warnings.slice(0, 20),
              preview: parsed.items.slice(0, 8),
            })
          }
          const result = store.upsertItems(parsed.items, now)
          return sendJson(res, 200, {
            ok: true,
            format: parsed.format,
            added: result.added.length,
            updated: result.updated.length,
            skipped: result.skipped,
            warnings: parsed.warnings.slice(0, 20),
            overview: store.overview(now),
          })
        }

        if (route === 'seed') {
          const result = store.upsertItems(seedItems(), now)
          return sendJson(res, 200, {
            ok: true,
            added: result.added.length,
            updated: result.updated.length,
            overview: store.overview(now),
          })
        }

        // 保存/更新一份动态演示（界面手工编辑场景，或从示例另存）
        if (route === 'demos') {
          const { scene, warnings } = normalizeScene(body.scene ?? body, {
            title: body.title, subject: body.subject, topic: body.topic,
          })
          const record = store.saveDemo({
            id: body.id,
            title: body.title ?? scene.title,
            kind: scene.kind,
            subject: scene.subject,
            topic: scene.topic,
            summary: sceneSummary(scene),
            keySteps: keySteps(scene),
            itemId: body.itemId,
            scene,
          }, now)
          return sendJson(res, 200, { ok: true, demo: record, warnings })
        }

        if (route === 'demos/delete') {
          const result = store.deleteDemos(body.ids ?? [])
          return sendJson(res, 200, { ok: true, ...result })
        }

        // 解析一份电子资料（只预览，不写库）
        if (route === 'docs/parse' || route === 'docs/import') {
          const filename = typeof body.filename === 'string' ? body.filename : ''
          let text = typeof body.text === 'string' ? body.text : ''
          let extracted = null
          if (text === '' && typeof body.base64 === 'string' && body.base64 !== '') {
            let buf
            try {
              buf = Buffer.from(body.base64, 'base64')
            } catch {
              return sendJson(res, 400, { ok: false, error: 'base64 解码失败' })
            }
            extracted = extractText(buf, filename)
            if (!extracted.ok) {
              return sendJson(res, 200, {
                ok: false,
                format: extracted.format,
                label: extracted.label,
                hint: extracted.hint,
                items: [],
              })
            }
            text = extracted.text
          }
          if (text.trim() === '') return sendJson(res, 400, { ok: false, error: '没有可解析的内容（既没有 text 也没有可识别的文件）' })

          const parsed = parseStudyText(text, {
            mode: body.mode === 'paper' || body.mode === 'courseware' ? body.mode : undefined,
            subject: body.subject,
            topic: body.topic,
            source: body.source ?? (filename !== '' ? filename.replace(/\.[a-z0-9]+$/i, '') : undefined),
            grade: body.grade,
          })

          const payload = {
            ok: true,
            mode: parsed.mode,
            format: extracted === null ? 'text' : extracted.format,
            label: extracted === null ? '粘贴文本' : extracted.label,
            title: parsed.title ?? '',
            subject: parsed.subject ?? null,
            confidence: parsed.confidence ?? 'high',
            confidenceReasons: parsed.confidenceReasons ?? [],
            sections: parsed.sections ?? [],
            stats: parsed.stats,
            warnings: [...(extracted === null ? [] : extracted.warnings), ...parsed.warnings].slice(0, 20),
            items: parsed.items,
            textLength: text.length,
          }

          if (route === 'docs/parse') return sendJson(res, 200, payload)

          // 可信度闸门：解析结果不像试卷时不写库，除非调用方明确 force
          // （界面上先让用户看预览，确认了再带 force 重发）
          if (payload.confidence === 'low' && body.force !== true && !Array.isArray(body.items)) {
            return sendJson(res, 200, { ...payload, ok: false, refused: true })
          }

          // 写库：优先用调用方回传的（用户可能在预览里改过），否则用刚解析的
          const incoming = Array.isArray(body.items) && body.items.length > 0 ? body.items : parsed.items
          const result = store.upsertItems(incoming, now)
          return sendJson(res, 200, {
            ...payload,
            added: result.added.length,
            updated: result.updated.length,
            skipped: result.skipped,
            overview: store.overview(now),
          })
        }

        return sendJson(res, 404, { ok: false, error: `未知路由 POST ${route}` })
      }

      return sendJson(res, 405, { ok: false, error: `不支持的方法 ${method}` })
    } catch (error) {
      deps.logger?.warn?.(`[dsh-highschool-tutor] API 失败：${String(error)}`)
      return sendJson(res, 500, { ok: false, error: String(error instanceof Error ? error.message : error) })
    }
  }
}
