// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 浏览器半边（client）。
 *
 * 本文件就是「已构建的客户端包」：一个通过 window.__ModuleLoader__.load 注册的
 * 惰性 CJS 工厂，与官方 @deepseek-ai/dsh-client-ui-* 插件的产物同一种线格式，
 * 因此无需 tsdown/构建链，改完刷新页面即生效。
 *
 * 注册两处 UI：
 *   ① settings.section  →「高中助学」独立设置分区，内含六个标签页：
 *        今日   倒计时、今日待复习、复习闯关（16:9 起步翻卡+四档评分）、快速记时长、薄弱点
 *        题库   六科错题/卡片检索、编辑、删除、导入（md/表格/csv/anki）、导出
 *        演示   已存的动态演示与九种内置示例，可预览、推到侧栏、删除
 *        计划   今日目标进度、各科建议分配、教材章节进度勾选、最近笔记
 *        统计   每日复习量与学习时长曲线、各科掌握度、记忆保持率、模考趋势
 *        设置   年级/高考日期/启用学科/每日目标、内置卡片包、数据位置
 *   ② conversation.session.header.utilities →「待复习 · 倒计时」徽标，
 *      点开是一个小面板：分学科待复习数 + 直接开始快速复习。
 *
 * 动态演示（讲题时模型调用 tutor_visualize 生成的 2D/3D 交互图）另注册两处：
 *   ③ tool.call.toolview（key='tutor_visualize'）→ 对话内嵌演示卡片，
 *      内容全部来自该次调用的持久化 meta，刷新页面与会话重放都能重新画出来。
 *   ④ shell.overlay → 右侧停靠面板，可拖宽、可切换最近演示、Esc 关闭。
 *
 * 演示本身跑在 <iframe sandbox="allow-scripts"> 里：文档取自 host 的
 * /api/highschool-tutor/frame.html（静态、内联引擎，整页只取一次），场景数据靠
 * postMessage 送进去——换题、跳步都不重建 iframe。
 *
 * 数据全部来自 host 半边的同源 JSON 路由 /api/highschool-tutor/*。
 *
 * @module @dsh-external/dsh-highschool-tutor/client
 */

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-highschool-tutor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ── 样式 ────────────────────────────────────────────────────────────────
    const CSS = [
      // 面板骨架
      '.hst_page{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary,#0f1115);padding:2px 0 18px;max-width:900px}',
      '.hst_head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.hst_title{margin:0;font-size:18px;font-weight:600;line-height:1.4}',
      '.hst_sub{margin:4px 0 0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.hst_tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l2,#0000001a);padding-bottom:0}',
      '.hst_tab{appearance:none;background:none;border:none;border-bottom:2px solid transparent;font:inherit;font-size:13.5px;color:var(--dsw-alias-label-secondary,#61666b);padding:7px 12px;cursor:pointer;border-radius:6px 6px 0 0}',
      '.hst_tab:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_tabOn{color:var(--dsw-alias-label-primary,#0f1115);font-weight:600;border-bottom-color:var(--dsw-alias-brand-primary,#3964fe)}',
      '.hst_body{display:flex;flex-direction:column;gap:14px}',
      // 卡片与栅格
      '.hst_card{border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-3,transparent)}',
      '.hst_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.hst_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
      '.hst_h3{margin:0;font-size:14px;font-weight:600;line-height:1.4}',
      '.hst_hint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#81858c)}',
      '.hst_mono{font-family:var(--dsw-font-mono,ui-monospace);font-variant-numeric:tabular-nums}',
      // 大数字
      '.hst_stat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-module-platform,#2631480a)}',
      '.hst_statNum{font-size:23px;font-weight:650;line-height:1.15;font-variant-numeric:tabular-nums}',
      '.hst_statLabel{font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b)}',
      // 学科色片
      '.hst_chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 9px;font-size:12px;line-height:1.5;border:1px solid transparent;cursor:pointer;background:none;font-family:inherit;color:inherit}',
      '.hst_chip:hover{filter:brightness(1.06)}',
      '.hst_chipDot{width:7px;height:7px;border-radius:50%;flex:none}',
      '.hst_chipNum{font-variant-numeric:tabular-nums;font-weight:600}',
      // 进度条
      '.hst_bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#26314814);overflow:hidden}',
      '.hst_barFill{height:100%;border-radius:999px;transition:width .35s ease}',
      '@media (prefers-reduced-motion: reduce){.hst_barFill{transition:none}}',
      // 按钮
      '.hst_btn{appearance:none;font:inherit;font-size:13px;border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#0f1115);border-radius:8px;padding:6px 13px;cursor:pointer;line-height:1.5}',
      '.hst_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_btn:disabled{opacity:.42;cursor:default}',
      '.hst_btnPrimary{background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-layer-3,#fff);border-color:transparent;font-weight:500}',
      '.hst_btnSm{padding:3px 9px;font-size:12px;border-radius:7px}',
      '.hst_btnDanger{color:var(--dsw-alias-state-error-primary,#dc2626)}',
      // 表单
      '.hst_field{display:flex;flex-direction:column;gap:5px}',
      '.hst_label{font-size:12.5px;font-weight:500;line-height:1.5}',
      '.hst_input,.hst_select,.hst_textarea{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-3,#fff);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary,#0f1115);border-radius:8px;padding:7px 10px;line-height:1.55;width:100%;box-sizing:border-box}',
      '.hst_input:focus-visible,.hst_select:focus-visible,.hst_textarea:focus-visible{border-color:var(--dsw-alias-brand-primary,#3964fe);outline:none}',
      '.hst_textarea{min-height:74px;resize:vertical;font-family:inherit}',
      '.hst_inputSm{padding:4px 8px;font-size:12.5px;width:auto}',
      '.hst_check{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}',
      // 复习闯关：16:9 是最矮高度（JS 按卡片宽度换算成 --hst-minh，封顶 60vh），
      // 内容多时卡片随内容长高——题干/答案/解析一次全部可见，卡片内部不滚动
      '.hst_review{display:flex;flex-direction:column;gap:12px}',
      '.hst_reviewStage{width:100%;min-height:min(var(--hst-minh,0px),60vh);margin-inline:auto}',
      '.hst_reviewBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:12px}',
      '.hst_reviewFoot{display:flex;flex-direction:column;gap:10px}',
      '.hst_reviewEnd{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center}',
      '.hst_reviewTop{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.hst_q{font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word}',
      '.hst_a{font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-module-platform,#2631480a);border-left:3px solid var(--dsw-alias-state-success-primary,#16a34a)}',
      '.hst_expl{font-size:12px;line-height:1.65;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.hst_grades{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
      '.hst_gradeBtn{appearance:none;font:inherit;border-radius:9px;padding:8px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#0f1115)}',
      '.hst_gradeBtn:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_gradeKey{font-size:13px;font-weight:600}',
      '.hst_gradeSub{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#81858c);font-variant-numeric:tabular-nums}',
      // 动态演示：内嵌卡片
      '.hst_frame{display:block;width:100%;border:0;background:transparent;color-scheme:normal;border-radius:10px}',
      '.hst_frameSkeleton{width:100%;border-radius:10px;background:var(--dsw-alias-bg-module-platform,#2631480a)}',
      // 对话内嵌卡片：画布固定 16:9（高度由宽度决定），停靠/侧栏面板仍按内容自适应
      '.hst_frameCard{aspect-ratio:16 / 9;height:auto}',
      '.hst_frameSkeletonCard{aspect-ratio:16 / 9;height:auto}',
      '.hst_toolCard{display:flex;flex-direction:column;gap:6px;margin:2px 0 4px}',
      // 已推到侧栏时卡片让位：只留一条标题行，不再重复渲染画布
      '.hst_toolCardDocked{border-left:2px solid var(--dsw-alias-brand-primary,#3964fe);padding-left:9px;gap:5px}',
      '.hst_toolLine{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);padding:2px 0}',
      '.hst_toolHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.hst_toolTitle{font-size:13px;font-weight:600;line-height:1.4}',
      '.hst_toolMeta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#81858c);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 重点步骤芯片
      '.hst_keyRow{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.hst_keyLabel{font-size:10.5px;font-weight:600;color:#fff;background:#e08b1a;padding:1px 6px;border-radius:4px;flex:none}',
      '.hst_keyChip{appearance:none;font:inherit;font-size:11.5px;line-height:1.5;padding:2px 8px;border-radius:6px;cursor:pointer;',
      'border:1px solid #e08b1a66;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);text-align:left}',
      '.hst_keyChip:hover{background:#e08b1a1f}',
      '.hst_keyChipOn{background:#e08b1a;border-color:transparent;color:#fff;font-weight:500}',
      // better-sidebar 页签
      '.hst_bsTab{display:flex;flex-direction:column;gap:8px;padding:10px 12px 16px;height:100%;overflow-y:auto}',
      '.hst_bsHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:none}',
      '.hst_bsTitle{font-size:13px;font-weight:600;flex:1;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 右侧停靠面板
      '.hst_dock{position:fixed;right:12px;top:60px;bottom:14px;display:flex;flex-direction:column;gap:8px;',
      'background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#0000001f);border-radius:14px;',
      'box-shadow:0 10px 34px #0000002e;padding:10px 12px 12px;pointer-events:auto;z-index:40;overflow:hidden}',
      '.hst_dockGrip{position:absolute;left:0;top:0;bottom:0;width:8px;cursor:col-resize;border-radius:14px 0 0 14px}',
      '.hst_dockGrip:hover{background:var(--dsw-alias-brand-primary,#3964fe);opacity:.22}',
      '.hst_dockHead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none}',
      '.hst_dockTitle{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;min-width:0;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
      '.hst_dockDot{width:8px;height:8px;border-radius:50%;flex:none}',
      '.hst_dockBody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px}',
      '.hst_dockList{flex:none;max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;',
      'border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:9px;padding:5px}',
      '.hst_dockItem{appearance:none;font:inherit;text-align:left;background:none;border:none;border-radius:7px;',
      'padding:5px 7px;cursor:pointer;display:flex;flex-direction:column;gap:1px;color:inherit}',
      '.hst_dockItem:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_dockItemOn{background:var(--dsw-alias-interactive-bg-hover,#26314814);font-weight:600}',
      '.hst_dockItemT{font-size:12.5px;line-height:1.4}',
      '.hst_dockItemM{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c)}',
      // 演示标签页
      '.hst_demoList{display:flex;flex-direction:column;gap:2px}',
      '.hst_demoRow{display:flex;align-items:center;gap:8px;padding:5px 2px;border-bottom:1px solid var(--dsw-alias-border-l2,#0000000f)}',
      '.hst_demoName{appearance:none;font:inherit;font-size:13px;background:none;border:none;padding:0;cursor:pointer;',
      'color:var(--dsw-alias-label-primary,#0f1115);text-align:left;flex:1;min-width:0}',
      '.hst_demoName:hover{color:var(--dsw-alias-brand-primary,#3964fe)}',
      '.hst_demoMeta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap}',
      // 资料导入
      '.hst_docList{display:flex;flex-direction:column;gap:2px;max-height:420px;overflow-y:auto;',
      'border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:9px;padding:6px}',
      '.hst_docRow{display:flex;gap:8px;align-items:flex-start;padding:6px 6px;border-radius:7px;cursor:pointer}',
      '.hst_docRow:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_docRowOff{opacity:.45}',
      '.hst_docBody{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.hst_docQ{font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
      '.hst_docM{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c)}',
      '.hst_warnBox{border:1px solid #e08b1a66;background:#e08b1a14;border-radius:9px;padding:8px 10px;',
      'display:flex;flex-direction:column;gap:6px;font-size:12.5px}',
      // 左侧栏底部的演示入口
      '.hst_launch{appearance:none;font:inherit;font-size:13px;display:flex;align-items:center;gap:8px;width:100%;',
      'padding:7px 9px;border-radius:9px;border:none;background:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#61666b);text-align:left}',
      '.hst_launch:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}',
      '.hst_launch:disabled{opacity:.5;cursor:default}',
      '.hst_launchRail{width:auto;justify-content:center;padding:8px}',
      '.hst_launchOn{color:var(--dsw-alias-brand-primary,#3964fe)}',
      '.hst_launchLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hst_launchNum{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#81858c)}',
      '@media (max-width: 900px){.hst_dock{left:12px;width:auto!important}}',
      // 列表
      '.hst_list{display:flex;flex-direction:column;gap:8px}',
      '.hst_item{border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;cursor:pointer}',
      '.hst_item:hover{background:var(--dsw-alias-interactive-bg-hover,#26314808)}',
      '.hst_itemHead{display:flex;align-items:flex-start;gap:8px}',
      '.hst_itemQ{flex:1;font-size:13.5px;line-height:1.6;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}',
      '.hst_itemQOpen{-webkit-line-clamp:unset;white-space:pre-wrap}',
      '.hst_meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#81858c);display:flex;gap:8px;flex-wrap:wrap;font-variant-numeric:tabular-nums}',
      '.hst_tag{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#2631480f);color:var(--dsw-alias-label-secondary,#61666b)}',
      '.hst_empty{padding:22px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#81858c);line-height:1.8}',
      '.hst_err{font-size:12.5px;color:var(--dsw-alias-state-error-primary,#dc2626);line-height:1.6}',
      '.hst_ok{font-size:12.5px;color:var(--dsw-alias-state-success-primary,#16a34a);line-height:1.6}',
      // 大纲
      '.hst_chapters{display:flex;flex-direction:column;gap:4px}',
      '.hst_chapter{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 6px;border-radius:7px;cursor:pointer;line-height:1.6}',
      '.hst_chapter:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_chapterDone{color:var(--dsw-alias-label-tertiary,#81858c);text-decoration:line-through}',
      // 徽标
      '.hst_badge{display:inline-flex;align-items:center;gap:7px;height:46px;padding:0 10px;border-radius:14px;cursor:pointer;border:none;background:none;font:inherit;color:inherit;font-variant-numeric:tabular-nums}',
      '.hst_badge:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.hst_badgeNum{font-size:13px;font-weight:600;line-height:1}',
      '.hst_badgeLabel{font-size:9px;line-height:1.1;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.hst_badgeCol{display:flex;flex-direction:column;align-items:center;gap:2px}',
      '.hst_pop{position:absolute;top:52px;right:0;z-index:60;width:390px;max-width:min(390px,92vw);max-height:72vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 12px 32px #0000002e;padding:14px;display:flex;flex-direction:column;gap:12px}',
      '.hst_popWrap{position:relative;display:inline-flex}',
      // 图表
      '.hst_chart{width:100%;overflow:visible}',
      '.hst_chartCap{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    ].join('')

    const STYLE_ID = 'dsh-highschool-tutor/panel.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-highschool-tutor'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── 常量与工具 ──────────────────────────────────────────────────────────
    const API = '/api/highschool-tutor'

    /** 六科定义（与 host 侧 subjects.js 保持一致；浏览器包无法跨包 import）。 */
    const SUBJECTS = [
      { key: 'chinese', label: '语文', short: '语', color: '#d4483b' },
      { key: 'math', label: '数学', short: '数', color: '#2f6df6' },
      { key: 'english', label: '英语', short: '英', color: '#8b5cf6' },
      { key: 'physics', label: '物理', short: '物', color: '#0f9d8f' },
      { key: 'chemistry', label: '化学', short: '化', color: '#e08b1a' },
      { key: 'geography', label: '地理', short: '地', color: '#6b8f2f' },
    ]
    const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map((s) => [s.key, s]))
    const GRADE_LABELS = { g1: '高一', g2: '高二', g3: '高三' }
    const STATUS_LABELS = { new: '未学', learning: '巩固中', review: '复习中' }
    /** 演示场景类型的中文名（与 host 侧 scene.js 的 KIND_LABELS 保持一致）。 */
    const KIND_LABELS = {
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
    const GRADE_BUTTONS = [
      { key: 'again', label: '重来', hint: '不会', color: '#dc2626' },
      { key: 'hard', label: '困难', hint: '吃力', color: '#e08b1a' },
      { key: 'good', label: '良好', hint: '掌握', color: '#2f6df6' },
      { key: 'easy', label: '简单', hint: '秒杀', color: '#16a34a' },
    ]

    /**
     * 学科展示信息。
     * @param {string} key 学科键。
     * @returns {{key: string, label: string, short: string, color: string}} 展示信息。
     */
    const subjectOf = (key) => SUBJECT_MAP[key] ?? { key, label: key, short: '?', color: '#8b8f96' }

    /**
     * 间隔天数 → 中文描述。
     * @param {number} days 天数。
     * @returns {string} 描述。
     */
    function fmtInterval(days) {
      if (!Number.isFinite(days) || days <= 0) return '20 分钟'
      if (days < 30) return `${Math.round(days * 10) / 10} 天`
      if (days < 365) return `${Math.round((days / 30) * 10) / 10} 月`
      return `${Math.round((days / 365) * 10) / 10} 年`
    }

    /**
     * 百分比裁剪。
     * @param {number} value 分子。
     * @param {number} total 分母。
     * @returns {number} 0-100 的整数。
     */
    function pct(value, total) {
      if (!Number.isFinite(total) || total <= 0) return 0
      return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
    }

    /** 掌握度 → 颜色。 */
    const masteryColor = (m) => (m >= 75 ? '#16a34a' : m >= 45 ? '#e08b1a' : '#dc2626')

    // ── API 与刷新总线 ──────────────────────────────────────────────────────
    /** 任何写操作后广播，让面板与徽标同时刷新。 */
    const bus = {
      listeners: new Set(),
      emit() { for (const fn of [...this.listeners]) { try { fn() } catch { /* 单个订阅者失败不影响其他 */ } } },
      on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
    }

    /**
     * GET 同源 JSON。
     * @param {string} path API 相对路径。
     * @returns {Promise<any>} 响应体。
     */
    async function apiGet(path) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.json()
    }

    /**
     * POST 同源 JSON，并在成功后广播刷新。
     * @param {string} path API 相对路径。
     * @param {object} [body] 请求体。
     * @returns {Promise<any>} 响应体。
     */
    async function apiPost(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `${response.status} ${response.statusText}`)
      bus.emit()
      return data
    }

    /**
     * 通用「加载一个 GET 资源」Hook：随总线自动重取。
     * @param {string|null} path API 路径（null 表示暂不请求）。
     * @returns {{data: any, error: string|null, loading: boolean, reload: () => void}} 状态。
     */
    function useResource(path) {
      const [state, setState] = React.useState({ data: null, error: null, loading: path !== null })
      const load = React.useCallback(() => {
        if (path === null) return
        let alive = true
        setState((s) => ({ ...s, loading: s.data === null }))
        apiGet(path).then(
          (data) => { if (alive) setState({ data, error: null, loading: false }) },
          (error) => { if (alive) setState({ data: null, error: String(error.message ?? error), loading: false }) },
        )
        return () => { alive = false }
      }, [path])
      React.useEffect(() => {
        const cancel = load()
        const off = bus.on(() => { load() })
        return () => { off(); if (typeof cancel === 'function') cancel() }
      }, [load])
      return { ...state, reload: load }
    }

    // ── 基础组件 ────────────────────────────────────────────────────────────
    /** 学科色片（可点击）。 */
    function Chip({ subject, count, active, onClick, title }) {
      const s = subjectOf(subject)
      return h('button', {
        className: 'hst_chip',
        type: 'button',
        title: title ?? s.label,
        onClick,
        style: {
          background: active === true ? `${s.color}1f` : 'var(--dsw-alias-bg-module-platform,#2631480a)',
          borderColor: active === true ? s.color : 'transparent',
          cursor: onClick === undefined ? 'default' : 'pointer',
        },
      }, [
        h('span', { key: 'd', className: 'hst_chipDot', style: { background: s.color } }),
        h('span', { key: 'l' }, s.label),
        count === undefined ? null : h('span', { key: 'n', className: 'hst_chipNum' }, String(count)),
      ])
    }

    /** 细进度条。 */
    function Bar({ value, total, color }) {
      const p = pct(value, total)
      return h('div', { className: 'hst_bar' }, h('div', {
        className: 'hst_barFill',
        style: { width: `${p}%`, background: color ?? 'var(--dsw-alias-brand-primary,#3964fe)' },
      }))
    }

    /** 大数字统计块。 */
    function Stat({ num, label, color, sub }) {
      return h('div', { className: 'hst_stat' }, [
        h('div', { key: 'n', className: 'hst_statNum', style: color === undefined ? undefined : { color } }, num),
        h('div', { key: 'l', className: 'hst_statLabel' }, label),
        sub === undefined ? null : h('div', { key: 's', className: 'hst_chartCap' }, sub),
      ])
    }

    /** 表单字段包装。 */
    function Field({ label, hint, children }) {
      return h('div', { className: 'hst_field' }, [
        h('label', { key: 'l', className: 'hst_label' }, label),
        children,
        hint === undefined ? null : h('p', { key: 'h', className: 'hst_hint' }, hint),
      ])
    }

    /** 双轴迷你柱状图：柱=复习量，折线=学习分钟。 */
    function DailyChart({ series }) {
      if (!Array.isArray(series) || series.length === 0) return h('p', { className: 'hst_hint' }, '暂无数据')
      const W = 640
      const H = 130
      const padB = 18
      const maxR = Math.max(1, ...series.map((d) => d.reviews))
      const maxM = Math.max(1, ...series.map((d) => d.minutes))
      const bw = W / series.length
      const bars = series.map((d, i) => {
        const barH = ((H - padB) * d.reviews) / maxR
        return h('rect', {
          key: `b${i}`,
          x: i * bw + bw * 0.18,
          y: H - padB - barH,
          width: bw * 0.64,
          height: Math.max(0, barH),
          rx: Math.min(3, bw * 0.3),
          fill: 'var(--dsw-alias-brand-primary,#3964fe)',
          opacity: 0.82,
        })
      })
      const pts = series.map((d, i) => `${i * bw + bw / 2},${H - padB - ((H - padB) * d.minutes) / maxM}`).join(' ')
      const labels = series.map((d, i) => (
        i % Math.ceil(series.length / 7) === 0
          ? h('text', { key: `t${i}`, x: i * bw + bw / 2, y: H - 5, textAnchor: 'middle', fontSize: 9, fill: 'var(--dsw-alias-label-tertiary,#81858c)' }, d.date.slice(5))
          : null
      ))
      return h('div', null, [
        h('svg', { key: 'svg', className: 'hst_chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', height: 130 }, [
          ...bars,
          h('polyline', { key: 'line', points: pts, fill: 'none', stroke: '#e08b1a', strokeWidth: 1.8, strokeLinejoin: 'round' }),
          ...labels,
        ]),
        h('div', { key: 'cap', className: 'hst_chartCap' }, `柱=每日复习量（峰值 ${maxR}）· 折线=每日学习分钟（峰值 ${maxM}）`),
      ])
    }

    /** 模考总分趋势折线。 */
    function ExamChart({ trend }) {
      if (!Array.isArray(trend) || trend.length === 0) return h('p', { className: 'hst_hint' }, '还没有模考记录')
      const W = 640
      const H = 140
      const pad = 24
      const values = trend.map((e) => e.percent ?? 0)
      const min = Math.max(0, Math.min(...values) - 5)
      const max = Math.min(100, Math.max(...values) + 5)
      const span = Math.max(1, max - min)
      const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, trend.length - 1)
      const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2)
      const pts = trend.map((e, i) => `${x(i)},${y(e.percent ?? 0)}`).join(' ')
      return h('div', null, [
        h('svg', { key: 'svg', className: 'hst_chart', viewBox: `0 0 ${W} ${H}`, height: 140 }, [
          h('polyline', { key: 'l', points: pts, fill: 'none', stroke: 'var(--dsw-alias-brand-primary,#3964fe)', strokeWidth: 2 }),
          ...trend.map((e, i) => h('circle', { key: `c${i}`, cx: x(i), cy: y(e.percent ?? 0), r: 3.5, fill: 'var(--dsw-alias-brand-primary,#3964fe)' })),
          ...trend.map((e, i) => h('text', { key: `v${i}`, x: x(i), y: y(e.percent ?? 0) - 9, textAnchor: 'middle', fontSize: 10, fill: 'var(--dsw-alias-label-secondary,#61666b)' }, String(e.total))),
          ...trend.map((e, i) => h('text', { key: `d${i}`, x: x(i), y: H - 6, textAnchor: 'middle', fontSize: 9, fill: 'var(--dsw-alias-label-tertiary,#81858c)' }, e.date.slice(5))),
        ]),
        h('div', { key: 'cap', className: 'hst_chartCap' }, '纵轴为总分得分率（%），点上数字为总分'),
      ])
    }

    // ── 复习闯关 ────────────────────────────────────────────────────────────
    /**
     * 翻卡复习器：取今日队列 → 显示题干 → 显示答案 → 四档评分 → 下一题。
     * 卡片以 16:9 为最矮高度（封顶 60vh），内容多时随内容长高：
     * 题干/答案/解析一次全部可见，卡片内部不需要滚动；
     * 键盘：空格/回车翻面，1-4 评分，Esc 退出。
     * @param {{subject?: string, compact?: boolean, onExit?: () => void}} props 属性。
     * @returns {object} React 元素。
     */
    function ReviewRunner({ subject, compact, onExit }) {
      const [queue, setQueue] = React.useState(null)
      const [idx, setIdx] = React.useState(0)
      const [revealed, setRevealed] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [tally, setTally] = React.useState({ again: 0, hard: 0, good: 0, easy: 0 })
      const startRef = React.useRef(Date.now())
      // 16:9 是最矮高度：ResizeObserver 按卡片宽度换算成 --hst-minh（封顶 60vh），
      // 内容多时卡片随内容长高——题干/答案/解析一次全部可见，卡片内部不用滚动。
      const stageRef = React.useRef(null)
      const [minH, setMinH] = React.useState(null)
      React.useEffect(() => {
        const el = stageRef.current
        if (el === null || typeof ResizeObserver === 'undefined') return undefined
        const ro = new ResizeObserver((list) => {
          const first = list[0]
          if (first === undefined) return
          setMinH(`${Math.round((first.contentRect.width * 9) / 16)}px`)
        })
        ro.observe(el)
        return () => ro.disconnect()
      }, [])
      const stageStyle = minH === null ? undefined : { '--hst-minh': minH }

      const load = React.useCallback(() => {
        setError(null)
        apiGet(`/queue?limit=${compact === true ? 12 : 30}${subject ? `&subject=${subject}` : ''}`).then(
          (data) => { setQueue(data); setIdx(0); setRevealed(false); startRef.current = Date.now() },
          (e) => setError(String(e.message ?? e)),
        )
      }, [subject, compact])

      React.useEffect(() => { load() }, [load])

      const items = queue?.items ?? []
      const item = items[idx] ?? null

      const grade = React.useCallback((key) => {
        const current = items[idx] ?? null
        if (current === null) return
        const elapsedMs = Date.now() - startRef.current
        startRef.current = Date.now()
        setTally((t) => ({ ...t, [key]: t[key] + 1 }))
        setRevealed(false)
        setIdx((i) => i + 1)
        apiPost('/review', { grades: [{ id: current.id, grade: key, elapsedMs }] }).catch((e) => setError(String(e.message ?? e)))
      }, [items, idx])

      // 键盘操作（输入框内不拦截）
      React.useEffect(() => {
        const onKey = (event) => {
          const target = event.target
          if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
          if (item === null) return
          if (event.key === 'Escape' && onExit !== undefined) { onExit(); return }
          if (!revealed && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setRevealed(true); return }
          if (revealed) {
            const map = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }
            if (map[event.key] !== undefined) { event.preventDefault(); grade(map[event.key]) }
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [revealed, item, grade, onExit])

      if (error !== null) {
        return h('div', { ref: stageRef, style: stageStyle, className: 'hst_card hst_review hst_reviewStage' }, [
          h('div', { key: 'e', className: 'hst_reviewEnd' }, [
            h('p', { key: 't', className: 'hst_err' }, `复习队列加载失败：${error}`),
            h('div', { key: 'a', className: 'hst_row' }, [
              h('button', { key: 'r', className: 'hst_btn', type: 'button', onClick: load }, '重试'),
              onExit === undefined ? null : h('button', { key: 'x', className: 'hst_btn', type: 'button', onClick: onExit }, '返回'),
            ]),
          ]),
        ])
      }
      if (queue === null) return h('div', { ref: stageRef, style: stageStyle, className: 'hst_card hst_review hst_reviewStage' }, h('div', { className: 'hst_reviewEnd' }, h('p', { className: 'hst_hint' }, '正在取今日队列…')))

      if (item === null) {
        const done = tally.again + tally.hard + tally.good + tally.easy
        return h('div', { ref: stageRef, style: stageStyle, className: 'hst_card hst_review hst_reviewStage' }, [
          h('div', { key: 'd', className: 'hst_reviewEnd' }, [
            h('div', { key: 't', className: 'hst_empty' }, done > 0
              ? `本轮完成 ${done} 题 · 掌握 ${tally.good + tally.easy} · 吃力 ${tally.hard} · 需重来 ${tally.again}\n答错的题会在 20 分钟后重新进入队列`
              : items.length === 0 && queue.counts.pool === 0
                ? '题库还是空的。先在「题库」标签导入内置卡片包，或在对话里让我把错题录进来。'
                : '今日队列已清空，休息一下 🎉'),
            h('div', { key: 'a', className: 'hst_row', style: { justifyContent: 'center' } }, [
              h('button', { key: 'r', className: 'hst_btn', type: 'button', onClick: load }, '再取一轮'),
              onExit === undefined ? null : h('button', { key: 'x', className: 'hst_btn hst_btnPrimary', type: 'button', onClick: onExit }, '完成'),
            ]),
          ]),
        ])
      }

      const s = subjectOf(item.subject)
      return h('div', { ref: stageRef, style: stageStyle, className: 'hst_card hst_review hst_reviewStage' }, [
        h('div', { key: 'top', className: 'hst_reviewTop' }, [
          h('div', { key: 'l', className: 'hst_row' }, [
            h(Chip, { key: 'c', subject: item.subject, active: true }),
            item.topic === '' ? null : h('span', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, item.topic),
            h('span', { key: 'k', className: 'hst_tag' }, item.kind === 'mistake' ? '错题' : '知识卡'),
            h('span', { key: 'd', className: 'hst_tag' }, `难度 ${item.difficulty}`),
          ]),
          h('div', { key: 'r', className: 'hst_row' }, [
            h('span', { key: 'p', className: 'hst_meta' }, `${idx + 1} / ${items.length}`),
            onExit === undefined ? null : h('button', { key: 'x', className: 'hst_btn hst_btnSm', type: 'button', onClick: onExit }, '退出'),
          ]),
        ]),
        h(Bar, { key: 'bar', value: idx, total: items.length, color: s.color }),
        h('div', { key: 'body', className: 'hst_reviewBody' }, [
          h('div', { key: 'q', className: 'hst_q' }, item.question),
          revealed
            ? h('div', { key: 'ans', style: { display: 'flex', flexDirection: 'column', gap: 10 } }, [
              h('div', { key: 'a', className: 'hst_a' }, item.answer === '' ? '（这张卡没有填答案）' : item.answer),
              item.explanation === '' ? null : h('div', { key: 'e', className: 'hst_expl' }, `解析：${item.explanation}`),
              h('div', { key: 'm', className: 'hst_meta' }, [
                h('span', { key: 's' }, STATUS_LABELS[item.srs.state] ?? item.srs.state),
                h('span', { key: 'r' }, `已复习 ${item.srs.reps} 次`),
                h('span', { key: 'l' }, `遗忘 ${item.srs.lapses} 次`),
                h('span', { key: 'ms' }, `掌握度 ${item.masteryScore}`),
                item.source === '' ? null : h('span', { key: 'src' }, `来源 ${item.source}`),
              ]),
            ])
            : null,
        ]),
        h('div', { key: 'foot', className: 'hst_reviewFoot' }, revealed
          ? [
            h('div', { key: 'g', className: 'hst_grades' }, GRADE_BUTTONS.map((g) => h('button', {
              key: g.key,
              type: 'button',
              className: 'hst_gradeBtn',
              onClick: () => grade(g.key),
              style: { borderColor: `${g.color}55` },
            }, [
              h('span', { key: 'l', className: 'hst_gradeKey', style: { color: g.color } }, g.label),
              h('span', { key: 's', className: 'hst_gradeSub' }, `${g.hint} · ${fmtInterval(item.preview?.[g.key])}`),
            ]))),
            h('p', { key: 'kb', className: 'hst_hint' }, '键盘：1 重来 · 2 困难 · 3 良好 · 4 简单'),
          ]
          : [
            h('div', { key: 'reveal', className: 'hst_row' }, [
              h('button', { key: 'b', className: 'hst_btn hst_btnPrimary', type: 'button', onClick: () => setRevealed(true) }, '显示答案（空格）'),
              h('span', { key: 'h', className: 'hst_hint' }, '先在心里/纸上作答，再翻面评分'),
            ]),
          ]),
      ])
    }

    // ── 今日 ────────────────────────────────────────────────────────────────
    /**
     * 今日标签页：倒计时、目标进度、待复习分布、快速记时长、薄弱点。
     * @param {{overview: object, onGoLibrary: (filter: object) => void}} props 属性。
     * @returns {object} React 元素。
     */
    function TodayTab({ overview, onGoLibrary }) {
      const [running, setRunning] = React.useState(null) // null | { subject?: string }
      const [logSubject, setLogSubject] = React.useState('math')
      const [logMsg, setLogMsg] = React.useState(null)

      const addMinutes = (minutes) => {
        apiPost('/studylog', { subject: logSubject, minutes }).then(
          () => setLogMsg(`已记 ${subjectOf(logSubject).label} ${minutes} 分钟`),
          (e) => setLogMsg(`记录失败：${String(e.message ?? e)}`),
        )
      }

      if (running !== null) {
        return h('div', { className: 'hst_body' }, [
          h('div', { key: 'h', className: 'hst_row' }, [
            h('span', { key: 't', className: 'hst_h3' }, running.subject === undefined ? '全科复习' : `${subjectOf(running.subject).label}复习`),
            h('span', { key: 'k', className: 'hst_hint' }, 'Esc 退出'),
          ]),
          h(ReviewRunner, { key: 'r', subject: running.subject, onExit: () => setRunning(null) }),
        ])
      }

      const due = overview.due
      const study = overview.study
      const subjectsWithDue = SUBJECTS.filter((s) => (due.bySubject[s.key] ?? 0) + (due.newBySubject[s.key] ?? 0) > 0)

      return h('div', { className: 'hst_body' }, [
        // 顶部四个数字
        h('div', { key: 'stats', className: 'hst_grid' }, [
          h(Stat, {
            key: 'cd',
            num: overview.countdown.days === null ? '—' : overview.countdown.days,
            label: overview.countdown.days === null ? '高考日期未设置' : `天后高考（${overview.countdown.examDate}）`,
            color: overview.countdown.days !== null && overview.countdown.days < 100 ? '#dc2626' : undefined,
          }),
          h(Stat, { key: 'due', num: due.total + due.new, label: '今日待复习', sub: `到期 ${due.total} · 新卡 ${due.new}${due.learning > 0 ? ` · 巩固中 ${due.learning}` : ''}` }),
          h(Stat, { key: 'done', num: `${study.reviewedToday}/${study.reviewTarget}`, label: '今日已复习', sub: study.againToday > 0 ? `其中 ${study.againToday} 次答错` : '正确率良好' }),
          h(Stat, { key: 'min', num: `${study.minutes}/${study.target}`, label: '今日学习（分钟）', sub: `连续 ${study.streak} 天` }),
        ]),
        // 目标进度
        h('div', { key: 'goal', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '今日目标'),
          h('div', { key: 'r1' }, [
            h('div', { key: 'l', className: 'hst_meta', style: { justifyContent: 'space-between' } }, [
              h('span', { key: 'a' }, `复习 ${study.reviewedToday} / ${study.reviewTarget} 条`),
              h('span', { key: 'b' }, `${pct(study.reviewedToday, study.reviewTarget)}%`),
            ]),
            h(Bar, { key: 'b', value: study.reviewedToday, total: study.reviewTarget, color: '#3964fe' }),
          ]),
          h('div', { key: 'r2' }, [
            h('div', { key: 'l', className: 'hst_meta', style: { justifyContent: 'space-between' } }, [
              h('span', { key: 'a' }, `学习 ${study.minutes} / ${study.target} 分钟`),
              h('span', { key: 'b' }, `${pct(study.minutes, study.target)}%`),
            ]),
            h(Bar, { key: 'b', value: study.minutes, total: study.target, color: '#e08b1a' }),
          ]),
        ]),
        // 开始复习
        h('div', { key: 'go', className: 'hst_card' }, [
          h('div', { key: 'h', className: 'hst_row', style: { justifyContent: 'space-between' } }, [
            h('h3', { key: 't', className: 'hst_h3' }, '开始复习'),
            h('button', {
              key: 'b',
              className: 'hst_btn hst_btnPrimary',
              type: 'button',
              disabled: due.total + due.new === 0,
              onClick: () => setRunning({}),
            }, due.total + due.new === 0 ? '今日已清空' : `全科复习（${due.total + due.new} 条）`),
          ]),
          subjectsWithDue.length === 0
            ? h('p', { key: 'e', className: 'hst_hint' }, '没有到期的题目。可以去「题库」加题，或在对话里让我出几道新题练手。')
            : h('div', { key: 'c', className: 'hst_row' }, subjectsWithDue.map((s) => h(Chip, {
              key: s.key,
              subject: s.key,
              count: (due.bySubject[s.key] ?? 0) + (due.newBySubject[s.key] ?? 0),
              onClick: () => setRunning({ subject: s.key }),
              title: `复习${s.label}`,
            }))),
        ]),
        // 快速记时长
        h('div', { key: 'log', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '快速记学习时长'),
          h('div', { key: 'r', className: 'hst_row' }, [
            h('select', {
              key: 's',
              className: 'hst_select hst_inputSm',
              value: logSubject,
              onChange: (e) => setLogSubject(e.target.value),
            }, SUBJECTS.map((s) => h('option', { key: s.key, value: s.key }, s.label))),
            ...[15, 30, 45, 60].map((m) => h('button', { key: m, className: 'hst_btn hst_btnSm', type: 'button', onClick: () => addMinutes(m) }, `+${m} 分`)),
            h('button', { key: 'undo', className: 'hst_btn hst_btnSm', type: 'button', onClick: () => addMinutes(-15) }, '−15 分'),
            logMsg === null ? null : h('span', { key: 'm', className: 'hst_ok' }, logMsg),
          ]),
          h('p', { key: 'h', className: 'hst_hint' }, '也可以直接在对话里说「今天数学刷了一小时」，我会调用 tutor_study_log 记下来。'),
        ]),
        // 薄弱点
        h('div', { key: 'weak', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '薄弱知识点'),
          overview.weakTopics.length === 0
            ? h('p', { key: 'e', className: 'hst_hint' }, '复习记录还太少，多练几轮就会出现排行。')
            : h('div', { key: 'l', className: 'hst_list' }, overview.weakTopics.map((w, i) => h('div', {
              key: `${w.subject}-${w.topic}-${i}`,
              className: 'hst_item',
              onClick: () => onGoLibrary({ subject: w.subject, query: w.topic }),
              title: '在题库中查看这个知识点',
            }, [
              h('div', { key: 'h', className: 'hst_itemHead' }, [
                h(Chip, { key: 'c', subject: w.subject }),
                h('span', { key: 't', className: 'hst_itemQ' }, w.topic),
                h('span', { key: 'm', className: 'hst_chipNum', style: { color: masteryColor(w.mastery), fontSize: 12 } }, `掌握度 ${w.mastery}`),
              ]),
              h('div', { key: 'm', className: 'hst_meta' }, [
                h('span', { key: 'a' }, `${w.items} 条`),
                h('span', { key: 'b' }, w.accuracy === null ? '未复习过' : `正确率 ${w.accuracy}%`),
                h('span', { key: 'c' }, `遗忘 ${w.lapses} 次`),
                w.due > 0 ? h('span', { key: 'd', style: { color: '#dc2626' } }, `待复习 ${w.due}`) : null,
              ]),
            ]))),
        ]),
      ])
    }

    // ── 题库 ────────────────────────────────────────────────────────────────
    /** 空白表单。 */
    const EMPTY_ITEM = { subject: 'math', kind: 'mistake', topic: '', chapter: '', question: '', answer: '', explanation: '', tags: '', difficulty: 3, source: '' }

    /**
     * 题目编辑器（新增/修改共用）。
     * @param {{value: object, onCancel: () => void, onSaved: () => void}} props 属性。
     * @returns {object} React 元素。
     */
    function ItemEditor({ value, onCancel, onSaved }) {
      const [form, setForm] = React.useState(() => ({
        ...EMPTY_ITEM,
        ...value,
        tags: Array.isArray(value.tags) ? value.tags.join(' ') : value.tags ?? '',
      }))
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

      const save = () => {
        if (form.question.trim() === '') { setError('题干不能为空'); return }
        setBusy(true)
        setError(null)
        apiPost('/items', {
          items: [{
            ...(value.id === undefined ? {} : { id: value.id }),
            subject: form.subject,
            kind: form.kind,
            topic: form.topic,
            chapter: form.chapter,
            question: form.question,
            answer: form.answer,
            explanation: form.explanation,
            tags: form.tags,
            difficulty: Number(form.difficulty) || 3,
            source: form.source,
          }],
        }).then(
          () => { setBusy(false); onSaved() },
          (e) => { setBusy(false); setError(String(e.message ?? e)) },
        )
      }

      return h('div', { className: 'hst_card' }, [
        h('h3', { key: 't', className: 'hst_h3' }, value.id === undefined ? '新增题目 / 卡片' : `编辑 ${value.id}`),
        h('div', { key: 'r1', className: 'hst_grid' }, [
          h(Field, { key: 's', label: '学科' }, h('select', { className: 'hst_select', value: form.subject, onChange: set('subject') }, SUBJECTS.map((s) => h('option', { key: s.key, value: s.key }, s.label)))),
          h(Field, { key: 'k', label: '类型' }, h('select', { className: 'hst_select', value: form.kind, onChange: set('kind') }, [
            h('option', { key: 'm', value: 'mistake' }, '错题'),
            h('option', { key: 'c', value: 'card' }, '知识卡'),
          ])),
          h(Field, { key: 'd', label: '难度 1-5' }, h('input', { className: 'hst_input', type: 'number', min: 1, max: 5, value: form.difficulty, onChange: set('difficulty') })),
        ]),
        h('div', { key: 'r2', className: 'hst_grid' }, [
          h(Field, { key: 't', label: '知识点' }, h('input', { className: 'hst_input', value: form.topic, onChange: set('topic'), placeholder: '如 一元函数的导数及其应用' })),
          h(Field, { key: 'c', label: '章节 / 教材' }, h('input', { className: 'hst_input', value: form.chapter, onChange: set('chapter'), placeholder: '如 选择性必修第二册' })),
          h(Field, { key: 's', label: '来源' }, h('input', { className: 'hst_input', value: form.source, onChange: set('source'), placeholder: '如 2024 一模 T18' })),
        ]),
        h(Field, { key: 'q', label: '题干 / 卡片正面' }, h('textarea', { className: 'hst_textarea', value: form.question, onChange: set('question') })),
        h(Field, { key: 'a', label: '答案 / 卡片背面' }, h('textarea', { className: 'hst_textarea', value: form.answer, onChange: set('answer') })),
        h(Field, { key: 'e', label: '解析 / 错因', hint: '错题建议写清「为什么错」，复习时比答案更值钱' }, h('textarea', { className: 'hst_textarea', value: form.explanation, onChange: set('explanation') })),
        h(Field, { key: 'g', label: '标签', hint: '空格或逗号分隔，如 计算失误 必背' }, h('input', { className: 'hst_input', value: form.tags, onChange: set('tags') })),
        error === null ? null : h('p', { key: 'err', className: 'hst_err' }, error),
        h('div', { key: 'act', className: 'hst_row', style: { justifyContent: 'flex-end' } }, [
          h('button', { key: 'c', className: 'hst_btn', type: 'button', onClick: onCancel }, '取消'),
          h('button', { key: 's', className: 'hst_btn hst_btnPrimary', type: 'button', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
        ]),
      ])
    }

    /**
     * 导入面板：先预览（dryRun），确认后正式写库。
     * @param {{onClose: () => void}} props 属性。
     * @returns {object} React 元素。
     */
    function ImportPanel({ onClose }) {
      const [text, setText] = React.useState('')
      const [format, setFormat] = React.useState('auto')
      const [subject, setSubject] = React.useState('math')
      const [kind, setKind] = React.useState('card')
      const [preview, setPreview] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const run = (dryRun) => {
        if (text.trim() === '') { setMsg('请先粘贴要导入的内容'); return }
        setBusy(true)
        setMsg(null)
        apiPost('/import', { text, format, subject, kind, dryRun }).then(
          (data) => {
            setBusy(false)
            if (dryRun) { setPreview(data); setMsg(null) } else {
              setPreview(null)
              setText('')
              setMsg(`导入完成：新增 ${data.added} 条、更新 ${data.updated} 条${data.skipped > 0 ? `、跳过 ${data.skipped} 条` : ''}（识别为 ${data.format}）`)
            }
          },
          (e) => { setBusy(false); setMsg(`失败：${String(e.message ?? e)}`) },
        )
      }

      return h('div', { className: 'hst_card' }, [
        h('div', { key: 'h', className: 'hst_row', style: { justifyContent: 'space-between' } }, [
          h('h3', { key: 't', className: 'hst_h3' }, '批量导入'),
          h('button', { key: 'x', className: 'hst_btn hst_btnSm', type: 'button', onClick: onClose }, '收起'),
        ]),
        h('p', { key: 'hint', className: 'hst_hint' }, '支持 ① Markdown 问答块（Q:/A:/解析:，## 标题可切学科）② Markdown 表格 ③ CSV（首行表头：学科,知识点,题干,答案,解析,难度）④ Anki 导出的 TSV。'),
        h('div', { key: 'opts', className: 'hst_grid' }, [
          h(Field, { key: 'f', label: '格式' }, h('select', { className: 'hst_select', value: format, onChange: (e) => setFormat(e.target.value) }, [
            h('option', { key: 'a', value: 'auto' }, '自动识别'),
            h('option', { key: 'm', value: 'md' }, 'Markdown 问答块'),
            h('option', { key: 't', value: 'mdtable' }, 'Markdown 表格'),
            h('option', { key: 'c', value: 'csv' }, 'CSV'),
            h('option', { key: 'v', value: 'tsv' }, 'Anki TSV'),
          ])),
          h(Field, { key: 's', label: '默认学科', hint: '文本里没写学科时使用' }, h('select', { className: 'hst_select', value: subject, onChange: (e) => setSubject(e.target.value) }, SUBJECTS.map((s) => h('option', { key: s.key, value: s.key }, s.label)))),
          h(Field, { key: 'k', label: '默认类型' }, h('select', { className: 'hst_select', value: kind, onChange: (e) => setKind(e.target.value) }, [
            h('option', { key: 'c', value: 'card' }, '知识卡'),
            h('option', { key: 'm', value: 'mistake' }, '错题'),
          ])),
        ]),
        h('textarea', {
          key: 'ta',
          className: 'hst_textarea',
          style: { minHeight: 150, fontFamily: 'var(--dsw-font-mono,ui-monospace)', fontSize: 12.5 },
          value: text,
          placeholder: '## 数学\n### 导数\nQ: 求 f(x)=x³−3x 的极值\nA: 极大值 2，极小值 −2\n解析: 求导定号\n---',
          onChange: (e) => setText(e.target.value),
        }),
        msg === null ? null : h('p', { key: 'm', className: msg.startsWith('失败') ? 'hst_err' : 'hst_ok' }, msg),
        preview === null ? null : h('div', { key: 'p', className: 'hst_card', style: { background: 'var(--dsw-alias-bg-module-platform,#2631480a)' } }, [
          h('p', { key: 's', className: 'hst_label' }, `识别为 ${preview.format}，可导入 ${preview.count} 条`),
          ...(preview.warnings ?? []).slice(0, 5).map((w, i) => h('p', { key: `w${i}`, className: 'hst_hint' }, `· ${w}`)),
          ...(preview.preview ?? []).slice(0, 5).map((it, i) => h('div', { key: `i${i}`, className: 'hst_meta' }, `${subjectOf(it.subject).label} · ${it.topic ?? ''} · ${String(it.question).slice(0, 42)}`)),
        ]),
        h('div', { key: 'act', className: 'hst_row', style: { justifyContent: 'flex-end' } }, [
          h('button', { key: 'p', className: 'hst_btn', type: 'button', disabled: busy, onClick: () => run(true) }, '预览'),
          h('button', { key: 'i', className: 'hst_btn hst_btnPrimary', type: 'button', disabled: busy, onClick: () => run(false) }, busy ? '处理中…' : '确认导入'),
        ]),
      ])
    }

    /**
     * 题库标签页：筛选、查看、编辑、删除、导入、导出。
     * @param {{initialFilter: object|null, onConsumeFilter: () => void}} props 属性。
     * @returns {object} React 元素。
     */
    function LibraryTab({ initialFilter, onConsumeFilter }) {
      const [filter, setFilter] = React.useState({ subject: '', kind: '', status: 'all', sort: 'updated', query: '' })
      const [draftQuery, setDraftQuery] = React.useState('')
      const [limit, setLimit] = React.useState(20)
      const [openId, setOpenId] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [importing, setImporting] = React.useState(false)
      const [msg, setMsg] = React.useState(null)

      // 从「今日」页跳转过来的筛选条件
      React.useEffect(() => {
        if (initialFilter === null) return
        setFilter((f) => ({ ...f, subject: initialFilter.subject ?? '', query: initialFilter.query ?? '' }))
        setDraftQuery(initialFilter.query ?? '')
        onConsumeFilter()
      }, [initialFilter, onConsumeFilter])

      // 搜索框防抖
      React.useEffect(() => {
        const timer = window.setTimeout(() => setFilter((f) => (f.query === draftQuery ? f : { ...f, query: draftQuery })), 300)
        return () => window.clearTimeout(timer)
      }, [draftQuery])

      const params = new URLSearchParams()
      if (filter.subject !== '') params.set('subject', filter.subject)
      if (filter.kind !== '') params.set('kind', filter.kind)
      if (filter.status !== 'all') params.set('status', filter.status)
      params.set('sort', filter.sort)
      if (filter.query !== '') params.set('query', filter.query)
      params.set('limit', String(limit))
      const { data, error, loading } = useResource(`/items?${params.toString()}`)

      const remove = (id) => {
        if (typeof window.confirm === 'function' && !window.confirm('删除这条记录？复习进度也会一起删除。')) return
        apiPost('/items/delete', { ids: [id] }).then(() => setMsg('已删除'), (e) => setMsg(`删除失败：${String(e.message ?? e)}`))
      }

      const exportMd = () => {
        const q = new URLSearchParams()
        if (filter.subject !== '') q.set('subject', filter.subject)
        if (filter.kind !== '') q.set('kind', filter.kind)
        fetch(`${API}/export?${q.toString()}`, { cache: 'no-store' }).then((r) => r.text()).then((text) => {
          const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `高中助学题库-${new Date().toISOString().slice(0, 10)}.md`
          a.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 2000)
        }).catch((e) => setMsg(`导出失败：${String(e.message ?? e)}`))
      }

      const items = data?.items ?? []
      return h('div', { className: 'hst_body' }, [
        // 工具条
        h('div', { key: 'bar', className: 'hst_card' }, [
          h('div', { key: 'r1', className: 'hst_row' }, [
            h('input', {
              key: 'q',
              className: 'hst_input',
              style: { flex: '1 1 200px', minWidth: 160, width: 'auto' },
              placeholder: '搜索题干 / 答案 / 解析 / 知识点 / 标签',
              value: draftQuery,
              onChange: (e) => setDraftQuery(e.target.value),
            }),
            h('select', { key: 's', className: 'hst_select hst_inputSm', value: filter.subject, onChange: (e) => setFilter((f) => ({ ...f, subject: e.target.value })) }, [
              h('option', { key: 'all', value: '' }, '全部学科'),
              ...SUBJECTS.map((s) => h('option', { key: s.key, value: s.key }, s.label)),
            ]),
            h('select', { key: 'k', className: 'hst_select hst_inputSm', value: filter.kind, onChange: (e) => setFilter((f) => ({ ...f, kind: e.target.value })) }, [
              h('option', { key: 'a', value: '' }, '全部类型'),
              h('option', { key: 'm', value: 'mistake' }, '错题'),
              h('option', { key: 'c', value: 'card' }, '知识卡'),
            ]),
            h('select', { key: 'st', className: 'hst_select hst_inputSm', value: filter.status, onChange: (e) => setFilter((f) => ({ ...f, status: e.target.value })) }, [
              h('option', { key: 'a', value: 'all' }, '全部状态'),
              h('option', { key: 'd', value: 'due' }, '今日到期'),
              h('option', { key: 'n', value: 'new' }, '未学'),
              h('option', { key: 'w', value: 'weak' }, '薄弱'),
              h('option', { key: 'r', value: 'review' }, '复习中'),
            ]),
            h('select', { key: 'so', className: 'hst_select hst_inputSm', value: filter.sort, onChange: (e) => setFilter((f) => ({ ...f, sort: e.target.value })) }, [
              h('option', { key: 'u', value: 'updated' }, '最近更新' ),
              h('option', { key: 'c', value: 'created' }, '最近添加'),
              h('option', { key: 'd', value: 'due' }, '按到期时间'),
              h('option', { key: 'm', value: 'mastery' }, '掌握度最低'),
              h('option', { key: 'f', value: 'difficulty' }, '难度最高'),
            ]),
          ]),
          h('div', { key: 'r2', className: 'hst_row' }, [
            h('button', { key: 'n', className: 'hst_btn hst_btnSm hst_btnPrimary', type: 'button', onClick: () => setEditing({ ...EMPTY_ITEM, subject: filter.subject === '' ? 'math' : filter.subject }) }, '＋ 新增'),
            h('button', { key: 'i', className: 'hst_btn hst_btnSm', type: 'button', onClick: () => setImporting((v) => !v) }, '导入'),
            h('button', { key: 'e', className: 'hst_btn hst_btnSm', type: 'button', onClick: exportMd }, '导出 Markdown'),
            h('button', {
              key: 's',
              className: 'hst_btn hst_btnSm',
              type: 'button',
              onClick: () => apiPost('/seed').then((d) => setMsg(`内置卡片包：新增 ${d.added} 条、更新 ${d.updated} 条`), (e) => setMsg(String(e.message ?? e))),
            }, '导入内置卡片包'),
            h('span', { key: 'c', className: 'hst_meta' }, loading ? '加载中…' : `共 ${data?.total ?? 0} 条`),
            msg === null ? null : h('span', { key: 'm', className: 'hst_ok' }, msg),
          ]),
        ]),
        importing ? h(ImportPanel, { key: 'imp', onClose: () => setImporting(false) }) : null,
        editing === null ? null : h(ItemEditor, {
          key: 'edit',
          value: editing,
          onCancel: () => setEditing(null),
          onSaved: () => { setEditing(null); setMsg('已保存') },
        }),
        error !== null ? h('p', { key: 'err', className: 'hst_err' }, `加载失败：${error}`) : null,
        items.length === 0 && !loading
          ? h('div', { key: 'empty', className: 'hst_empty' }, '没有匹配的记录。可以点「导入内置卡片包」先装上六科高频卡，或在对话里让我把错题录进来。')
          : h('div', { key: 'list', className: 'hst_list' }, items.map((it) => {
            const open = openId === it.id
            const dueInDays = Math.round((it.srs.due - Date.now()) / 86_400_000)
            return h('div', { key: it.id, className: 'hst_item', onClick: () => setOpenId(open ? null : it.id) }, [
              h('div', { key: 'h', className: 'hst_itemHead' }, [
                h(Chip, { key: 'c', subject: it.subject }),
                h('span', { key: 'q', className: `hst_itemQ${open ? ' hst_itemQOpen' : ''}` }, it.question),
                h('span', { key: 'm', style: { fontSize: 11.5, color: masteryColor(it.masteryScore), flex: 'none' } }, String(it.masteryScore)),
              ]),
              h('div', { key: 'm', className: 'hst_meta' }, [
                it.topic === '' ? null : h('span', { key: 't' }, it.topic),
                h('span', { key: 'k' }, it.kind === 'mistake' ? '错题' : '知识卡'),
                h('span', { key: 's' }, STATUS_LABELS[it.srs.state] ?? it.srs.state),
                h('span', { key: 'd' }, it.srs.state === 'new' ? '未排期' : dueInDays <= 0 ? '已到期' : `${dueInDays} 天后`),
                it.srs.lapses > 0 ? h('span', { key: 'l', style: { color: '#dc2626' } }, `遗忘 ${it.srs.lapses}`) : null,
                ...(it.tags ?? []).map((t, i) => h('span', { key: `tg${i}`, className: 'hst_tag' }, t)),
              ]),
              open ? h('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
                h('div', { key: 'a', className: 'hst_a' }, it.answer === '' ? '（无答案）' : it.answer),
                it.explanation === '' ? null : h('div', { key: 'e', className: 'hst_expl' }, `解析：${it.explanation}`),
                h('div', { key: 'act', className: 'hst_row' }, [
                  h('button', { key: 'e', className: 'hst_btn hst_btnSm', type: 'button', onClick: (ev) => { ev.stopPropagation(); setEditing(it) } }, '编辑'),
                  h('button', { key: 'd', className: 'hst_btn hst_btnSm hst_btnDanger', type: 'button', onClick: (ev) => { ev.stopPropagation(); remove(it.id) } }, '删除'),
                  h('span', { key: 'i', className: 'hst_meta hst_mono' }, it.id),
                  it.source === '' ? null : h('span', { key: 's', className: 'hst_meta' }, `来源 ${it.source}`),
                ]),
              ]) : null,
            ])
          })),
        (data?.total ?? 0) > items.length
          ? h('button', { key: 'more', className: 'hst_btn', type: 'button', onClick: () => setLimit((v) => v + 40) }, `加载更多（还有 ${data.total - items.length} 条）`)
          : null,
      ])
    }

    // ── 计划 ────────────────────────────────────────────────────────────────
    /**
     * 计划标签页：今日目标分配建议、教材章节进度勾选、最近笔记。
     * @param {{overview: object}} props 属性。
     * @returns {object} React 元素。
     */
    function PlanTab({ overview }) {
      const profile = overview.profile
      const [subject, setSubject] = React.useState(profile.subjects[0] ?? 'math')
      const progress = useResource('/progress?notes=10')
      const syllabus = useResource(`/syllabus?subject=${subject}${profile.grade === null ? '' : `&grade=${profile.grade}`}`)
      const [msg, setMsg] = React.useState(null)

      // 建议分配：按各科待复习量加权（无待复习时平均分），取 5 分钟粒度
      const weights = profile.subjects.map((key) => ({
        key,
        due: (overview.due.bySubject[key] ?? 0) + (overview.due.newBySubject[key] ?? 0),
        weak: overview.weakTopics.filter((w) => w.subject === key).length,
      }))
      const totalWeight = weights.reduce((a, w) => a + w.due + w.weak * 2 + 1, 0)
      const plan = weights.map((w) => ({
        ...w,
        minutes: Math.max(5, Math.round((profile.dailyStudyMinutes * (w.due + w.weak * 2 + 1)) / totalWeight / 5) * 5),
        done: overview.study.minutesBySubject[w.key] ?? 0,
      }))

      const chapters = progress.data?.chapters?.[subject] ?? {}
      const toggle = (chapter) => {
        const done = chapters[chapter]?.status === 'done'
        apiPost('/studylog', { subject, chapter, status: done ? 'todo' : 'done' }).then(
          () => setMsg(`${chapter} → ${done ? '未完成' : '已完成'}`),
          (e) => setMsg(`失败：${String(e.message ?? e)}`),
        )
      }

      return h('div', { className: 'hst_body' }, [
        h('div', { key: 'plan', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '今日分配建议'),
          h('p', { key: 'h', className: 'hst_hint' }, `按各科待复习量与薄弱程度加权，把每日 ${profile.dailyStudyMinutes} 分钟目标摊到六科；点学科可直接看它的章节进度。`),
          h('div', { key: 'l', className: 'hst_list' }, plan.map((p) => h('div', { key: p.key, className: 'hst_item', onClick: () => setSubject(p.key) }, [
            h('div', { key: 'h', className: 'hst_itemHead' }, [
              h(Chip, { key: 'c', subject: p.key, active: subject === p.key }),
              h('span', { key: 'm', className: 'hst_itemQ hst_mono' }, `建议 ${p.minutes} 分钟 · 已学 ${p.done} 分钟`),
              h('span', { key: 'd', className: 'hst_meta' }, p.due > 0 ? `待复习 ${p.due}` : '无到期'),
            ]),
            h(Bar, { key: 'b', value: p.done, total: p.minutes, color: subjectOf(p.key).color }),
          ]))),
        ]),
        h('div', { key: 'ch', className: 'hst_card' }, [
          h('div', { key: 'h', className: 'hst_row', style: { justifyContent: 'space-between' } }, [
            h('h3', { key: 't', className: 'hst_h3' }, `${subjectOf(subject).label}教材进度`),
            msg === null ? null : h('span', { key: 'm', className: 'hst_ok' }, msg),
          ]),
          h('div', { key: 'c', className: 'hst_row' }, SUBJECTS.map((s) => h(Chip, { key: s.key, subject: s.key, active: subject === s.key, onClick: () => setSubject(s.key) }))),
          syllabus.loading ? h('p', { key: 'l', className: 'hst_hint' }, '加载大纲…') : null,
          ...(syllabus.data?.modules ?? []).map((mod) => h('div', { key: mod.book, style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
            h('div', { key: 'b', className: 'hst_label' }, `${mod.book}${mod.grade === 'all' ? '' : ` · ${GRADE_LABELS[mod.grade] ?? mod.grade}`}`),
            h('div', { key: 'c', className: 'hst_chapters' }, mod.chapters.map((chapter) => {
              const done = chapters[chapter]?.status === 'done'
              return h('label', { key: chapter, className: `hst_chapter${done ? ' hst_chapterDone' : ''}` }, [
                h('input', { key: 'i', type: 'checkbox', checked: done, onChange: () => toggle(chapter) }),
                h('span', { key: 't' }, chapter),
                done ? h('span', { key: 'd', className: 'hst_meta' }, chapters[chapter].date) : null,
              ])
            })),
          ])),
          h('p', { key: 'hint', className: 'hst_hint' }, '勾选会写入学习日志（当天章节完成数），也可以在对话里说「化学选必一第二章看完了」。'),
        ]),
        h('div', { key: 'notes', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '最近笔记'),
          (progress.data?.notes ?? []).length === 0
            ? h('p', { key: 'e', className: 'hst_hint' }, '还没有笔记。对话里说「记一下：导数含参讨论不熟」就会存进来。')
            : h('div', { key: 'l', className: 'hst_list' }, progress.data.notes.map((n, i) => h('div', { key: i, className: 'hst_meta' }, [
              h('span', { key: 'd', className: 'hst_mono' }, n.date),
              n.subject === null || n.subject === undefined ? null : h(Chip, { key: 'c', subject: n.subject }),
              h('span', { key: 't', style: { color: 'var(--dsw-alias-label-primary,#0f1115)' } }, n.text),
            ]))),
        ]),
      ])
    }

    // ── 统计 ────────────────────────────────────────────────────────────────
    /**
     * 模考成绩录入表单。
     * @param {{subjects: string[], onSaved: (msg: string) => void}} props 属性。
     * @returns {object} React 元素。
     */
    function ExamForm({ subjects, onSaved }) {
      const [open, setOpen] = React.useState(false)
      const [form, setForm] = React.useState({ date: new Date().toISOString().slice(0, 10), name: '', rank: '', rankOf: '', note: '' })
      const [scores, setScores] = React.useState({})
      const [busy, setBusy] = React.useState(false)

      if (!open) return h('button', { className: 'hst_btn hst_btnSm', type: 'button', onClick: () => setOpen(true) }, '＋ 记录一次成绩')

      const save = () => {
        const list = Object.entries(scores)
          .filter(([, v]) => String(v).trim() !== '' && Number.isFinite(Number(v)))
          .map(([key, v]) => ({ subject: key, score: Number(v) }))
        if (list.length === 0) { onSaved('至少填一科分数'); return }
        setBusy(true)
        apiPost('/exams', {
          exam: {
            date: form.date,
            name: form.name === '' ? '模考' : form.name,
            scores: list,
            rank: form.rank === '' ? undefined : Number(form.rank),
            rankOf: form.rankOf === '' ? undefined : Number(form.rankOf),
            note: form.note,
          },
        }).then(
          () => { setBusy(false); setOpen(false); setScores({}); onSaved('成绩已记录') },
          (e) => { setBusy(false); onSaved(`失败：${String(e.message ?? e)}`) },
        )
      }

      return h('div', { className: 'hst_card', style: { background: 'var(--dsw-alias-bg-module-platform,#2631480a)' } }, [
        h('div', { key: 'r1', className: 'hst_grid' }, [
          h(Field, { key: 'd', label: '日期' }, h('input', { className: 'hst_input', type: 'date', value: form.date, onChange: (e) => setForm((f) => ({ ...f, date: e.target.value })) })),
          h(Field, { key: 'n', label: '名称' }, h('input', { className: 'hst_input', value: form.name, placeholder: '如 高二下月考二', onChange: (e) => setForm((f) => ({ ...f, name: e.target.value })) })),
          h(Field, { key: 'r', label: '名次' }, h('input', { className: 'hst_input', type: 'number', value: form.rank, onChange: (e) => setForm((f) => ({ ...f, rank: e.target.value })) })),
          h(Field, { key: 'o', label: '参考人数' }, h('input', { className: 'hst_input', type: 'number', value: form.rankOf, onChange: (e) => setForm((f) => ({ ...f, rankOf: e.target.value })) })),
        ]),
        h('div', { key: 'r2', className: 'hst_grid' }, subjects.map((key) => h(Field, { key, label: subjectOf(key).label }, h('input', {
          className: 'hst_input',
          type: 'number',
          value: scores[key] ?? '',
          placeholder: key === 'chinese' || key === 'math' || key === 'english' ? '满分 150' : '满分 100',
          onChange: (e) => setScores((s) => ({ ...s, [key]: e.target.value })),
        })))),
        h(Field, { key: 'note', label: '备注' }, h('input', { className: 'hst_input', value: form.note, placeholder: '如 理综时间不够', onChange: (e) => setForm((f) => ({ ...f, note: e.target.value })) })),
        h('div', { key: 'act', className: 'hst_row', style: { justifyContent: 'flex-end' } }, [
          h('button', { key: 'c', className: 'hst_btn', type: 'button', onClick: () => setOpen(false) }, '取消'),
          h('button', { key: 's', className: 'hst_btn hst_btnPrimary', type: 'button', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
        ]),
      ])
    }

    /**
     * 统计标签页：每日曲线、各科掌握度、保持率、模考趋势。
     * @param {{overview: object}} props 属性。
     * @returns {object} React 元素。
     */
    function StatsTab({ overview }) {
      const [days, setDays] = React.useState(14)
      const { data, error, loading } = useResource(`/stats?days=${days}`)
      const [msg, setMsg] = React.useState(null)

      if (error !== null) return h('p', { className: 'hst_err' }, `统计加载失败：${error}`)
      if (data === null) return h('p', { className: 'hst_hint' }, loading ? '统计计算中…' : '暂无数据')

      const removeExam = (id) => {
        apiPost('/exams/delete', { ids: [id] }).then(() => setMsg('已删除该次成绩'), (e) => setMsg(String(e.message ?? e)))
      }

      return h('div', { className: 'hst_body' }, [
        h('div', { key: 'range', className: 'hst_row' }, [
          h('span', { key: 'l', className: 'hst_label' }, '时间窗'),
          ...[7, 14, 30, 90].map((d) => h('button', {
            key: d,
            type: 'button',
            className: `hst_btn hst_btnSm${days === d ? ' hst_btnPrimary' : ''}`,
            onClick: () => setDays(d),
          }, `${d} 天`)),
          h('span', { key: 'r', className: 'hst_meta' }, `${data.range.from ?? ''} → ${data.range.to ?? ''}`),
        ]),
        h('div', { key: 'daily', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '每日复习量与学习时长'),
          h(DailyChart, { key: 'c', series: data.series }),
        ]),
        h('div', { key: 'ret', className: 'hst_grid' }, [
          h(Stat, { key: 'r', num: data.retention.reviews, label: `${days} 天累计复习（条）` }),
          h(Stat, {
            key: 'a',
            num: data.retention.accuracy === null ? '—' : `${data.retention.accuracy}%`,
            label: '一次通过率',
            color: data.retention.accuracy === null ? undefined : masteryColor(data.retention.accuracy),
          }),
          h(Stat, {
            key: 'm',
            num: data.retention.matureAccuracy === null ? '—' : `${data.retention.matureAccuracy}%`,
            label: '熟卡保持率',
            sub: '排除首次学习的卡',
          }),
          h(Stat, { key: 's', num: overview.study.streak, label: '连续学习天数' }),
        ]),
        h('div', { key: 'subj', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '各科掌握度'),
          h('div', { key: 'l', className: 'hst_list' }, data.subjects.map((s) => h('div', { key: s.subject, style: { display: 'flex', flexDirection: 'column', gap: 5 } }, [
            h('div', { key: 'h', className: 'hst_row', style: { justifyContent: 'space-between' } }, [
              h(Chip, { key: 'c', subject: s.subject }),
              h('span', { key: 'm', className: 'hst_meta' }, [
                `${s.items} 条 · 待复习 ${s.due} · ${s.newItems} 未学`,
                s.accuracy === null ? '' : ` · 正确率 ${s.accuracy}%`,
                ` · ${s.minutes} 分钟`,
              ].join('')),
              h('span', { key: 'v', className: 'hst_chipNum', style: { color: masteryColor(s.mastery) } }, String(s.mastery)),
            ]),
            h(Bar, { key: 'b', value: s.mastery, total: 100, color: masteryColor(s.mastery) }),
          ]))),
        ]),
        h('div', { key: 'exam', className: 'hst_card' }, [
          h('div', { key: 'h', className: 'hst_row', style: { justifyContent: 'space-between' } }, [
            h('h3', { key: 't', className: 'hst_h3' }, '模考成绩趋势'),
            msg === null ? null : h('span', { key: 'm', className: 'hst_ok' }, msg),
          ]),
          h(ExamChart, { key: 'c', trend: data.examTrend }),
          h(ExamForm, { key: 'f', subjects: overview.profile.subjects, onSaved: setMsg }),
          data.examTrend.length === 0 ? null : h('div', { key: 'l', className: 'hst_list' }, data.examTrend.slice().reverse().map((e) => h('div', { key: e.id, className: 'hst_item' }, [
            h('div', { key: 'h', className: 'hst_itemHead' }, [
              h('span', { key: 'n', className: 'hst_itemQ' }, `${e.date} ${e.name}`),
              h('span', { key: 's', className: 'hst_chipNum hst_mono' }, `${e.total} / ${e.totalFull}`),
              h('button', { key: 'd', className: 'hst_btn hst_btnSm hst_btnDanger', type: 'button', onClick: () => removeExam(e.id) }, '删除'),
            ]),
            h('div', { key: 'm', className: 'hst_meta' }, [
              ...Object.entries(e.scores).map(([key, v]) => h('span', { key }, `${subjectOf(key).label} ${v.score}/${v.full}`)),
              e.rank === null ? null : h('span', { key: 'r' }, `名次 ${e.rank}${e.rankOf === null ? '' : ` / ${e.rankOf}`}`),
            ]),
          ]))),
        ]),
      ])
    }

    // ── 设置 ────────────────────────────────────────────────────────────────
    /**
     * 设置标签页：年级、高考日期、启用学科、每日目标、数据位置与工具说明。
     * @param {{overview: object, meta: object|null}} props 属性。
     * @returns {object} React 元素。
     */
    function SettingsTab({ overview, meta }) {
      const [form, setForm] = React.useState(() => ({
        grade: overview.profile.grade ?? '',
        examDate: overview.profile.examDate ?? '',
        region: overview.profile.region,
        subjects: [...overview.profile.subjects],
        dailyReviewTarget: overview.profile.dailyReviewTarget,
        dailyStudyMinutes: overview.profile.dailyStudyMinutes,
        newPerDay: overview.profile.newPerDay,
      }))
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const save = () => {
        setBusy(true)
        apiPost('/profile', {
          grade: form.grade === '' ? null : form.grade,
          examDate: form.examDate === '' ? null : form.examDate,
          region: form.region,
          subjects: form.subjects,
          dailyReviewTarget: Number(form.dailyReviewTarget) || 0,
          dailyStudyMinutes: Number(form.dailyStudyMinutes) || 0,
          newPerDay: Number(form.newPerDay) || 0,
        }).then(
          (data) => { setBusy(false); setMsg('已保存'); setForm((f) => ({ ...f, examDate: data.profile.examDate ?? '' })) },
          (e) => { setBusy(false); setMsg(`保存失败：${String(e.message ?? e)}`) },
        )
      }

      const toggleSubject = (key) => setForm((f) => ({
        ...f,
        subjects: f.subjects.includes(key) ? f.subjects.filter((s) => s !== key) : [...f.subjects, key],
      }))

      return h('div', { className: 'hst_body' }, [
        h('div', { key: 'p', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '学情'),
          h('div', { key: 'r1', className: 'hst_grid' }, [
            h(Field, { key: 'g', label: '当前年级', hint: '改年级会自动重算高考日期' }, h('select', {
              className: 'hst_select',
              value: form.grade,
              onChange: (e) => setForm((f) => ({ ...f, grade: e.target.value, examDate: '' })),
            }, [
              h('option', { key: '', value: '' }, '未指定'),
              h('option', { key: 'g1', value: 'g1' }, '高一'),
              h('option', { key: 'g2', value: 'g2' }, '高二'),
              h('option', { key: 'g3', value: 'g3' }, '高三'),
            ])),
            h(Field, { key: 'd', label: '高考日期' }, h('input', { className: 'hst_input', type: 'date', value: form.examDate, onChange: (e) => setForm((f) => ({ ...f, examDate: e.target.value })) })),
            h(Field, { key: 'r', label: '考区 / 教材' }, h('input', { className: 'hst_input', value: form.region, onChange: (e) => setForm((f) => ({ ...f, region: e.target.value })) })),
          ]),
          h(Field, { key: 'subj', label: '启用学科', hint: '未启用的学科不进入复习队列与统计' }, h('div', { className: 'hst_row' }, SUBJECTS.map((s) => h('label', { key: s.key, className: 'hst_check' }, [
            h('input', { key: 'i', type: 'checkbox', checked: form.subjects.includes(s.key), onChange: () => toggleSubject(s.key) }),
            h('span', { key: 'l', style: { color: s.color, fontWeight: 500 } }, s.label),
          ])))),
          h('div', { key: 'r2', className: 'hst_grid' }, [
            h(Field, { key: 'a', label: '每日复习目标（条）' }, h('input', { className: 'hst_input', type: 'number', min: 0, value: form.dailyReviewTarget, onChange: (e) => setForm((f) => ({ ...f, dailyReviewTarget: e.target.value })) })),
            h(Field, { key: 'b', label: '每日学习目标（分钟）' }, h('input', { className: 'hst_input', type: 'number', min: 0, value: form.dailyStudyMinutes, onChange: (e) => setForm((f) => ({ ...f, dailyStudyMinutes: e.target.value })) })),
            h(Field, { key: 'c', label: '每日新卡上限（条）', hint: '防止一天塞太多新内容' }, h('input', { className: 'hst_input', type: 'number', min: 0, value: form.newPerDay, onChange: (e) => setForm((f) => ({ ...f, newPerDay: e.target.value })) })),
          ]),
          h('div', { key: 'act', className: 'hst_row', style: { justifyContent: 'flex-end' } }, [
            msg === null ? null : h('span', { key: 'm', className: msg.startsWith('保存失败') ? 'hst_err' : 'hst_ok' }, msg),
            h('button', { key: 's', className: 'hst_btn hst_btnPrimary', type: 'button', disabled: busy, onClick: save }, busy ? '保存中…' : '保存设置'),
          ]),
        ]),
        h('div', { key: 'data', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '数据与内容'),
          h('div', { key: 's', className: 'hst_grid' }, [
            h(Stat, { key: 'i', num: overview.totals.items, label: '题库总条数', sub: `错题 ${overview.totals.mistakes} · 知识卡 ${overview.totals.cards}` }),
            h(Stat, { key: 'c', num: meta?.seedCount ?? '—', label: '内置卡片包（条）', sub: '可在「题库」一键导入' }),
            h(Stat, { key: 'y', num: Object.values(meta?.syllabus ?? {}).reduce((a, v) => a + (v.chapters ?? 0), 0) || '—', label: '大纲章节数', sub: '人教版新教材六科' }),
          ]),
          h('p', { key: 'd', className: 'hst_hint' }, `数据目录：${meta?.dataDir ?? '（读取中）'}（profile / items / reviews / studylog / exams 五个 JSON，原子写入，可直接备份）`),
        ]),
        h('div', { key: 'tools', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '在对话里怎么用'),
          h('p', { key: 'i', className: 'hst_hint' }, '插件给模型装了 10 个工具，你可以直接用自然语言指挥：'),
          ...[
            ['「这道题我又错了，记进错题本」', 'tutor_add_items 写入错题并排期'],
            ['「抽查我 10 道今天该复习的物理题」', 'tutor_review_queue 取题 → 批改 → tutor_grade_review 回写'],
            ['「我数学哪个知识点最弱？」', 'tutor_dashboard 看薄弱点排行'],
            ['「按导数出 5 道变式题」', 'tutor_search_items 找同类题 + 生成新题后入库'],
            ['「今天化学学了 45 分钟」', 'tutor_study_log 记时长'],
            ['「这次月考数学 128 语文 112」', 'tutor_exam_record 记成绩并看趋势'],
            ['「把这段错题整理导进去」', 'tutor_import 解析 Markdown/CSV/Anki'],
            ['「我升高三了」', 'tutor_settings 改年级与倒计时'],
          ].map(([say, does], i) => h('div', { key: i, className: 'hst_meta' }, [
            h('span', { key: 's', style: { color: 'var(--dsw-alias-label-primary,#0f1115)' } }, say),
            h('span', { key: 'd' }, `→ ${does}`),
          ])),
        ]),
      ])
    }

    // ── 动态演示：主题桥、演示帧、侧栏停靠面板、工具卡片 ────────────────────
    /**
     * 演示帧文档只取一次，整页所有 iframe 复用同一份 srcdoc 字符串
     * （文档是静态的，场景数据靠 postMessage 送进去）。
     */
    let framePromise = null

    /** host 侧的 ui 配置也只取一次（演示卡片可能同时存在很多个，不该各自请求）。 */
    let uiConfigPromise = null

    /** 用户是否在侧栏里显式勾过「自动」——勾过就优先于 host 配置。 */
    let autoPrefSet = false

    /**
     * 取 host 的 ui 配置（badge/panel/demo/autoDock/pollIntervalMs）。
     * @returns {Promise<object>} ui 配置。
     */
    function loadUiConfig() {
      if (uiConfigPromise === null) {
        uiConfigPromise = apiGet('/meta').then((m) => {
          const ui = (m && m.ui) || {}
          // host 配置只当默认值：用户自己勾过的偏好优先
          if (!autoPrefSet && ui.autoDock === false) dock.set({ auto: false })
          return ui
        }, () => ({}))
      }
      return uiConfigPromise
    }

    /**
     * 订阅 ui 配置（未取到时返回 null，调用方按「默认开启」渲染即可）。
     * @returns {object|null} ui 配置。
     */
    function useUiConfig() {
      const [ui, setUi] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        loadUiConfig().then((value) => { if (alive) setUi(value) })
        return () => { alive = false }
      }, [])
      return ui
    }

    /**
     * 取演示帧文档。
     * @returns {Promise<string>} HTML 文档。
     */
    function loadFrameDoc() {
      if (framePromise === null) {
        framePromise = fetch(`${API}/frame.html`, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
          return r.text()
        })
      }
      return framePromise
    }

    /** 宿主设计令牌 → 演示帧变量的映射。 */
    const THEME_TOKENS = [
      ['fg', '--dsw-alias-label-primary', '#0f1115'],
      ['fg2', '--dsw-alias-label-secondary', '#61666b'],
      ['fg3', '--dsw-alias-label-tertiary', '#81858c'],
      ['bg', '--dsw-alias-bg-layer-3', '#ffffff'],
      ['bg2', '--dsw-alias-bg-module-platform', 'rgba(38,49,72,.05)'],
      ['line', '--dsw-alias-border-l2', 'rgba(0,0,0,.12)'],
      ['brand', '--dsw-alias-brand-primary', '#3964fe'],
      ['good', '--dsw-alias-state-success-primary', '#16a34a'],
      ['bad', '--dsw-alias-state-error-primary', '#dc2626'],
    ]

    /**
     * 解析宿主当前主题，桥接给演示帧（沙箱 iframe 读不到父页面的 CSS 变量）。
     * @returns {object} 变量表。
     */
    function resolveTheme() {
      const out = { warn: '#e08b1a' }
      let root = null
      let body = null
      try {
        root = getComputedStyle(document.documentElement)
        body = getComputedStyle(document.body)
      } catch { /* 取不到就全用兜底色 */ }
      for (const [key, token, fallback] of THEME_TOKENS) {
        const value = root === null
          ? ''
          : (root.getPropertyValue(token).trim() || (body === null ? '' : body.getPropertyValue(token).trim()))
        out[key] = value !== '' ? value : fallback
      }
      // 深色判定：取正文色的亮度反推，比嗅探 body 属性名更稳
      const m = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(out.fg)
      let dark = false
      if (m !== null) dark = (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000 > 150
      else if (/^#([0-9a-f]{6})$/i.test(out.fg)) {
        const hex = out.fg.slice(1)
        const lum = (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587 + parseInt(hex.slice(4, 6), 16) * 114) / 1000
        dark = lum > 150
      }
      out.scheme = dark ? 'dark' : 'light'
      return out
    }

    /**
     * 一个演示帧：沙箱 iframe + postMessage 装载场景 + 高度自适应。
     * @param {object} props scene、token、mode（card|panel）、onStep、minHeight。
     * @returns {object} React 元素。
     */
    function DemoFrame({ scene, token, mode, onStep, minHeight }) {
      const [doc, setDoc] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [height, setHeight] = React.useState(minHeight || (mode === 'panel' ? 480 : 380))
      const [themeTick, setThemeTick] = React.useState(0)
      const ref = React.useRef(null)
      const ready = React.useRef(false)

      React.useEffect(() => {
        let alive = true
        loadFrameDoc().then(
          (text) => { if (alive) setDoc(text) },
          (err) => { if (alive) setError(String(err.message ?? err)) },
        )
        return () => { alive = false }
      }, [])

      // 宿主切换主题时重新桥接一次
      React.useEffect(() => {
        const bump = () => setThemeTick((t) => t + 1)
        const observer = new MutationObserver(bump)
        observer.observe(document.documentElement, { attributes: true })
        observer.observe(document.body, { attributes: true })
        return () => observer.disconnect()
      }, [])

      const send = React.useCallback(() => {
        const win = ref.current === null ? null : ref.current.contentWindow
        if (win === null || scene === null || scene === undefined) return
        win.postMessage({ type: 'hst:scene', token, mode: mode || 'card', scene, theme: resolveTheme() }, '*')
      }, [scene, token, mode, themeTick])

      React.useEffect(() => { if (ready.current) send() }, [send])

      React.useEffect(() => {
        const onMessage = (ev) => {
          const data = ev.data
          if (data === null || typeof data !== 'object' || data.token !== token) return
          if (data.type === 'hst:height' && Number.isFinite(data.height)) {
            // 卡片态已是固定 16:9，不需要引擎上报的高度；面板/侧栏按内容自适应
            if (mode === 'panel') setHeight(Math.min(2000, Math.max(140, Math.ceil(data.height))))
          } else if (data.type === 'hst:step' && typeof onStep === 'function') {
            onStep(data)
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [token, mode, onStep])

      if (error !== null) return h('p', { className: 'hst_hint' }, `演示引擎加载失败：${error}`)
      if (doc === null) return h('div', {
        className: `hst_frameSkeleton${mode === 'panel' ? '' : ' hst_frameSkeletonCard'}`,
        style: mode === 'panel' ? { height: `${height}px` } : undefined,
      })
      return h('iframe', {
        ref,
        className: `hst_frame${mode === 'panel' ? '' : ' hst_frameCard'}`,
        // 卡片与侧栏靠这个属性找到自己的帧来下发「跳到第 n 步」
        'data-token': token,
        sandbox: 'allow-scripts',
        referrerPolicy: 'no-referrer',
        title: (scene && scene.title) || '动态演示',
        srcDoc: doc,
        style: mode === 'panel' ? { height: `${height}px` } : undefined,
        onLoad: () => { ready.current = true; send() },
      })
    }

    /**
     * 侧栏停靠面板的共享状态（模块级）：新演示一生成就自动推到这里显示，
     * 挂在 shell.overlay 上的面板订阅它。两者在同一个浏览器包里，直接共享最省事。
     */
    const dock = {
      state: { open: false, demo: null, width: 430, step: null, token: null, auto: true },
      listeners: new Set(),
      /** 广播状态。 */
      emit() { for (const fn of [...this.listeners]) { try { fn(this.state) } catch { /* 忽略单个订阅者 */ } } },
      /** 订阅。 */
      on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      /** 局部更新。 */
      set(patch) { this.state = { ...this.state, ...patch }; this.emit() },
      /** 打开某份演示（demo 形如 { id, callId, title, scene, ... }）。 */
      show(demo) { this.set({ open: true, demo, step: null }) },
      /** 关闭面板。 */
      close() { this.set({ open: false }) },
      /** 这份调用是不是正在侧栏里显示（卡片据此决定要不要自己再画一遍）。 */
      showing(callId) {
        return this.state.open && this.state.demo !== null && this.state.demo.callId === callId
      },
      /** 切换「新演示自动进侧栏」，并记住偏好。 */
      setAuto(on) {
        this.set({ auto: on !== false })
        autoPrefSet = true
        try { window.localStorage.setItem('hst.dock.auto', on !== false ? 'on' : 'off') } catch { /* 忽略 */ }
      },
    }

    /**
     * 自动推送所需的记号。
     *
     * 难点是区分「刚生成的演示」与「刷新页面时重放的历史演示」——后者若也自动弹侧栏，
     * 每次刷新都会被一堆旧演示轮流刷屏。用两个信号联合判断：
     *   ① 这次调用曾以「运行中」状态渲染过 ⇒ 一定是当场发生的；
     *   ② 页面已过初始重放窗口（BOOT_QUIET_MS）⇒ 此后出现的都算新的。
     */
    const BOOT_AT = Date.now()
    const BOOT_QUIET_MS = 1800
    /** 见过「运行中」状态的 callId。 */
    const sawRunning = new Set()
    /** 已自动推送过的 callId（卡片重新挂载时不再弹）。 */
    const autoShown = new Set()

    /**
     * 判断某次调用是否该自动进侧栏。
     * @param {string} callId 工具调用 id。
     * @param {number} [now] 当前时间（可注入，便于测试初始重放窗口）。
     * @returns {boolean} 是否自动推送。
     */
    function shouldAutoDock(callId, now) {
      if (!dock.state.auto || autoShown.has(callId)) return false
      return sawRunning.has(callId) || (now === undefined ? Date.now() : now) - BOOT_AT > BOOT_QUIET_MS
    }

    /**
     * 让某个演示帧跳到第 index 步（1 起）。
     * @param {string|null} token 帧 token。
     * @param {number} index 步序号（1 起）。
     * @returns {void}
     */
    function postStep(token, index) {
      if (token === null || token === undefined) return
      const frame = document.querySelector(`iframe.hst_frame[data-token="${token}"]`)
      if (frame !== null && frame.contentWindow !== null) {
        frame.contentWindow.postMessage({ type: 'hst:step', token, index: index - 1 }, '*')
      }
    }

    // 面板宽度与「自动进侧栏」偏好都记在本地
    try {
      const saved = Number(window.localStorage.getItem('hst.dock.width'))
      if (Number.isFinite(saved) && saved >= 320) dock.state.width = Math.min(760, saved)
      const auto = window.localStorage.getItem('hst.dock.auto')
      if (auto === 'off' || auto === 'on') {
        autoPrefSet = true
        dock.state.auto = auto === 'on'
      }
    } catch { /* 隐私模式下可能不可用 */ }

    /** 独立演示窗口与对话页共享的广播频道名（与 host 侧 PANEL_CHANNEL 一致）。 */
    const PANEL_CHANNEL = 'dsh-highschool-tutor/demo'

    /**
     * 独立演示窗口的桥。
     *
     * 用 BroadcastChannel 而不是 window.opener/postMessage：频道是同源共享的，
     * **对话页与演示窗口任意一边刷新都能重新握手**，而 opener 引用一刷新就断。
     * 窗口那边的实现见 host 侧 frame/index.js 的 panelDocument()。
     *
     * 协议：
     *   对话页 → 窗口   { t:'scene', demo, theme }   推送演示
     *   对话页 → 窗口   { t:'ping' }                 探活
     *   窗口 → 对话页   { t:'here' }                 我在（应答 ping / 每 4 秒宣告）
     *   窗口 → 对话页   { t:'need' }                 我刚打开，把当前演示给我
     *   窗口 → 对话页   { t:'bye' }                  我要关了
     */
    const panel = {
      channel: null,
      /** 窗口是否活着（收到 here/need 置真；bye 或探活超时置假）。 */
      alive: false,
      /** 最近一次收到窗口消息的时刻。 */
      seenAt: 0,
      /** window.open 的引用，仅用于聚焦；存活判断一律走频道。 */
      win: null,
      /** 最近推送过的演示，供窗口刷新后索要。 */
      last: null,
      listeners: new Set(),
      path: `${API}/panel.html`,

      /** 订阅存活状态变化。 */
      on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      /** 广播存活状态变化。 */
      emit() { for (const fn of [...this.listeners]) { try { fn(this.alive) } catch { /* 忽略 */ } } },

      /** 建立频道（幂等；浏览器不支持时返回 null，功能自然退化）。 */
      connect() {
        if (this.channel !== null || typeof window.BroadcastChannel !== 'function') return this.channel
        try {
          this.channel = new window.BroadcastChannel(PANEL_CHANNEL)
        } catch {
          this.channel = null
          return null
        }
        this.channel.onmessage = (ev) => {
          const msg = ev.data
          if (msg === null || typeof msg !== 'object') return
          if (msg.t === 'here' || msg.t === 'need') {
            const was = this.alive
            this.alive = true
            this.seenAt = Date.now()
            if (msg.t === 'need' && this.last !== null) this.push(this.last)
            if (!was) this.emit()
          } else if (msg.t === 'bye') {
            this.alive = false
            this.emit()
          }
        }
        return this.channel
      },

      /**
       * 推送一份演示到独立窗口（窗口没开也无害，只是没人接收）。
       * @param {object} demo 演示对象。
       * @returns {void}
       */
      push(demo) {
        this.last = demo
        const ch = this.connect()
        if (ch === null) return
        try { ch.postMessage({ t: 'scene', demo, theme: resolveTheme() }) } catch { /* 忽略 */ }
      },

      /** 探活：窗口若在会回 here；800ms 无回音即判定已关。 */
      ping() {
        const ch = this.connect()
        if (ch === null) return
        try { ch.postMessage({ t: 'ping' }) } catch { /* 忽略 */ }
        window.setTimeout(() => {
          if (this.alive && Date.now() - this.seenAt > 800) {
            this.alive = false
            this.emit()
          }
        }, 800)
      },

      /**
       * 打开（或聚焦）独立窗口。**必须由用户点击触发**，否则被浏览器拦截。
       * @param {object|null} [demo] 打开后立刻显示的演示。
       * @returns {boolean} 是否成功打开。
       */
      open(demo) {
        this.connect()
        if (demo !== null && demo !== undefined) this.last = demo
        if (this.win !== null && !this.win.closed) {
          this.win.focus()
          if (this.last !== null) this.push(this.last)
          return true
        }
        let opened = null
        try {
          opened = window.open(this.path, 'hst-demo-panel', 'popup=yes,width=760,height=940,left=120,top=60')
        } catch { opened = null }
        this.win = opened
        if (opened === null) return false
        // 窗口加载完会自己发 need，这里再补推一次以防错过
        window.setTimeout(() => { if (this.last !== null) this.push(this.last) }, 900)
        return true
      },
    }

    /**
     * 订阅独立窗口的存活状态（顺带定期探活）。
     * @returns {boolean} 窗口是否活着。
     */
    function usePanelAlive() {
      const [alive, setAlive] = React.useState(panel.alive)
      React.useEffect(() => {
        const off = panel.on(setAlive)
        panel.ping()
        const timer = window.setInterval(() => panel.ping(), 5000)
        return () => { off(); window.clearInterval(timer) }
      }, [])
      return alive
    }

    // ── 与 dsh-better-sidebar 集成 ───────────────────────────────────────────
    /** 注册进 better-sidebar 的页签 id（同时也是它的 tab.type 与默认 tab.id）。 */
    const BS_TAB_ID = 'highschool-tutor:demo'

    /**
     * better-sidebar 服务的持有者。
     *
     * 那个插件不是必需依赖：装了就把演示注册成它的一个侧栏页签（VSCode 风格的真正
     * 停靠列、按会话隔离、可分屏），没装就退回自带的 shell.overlay 浮层。所以这里只
     * 做弱引用，由 apply() 里的 ctx.inject(['betterSidebar'], …) 在服务可用时填充。
     */
    const bs = {
      service: null,
      listeners: new Set(),
      /** 订阅可用性变化。 */
      on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      /** 广播可用性变化。 */
      emit() { for (const fn of [...this.listeners]) { try { fn(this.service !== null) } catch { /* 忽略 */ } } },
      /** 绑定/解绑服务（服务消失时也要通知，好回落到浮层）。 */
      attach(service) { this.service = service ?? null; this.emit() },
      /** 服务可用且该页签没被用户在侧栏设置里关掉。 */
      usable() {
        const svc = this.service
        if (svc === null) return false
        try { return typeof svc.isTabEnabled !== 'function' || svc.isTabEnabled(BS_TAB_ID) } catch { return true }
      },
      /** 按服务自报的 features 清单探测能力（它承诺 features 只增不减）。 */
      can(feature) {
        const svc = this.service
        return svc !== null && Array.isArray(svc.features) && svc.features.includes(feature)
      },

      /**
       * 把一份演示送进 better-sidebar 页签并让它出现在眼前。
       * @param {object} demo 演示对象。
       * @returns {boolean} 是否成功送达。
       */
      show(demo) {
        if (!this.usable() || demo === null || demo === undefined) return false
        const svc = this.service
        // 内容由共享 store 承载：页签是单实例的，去重聚焦时新的 path 未必会被应用，
        // 所以不能把「当前是哪份演示」寄托在 tab.path 上。
        dock.set({ demo, step: null })
        let collapsed = false
        try {
          const snap = typeof svc.getSnapshot === 'function' ? svc.getSnapshot() : null
          collapsed = snap !== null && snap !== undefined && snap.state !== undefined
            && snap.state !== null && snap.state.panelOpen === false
        } catch { collapsed = false }
        try {
          // 面板收起时先关掉页签：这样下面的 openTab 会被宿主判定为「内容打开」，
          // 从而自动展开面板（未知 id 的 closeTab 按契约是严格 no-op，安全）
          if (collapsed) svc.closeTab(BS_TAB_ID)
          svc.openTab({ type: BS_TAB_ID, path: demo.id, title: demo.title })
          if (this.can('updateTab')) {
            svc.updateTab(BS_TAB_ID, { title: demo.title, path: demo.id, meta: { demoId: demo.id } })
          }
        } catch { return false }
        return true
      },
    }

    /**
     * 订阅 better-sidebar 是否可用。
     * @returns {boolean} 可用性。
     */
    function useBetterSidebar() {
      const [ready, setReady] = React.useState(bs.service !== null)
      React.useEffect(() => bs.on(setReady), [])
      return ready && bs.usable()
    }

    /**
     * 页签图标（内联 SVG，不引 primitives 图标库，少一层版本耦合）。
     * @param {number} [size] 尺寸。
     * @returns {object} React 元素。
     */
    function demoIcon(size) {
      return h('svg', {
        width: size || 16, height: size || 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M1.8 12.4 5.4 7l2.7 3 4.3-6.2', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { key: 'b', cx: '12.4', cy: '3.8', r: '1.5', fill: 'currentColor' }),
        h('path', { key: 'c', d: 'M1.5 14.5h13', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', opacity: '.45' }),
      ])
    }

    /**
     * 订阅停靠面板状态。
     * @returns {object} 当前状态。
     */
    function useDock() {
      const [state, setState] = React.useState(dock.state)
      React.useEffect(() => dock.on(setState), [])
      return state
    }

    /**
     * 重点步骤芯片行（卡片折叠态也能一眼看到重点在哪一步）。
     * @param {object} props keySteps、current、onPick。
     * @returns {object|null} React 元素。
     */
    function KeyStepChips({ keySteps, current, onPick }) {
      if (!Array.isArray(keySteps) || keySteps.length === 0) return null
      return h('div', { className: 'hst_keyRow' }, [
        h('span', { key: 'l', className: 'hst_keyLabel' }, '重点'),
        ...keySteps.map((s) => h('button', {
          key: s.index,
          type: 'button',
          className: `hst_keyChip${current === s.index ? ' hst_keyChipOn' : ''}`,
          title: `跳到第 ${s.index} 步`,
          onClick: () => { if (typeof onPick === 'function') onPick(s.index) },
        }, `${s.index}. ${s.title}`)),
      ])
    }

    /**
     * 右侧停靠面板：显示当前演示，可拖宽、可切换最近演示、可跳步。
     * 挂在 shell.overlay 插槽（加性、root 作用域），不与宿主任何自带 UI 争位置。
     * @returns {object|null} React 元素。
     */
    function TutorDock() {
      const state = useDock()
      const ui = useUiConfig()
      const [tick, setTick] = React.useState(0)
      const [picker, setPicker] = React.useState(false)
      const list = useResource(state.open && picker ? '/demos?limit=30' : null)
      const token = React.useMemo(() => `dock-${tick}`, [tick])
      const dragging = React.useRef(null)
      // 稳定引用：否则每次渲染都会让帧组件重装 message 监听
      const onStep = React.useCallback((msg) => dock.set({ step: msg }), [])

      React.useEffect(() => {
        if (state.open) setTick((t) => t + 1)
      }, [state.open, state.demo])

      // 把当前帧的 token 挂到共享状态上：对话里的卡片据此驱动侧栏跳步
      React.useEffect(() => {
        dock.set({ token })
      }, [token])

      React.useEffect(() => {
        const onMove = (ev) => {
          if (dragging.current === null) return
          const next = Math.min(760, Math.max(320, dragging.current.w + (dragging.current.x - ev.clientX)))
          dock.set({ width: next })
        }
        const onUp = () => {
          if (dragging.current === null) return
          dragging.current = null
          try { window.localStorage.setItem('hst.dock.width', String(dock.state.width)) } catch { /* 忽略 */ }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
      }, [])

      // Esc 关闭侧栏（只在面板打开时生效，不干扰宿主的其它快捷键）
      React.useEffect(() => {
        if (!state.open) return undefined
        const onKey = (ev) => { if (ev.key === 'Escape') dock.close() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [state.open])

      if (!state.open) return null
      if (ui !== null && ui.demo === false) return null
      const demo = state.demo
      const scene = demo === null ? null : demo.scene
      const subject = scene !== null && scene.subject !== null ? subjectOf(scene.subject) : null
      /** 让帧跳到某一步。 */
      const goStep = (index) => postStep(token, index)

      return h('div', { className: 'hst_dock', style: { width: `${state.width}px` } }, [
        h('div', {
          key: 'grip',
          className: 'hst_dockGrip',
          title: '拖动调整宽度',
          onPointerDown: (ev) => { dragging.current = { x: ev.clientX, w: state.width }; ev.preventDefault() },
        }),
        h('div', { key: 'head', className: 'hst_dockHead' }, [
          h('div', { key: 't', className: 'hst_dockTitle' }, [
            subject === null ? null : h('span', {
              key: 's',
              className: 'hst_dockDot',
              style: { background: subject.color },
              title: subject.label,
            }),
            h('span', { key: 'x' }, demo === null ? '动态演示' : demo.title),
          ]),
          h('div', { key: 'a', className: 'hst_row' }, [
            h('label', {
              key: 'auto',
              className: 'hst_check',
              title: '开启后，每次生成新演示都自动在这里显示',
            }, [
              h('input', {
                key: 'i',
                type: 'checkbox',
                checked: state.auto !== false,
                onChange: (ev) => dock.setAuto(ev.target.checked),
              }),
              h('span', { key: 's' }, '自动'),
            ]),
            h('button', {
              key: 'w',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              title: '改到独立窗口显示——可拖到另一块屏幕，之后新演示都会送到那里',
              onClick: () => {
                if (panel.open(state.demo)) dock.close()
                else window.alert('浏览器拦截了弹出窗口。请允许本站弹窗后再试。')
              },
            }, '独立窗口'),
            h('button', {
              key: 'p',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              onClick: () => setPicker((v) => !v),
              title: '切换到其它演示',
            }, picker ? '收起' : '最近'),
            h('button', {
              key: 'c',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              onClick: () => dock.close(),
              title: '关闭侧栏（Esc）',
            }, '关闭'),
          ]),
        ]),
        picker ? h('div', { key: 'list', className: 'hst_dockList' },
          list.data === null
            ? h('p', { className: 'hst_hint' }, '加载中…')
            : (list.data.demos.length === 0
              ? h('p', { className: 'hst_hint' }, '还没有存下的演示。讲题时让我出图，就会自动存进来。')
              : list.data.demos.map((d) => h('button', {
                key: d.id,
                type: 'button',
                className: `hst_dockItem${demo !== null && demo.id === d.id ? ' hst_dockItemOn' : ''}`,
                onClick: async () => {
                  try {
                    const full = await apiGet(`/demos/${d.id}`)
                    dock.show(full)
                    setPicker(false)
                  } catch (err) { /* 打不开就保持原样 */ }
                },
              }, [
                h('span', { key: 't', className: 'hst_dockItemT' }, d.title),
                h('span', { key: 'm', className: 'hst_dockItemM' }, `${KIND_LABELS[d.kind] ?? d.kind} · ${d.steps ?? 0} 步`),
              ])))) : null,
        h('div', { key: 'body', className: 'hst_dockBody' }, [
          demo === null || scene === null
            ? h('p', { key: 'e', className: 'hst_hint' }, '选一份演示打开。')
            : h(DemoFrame, {
              key: token,
              scene,
              token,
              mode: 'panel',
              minHeight: 520,
              onStep,
            }),
          demo === null ? null : h(KeyStepChips, {
            key: 'keys',
            keySteps: demo.keySteps,
            current: state.step === null ? null : state.step.index + 1,
            onPick: goStep,
          }),
        ]),
      ])
    }

    /**
     * dsh-better-sidebar 里的「动态演示」页签。
     *
     * 内容取自共享 store（对话每出一份新演示就写它），所以页签始终显示最新一份；
     * 顶部可切换到已存的其它演示。宿主传入的 `visible` 为假时（页签在后台）
     * 不必重绘，省掉后台 iframe 的无谓工作。
     * @param {object} props better-sidebar 传入的 TabComponentProps。
     * @returns {object} React 元素。
     */
    function DemoSidebarTab({ visible }) {
      const state = useDock()
      const [tick, setTick] = React.useState(0)
      const [picker, setPicker] = React.useState(false)
      const list = useResource(picker ? '/demos?limit=30' : null)
      const token = React.useMemo(() => `bs-${tick}`, [tick])
      const onStep = React.useCallback((msg) => dock.set({ step: msg }), [])

      // 换演示时重建帧，避免上一份的相机/步骤状态残留
      React.useEffect(() => { setTick((t) => t + 1) }, [state.demo])
      // 把 token 挂到共享状态上：对话里的卡片据此驱动本页签跳步
      React.useEffect(() => { dock.set({ token }) }, [token])

      const demo = state.demo
      const scene = demo === null || demo === undefined ? null : demo.scene
      const subject = scene !== null && scene.subject ? subjectOf(scene.subject) : null

      if (scene === null) {
        return h('div', { className: 'hst_bsTab' }, [
          h('p', { key: 'e', className: 'hst_hint' },
            '还没有演示。在对话里让我讲一道数学 / 物理 / 化学 / 地理题，演示就会自动出现在这里。'),
          h('button', {
            key: 'b',
            type: 'button',
            className: 'hst_btn hst_btnSm',
            onClick: async () => {
              try {
                const recent = await apiGet('/demos?limit=1&full=true')
                if (recent.demos.length > 0) dock.set({ demo: recent.demos[0], step: null })
                else dock.set({ demo: await apiGet('/demos/example:plot2d'), step: null })
              } catch { /* 后端不可用时不打断 */ }
            },
          }, '打开最近一份演示'),
        ])
      }

      return h('div', { className: 'hst_bsTab' }, [
        h('div', { key: 'h', className: 'hst_bsHead' }, [
          subject === null ? null : h('span', { key: 's', className: 'hst_dockDot', style: { background: subject.color }, title: subject.label }),
          h('span', { key: 't', className: 'hst_bsTitle', title: demo.title }, demo.title),
          h('label', {
            key: 'a',
            className: 'hst_check',
            title: '开启后，每次生成新演示都自动切到这里',
          }, [
            h('input', { key: 'i', type: 'checkbox', checked: state.auto !== false, onChange: (ev) => dock.setAuto(ev.target.checked) }),
            h('span', { key: 'x' }, '自动'),
          ]),
          h('button', {
            key: 'p',
            type: 'button',
            className: 'hst_btn hst_btnSm',
            onClick: () => setPicker((v) => !v),
            title: '切换到其它已存演示',
          }, picker ? '收起' : '最近'),
          h('button', {
            key: 'w',
            type: 'button',
            className: 'hst_btn hst_btnSm',
            title: '改到独立窗口显示（可拖到另一块屏幕）',
            onClick: () => panel.open(demo),
          }, '独立窗口'),
        ]),
        picker ? h('div', { key: 'l', className: 'hst_dockList' },
          list.data === null
            ? h('p', { className: 'hst_hint' }, '加载中…')
            : (list.data.demos.length === 0
              ? h('p', { className: 'hst_hint' }, '还没有存下的演示。')
              : list.data.demos.map((d) => h('button', {
                key: d.id,
                type: 'button',
                className: `hst_dockItem${demo.id === d.id ? ' hst_dockItemOn' : ''}`,
                onClick: async () => {
                  try {
                    dock.set({ demo: await apiGet(`/demos/${d.id}`), step: null })
                    setPicker(false)
                  } catch { /* 打不开就保持原样 */ }
                },
              }, [
                h('span', { key: 't', className: 'hst_dockItemT' }, d.title),
                h('span', { key: 'm', className: 'hst_dockItemM' }, `${KIND_LABELS[d.kind] ?? d.kind} · ${d.steps ?? 0} 步`),
              ])))) : null,
        visible === false
          ? h('p', { key: 'z', className: 'hst_hint' }, '页签在后台，切回来即继续。')
          : h(DemoFrame, { key: token, scene, token, mode: 'panel', minHeight: 460, onStep }),
        h(KeyStepChips, {
          key: 'k',
          keySteps: demo.keySteps,
          current: state.step === null || state.step === undefined ? null : state.step.index + 1,
          onPick: (index) => postStep(token, index),
        }),
      ])
    }

    /**
     * tutor_visualize 的工具视图：把持久化 meta 里的场景渲染成对话内嵌卡片。
     *
     * 所有内容都来自这次工具调用的持久化切片（block.meta），因此刷新页面、
     * 重放会话都能重新画出同一张图，不依赖任何运行时状态。
     * @param {object} props DSH 传入的 { callId, toolName, block }。
     * @returns {object} React 元素。
     */
    function DemoToolView({ callId, block }) {
      const [step, setStep] = React.useState(null)
      const ui = useUiConfig()
      const dockState = useDock()
      const panelAlive = usePanelAlive()
      const bsReady = useBetterSidebar()
      const token = `call-${callId}`

      const settled = block !== null && typeof block === 'object' && 'kind' in block
      const meta = settled && block.meta !== null && typeof block.meta === 'object' && block.meta.kind === 'hst-demo'
        ? block.meta
        : null

      // 运行中先留个记号：只有「当场跑过」的调用才配自动弹出，
      // 刷新页面重放的历史卡片不该把演示surface抢走。
      if (!settled) sawRunning.add(callId)

      /** 侧栏 / 独立窗口要显示的演示对象（带 callId 以便卡片判断显示在哪）。 */
      const asDemo = React.useCallback(() => (meta === null ? null : {
        id: meta.demoId ?? `call:${callId}`,
        callId,
        title: meta.title,
        kind: meta.sceneKind,
        keySteps: meta.keySteps,
        itemId: meta.itemId,
        scene: meta.scene,
      }), [meta, callId])

      // 新演示自动就位。落点优先级：
      //   独立窗口（用户显式开着就尊重它）→ better-sidebar 页签 → 自带浮层 → 内嵌卡片
      React.useEffect(() => {
        if (meta === null) return
        if (ui !== null && ui.demo === false) return
        const demo = asDemo()
        if (demo === null) return
        // 窗口开着时始终同步（哪怕是重放，也让窗口保持在最新一份）
        if (panelAlive) panel.push(demo)
        if (!shouldAutoDock(callId)) return
        autoShown.add(callId)
        if (panelAlive) return
        if (bsReady && bs.show(demo)) return
        dock.show(demo)
      }, [meta, callId, ui, asDemo, panelAlive, bsReady])

      /** 演示 UI 被 config.demo=false 关掉时，退回 durable 结果的首行文本。 */
      const plainLine = () => {
        const first = Array.isArray(block && block.content)
          ? (block.content.find((b) => b.type === 'text' && typeof b.text === 'string') ?? null)
          : null
        return first === null ? '动态演示' : String(first.text).split('\n')[0].slice(0, 200)
      }

      if (!settled) return h('div', { className: 'hst_toolLine' }, '动态演示 · 生成中…')
      if (ui !== null && ui.demo === false) return h('div', { className: 'hst_toolLine' }, plainLine())
      // 出错、或旧记录里没有可渲染的 meta：只占一行，显示 durable 结果的首行
      if (block.isError === true || meta === null) return h('div', { className: 'hst_toolLine' }, plainLine())

      const subject = meta.scene !== null && meta.scene.subject ? subjectOf(meta.scene.subject) : null
      const inDock = dockState.open && dockState.demo !== null && dockState.demo.callId === callId
      // 这份演示是否正显示在 better-sidebar 页签里（内容由共享 store 承载）
      const inSidebarTab = bsReady && dockState.demo !== null && dockState.demo !== undefined
        && dockState.demo.callId === callId
      // 演示已在别处显示时卡片让位：不再渲染第二个 iframe，只留标题、摘要与
      // 重点步骤——点重点步骤仍能驱动那边的帧跳步。
      const elsewhere = panelAlive || inDock || inSidebarTab
      const activeToken = inDock || inSidebarTab ? dockState.token : token
      const current = inDock || inSidebarTab
        ? (dockState.step === null || dockState.step === undefined ? null : dockState.step.index + 1)
        : (step === null ? null : step.index + 1)
      const where = panelAlive ? '正在独立窗口显示'
        : inSidebarTab ? '正在侧栏页签显示'
          : inDock ? '正在右侧栏显示' : ''

      return h('div', { className: `hst_toolCard${elsewhere ? ' hst_toolCardDocked' : ''}` }, [
        h('div', { key: 'h', className: 'hst_toolHead' }, [
          subject === null ? null : h('span', { key: 'd', className: 'hst_dockDot', style: { background: subject.color } }),
          h('span', { key: 't', className: 'hst_toolTitle' }, meta.title),
          h('span', { key: 'm', className: 'hst_toolMeta' },
            where === '' ? meta.summary : `${meta.summary} · ${where}`),
          panelAlive
            ? h('button', {
              key: 'w',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              title: '把独立窗口切到前面',
              onClick: () => panel.open(asDemo()),
            }, '聚焦窗口')
            : h('button', {
              key: 'w',
              type: 'button',
              className: 'hst_btn hst_btnSm hst_btnPrimary',
              title: '在独立窗口打开——可拖到另一块屏幕，之后每份新演示都会自动出现在那里',
              onClick: () => {
                if (!panel.open(asDemo())) window.alert('浏览器拦截了弹出窗口。请允许本站弹窗后再试。')
                else dock.close()
              },
            }, '独立窗口'),
          elsewhere
            ? null
            : h('button', {
              key: 'x',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              title: bsReady ? '在侧栏页签中打开' : '推到页内右侧栏',
              onClick: () => {
                const demo = asDemo()
                if (demo === null) return
                if (bsReady && bs.show(demo)) return
                dock.show(demo)
              },
            }, '侧栏'),
          inDock && !inSidebarTab
            ? h('button', {
              key: 'c',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              title: '关掉侧栏，改在这里展开',
              onClick: () => dock.close(),
            }, '收起侧栏')
            : null,
        ]),
        // 只有哪儿都没显示时才自己画
        elsewhere ? null : h(DemoFrame, { key: 'f', scene: meta.scene, token, mode: 'card', onStep: setStep }),
        h(KeyStepChips, {
          key: 'k',
          keySteps: meta.keySteps,
          current: panelAlive ? null : current,
          onPick: (index) => postStep(activeToken, index),
        }),
      ])
    }

    /**
     * 设置页「演示」标签页：已存演示与内置示例，可预览、打开侧栏、删除。
     * @returns {object} React 元素。
     */
    function DemosTab() {
      const [query, setQuery] = React.useState('')
      const [subject, setSubject] = React.useState('')
      const [openId, setOpenId] = React.useState(null)
      const [current, setCurrent] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const params = new URLSearchParams({ limit: '60' })
      if (query.trim() !== '') params.set('query', query.trim())
      if (subject !== '') params.set('subject', subject)
      const list = useResource(`/demos?${params.toString()}`)
      const meta = useResource('/meta')

      /** 打开一份演示（预览用）。 */
      const load = async (id) => {
        if (openId === id) { setOpenId(null); setCurrent(null); return }
        setBusy(true)
        try {
          const full = await apiGet(`/demos/${id}`)
          setCurrent(full)
          setOpenId(id)
        } catch (err) { setCurrent(null) } finally { setBusy(false) }
      }

      const examples = meta.data !== null && meta.data.scene ? meta.data.scene.examples : []
      return h('div', { className: 'hst_body' }, [
        h('div', { key: 'bar', className: 'hst_card' }, [
          h('div', { key: 'r', className: 'hst_row' }, [
            h('input', {
              key: 'q',
              className: 'hst_input hst_inputSm',
              placeholder: '搜标题 / 知识点',
              value: query,
              onChange: (ev) => setQuery(ev.target.value),
              style: { width: '190px' },
            }),
            h('select', {
              key: 's',
              className: 'hst_select hst_inputSm',
              value: subject,
              onChange: (ev) => setSubject(ev.target.value),
            }, [
              h('option', { key: '', value: '' }, '全部学科'),
              ...SUBJECTS.map((s) => h('option', { key: s.key, value: s.key }, s.label)),
            ]),
            h('span', { key: 'n', className: 'hst_hint' },
              list.data === null ? '' : `共 ${list.data.total} 份演示`),
          ]),
          h('p', { key: 'h', className: 'hst_hint' },
            '讲题时让我「画个图」，演示会自动存到这里；点标题预览，点「侧栏」在右侧栏放大交互。'),
        ]),
        current !== null ? h('div', { key: 'pv', className: 'hst_card' }, [
          h('div', { key: 'h', className: 'hst_row' }, [
            h('h3', { key: 't', className: 'hst_h3' }, current.title),
            h('button', {
              key: 'w',
              type: 'button',
              className: 'hst_btn hst_btnSm hst_btnPrimary',
              onClick: () => panel.open(current),
              title: '在独立窗口打开（可拖到另一块屏幕）',
            }, '独立窗口'),
            h('button', {
              key: 'bs',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              onClick: () => { if (!bs.show(current)) dock.show(current) },
              title: '在侧栏页签中打开',
            }, '侧栏'),
            h('button', {
              key: 'd',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              onClick: () => dock.show(current),
            }, '侧栏展开'),
          ]),
          h(DemoFrame, { key: `pv-${current.id}`, scene: current.scene, token: `tab-${current.id}`, mode: 'panel' }),
        ]) : null,
        h('div', { key: 'list', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '已存演示'),
          list.data === null
            ? h('p', { key: 'l', className: 'hst_hint' }, '加载中…')
            : (list.data.demos.length === 0
              ? h('p', { key: 'e', className: 'hst_hint' }, '还没有演示。在对话里让我讲一道数学/物理/化学/地理题，就会自动生成。')
              : h('div', { key: 'rows', className: 'hst_demoList' }, list.data.demos.map((d) => h('div', {
                key: d.id,
                className: 'hst_demoRow',
              }, [
                h('button', {
                  key: 't',
                  type: 'button',
                  className: 'hst_demoName',
                  disabled: busy,
                  onClick: () => load(d.id),
                }, d.title),
                h('span', { key: 'm', className: 'hst_demoMeta' }, [
                  d.subject === null ? '' : subjectOf(d.subject).label,
                  ' · ',
                  KIND_LABELS[d.kind] ?? d.kind,
                  ' · ',
                  `${d.steps ?? 0} 步`,
                  d.itemId ? ' · 已关联题目' : '',
                ].join('')),
                h('button', {
                  key: 'd',
                  type: 'button',
                  className: 'hst_btn hst_btnSm hst_btnDanger',
                  onClick: async () => {
                    if (!window.confirm(`删除演示「${d.title}」？`)) return
                    await apiPost('/demos/delete', { ids: [d.id] })
                    if (openId === d.id) { setOpenId(null); setCurrent(null) }
                  },
                }, '删除'),
              ])))),
        ]),
        h('div', { key: 'ex', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '内置示例（九种场景类型）'),
          h('p', { key: 'h', className: 'hst_hint' }, '每种类型一份真实题目的完整演示，也是我出图时参照的样例。'),
          h('div', { key: 'rows', className: 'hst_demoList' }, examples.map((e) => h('div', {
            key: e.kind,
            className: 'hst_demoRow',
          }, [
            h('button', {
              key: 't',
              type: 'button',
              className: 'hst_demoName',
              onClick: () => load(`example:${e.kind}`),
            }, e.title),
            h('span', { key: 'm', className: 'hst_demoMeta' }, [
              e.subject === null ? '' : subjectOf(e.subject).label,
              ' · ',
              KIND_LABELS[e.kind] ?? e.kind,
              ' · ',
              `${e.steps} 步`,
            ].join('')),
          ]))),
        ]),
      ])
    }

    /**
     * 左侧栏底部的「演示」入口：常驻按钮，用来重新打开上一份演示。
     *
     * 侧栏关掉之后如果没有这个入口，用户就只能回到对话里翻那张卡片、或者进设置页，
     * 所以它补的是一个真实的死角。owner 只给 `wide`：侧栏折叠成 56px 轨道时按自带
     * 插件的惯例只画图标。
     * @param {object} props { wide }。
     * @returns {object|null} React 元素。
     */
    function TutorDockLauncher({ wide }) {
      const ui = useUiConfig()
      const state = useDock()
      const alive = usePanelAlive()
      const bsReady = useBetterSidebar()
      const overview = useResource('/overview')
      const [busy, setBusy] = React.useState(false)

      if (ui !== null && ui.demo === false) return null
      const count = overview.data === null ? null : (overview.data.totals.demos ?? 0)

      /** 打开：优先上一份，其次库里最新的一份，最后退回内置示例。 */
      const open = async () => {
        // 装了 better-sidebar 就送进它的页签，不再用自带浮层
        const toSidebar = (demo) => (bsReady && bs.show(demo)) || (dock.show(demo), true)
        if (bsReady) {
          if (state.demo !== null && state.demo !== undefined) { bs.show(state.demo); return }
        } else if (state.open) { dock.close(); return } else if (state.demo !== null) { dock.set({ open: true }); return }
        setBusy(true)
        try {
          const list = await apiGet('/demos?limit=1&full=true')
          if (list.demos.length > 0) toSidebar(list.demos[0])
          else toSidebar(await apiGet('/demos/example:plot2d'))
        } catch (err) {
          /* 后端不可用时什么都不做，不弹错误打断用户 */
        } finally {
          setBusy(false)
        }
      }

      return h('button', {
        type: 'button',
        className: `hst_launch${wide ? '' : ' hst_launchRail'}${state.open || alive ? ' hst_launchOn' : ''}`,
        title: alive ? '聚焦独立演示窗口' : (state.open ? '收起动态演示侧栏' : '打开动态演示（Shift+点击 = 独立窗口）'),
        disabled: busy,
        onClick: (ev) => {
          // Shift+点击（或窗口已开着）走独立窗口，否则用页内侧栏
          if (ev.shiftKey || alive) { panel.open(panel.last); return }
          open()
        },
      }, [
        // 内联 SVG：不引入 primitives 图标库，省一层版本耦合
        h('svg', {
          key: 'i',
          width: wide ? 16 : 18,
          height: wide ? 16 : 18,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
        }, [
          h('path', { key: 'a', d: 'M1.8 12.4 5.4 7l2.7 3 4.3-6.2', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          h('circle', { key: 'b', cx: '12.4', cy: '3.8', r: '1.5', fill: 'currentColor' }),
          h('path', { key: 'c', d: 'M1.5 14.5h13', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', opacity: '.45' }),
        ]),
        wide ? h('span', { key: 't', className: 'hst_launchLabel' }, '动态演示') : null,
        wide && count !== null && count > 0 ? h('span', { key: 'n', className: 'hst_launchNum' }, String(count)) : null,
      ])
    }

    /**
     * 设置页「资料」标签页：选一份电子试卷/课件 → 预览切题结果 → 勾选后入库。
     *
     * 有意做成「先预览再入库」两步：切题是启发式的，直接写库等于把不确定性塞进题库，
     * 而题库是要天天复习的东西，脏数据的代价远高于多点一次按钮。
     * @returns {object} React 元素。
     */
    function DocsTab() {
      const [file, setFile] = React.useState(null)
      const [pasted, setPasted] = React.useState('')
      const [mode, setMode] = React.useState('auto')
      const [subject, setSubject] = React.useState('')
      const [topic, setTopic] = React.useState('')
      const [source, setSource] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [excluded, setExcluded] = React.useState({})
      const [confirmLow, setConfirmLow] = React.useState(false)
      const [done, setDone] = React.useState(null)
      const formats = useResource('/docs/formats')

      /** 把 File 读成 base64（去掉 data URL 前缀）。 */
      const toBase64 = (f) => new Promise((resolve, reject) => {
        const reader = new window.FileReader()
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.onload = () => {
          const text = String(reader.result)
          const comma = text.indexOf(',')
          resolve(comma >= 0 ? text.slice(comma + 1) : text)
        }
        reader.readAsDataURL(f)
      })

      /** 解析（只预览）。 */
      const parse = async () => {
        setBusy(true)
        setError(null)
        setResult(null)
        setDone(null)
        setExcluded({})
        setConfirmLow(false)
        try {
          const body = {
            mode,
            subject: subject === '' ? undefined : subject,
            topic: topic === '' ? undefined : topic,
            source: source === '' ? undefined : source,
          }
          if (file !== null) {
            body.filename = file.name
            body.base64 = await toBase64(file)
          } else if (pasted.trim() !== '') {
            body.text = pasted
          } else {
            setError('先选一个文件，或把题目粘贴到下面的框里')
            setBusy(false)
            return
          }
          const data = await apiPost('/docs/parse', body)
          setResult(data)
          if (data.ok === false && data.hint) setError(data.hint)
        } catch (err) {
          setError(String(err.message ?? err))
        } finally {
          setBusy(false)
        }
      }

      /** 导入勾选的题目。 */
      const doImport = async () => {
        if (result === null || result.items === undefined) return
        const items = result.items.filter((_, i) => excluded[i] !== true)
        if (items.length === 0) { setError('一道题都没勾选'); return }
        setBusy(true)
        setError(null)
        try {
          const data = await apiPost('/docs/import', { items, force: true })
          setDone(`已导入 ${data.added} 条${data.updated > 0 ? `、更新 ${data.updated} 条` : ''}${data.skipped > 0 ? `、跳过 ${data.skipped} 条` : ''}；题库共 ${data.overview.totals.items} 条。`)
          setResult(null)
          setFile(null)
          setPasted('')
        } catch (err) {
          setError(String(err.message ?? err))
        } finally {
          setBusy(false)
        }
      }

      const stats = result === null ? null : result.stats
      const lowConfidence = result !== null && result.confidence === 'low'
      const keep = result === null || result.items === undefined
        ? 0
        : result.items.filter((_, i) => excluded[i] !== true).length

      return h('div', { className: 'hst_body' }, [
        // ① 选文件
        h('div', { key: 'pick', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '① 选一份资料'),
          h('div', { key: 'r', className: 'hst_row' }, [
            h('input', {
              key: 'f',
              type: 'file',
              className: 'hst_input hst_inputSm',
              accept: '.docx,.pptx,.txt,.md,.markdown,.csv,.html,.htm',
              onChange: (ev) => {
                setFile(ev.target.files && ev.target.files.length > 0 ? ev.target.files[0] : null)
                setResult(null)
                setDone(null)
              },
              style: { width: 'auto' },
            }),
            file === null ? null : h('span', { key: 'n', className: 'hst_hint' }, `${file.name} · ${(file.size / 1024).toFixed(0)} KB`),
          ]),
          // 兜底文案里就要写清 PDF / 图片的出路：那是用户第一个会问的问题，
          // 不该等异步取回格式清单才出现。
          h('p', { key: 'h', className: 'hst_hint' },
            formats.data === null
              ? '直接支持：Word 试卷（.docx）/ PPT 课件（.pptx）/ 纯文本 / Markdown / CSV / 网页。'
                + 'PDF 请先用 Word、WPS 另存为 .docx 再导入；扫描件或手机拍的题，直接发在对话里让我 OCR 识别后写入。'
              : `直接支持：${formats.data.supported.map((f) => f.label).join(' / ')}。`
                + formats.data.indirect.map((f) => `${f.label}：${f.note}`).join('；')),
          h('details', { key: 'p' }, [
            h('summary', { key: 's', className: 'hst_hint', style: { cursor: 'pointer' } }, '或者直接粘贴题目文本'),
            h('textarea', {
              key: 'a',
              className: 'hst_textarea',
              placeholder: '把试卷文字粘进来，支持「1．题干 / A．选项 / 【答案】 / 文末参考答案」等常见写法',
              value: pasted,
              onChange: (ev) => { setPasted(ev.target.value); setFile(null); setResult(null) },
              style: { marginTop: '6px' },
            }),
          ]),
        ]),

        // ② 解析选项
        h('div', { key: 'opt', className: 'hst_card' }, [
          h('h3', { key: 't', className: 'hst_h3' }, '② 解析选项'),
          h('div', { key: 'r', className: 'hst_row' }, [
            h(Field, { key: 'm', label: '模式' }, h('select', {
              className: 'hst_select hst_inputSm',
              value: mode,
              onChange: (ev) => setMode(ev.target.value),
            }, [
              h('option', { key: 'a', value: 'auto' }, '自动判断'),
              h('option', { key: 'p', value: 'paper' }, '试卷（切题 + 回填答案）'),
              h('option', { key: 'c', value: 'courseware' }, '课件（按页转卡片）'),
            ])),
            h(Field, { key: 's', label: '学科' }, h('select', {
              className: 'hst_select hst_inputSm',
              value: subject,
              onChange: (ev) => setSubject(ev.target.value),
            }, [
              h('option', { key: '', value: '' }, '自动识别'),
              ...SUBJECTS.map((x) => h('option', { key: x.key, value: x.key }, x.label)),
            ])),
            h(Field, { key: 'tp', label: '统一知识点' }, h('input', {
              className: 'hst_input hst_inputSm',
              placeholder: '可留空',
              value: topic,
              onChange: (ev) => setTopic(ev.target.value),
              style: { width: '150px' },
            })),
            h(Field, { key: 'src', label: '来源' }, h('input', {
              className: 'hst_input hst_inputSm',
              placeholder: '默认取文件名',
              value: source,
              onChange: (ev) => setSource(ev.target.value),
              style: { width: '130px' },
            })),
          ]),
          h('div', { key: 'b', className: 'hst_row' }, [
            h('button', {
              key: 'go',
              type: 'button',
              className: 'hst_btn hst_btnPrimary',
              disabled: busy,
              onClick: parse,
            }, busy ? '解析中…' : '解析预览'),
            error === null ? null : h('span', { key: 'e', className: 'hst_hint', style: { color: '#dc2626' } }, error),
            done === null ? null : h('span', { key: 'd', className: 'hst_hint', style: { color: '#16a34a' } }, done),
          ]),
        ]),

        // ③ 预览与入库
        result === null || result.items === undefined || result.items.length === 0 ? null : h('div', { key: 'pv', className: 'hst_card' }, [
          h('div', { key: 'h', className: 'hst_row' }, [
            h('h3', { key: 't', className: 'hst_h3' }, '③ 预览与入库'),
            h('span', { key: 's', className: 'hst_hint' }, result.mode === 'paper'
              ? `${result.label} · 切出 ${stats.questions} 题 · ${stats.withAnswer} 题带答案 · ${stats.withExplanation} 题带解析`
              : `${result.label} · ${stats.pages} 页转出 ${stats.cards} 张卡片`),
          ]),
          result.title === '' ? null : h('p', { key: 'ti', className: 'hst_hint' }, `识别标题：${result.title}`),
          (result.warnings ?? []).length === 0 ? null : h('ul', { key: 'w', className: 'hst_hint', style: { margin: '2px 0 0 16px' } },
            result.warnings.map((w, i) => h('li', { key: i }, w))),
          lowConfidence ? h('div', { key: 'lc', className: 'hst_warnBox' }, [
            h('div', { key: 't' }, `⚠ 这份文本不太像试卷：${(result.confidenceReasons ?? []).join('；')}`),
            h('label', { key: 'c', className: 'hst_check' }, [
              h('input', { key: 'i', type: 'checkbox', checked: confirmLow, onChange: (ev) => setConfirmLow(ev.target.checked) }),
              h('span', { key: 's' }, '我看过下面的内容，确认是题目，仍然导入'),
            ]),
          ]) : null,
          h('div', { key: 'list', className: 'hst_docList' }, result.items.map((it, i) => h('label', {
            key: i,
            className: `hst_docRow${excluded[i] === true ? ' hst_docRowOff' : ''}`,
          }, [
            h('input', {
              key: 'c',
              type: 'checkbox',
              checked: excluded[i] !== true,
              onChange: (ev) => setExcluded((prev) => ({ ...prev, [i]: !ev.target.checked })),
            }),
            h('div', { key: 'b', className: 'hst_docBody' }, [
              h('div', { key: 'q', className: 'hst_docQ' }, `${it.num ?? it.page ?? i + 1}. ${it.question}`),
              h('div', { key: 'm', className: 'hst_docM' }, [
                it.answer ? `答案：${it.answer}` : '⚠ 没有答案',
                it.explanation ? ' · 有解析' : '',
                ` · ${(it.tags ?? []).join('/')}`,
                ` · 难度 ${it.difficulty}`,
              ].join('')),
            ]),
          ]))),
          h('div', { key: 'act', className: 'hst_row' }, [
            h('button', {
              key: 'im',
              type: 'button',
              className: 'hst_btn hst_btnPrimary',
              disabled: busy || keep === 0 || (lowConfidence && !confirmLow),
              onClick: doImport,
            }, `导入选中的 ${keep} 条`),
            h('button', {
              key: 'all',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              onClick: () => setExcluded({}),
            }, '全选'),
            h('button', {
              key: 'none',
              type: 'button',
              className: 'hst_btn hst_btnSm',
              onClick: () => setExcluded(Object.fromEntries(result.items.map((_, i) => [i, true]))),
            }, '全不选'),
            h('span', { key: 'h', className: 'hst_hint' }, '入库后自动进入艾宾浩斯复习排期；没有答案的题建议先补上再导入。'),
          ]),
        ]),
      ])
    }

    // ── 面板与徽标 ──────────────────────────────────────────────────────────
    const TABS = [
      { key: 'today', label: '今日' },
      { key: 'library', label: '题库' },
      { key: 'demos', label: '演示' },
      { key: 'docs', label: '资料' },
      { key: 'plan', label: '计划' },
      { key: 'stats', label: '统计' },
      { key: 'settings', label: '设置' },
    ]

    /**
     * 设置页「高中助学」分区主面板。
     * @returns {object} React 元素。
     */
    function TutorPanel() {
      const [tab, setTab] = React.useState('today')
      const [pending, setPending] = React.useState(null)
      const overview = useResource('/overview')
      const meta = useResource('/meta')

      const goLibrary = React.useCallback((filter) => { setPending(filter); setTab('library') }, [])

      if (overview.error !== null) {
        return h('div', { className: 'hst_page' }, [
          h('h2', { key: 't', className: 'hst_title' }, '高中助学'),
          h('p', { key: 'e', className: 'hst_err' }, `无法连接插件后端：${overview.error}`),
          h('p', { key: 'h', className: 'hst_hint' }, '确认 dsh-highschool-tutor 已装入当前 profile 且 host 半边已启动（重启 dsh web 后再试）。'),
        ])
      }
      if (overview.data === null) return h('div', { className: 'hst_page' }, h('p', { className: 'hst_hint' }, '正在加载学习数据…'))

      const data = overview.data
      const profile = data.profile
      return h('div', { className: 'hst_page' }, [
        h('div', { key: 'head', className: 'hst_head' }, [
          h('div', { key: 'l' }, [
            h('h2', { key: 't', className: 'hst_title' }, '高中助学 · 语数英物化地'),
            h('p', { key: 's', className: 'hst_sub' }, [
              profile.grade === null ? '年级未设置（去「设置」选一下）' : GRADE_LABELS[profile.grade],
              ' · ',
              profile.region,
              ' · ',
              data.countdown.days === null ? '高考日期未设置' : `距高考 ${data.countdown.days} 天`,
              ' · 题库 ',
              String(data.totals.items),
              ' 条 · 连续 ',
              String(data.study.streak),
              ' 天',
            ].join('')),
          ]),
          h('div', { key: 'r', className: 'hst_row' }, [
            h(Stat, { key: 'd', num: data.due.total + data.due.new, label: '今日待复习' }),
          ]),
        ]),
        h('div', { key: 'tabs', className: 'hst_tabs' }, TABS.map((t) => h('button', {
          key: t.key,
          type: 'button',
          className: `hst_tab${tab === t.key ? ' hst_tabOn' : ''}`,
          onClick: () => setTab(t.key),
        }, t.label))),
        tab === 'today' ? h(TodayTab, { key: 'today', overview: data, onGoLibrary: goLibrary }) : null,
        tab === 'library' ? h(LibraryTab, { key: 'lib', initialFilter: pending, onConsumeFilter: () => setPending(null) }) : null,
        tab === 'demos' ? h(DemosTab, { key: 'demos' }) : null,
        tab === 'docs' ? h(DocsTab, { key: 'docs' }) : null,
        tab === 'plan' ? h(PlanTab, { key: 'plan', overview: data }) : null,
        tab === 'stats' ? h(StatsTab, { key: 'stats', overview: data }) : null,
        tab === 'settings' ? h(SettingsTab, { key: 'set', overview: data, meta: meta.data }) : null,
      ])
    }

    /**
     * 会话标题栏徽标：待复习条数 + 高考倒计时，点开可直接快速复习。
     * @returns {object|null} React 元素。
     */
    function TutorBadge() {
      const overview = useResource('/overview')
      const meta = useResource('/meta')
      const [open, setOpen] = React.useState(false)
      const [quick, setQuick] = React.useState(false)
      const wrapRef = React.useRef(null)
      const pollMs = Math.max(10_000, Number(meta.data?.ui?.pollIntervalMs) || 60_000)
      const reload = overview.reload

      // 定时轮询（页面隐藏时暂停，回到前台立刻取一次）
      React.useEffect(() => {
        const timer = window.setInterval(() => { if (!document.hidden) reload() }, pollMs)
        const onVisible = () => { if (!document.hidden) reload() }
        document.addEventListener('visibilitychange', onVisible)
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
      }, [pollMs, reload])

      // 点击外部 / Esc 关闭浮层
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) { setOpen(false); setQuick(false) }
        }
        const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); setQuick(false) } }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
      }, [open])

      if (meta.data?.ui?.badge === false) return null
      const data = overview.data
      if (data === null) return null

      const dueTotal = data.due.total + data.due.new
      const subjectsWithDue = SUBJECTS.filter((s) => (data.due.bySubject[s.key] ?? 0) + (data.due.newBySubject[s.key] ?? 0) > 0)

      return h('div', { className: 'hst_popWrap', ref: wrapRef }, [
        h('button', {
          key: 'b',
          type: 'button',
          className: 'hst_badge',
          title: `高中助学：今日待复习 ${dueTotal} 条${data.countdown.days === null ? '' : `，距高考 ${data.countdown.days} 天`}`,
          onClick: () => setOpen((v) => !v),
        }, [
          h('div', { key: 'd', className: 'hst_badgeCol' }, [
            h('span', { key: 'n', className: 'hst_badgeNum', style: { color: dueTotal > 0 ? '#dc2626' : '#16a34a' } }, String(dueTotal)),
            h('span', { key: 'l', className: 'hst_badgeLabel' }, '待复习'),
          ]),
          data.countdown.days === null ? null : h('div', { key: 'c', className: 'hst_badgeCol' }, [
            h('span', { key: 'n', className: 'hst_badgeNum' }, String(data.countdown.days)),
            h('span', { key: 'l', className: 'hst_badgeLabel' }, '天高考'),
          ]),
        ]),
        open ? h('div', { key: 'pop', className: 'hst_pop' }, [
          h('div', { key: 'h', className: 'hst_row', style: { justifyContent: 'space-between' } }, [
            h('span', { key: 't', className: 'hst_h3' }, '高中助学'),
            h('span', { key: 's', className: 'hst_meta' }, `${data.today} · 连续 ${data.study.streak} 天`),
          ]),
          h('div', { key: 'g', className: 'hst_grid' }, [
            h(Stat, { key: 'd', num: dueTotal, label: '待复习', sub: `到期 ${data.due.total} · 新 ${data.due.new}` }),
            h(Stat, { key: 'r', num: `${data.study.reviewedToday}/${data.study.reviewTarget}`, label: '今日已复习' }),
            h(Stat, { key: 'm', num: `${data.study.minutes}/${data.study.target}`, label: '学习分钟' }),
          ]),
          subjectsWithDue.length === 0 ? null : h('div', { key: 'c', className: 'hst_row' }, subjectsWithDue.map((s) => h(Chip, {
            key: s.key,
            subject: s.key,
            count: (data.due.bySubject[s.key] ?? 0) + (data.due.newBySubject[s.key] ?? 0),
          }))),
          quick
            ? h(ReviewRunner, { key: 'run', compact: true, onExit: () => setQuick(false) })
            : h('div', { key: 'act', className: 'hst_row' }, [
              h('button', {
                key: 'r',
                className: 'hst_btn hst_btnSm hst_btnPrimary',
                type: 'button',
                disabled: dueTotal === 0,
                onClick: () => setQuick(true),
              }, dueTotal === 0 ? '今日已清空' : '开始快速复习'),
              h('span', { key: 'h', className: 'hst_hint' }, '完整面板在 设置 → 高中助学'),
            ]),
        ]) : null,
      ])
    }

    // ── 插件注册 ────────────────────────────────────────────────────────────
    /** 硬依赖：插槽服务。 */
    const inject = ['slots']

    /**
     * 注册设置页分区、标题栏徽标、演示工具卡片与右侧停靠面板。
     * @param {object} ctx client 根上下文。
     * @returns {void}
     */
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'highschool-tutor',
        order: 45,
        label: () => '高中助学',
      }, TutorPanel))

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'highschool-tutor-badge',
        order: -20,
      }, TutorBadge))

      // tutor_visualize 的专属工具视图：按工具名 keyed，属于加性注册
      // （不会顶掉宿主的通用工具行，也不影响其它工具的渲染）。
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        id: 'highschool-tutor-demo',
        key: 'tutor_visualize',
      }, DemoToolView))

      // better-sidebar 页签
      '.hst_bsTab{display:flex;flex-direction:column;gap:8px;padding:10px 12px 16px;height:100%;overflow-y:auto}',
      '.hst_bsHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:none}',
      '.hst_bsTitle{font-size:13px;font-weight:600;flex:1;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 右侧停靠面板挂在 shell.overlay（root 作用域的加性浮层）：
      // 宿主自带的 details 列是单占位且已被工具详情占用，挂那里会接管所有工具的
      // 详情渲染，代价太大；浮层是唯一既能常驻右侧、又不与任何自带 UI 争位的座位。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'highschool-tutor-dock',
        order: 30,
      }, TutorDock))

      // 左侧栏底部的常驻入口：侧栏关掉后还能一键叫回来
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'highschool-tutor-demo-launcher',
        order: 20,
      }, TutorDockLauncher))

      // ── 可选集成：dsh-better-sidebar ──────────────────────────────────────
      // 用 cordis 的 ctx.inject(deps, cb) 而不是把 betterSidebar 写进本包的
      // 顶层 inject：那样会变成硬依赖，没装该插件时整个 client 半边都不加载。
      // 这里服务在就激活、服务走了就自动回落到自带浮层。
      if (typeof ctx.inject === 'function') {
        ctx.inject(['betterSidebar'], (sctx) => {
          const service = sctx.betterSidebar
          if (service === undefined || service === null || typeof service.registerTab !== 'function') return
          bs.attach(service)
          sctx.effect(() => {
            const dispose = service.registerTab({
              id: BS_TAB_ID,
              title: () => '动态演示',
              icon: (size) => demoIcon(size),
              order: 60,
              // 单实例：再次打开只聚焦已有页签，不会开出一堆重复页
              single: true,
              component: DemoSidebarTab,
            })
            return () => {
              try { dispose() } finally { bs.attach(null) }
            }
          }, 'dsh-highschool-tutor: better-sidebar 演示页签')
        })
      }
    }

    exports.ReviewRunner = ReviewRunner
    exports.TutorBadge = TutorBadge
    exports.TutorPanel = TutorPanel
    exports.TodayTab = TodayTab
    exports.LibraryTab = LibraryTab
    exports.PlanTab = PlanTab
    exports.StatsTab = StatsTab
    exports.SettingsTab = SettingsTab
    exports.DemosTab = DemosTab
    exports.DocsTab = DocsTab
    exports.DemoToolView = DemoToolView
    exports.DemoFrame = DemoFrame
    exports.TutorDock = TutorDock
    exports.TutorDockLauncher = TutorDockLauncher
    exports.dock = dock
    exports.panel = panel
    exports.bs = bs
    exports.DemoSidebarTab = DemoSidebarTab
    exports.BS_TAB_ID = BS_TAB_ID
    // 自动推送的判定逻辑对外暴露，便于单测（静态渲染跑不到 effect）
    exports.autoDock = {
      should: shouldAutoDock,
      markRunning: (id) => sawRunning.add(id),
      markShown: (id) => autoShown.add(id),
      bootAt: BOOT_AT,
      quietMs: BOOT_QUIET_MS,
      reset: () => { sawRunning.clear(); autoShown.clear() },
    }
    exports.resolveTheme = resolveTheme
    exports.apply = apply
    exports.inject = inject
    exports.fmtInterval = fmtInterval

    return module.exports
  },
})


