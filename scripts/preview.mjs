// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 演示引擎预览器（开发/自测用）。
 *
 * 把 lib/examples.js 里的每个示例场景渲染成一份**独立可打开**的 HTML：引擎内联、
 * 场景直接交给 mount()，不依赖 DSH、不依赖网络。用途：
 *
 *   · 改完引擎后用浏览器（或无头 Chrome 截图）逐个看一眼，做视觉回归；
 *   · 给别人演示这个功能能画出什么，不必先装插件。
 *
 * 用法：
 *   node scripts/preview.mjs               # 输出到 .preview/
 *   node scripts/preview.mjs /tmp/out      # 输出到指定目录
 *   node scripts/preview.mjs --kind plot2d # 只生成某一种
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXAMPLES } from '../lib/examples.js'
import { frameRuntime, frameVersion } from '../lib/frame/index.js'
import { normalizeScene, sceneSummary } from '../lib/scene.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 亮色主题下的桥接变量（与 client 侧 resolveTheme 的兜底值一致）。 */
const THEME = {
  fg: '#0f1115',
  fg2: '#61666b',
  fg3: '#81858c',
  bg: '#ffffff',
  bg2: 'rgba(38,49,72,.05)',
  line: 'rgba(0,0,0,.12)',
  brand: '#3964fe',
  good: '#16a34a',
  warn: '#e08b1a',
  bad: '#dc2626',
  scheme: 'light',
}

/**
 * 生成一份预览文档。
 * @param {object} scene 已规范化的场景。
 * @param {string} runtime 引擎源码。
 * @param {number} width 预览宽度（px）。
 * @param {number|'last'} step 打开时停在第几步（'last' 表示最后一步）。
 * @returns {string} HTML 文档。
 */
function previewDoc(scene, runtime, width, step) {
  const total = (scene.steps ?? []).length
  const index = step === 'last' ? total - 1 : Math.max(0, Math.min(total - 1, Number(step) || 0))
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>预览 · ${scene.title}</title>
<style>
  body { margin: 0; padding: 16px; background: #fff; }
  #hst-root { width: ${width}px; margin: 0 auto; }
</style>
</head>
<body>
<div id="hst-root"></div>
<script>${runtime}
var player = globalThis.__HST__.mount({
  mode: 'panel',
  theme: ${JSON.stringify(THEME)},
  scene: ${JSON.stringify(scene)}
});
${index >= 0 ? `player.go(${index});` : ''}
</script>
</body>
</html>
`
}

const args = process.argv.slice(2)
let outDir = join(ROOT, '.preview')
let only = null
let step = 'last'
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--kind') { only = args[i + 1]; i += 1 } else if (args[i] === '--step') { step = args[i + 1]; i += 1 } else if (!args[i].startsWith('--')) outDir = resolve(args[i])
}

const { source } = frameRuntime()
mkdirSync(outDir, { recursive: true })

const written = []
for (const [kind, raw] of Object.entries(EXAMPLES)) {
  if (only !== null && kind !== only) continue
  const { scene, warnings } = normalizeScene(raw)
  const file = join(outDir, `${kind}.html`)
  writeFileSync(file, previewDoc(scene, source, kind === "html" ? 560 : 620, step), "utf8")
  written.push({ kind, file, summary: sceneSummary(scene), warnings })
}

console.log(`引擎指纹 ${frameVersion()} · 引擎源码 ${(source.length / 1024).toFixed(1)} KB`)
console.log(`输出目录 ${outDir}\n`)
for (const row of written) {
  console.log(`  ${row.kind.padEnd(11)} ${row.summary}`)
  for (const w of row.warnings) console.log(`      ⚠ ${w}`)
}
console.log(`\n共 ${written.length} 份预览。用浏览器打开任意一个 .html 即可交互。`)
