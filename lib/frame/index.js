// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 演示帧的 host 侧装配。
 *
 * 职责：把 frame/*.browser.js 拼成一整段引擎脚本，并包进一份**完全静态**的 HTML
 * 文档——静态是关键：文档里不插值任何场景数据，所以
 *
 *   · 浏览器侧只需 fetch 一次 /api/highschool-tutor/frame.html 就能缓存复用，
 *     页面上 N 个演示卡片共用同一份 srcdoc 字符串；
 *   · 场景数据走 postMessage 送进去（见 30-shell.browser.js 的协议），
 *     换题、切步骤都不用重建 iframe，也不存在字符串转义踩坑。
 *
 * 安全模型（对齐 dsh-visualize 的做法）：iframe 用 sandbox="allow-scripts" 得到
 * 不透明源，文档自带 CSP 限定帧内能做什么——允许内联脚本/样式与固定 CDN 白名单，
 * 禁止 fetch/XHR/WebSocket（connect-src 只留 blob:/data:）、禁止嵌套框架与表单提交。
 * 声明式场景引擎完全离线自足；CDN 白名单只为 kind='html' 兜底时的自由度存在。
 *
 * @module dsh-highschool-tutor/frame
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本目录。 */
const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 引擎源码缓存。带 stamp（文件名+大小+mtime 的指纹）：任一 *.browser.js 改动后
 * 下一次请求自动重拼，不必重启 host——否则「改完刷新页面即生效」这句承诺对帧内
 * 引擎就是假的（永久缓存会一直发旧代码）。
 */
let cache = null

/** kind='html' 兜底时可加载静态资源的 CDN 白名单。 */
const RESOURCE_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://esm.sh',
]

const RESOURCE_SOURCES = ['blob:', 'data:', ...RESOURCE_ORIGINS].join(' ')

