// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 生成可发布的演示画廊（docs/，直接就能挂 GitHub Pages）。
 *
 * 产物结构：
 *   docs/index.html      画廊首页，按学科分组列出全部演示
 *   docs/hst-engine.js   渲染引擎，**只出一份**，各页面用 <script src> 共享
 *   docs/<id>.html       每份演示一页（自包含：只依赖同目录的 hst-engine.js）
 *
 * 为什么不像 .preview/ 那样把引擎内联进每一页：画廊有十几页，内联会让仓库凭空多出
 * 两兆重复内容。这里页面之间共享引擎，总体积 ≈ 引擎一份 + 每页几 KB 的场景 JSON。
 *
 * 素材来自仓库内的两处（不依赖任何本地数据，clone 下来就能重新生成）：
 *   lib/examples.js  九种场景类型各一份代表样例
 *   lib/showcase.js  讲题时产出的完整演示
 *
 * 用法：
 *   node scripts/showcase.mjs            # 生成到 docs/
 *   node scripts/showcase.mjs /tmp/out   # 生成到指定目录
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXAMPLES } from '../lib/examples.js'
import { SHOWCASE } from '../lib/showcase.js'
import { frameRuntime, frameVersion } from '../lib/frame/index.js'
import { KIND_LABELS, keySteps, normalizeScene, sceneSummary } from '../lib/scene.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 学科展示名与配色（与插件内一致）。 */
const SUBJECTS = {
  math: { label: '数学', color: '#2f6df6' },
  physics: { label: '物理', color: '#0f9d8f' },
  chemistry: { label: '化学', color: '#e08b1a' },
  geography: { label: '地理', color: '#6b8f2f' },
  chinese: { label: '语文', color: '#d4483b' },
  english: { label: '英语', color: '#8b5cf6' },
}

/** 亮/暗两套桥接变量，页面按系统偏好切换。 */
const THEMES = {
  light: {
    fg: '#0f1115', fg2: '#61666b', fg3: '#81858c', bg: '#ffffff',
    bg2: 'rgba(38,49,72,.05)', line: 'rgba(0,0,0,.12)',
    brand: '#3964fe', good: '#16a34a', warn: '#e08b1a', bad: '#dc2626', scheme: 'light',
  },
  dark: {
    fg: '#e8eaed', fg2: '#a8adb4', fg3: '#82878e', bg: '#1b1d21',
    bg2: 'rgba(255,255,255,.06)', line: 'rgba(255,255,255,.14)',
    brand: '#6f8cff', good: '#3ec46d', warn: '#f0a93a', bad: '#f26a6a', scheme: 'dark',
  },
}

/** 转义 HTML 文本。 */
function esc(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

/** 页面公共样式。 */
const PAGE_CSS = `
:root{color-scheme:light dark;--pg-fg:#0f1115;--pg-fg2:#61666b;--pg-bg:#fff;--pg-card:#fff;--pg-line:rgba(0,0,0,.1)}
@media (prefers-color-scheme:dark){:root{--pg-fg:#e8eaed;--pg-fg2:#a8adb4;--pg-bg:#15171a;--pg-card:#1b1d21;--pg-line:rgba(255,255,255,.12)}}
*{box-sizing:border-box}
body{margin:0;background:var(--pg-bg);color:var(--pg-fg);
font:14px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 20px 60px}
a{color:inherit}
.top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:20px;margin:0;line-height:1.4}
.sub{color:var(--pg-fg2);font-size:13px;margin:0 0 22px}
.tag{font-size:11.5px;padding:2px 8px;border-radius:999px;color:#fff;white-space:nowrap}
.q{background:var(--pg-card);border:1px solid var(--pg-line);border-left:3px solid #3964fe;
border-radius:10px;padding:12px 14px;margin:0 0 18px;font-size:13.5px;white-space:pre-wrap}
.stage{background:var(--pg-card);border:1px solid var(--pg-line);border-radius:14px;padding:14px}
.back{display:inline-block;margin-bottom:16px;font-size:13px;color:var(--pg-fg2);text-decoration:none}
.back:hover{color:var(--pg-fg)}
.hint{color:var(--pg-fg2);font-size:12.5px;margin:14px 0 0}
.grid{display:grid;gap:10px}
.card{display:block;background:var(--pg-card);border:1px solid var(--pg-line);border-radius:12px;
padding:12px 14px;text-decoration:none}
.card:hover{border-color:#3964fe}
.card h3{margin:0 0 4px;font-size:14.5px;line-height:1.45;font-weight:600}
.card p{margin:0;font-size:12.5px;color:var(--pg-fg2)}
.sec{margin:26px 0 10px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}
.dot{width:9px;height:9px;border-radius:50%}
`

/**
 * 生成一份演示页。
 * @param {object} entry { id, title, scene, question, summary }。
 * @returns {string} HTML。
 */
function demoPage(entry) {
  const s = entry.scene
  const subject = SUBJECTS[s.subject] ?? null
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)} · 高中助学动态演示</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<a class="back" href="./index.html">← 返回全部演示</a>
<div class="top">
<h1>${esc(s.title)}</h1>
${subject === null ? '' : `<span class="tag" style="background:${subject.color}">${subject.label}</span>`}
</div>
<p class="sub">${esc(s.topic)} · ${esc(entry.summary)}</p>
${entry.question ? `<p class="q">${esc(entry.question)}</p>` : ''}
<div class="stage"><div id="hst-root"></div></div>
<p class="hint">点步骤编号或 ▶ 自动播放；★ 是重点步骤。2D 图可拖动平移、滚轮缩放；3D 图可拖动旋转、双击复位。键盘 ← → 切步，空格播放。</p>
</div>
<script src="./hst-engine.js"></script>
<script>
(function () {
  var NS = (typeof globalThis !== 'undefined' && globalThis.__HST__) || window.__HST__;
  var THEMES = ${JSON.stringify(THEMES)};
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var player = NS.mount({
    mode: 'panel',
    theme: dark ? THEMES.dark : THEMES.light,
    scene: ${JSON.stringify(s)}
  });
  // 跟随系统明暗切换：重新桥接调色板并重绘
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
      NS.applyTheme(ev.matches ? THEMES.dark : THEMES.light);
      player.render();
    });
  }
})();
</script>
</body>
</html>
`
}

/**
 * 生成画廊首页。
 * @param {object[]} entries 全部演示。
 * @param {string} version 引擎指纹。
 * @returns {string} HTML。
 */
function indexPage(entries, version) {
  const order = ['math', 'physics', 'chemistry', 'geography', 'chinese', 'english']
  const groups = new Map()
  for (const e of entries) {
    const key = e.scene.subject ?? 'other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(e)
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  const sections = keys.map((key) => {
    const subject = SUBJECTS[key] ?? { label: '通用', color: '#81858c' }
    const cards = groups.get(key).map((e) => `<a class="card" href="./${e.id}.html">
