// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — host 半边（node 侧）。
 *
 * 一个面向高中三年（语数英物化地）的学习与巩固系统：
 *
 *   · 错题本 + 艾宾浩斯间隔复习（1→2→4→7→15→30→60→120 天，带 ease 微调）
 *   · 知识点/公式/古诗文卡片库（自带六科高频起始卡片包）
 *   · **讲题时自动生成动态演示**：声明式场景规范 → 2D/3D 交互图 + 分步解题演示
 *   · 12 个模型可调工具：对话里随手录题、抽查、批改、出图、记进度、报成绩
 *   · 每日计划与进度统计、连续天数、记忆保持率
 *   · 高考倒计时与模考成绩趋势
 *   · Markdown / CSV / Anki TSV 批量导入
 *
 * 职责划分：
 *   store.js     数据持久化（$DSH_HOME/highschool-tutor/*.json，原子写）
 *   srs.js       复习调度内核（纯函数）
 *   syllabus.js  六科知识大纲（人教版新教材）
 *   seed.js      内置起始卡片包
 *   importer.js  Markdown/CSV/TSV 解析
 *   scene.js     动态演示的场景规范（校验与规范化，纯函数）
 *   examples.js  九种场景的示例与字段速查（模型的 few-shot 样例）
 *   frame/       帧内渲染引擎（浏览器脚本）+ host 侧的沙箱文档装配
 *   api.js       浏览器侧 JSON 路由（前缀 /api/highschool-tutor）
 *   tools.js     模型可调工具定义
 *   client.js    浏览器半边：设置页分区 + 标题栏徽标 + 演示卡片 + 右侧停靠面板
 *
 * 所有注册（路由、工具）都挂在 ctx.effect 上，插件停用/热重载时自动清理。
 *
 * @module @dsh-external/dsh-highschool-tutor
 */

import { mastery } from './srs.js'
import { API_PREFIX, createApiHandler } from './api.js'
import { Store, dataDir } from './store.js'
import { createTools } from './tools.js'

/** Cordis 插件名。 */
export const name = 'dsh-highschool-tutor'

/** 硬依赖：工具注册表与内置 web 服务器。 */
export const inject = ['tools', 'webServer']

/** 插件配置默认值。 */
const DEFAULTS = {
  /** 是否在会话标题栏显示「待复习 / 倒计时」徽标。 */
  badge: true,
  /** 是否注册设置页分区（关掉后只保留模型工具与 API）。 */
  panel: true,
  /** 是否注册模型可调工具。 */
  tools: true,
  /** 是否启用动态演示 UI（对话内嵌卡片 + 右侧停靠面板）。 */
  demo: true,
  /** 新演示是否自动推到右侧栏显示（只作默认值，用户在侧栏勾选后以其偏好为准）。 */
  autoDock: true,
  /** 数据目录覆盖（默认 $DSH_HOME/highschool-tutor）。 */
  dataDir: null,
  /** 徽标轮询间隔（毫秒，最小 10 秒）。 */
  pollIntervalMs: 60_000,
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文。
 * @param {object|null} [rawConfig] 入口配置（cordis.patch.yml 里可覆写）。
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const dir = typeof config.dataDir === 'string' && config.dataDir.trim() !== '' ? config.dataDir : dataDir()
  const store = new Store(dir)
  const logger = ctx.logger ?? console

  // ── 浏览器侧 JSON API ────────────────────────────────────────────────────
  const handler = createApiHandler(store, { mastery, logger })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      // 客户端偏好通过 /meta 暴露：徽标开关等由 host 配置说话
      if ((req.method ?? 'GET').toUpperCase() === 'GET' && (req.url ?? '').includes('/meta')) {
        const patched = {
          writeHead: (status, headers) => res.writeHead(status, headers),
          end: (body) => {
            try {
              const parsed = JSON.parse(body)
              res.end(JSON.stringify({ ...parsed, ui: { badge: config.badge !== false, panel: config.panel !== false, demo: config.demo !== false, autoDock: config.autoDock !== false, pollIntervalMs: Math.max(10_000, Number(config.pollIntervalMs) || DEFAULTS.pollIntervalMs) } }))
            } catch {
              res.end(body)
            }
          },
        }
        return handler(req, patched)
      }
      return handler(req, res)
    },
  }), 'dsh-highschool-tutor: api')

  // ── 模型可调工具 ─────────────────────────────────────────────────────────
  if (config.tools !== false) {
    for (const tool of createTools(store)) {
      ctx.effect(() => ctx.tools.register(tool), `dsh-highschool-tutor: tool ${tool.name}`)
    }
  }

  const overview = store.overview()
  logger.info?.(`[dsh-highschool-tutor] 已就绪 · 题库 ${overview.totals.items} 条 · 今日待复习 ${overview.due.total} 条 · 数据目录 ${dir}`)
}