/** 演示帧文档的 Content-Security-Policy。 */
export const FRAME_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${RESOURCE_SOURCES}`,
  `style-src 'unsafe-inline' ${RESOURCE_SOURCES}`,
  `img-src ${RESOURCE_SOURCES}`,
  `font-src ${RESOURCE_SOURCES}`,
  `media-src ${RESOURCE_SOURCES}`,
  'connect-src blob: data:',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * 读出并拼接引擎源码（按文件名排序，00-core → 10-scene2d → 20-scene3d → 30-shell）。
 * @returns {{source: string, files: string[], version: string}} 引擎源码与指纹。
 */
export function frameRuntime() {
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith('.browser.js'))
    .sort()
  // 目录指纹：文件名 + 大小 + mtime。变了就重拼，没变就走缓存。
  const stamp = files
    .map((f) => {
      const s = statSync(join(HERE, f))
      return `${f}:${s.size}:${s.mtimeMs}`
    })
    .join('|')
  if (cache !== null && cache.stamp === stamp) return cache

  const parts = []
  let size = 0
  for (const file of files) {
    const text = readFileSync(join(HERE, file), 'utf8')
    size += text.length
    // 结尾必须补 `;`：每个文件都以 `})(…)` 形式的 IIFE 收尾且不带分号，直接换行
    // 拼接会踩 ASI 陷阱——下一个文件开头的 `(function (NS) {…})` 被解析成对上一段
    // 返回值的调用，整段脚本抛 TypeError，结果只有第一个文件生效。
    parts.push(`/* ── ${file} ── */\n${text}\n;\n`)
  }
  // 指纹：文件数 + 总字节数，改动即变（够用且零维护成本）
  const version = `${files.length}-${size.toString(36)}`
  cache = { source: parts.join('\n'), files, version, stamp }
  return cache
}

/** 开发期热重载用：清掉源码缓存。 */
export function clearFrameCache() {
  cache = null
}

/** 独立演示窗口与对话页之间的广播频道名（同源、跨窗口、两边刷新都不断链）。 */
export const PANEL_CHANNEL = 'dsh-highschool-tutor/demo'

/** 独立窗口页面的明暗两套调色板（它读不到宿主的设计令牌，自己带一套）。 */
const PANEL_THEMES = {
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

/**
 * 生成**独立演示窗口**的页面（`GET /panel.html`）。
 *
 * 与 iframe 里的 frameDocument() 不同，这是一个普通的同源页面：
 *   · 引擎走 `<script src="./frame.js">` 加载，不必内联（省 138 KB 且可被浏览器缓存）；
 *   · 通过 BroadcastChannel 与对话页通信——对话页每出一份新演示就广播过来，
 *     任意一边刷新都能重新握手，不像 window.opener 那样一刷新就断；
 *   · 也能独立使用：直接打开这个地址（或带 ?demo=dm_0003），
 *     没有对话页在广播时就自己从 /demos 取最近一份。
 *
 * @returns {string} HTML 文档。
 */
export function panelDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>动态演示 · 高中助学</title>
<style>
:root{color-scheme:light dark;--pg-fg:#0f1115;--pg-fg2:#61666b;--pg-bg:#fff;--pg-line:rgba(0,0,0,.12)}
@media (prefers-color-scheme:dark){:root{--pg-fg:#e8eaed;--pg-fg2:#a8adb4;--pg-bg:#15171a;--pg-line:rgba(255,255,255,.14)}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--pg-bg);color:var(--pg-fg);display:flex;flex-direction:column;
font:13.5px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--pg-line);flex-wrap:wrap}
.dot{width:9px;height:9px;border-radius:50%;flex:none;background:#81858c}
.title{font-weight:600;font-size:13.5px;flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.state{font-size:11.5px;color:var(--pg-fg2);white-space:nowrap}
select,.chk{font:inherit;font-size:12px;color:inherit;background:transparent;
border:1px solid var(--pg-line);border-radius:7px;padding:3px 6px}
.chk{display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:none}
main{flex:1;min-height:0;overflow-y:auto;padding:10px 12px 18px}
.empty{color:var(--pg-fg2);font-size:13px;padding:24px 4px;line-height:1.9}
kbd{font:inherit;font-size:11.5px;border:1px solid var(--pg-line);border-radius:4px;padding:0 4px}
</style>
</head>
<body>
<div class="bar">
  <span class="dot" id="dot"></span>
  <span class="title" id="title">动态演示</span>
  <span class="state" id="state">等待对话页推送…</span>
  <label class="chk" title="勾选时：对话里每出一份新演示都自动切到这里"><input type="checkbox" id="follow" checked> 跟随对话</label>
  <select id="recent" title="打开已存的演示"><option value="">最近演示…</option></select>
</div>
<main><div id="hst-root"></div><div class="empty" id="empty">
  还没有演示。<br>
  在对话里让我讲一道数学 / 物理 / 化学 / 地理题，演示就会自动出现在这个窗口。<br>
  这个窗口独立于对话页面，可以拖到另一块屏幕；对话页刷新也不会断开。<br>
  快捷键：<kbd>←</kbd> <kbd>→</kbd> 切步骤，<kbd>空格</kbd> 播放，<kbd>r</kbd> 复位视角。
</div></main>
<script src="./frame.js"></script>
<script>
(function () {
  // 引擎把自己挂在 globalThis 上；浏览器里 window === globalThis，两边都取一次
  // 既不改变浏览器语义，又让这段脚本能在测试桩里跑起来。
  var NS = (typeof globalThis !== 'undefined' && globalThis.__HST__) || window.__HST__;
  var THEMES = ${JSON.stringify(PANEL_THEMES)};
  var CHANNEL = ${JSON.stringify(PANEL_CHANNEL)};
  var SUBJECTS = { chinese: ['语文', '#d4483b'], math: ['数学', '#2f6df6'], english: ['英语', '#8b5cf6'],
    physics: ['物理', '#0f9d8f'], chemistry: ['化学', '#e08b1a'], geography: ['地理', '#6b8f2f'] };
  var elTitle = document.getElementById('title');
  var elState = document.getElementById('state');
  var elDot = document.getElementById('dot');
  var elEmpty = document.getElementById('empty');
  var elFollow = document.getElementById('follow');
  var elRecent = document.getElementById('recent');
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var player = null;
  var hostTheme = null;

  /** 当前应使用的调色板：优先用对话页桥过来的，否则用本页的明暗两套。 */
  function theme() {
    return hostTheme || (dark ? THEMES.dark : THEMES.light);
  }

  /** 装载一份演示。 */
  function load(demo) {
    if (!demo || !demo.scene) return;
    elEmpty.style.display = 'none';
    elTitle.textContent = demo.title || demo.scene.title || '动态演示';
    document.title = (demo.title || demo.scene.title || '动态演示') + ' · 高中助学';
    var sub = SUBJECTS[demo.scene.subject];
    elDot.style.background = sub ? sub[1] : '#81858c';
    elDot.title = sub ? sub[0] : '';
    if (player === null) {
      player = NS.mount({ mode: 'panel', theme: theme(), scene: demo.scene });
    } else {
      NS.applyTheme(theme());
      player.load(demo.scene);
    }
  }

  /** 拉取最近演示填充下拉框。 */
  function fillRecent() {
    fetch('./demos?limit=30', { cache: 'no-store' }).then(function (r) { return r.json() }).then(function (data) {
      (data.demos || []).forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.title;
        elRecent.appendChild(opt);
      });
    }).catch(function () { /* 后端不可用时保持空列表 */ });
  }

  /** 按 id 打开一份已存演示。 */
  function openStored(id) {
    return fetch('./demos/' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (demo) { load(demo); return true })
      .catch(function () { return false });
  }

  elRecent.addEventListener('change', function () {
    if (elRecent.value !== '') openStored(elRecent.value);
  });

  // ── 与对话页的广播通道 ────────────────────────────────────────────────────
  var bc = null;
  try { bc = new BroadcastChannel(CHANNEL) } catch (err) { bc = null }
  var gotPush = false;
  if (bc !== null) {
    bc.onmessage = function (ev) {
      var msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'scene') {
        gotPush = true;
        if (msg.theme) hostTheme = msg.theme;
        elState.textContent = '已连接对话页';
        if (elFollow.checked || player === null) load(msg.demo);
      } else if (msg.t === 'ping') {
        bc.postMessage({ t: 'here' });
      }
    };
    bc.postMessage({ t: 'here' });
    bc.postMessage({ t: 'need' });
    window.addEventListener('beforeunload', function () { try { bc.postMessage({ t: 'bye' }) } catch (e) {} });
    // 对话页可能稍后才打开：定期宣告存在，让它把演示投过来
    setInterval(function () { try { bc.postMessage({ t: 'here' }) } catch (e) {} }, 4000);
  } else {
    elState.textContent = '此浏览器不支持跨窗口同步，可用下拉框手动打开';
  }

  // 直接打开本页（?demo=xxx 或什么都不带）时的兜底：自己取一份来显示
  var wanted = new URLSearchParams(location.search).get('demo');
  fillRecent();
  if (wanted) {
    openStored(wanted);
  } else {
    setTimeout(function () {
      if (gotPush || player !== null) return;
      fetch('./demos?limit=1&full=true', { cache: 'no-store' }).then(function (r) { return r.json() })
        .then(function (data) {
          if (data.demos && data.demos.length > 0) {
            load(data.demos[0]);
            elState.textContent = '显示最近一份演示';
          }
        }).catch(function () { /* 忽略 */ });
    }, 700);
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
      dark = ev.matches;
      if (hostTheme === null && player !== null) { NS.applyTheme(theme()); player.render() }
    });
  }
})();
</script>
</body>
</html>
`
}

/**
 * 生成演示帧的完整 HTML 文档（静态，可被所有 iframe 复用）。
 * @returns {string} HTML 文档。
 */
export function frameDocument() {
  const runtime = frameRuntime()
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
<title>高中助学 · 动态演示</title>
</head>
<body>
<div id="hst-root"></div>
<script>${runtime.source}
;(function () {
  try {
    globalThis.__HST__.mount({ mode: 'card' })
  } catch (err) {
    var box = document.getElementById('hst-root')
    if (box) box.textContent = '演示引擎启动失败：' + (err && err.message ? err.message : err)
  }
})();
</script>
</body>
</html>
`
}

/**
 * 引擎指纹（浏览器侧当作缓存键）。
 * @returns {string} 版本串。
 */
export function frameVersion() {
  return frameRuntime().version
}