<h3>${esc(e.scene.title)}</h3>
<p>${esc(KIND_LABELS[e.scene.kind] ?? e.scene.kind)} · ${esc(e.scene.topic)} · ${e.steps} 个步骤${e.keys > 0 ? ` · ${e.keys} 个重点` : ''}</p>
</a>`).join('\n')
    return `<div class="sec"><span class="dot" style="background:${subject.color}"></span>${subject.label}</div>
<div class="grid">
${cards}
</div>`
  }).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>高中助学 · 动态演示画廊</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<h1>高中助学 · 动态演示画廊</h1>
<p class="sub">${entries.length} 份可交互演示，覆盖数学 / 物理 / 化学 / 地理。每份都带分步解题时间轴，★ 标出重点步骤。<br>
全部离线渲染：无网络请求、无第三方库，引擎 ${(frameRuntime().source.length / 1024).toFixed(0)} KB（指纹 ${esc(version)}）。</p>
${sections}
<p class="hint" style="margin-top:30px">
由 <a href="https://github.com/HokkaidoCOLA/dsh-highschool-tutor">dsh-highschool-tutor</a> 生成 ·
<code>node scripts/showcase.mjs</code> 可随时重新生成本画廊。
</p>
</div>
</body>
</html>
`
}

// ── 生成 ──────────────────────────────────────────────────────────────────────
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'docs')
mkdirSync(outDir, { recursive: true })

/** 收集素材：先 showcase（完整演示），再 examples（每种类型的代表样例）。 */
const raw = [
  ...SHOWCASE.map((s) => ({ id: s.id, scene: s.scene, question: s.question })),
  ...Object.entries(EXAMPLES).map(([kind, scene]) => ({ id: `example-${kind}`, scene, question: '' })),
]

const entries = []
let warned = 0
for (const item of raw) {
  const { scene, warnings } = normalizeScene(item.scene)
  if (warnings.length > 0) {
    warned += warnings.length
    console.error(`  ⚠ ${item.id}：${warnings.join('；')}`)
  }
  entries.push({
    id: item.id,
    scene,
    question: item.question,
    summary: sceneSummary(scene),
    steps: scene.steps.length,
    keys: keySteps(scene).length,
  })
}

const runtime = frameRuntime()
writeFileSync(join(outDir, 'hst-engine.js'), runtime.source, 'utf8')
for (const entry of entries) writeFileSync(join(outDir, `${entry.id}.html`), demoPage(entry), 'utf8')
writeFileSync(join(outDir, 'index.html'), indexPage(entries, runtime.version), 'utf8')
// GitHub Pages 默认会跑 Jekyll，加这个空文件跳过它（否则下划线开头的文件会被忽略）
writeFileSync(join(outDir, '.nojekyll'), '', 'utf8')

const engineKb = runtime.source.length / 1024
const pagesKb = entries.reduce((a, e) => a + demoPage(e).length, 0) / 1024
console.log(`引擎指纹 ${runtime.version} · 引擎 ${engineKb.toFixed(0)} KB（各页共享）· ${entries.length} 个页面共 ${pagesKb.toFixed(0)} KB`)
console.log(`输出目录 ${outDir}\n`)
for (const e of entries) {
  const kind = (KIND_LABELS[e.scene.kind] ?? e.scene.kind).padEnd(6, '　')
  console.log(`  ${e.id.padEnd(28)} ${kind} ${String(e.steps).padStart(2)} 步 / ${e.keys} 重点  ${e.scene.title}`)
}
console.log(`\n打开 ${join(outDir, 'index.html')} 即可浏览；推到 GitHub 后在仓库设置里把 Pages 源指向 /docs 就是在线版。`)
if (warned > 0) {
  console.error(`\n❌ 有 ${warned} 条规范化警告，请修掉后再发布`)
  process.exit(1)
}
