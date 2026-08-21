// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 帧内引擎「shell 层」：DOM、步骤时间轴、交互、消息协议。
 *
 * 这一层把场景层包装成一个可用的演示器：
 *
 *   ┌──────────────────────────────┐
 *   │ 标题 · 说明          [复位]  │
 *   │ ┌──────────────────────────┐ │  ← 画布：2D 可平移缩放，3D 可拖拽旋转
 *   │ │        canvas            │ │
 *   │ └──────────────────────────┘ │
 *   │ ① ②★③ ④ ⑤   ‹ ▶ ›  3/5      │  ← 步骤时间轴，★ 是重点步骤
 *   │ 第 3 步 标题                  │
 *   │ 说明文字……                    │
 *   │ 公式                          │
 *   └──────────────────────────────┘
 *
 * 步骤是**累积**语义：第 n 步的画面 = 初始场景依次施加 0..n 步的 show/hide/set/view。
 * 因此来回点步骤、拖进度条得到的画面完全一致，不会像「增量动画」那样漂移。
 * focus（高亮）只取当前步，这样「这一步在看哪里」一眼可见。
 *
 * 与父窗口的消息协议（父窗口是 DSH 的对话卡片或右侧停靠面板）：
 *   父 → 帧  { type:'hst:scene', token, scene, theme, mode }  装载/替换场景
 *   父 → 帧  { type:'hst:step',  token, index }               跳到某一步
 *   帧 → 父  { type:'hst:ready', token }                      引擎就绪
 *   帧 → 父  { type:'hst:height',token, height }              内容高度（父窗口据此调 iframe 高）
 *   帧 → 父  { type:'hst:step',  token, index, total, title, key } 当前步变化
 */

(function (NS) {
  'use strict'

  /** 帧内样式（挂载时注入 <style>）。 */
  var CSS = [
    ':root{color-scheme:light dark}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;padding:0;background:transparent;color:var(--hst-fg,#0f1115);',
    'font:13px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}',
    '.hst{display:flex;flex-direction:column;gap:8px;padding:2px}',
    '.hst_top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-height:18px}',
    '.hst_t{font-size:13.5px;font-weight:600;line-height:1.4}',
    '.hst_cap{font-size:11.5px;color:var(--hst-fg2,#61666b);flex:1;min-width:0}',
    '.hst_tag{font-size:10.5px;padding:1px 6px;border-radius:999px;background:var(--hst-bg2,rgba(38,49,72,.06));color:var(--hst-fg2,#61666b);white-space:nowrap}',
    '.hst_stage{position:relative;border-radius:10px;overflow:hidden;background:var(--hst-bg2,rgba(38,49,72,.04));',
    'border:1px solid var(--hst-line,rgba(0,0,0,.1))}',
    '.hst_stage canvas{display:block;touch-action:none;cursor:grab}',
    '.hst_stage canvas.drag{cursor:grabbing}',
    '.hst_hint{position:absolute;right:7px;bottom:6px;font-size:10px;color:var(--hst-fg3,#81858c);',
    'background:var(--hst-bg,#fff);opacity:.72;padding:1px 6px;border-radius:5px;pointer-events:none}',
    '.hst_reset{position:absolute;right:6px;top:6px;font:inherit;font-size:11px;padding:2px 8px;border-radius:6px;',
    'border:1px solid var(--hst-line,rgba(0,0,0,.12));background:var(--hst-bg,#fff);color:var(--hst-fg2,#61666b);cursor:pointer}',
    '.hst_reset:hover{color:var(--hst-fg,#0f1115)}',
    // 步骤时间轴
    '.hst_bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.hst_chips{display:flex;align-items:center;gap:4px;flex-wrap:wrap;flex:1;min-width:0}',
    '.hst_chip{appearance:none;font:inherit;font-size:11.5px;line-height:1;min-width:22px;height:22px;padding:0 6px;',
    'border-radius:6px;border:1px solid var(--hst-line,rgba(0,0,0,.12));background:var(--hst-bg,#fff);',
    'color:var(--hst-fg2,#61666b);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:2px}',
    '.hst_chip:hover{border-color:var(--hst-brand,#3964fe)}',
    '.hst_chip.on{background:var(--hst-brand,#3964fe);border-color:transparent;color:#fff;font-weight:600}',
    '.hst_chip.key{border-color:var(--hst-warn,#e08b1a);color:var(--hst-warn,#e08b1a)}',
    '.hst_chip.key.on{background:var(--hst-warn,#e08b1a);color:#fff}',
    '.hst_ctrl{display:flex;align-items:center;gap:3px}',
    '.hst_btn{appearance:none;font:inherit;font-size:12px;height:22px;min-width:24px;padding:0 7px;border-radius:6px;',
    'border:1px solid var(--hst-line,rgba(0,0,0,.12));background:var(--hst-bg,#fff);color:var(--hst-fg,#0f1115);cursor:pointer}',
    '.hst_btn:hover:not(:disabled){background:var(--hst-bg2,rgba(38,49,72,.06))}',
    '.hst_btn:disabled{opacity:.4;cursor:default}',
    '.hst_pos{font-size:11px;color:var(--hst-fg3,#81858c);font-variant-numeric:tabular-nums;white-space:nowrap}',
    // 当前步骤说明
    '.hst_step{border-radius:9px;padding:8px 10px;background:var(--hst-bg2,rgba(38,49,72,.045));',
    'border-left:3px solid var(--hst-brand,#3964fe);display:flex;flex-direction:column;gap:4px}',
    '.hst_step.key{border-left-color:var(--hst-warn,#e08b1a);background:color-mix(in srgb,var(--hst-warn,#e08b1a) 9%,transparent)}',
    '.hst_stitle{font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:6px}',
    '.hst_star{font-size:10px;font-weight:600;color:#fff;background:var(--hst-warn,#e08b1a);padding:1px 5px;border-radius:4px}',
    '.hst_detail{font-size:12px;color:var(--hst-fg2,#61666b);white-space:pre-wrap}',
    '.hst_formula{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;',
    'background:var(--hst-bg,#fff);border:1px solid var(--hst-line,rgba(0,0,0,.08));border-radius:6px;padding:5px 8px;',
    'white-space:pre-wrap;overflow-x:auto}',
    '.hst_html{padding:2px}',
    '.hst_err{font-size:12px;color:var(--hst-bad,#dc2626);padding:8px}',
    '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}',
  ].join('')

  /** 消息类型。 */
  var MSG = { scene: 'hst:scene', step: 'hst:step', height: 'hst:height', ready: 'hst:ready' }

  /**
   * 建元素。
   * @param {string} tag 标签。
   * @param {string} [cls] class。
   * @param {string} [text] 文本。
   * @returns {HTMLElement} 元素。
   */
  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  /**
   * 把 HTML 片段塞进容器，并让其中的 <script> 真正执行
   * （innerHTML 插入的 script 不会自动执行，需要重建节点）。
   * @param {HTMLElement} host 容器。
   * @param {string} html 片段。
   * @returns {void}
   */
  function injectHtml(host, html) {
    host.innerHTML = String(html == null ? '' : html)
    var scripts = host.querySelectorAll('script')
    for (var i = 0; i < scripts.length; i += 1) {
      var old = scripts[i]
      var fresh = document.createElement('script')
      for (var a = 0; a < old.attributes.length; a += 1) {
        fresh.setAttribute(old.attributes[a].name, old.attributes[a].value)
      }
      fresh.textContent = old.textContent
      old.parentNode.replaceChild(fresh, old)
    }
  }

  /**
   * 演示器。
   * @param {HTMLElement} root 挂载点。
   * @param {object} [opts] 选项：token（消息校验）、mode（'card' | 'panel'）。
   * @constructor
   */
  function Player(root, opts) {
    var o = opts || {}
    this.root = root
    this.token = o.token || ''
    this.mode = o.mode || 'card'
    this.scene = null
    this.handler = null
    this.index = -1
    this.playing = false
    this.timer = 0
    this.raf = 0
    this.t = 0
    this.animated = false
    this.cam = null
    this.pan = { x: 0, y: 0, zoom: 1 }
    this.lastHeight = 0
    this.build()
  }

  Player.prototype = {
    /** 建立 DOM 骨架。 */
    build: function () {
      var self = this
      this.root.innerHTML = ''
      var wrap = el('div', 'hst')

      var top = el('div', 'hst_top')
      this.elTitle = el('div', 'hst_t')
      this.elCap = el('div', 'hst_cap')
      this.elTag = el('div', 'hst_tag')
      top.appendChild(this.elTitle)
      top.appendChild(this.elCap)
      top.appendChild(this.elTag)
      wrap.appendChild(top)

      this.elStage = el('div', 'hst_stage')
      this.canvas = el('canvas')
      this.elStage.appendChild(this.canvas)
      this.elHint = el('div', 'hst_hint')
      this.elStage.appendChild(this.elHint)
      this.elReset = el('button', 'hst_reset', '复位')
      this.elReset.type = 'button'
      this.elReset.addEventListener('click', function () { self.resetView() })
      this.elStage.appendChild(this.elReset)
      wrap.appendChild(this.elStage)

      this.elHtml = el('div', 'hst_html')
      this.elHtml.style.display = 'none'
      wrap.appendChild(this.elHtml)

      var bar = el('div', 'hst_bar')
      this.elChips = el('div', 'hst_chips')
      bar.appendChild(this.elChips)
      var ctrl = el('div', 'hst_ctrl')
      this.btnPrev = el('button', 'hst_btn', '‹')
      this.btnPlay = el('button', 'hst_btn', '▶')
      this.btnNext = el('button', 'hst_btn', '›')
      this.btnPrev.type = 'button'
      this.btnPlay.type = 'button'
      this.btnNext.type = 'button'
      this.btnPrev.title = '上一步（←）'
      this.btnPlay.title = '自动播放（空格）'
      this.btnNext.title = '下一步（→）'
      this.btnPrev.addEventListener('click', function () { self.go(self.index - 1) })
      this.btnNext.addEventListener('click', function () { self.go(self.index + 1) })
      this.btnPlay.addEventListener('click', function () { self.toggle() })
      ctrl.appendChild(this.btnPrev)
      ctrl.appendChild(this.btnPlay)
      ctrl.appendChild(this.btnNext)
      this.elPos = el('div', 'hst_pos')
      ctrl.appendChild(this.elPos)
      bar.appendChild(ctrl)
      this.elBar = bar
      wrap.appendChild(bar)

      this.elStep = el('div', 'hst_step')
      this.elStepTitle = el('div', 'hst_stitle')
      this.elDetail = el('div', 'hst_detail')
      this.elFormula = el('div', 'hst_formula')
      this.elStep.appendChild(this.elStepTitle)
      this.elStep.appendChild(this.elDetail)
      this.elStep.appendChild(this.elFormula)
      wrap.appendChild(this.elStep)

      this.root.appendChild(wrap)
      this.painter = new NS.Painter(this.canvas)
      this.bindInteractions()

      // 键盘：←/→ 切步，空格播放/暂停，r 复位
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowRight') { self.go(self.index + 1); ev.preventDefault() }
        else if (ev.key === 'ArrowLeft') { self.go(self.index - 1); ev.preventDefault() }
        else if (ev.key === ' ') { self.toggle(); ev.preventDefault() }
        else if (ev.key === 'r' || ev.key === 'R') self.resetView()
      })
      window.addEventListener('resize', function () { self.layout(); self.render() })
    },

    /** 绑定画布上的拖拽/缩放交互。 */
    bindInteractions: function () {
      var self = this
      var dragging = false
      var last = null
      this.canvas.addEventListener('pointerdown', function (ev) {
        dragging = true
        last = { x: ev.clientX, y: ev.clientY }
        self.canvas.classList.add('drag')
        try { self.canvas.setPointerCapture(ev.pointerId) } catch (err) { /* 忽略 */ }
      })
      this.canvas.addEventListener('pointermove', function (ev) {
        if (!dragging || !last) return
        var dx = ev.clientX - last.x
        var dy = ev.clientY - last.y
        last = { x: ev.clientX, y: ev.clientY }
        if (self.is3d()) {
          self.cam.yaw += dx * 0.01
          self.cam.pitch = NS.clamp(self.cam.pitch + dy * 0.01, -1.45, 1.45)
        } else {
          var v = self.painter.view
          var kx = (v.xMax - v.xMin) / Math.max(1, self.painter.w)
          var ky = (v.yMax - v.yMin) / Math.max(1, self.painter.h)
          self.pan.x -= dx * kx
          self.pan.y += dy * ky
        }
        self.render()
      })
      /** 结束拖拽。 */
      var end = function () {
        dragging = false
        last = null
        self.canvas.classList.remove('drag')
      }
      this.canvas.addEventListener('pointerup', end)
      this.canvas.addEventListener('pointercancel', end)
      this.canvas.addEventListener('wheel', function (ev) {
        ev.preventDefault()
        var k = ev.deltaY > 0 ? 1.1 : 1 / 1.1
        if (self.is3d()) self.cam.zoom = NS.clamp(self.cam.zoom / k, 0.35, 4)
        else self.pan.zoom = NS.clamp(self.pan.zoom * k, 0.25, 6)
        self.render()
      }, { passive: false })
      this.canvas.addEventListener('dblclick', function () { self.resetView() })
    },

    /** 当前场景是否 3D。 */
    is3d: function () {
      return Boolean(this.handler && this.handler.is3d)
    },

    /**
     * 装载一份场景。
     * @param {object} scene 已规范化的场景。
     * @returns {void}
     */
    load: function (scene) {
      this.scene = scene && typeof scene === 'object' ? scene : null
      this.handler = this.scene ? NS.kinds[this.scene.kind] || null : null
      this.index = -1
      this.playing = false
      this.t = 0
      this.pan = { x: 0, y: 0, zoom: 1 }
      this.cam = this.handler && this.handler.is3d
        ? Object.assign({}, this.handler.defaultCam)
        : { yaw: 0.6, pitch: 0.3, zoom: 1, dist: 9, perspective: true }
      if (this.scene && this.scene.view) {
        if (this.scene.view.yaw !== undefined) this.cam.yaw = NS.rad(this.scene.view.yaw)
        if (this.scene.view.pitch !== undefined) this.cam.pitch = NS.rad(this.scene.view.pitch)
        if (this.scene.view.zoom !== undefined) this.cam.zoom = this.scene.view.zoom
        if (this.scene.view.perspective === false) this.cam.perspective = false
      }
      // 是否存在需要连续动画的对象（力学轨迹）
      this.animated = false
      var objects = (this.scene && this.scene.objects) || []
      for (var i = 0; i < objects.length; i += 1) {
        if (objects[i].type === 'path' && objects[i].animate !== false) this.animated = true
      }
      this.renderChrome()
      this.layout()
      this.go(this.scene && this.scene.steps && this.scene.steps.length > 0 ? 0 : -1)
      if (this.animated) this.startRaf()
    },

    /** 渲染标题栏与步骤芯片等固定部分。 */
    renderChrome: function () {
      var self = this
      var scene = this.scene
      var steps = (scene && scene.steps) || []
      this.elTitle.textContent = scene ? scene.title || '' : ''
      this.elCap.textContent = scene ? scene.caption || '' : ''
      var kindLabel = {
        plot2d: '函数图像', geom3d: '立体几何', mech2d: '力学', circuit: '电路',
        chart2d: '过程曲线', molecule3d: '分子构型', lattice3d: '晶胞', globe3d: '地球光照',
        diagram2d: '示意图', html: '自定义',
      }
      this.elTag.textContent = scene ? (kindLabel[scene.kind] || scene.kind) : ''
      this.elTag.style.display = scene ? '' : 'none'

      this.elChips.innerHTML = ''
      for (var i = 0; i < steps.length; i += 1) {
        var chip = el('button', 'hst_chip' + (steps[i].key ? ' key' : ''))
        chip.type = 'button'
        chip.textContent = String(i + 1)
        chip.title = (steps[i].key ? '重点 · ' : '') + (steps[i].title || '')
        if (steps[i].key) {
          var star = el('span', '', '★')
          star.style.fontSize = '9px'
          chip.appendChild(star)
        }
        ;(function (idx, node) {
          node.addEventListener('click', function () { self.playing = false; self.stopTimer(); self.go(idx) })
        })(i, chip)
        this.elChips.appendChild(chip)
      }
      var hasSteps = steps.length > 0
      this.elBar.style.display = hasSteps ? '' : 'none'
      this.elStep.style.display = hasSteps ? '' : 'none'

      var is3d = this.is3d()
      this.elHint.textContent = scene && scene.kind !== 'html'
        ? (is3d ? '拖动旋转 · 滚轮缩放 · 双击复位' : '拖动平移 · 滚轮缩放')
        : ''
      this.elReset.style.display = scene && scene.kind !== 'html' ? '' : 'none'

      var isHtml = scene && scene.kind === 'html'
      this.elStage.style.display = isHtml ? 'none' : ''
      this.elHtml.style.display = isHtml ? '' : 'none'
      if (isHtml) injectHtml(this.elHtml, scene.html)
      if (scene && !this.handler && !isHtml) {
        this.elStage.style.display = 'none'
        this.elHtml.style.display = ''
        this.elHtml.innerHTML = ''
        this.elHtml.appendChild(el('div', 'hst_err', '不支持的场景类型：' + scene.kind))
      }
    },

    /** 按容器宽度决定画布尺寸。 */
    layout: function () {
      var width = Math.max(160, this.elStage.clientWidth || this.root.clientWidth || 320)
      var ratio = this.mode === 'panel' ? 0.78 : 0.62
      var min = this.mode === 'panel' ? 240 : 190
      var max = this.mode === 'panel' ? 520 : 360
      var height = NS.clamp(Math.round(width * ratio), min, max)
      this.painter.resize(width, height)
    },

    /**
     * 计算第 index 步的有效场景（累积施加 0..index 步）。
     * @param {number} index 步序号（-1 表示初始态）。
     * @returns {{objects: object[], focus: object, view: object}} 有效场景。
     */
    derive: function (index) {
      var scene = this.scene
      var base = (scene && scene.objects) || []
      var steps = (scene && scene.steps) || []
      var hidden = {}
      var patch = {}
      var view = Object.assign({}, (scene && scene.view) || {})
      var focus = new Set()
      for (var i = 0; i < base.length; i += 1) {
        if (base[i].hidden) hidden[base[i].id] = true
      }
      for (var s = 0; s <= index && s < steps.length; s += 1) {
        var step = steps[s]
        if (step.hide) for (var h = 0; h < step.hide.length; h += 1) hidden[step.hide[h]] = true
        if (step.show) for (var w = 0; w < step.show.length; w += 1) delete hidden[step.show[w]]
        if (step.set) {
          for (var id in step.set) {
            if (!Object.prototype.hasOwnProperty.call(step.set, id)) continue
            patch[id] = Object.assign({}, patch[id] || {}, step.set[id])
          }
        }
        if (step.view) view = Object.assign(view, step.view)
        // focus 只取当前步：让「这一步在看哪里」一目了然
        if (s === index && step.focus) {
          for (var f = 0; f < step.focus.length; f += 1) focus.add(step.focus[f])
        }
      }
      var objects = []
      for (var k = 0; k < base.length; k += 1) {
        var obj = base[k]
        var merged = patch[obj.id] ? Object.assign({}, obj, patch[obj.id]) : Object.assign({}, obj)
        // 显隐一律由 hidden 表说话（而不是只在表里时才加 hidden）：
        // 否则 show 无法翻转对象自带的 hidden:true。
        merged.hidden = hidden[obj.id] === true
        objects.push(merged)
      }
      return { objects: objects, focus: focus, view: view }
    },

    /**
     * 跳到某一步。
     * @param {number} index 步序号。
     * @returns {void}
     */
    go: function (index) {
      var steps = (this.scene && this.scene.steps) || []
      var next = NS.clamp(index, steps.length > 0 ? 0 : -1, steps.length - 1)
      if (steps.length === 0) next = -1
      this.index = next
      var step = next >= 0 ? steps[next] : null

      var chips = this.elChips.children
      for (var i = 0; i < chips.length; i += 1) {
        if (i === next) chips[i].classList.add('on')
        else chips[i].classList.remove('on')
      }
      this.btnPrev.disabled = next <= 0
      this.btnNext.disabled = next < 0 || next >= steps.length - 1
      this.elPos.textContent = steps.length > 0 ? (next + 1) + '/' + steps.length : ''

      this.elStepTitle.innerHTML = ''
      if (step) {
        if (step.key) this.elStepTitle.appendChild(el('span', 'hst_star', '重点'))
        this.elStepTitle.appendChild(el('span', '', step.title || ''))
        this.elStep.className = 'hst_step' + (step.key ? ' key' : '')
        this.elDetail.textContent = step.detail || ''
        this.elDetail.style.display = step.detail ? '' : 'none'
        this.elFormula.textContent = step.formula ? NS.sup(step.formula) : ''
        this.elFormula.style.display = step.formula ? '' : 'none'
        // 步骤可以带 at：把动画进度定到指定时刻
        if (step.at !== undefined) this.t = NS.clamp(step.at, 0, 1)
      }
      this.render()
      this.post(MSG.step, {
        index: next,
        total: steps.length,
        title: step ? step.title : '',
        key: Boolean(step && step.key),
      })
    },

    /** 播放/暂停自动步进。 */
    toggle: function () {
      var steps = (this.scene && this.scene.steps) || []
      if (steps.length === 0) return
      this.playing = !this.playing
      this.btnPlay.textContent = this.playing ? '❚❚' : '▶'
      var self = this
      this.stopTimer()
      if (this.playing) {
        if (this.index >= steps.length - 1) this.go(0)
        this.timer = setInterval(function () {
          if (self.index >= steps.length - 1) {
            self.playing = false
            self.btnPlay.textContent = '▶'
            self.stopTimer()
            return
          }
          self.go(self.index + 1)
        }, 2800)
      }
    },

    /** 停掉自动步进定时器。 */
    stopTimer: function () {
      if (this.timer) { clearInterval(this.timer); this.timer = 0 }
    },

    /** 连续动画循环（力学轨迹上的跟随点）。 */
    startRaf: function () {
      var self = this
      if (this.raf) return
      var tick = function () {
        self.t += 0.006
        if (self.t > 1) self.t = 0
        self.render()
        self.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
    },

    /** 复位视角。 */
    resetView: function () {
      this.pan = { x: 0, y: 0, zoom: 1 }
      this.cam = this.handler && this.handler.is3d
        ? Object.assign({}, this.handler.defaultCam)
        : { yaw: 0.6, pitch: 0.3, zoom: 1, dist: 9, perspective: true }
      if (this.scene && this.scene.view) {
        if (this.scene.view.yaw !== undefined) this.cam.yaw = NS.rad(this.scene.view.yaw)
        if (this.scene.view.pitch !== undefined) this.cam.pitch = NS.rad(this.scene.view.pitch)
        if (this.scene.view.zoom !== undefined) this.cam.zoom = this.scene.view.zoom
      }
      this.render()
    },

    /** 重绘画布。 */
    render: function () {
      if (!this.scene || !this.handler) { this.reportHeight(); return }
      var eff = this.derive(this.index)
      var p = this.painter
      p.clear()
      var view = eff.view
      if (this.handler.is3d) {
        var R = NS.R3
        p.setView({ xMin: -R, xMax: R, yMin: -R, yMax: R, equal: true })
      } else {
        var xMin = view.xMin !== undefined ? view.xMin : -5
        var xMax = view.xMax !== undefined ? view.xMax : 5
        var yMin = view.yMin !== undefined ? view.yMin : -4
        var yMax = view.yMax !== undefined ? view.yMax : 4
        // 平移与缩放：围绕中心缩放，再叠加平移
        var cx = (xMin + xMax) / 2 + this.pan.x
        var cy = (yMin + yMax) / 2 + this.pan.y
        var hw = ((xMax - xMin) / 2) * this.pan.zoom
        var hh = ((yMax - yMin) / 2) * this.pan.zoom
        p.setView({
          xMin: cx - hw, xMax: cx + hw, yMin: cy - hh, yMax: cy + hh,
          equal: view.equal === true,
        })
      }
      var state = {
        focus: eff.focus,
        cam: this.cam,
        view: view,
        t: this.animated ? this.t : undefined,
        index: this.index,
      }
      try {
        this.handler.draw(p, { kind: this.scene.kind, objects: eff.objects, view: view }, state)
      } catch (err) {
        p.text((p.view.xMin + p.view.xMax) / 2, (p.view.yMin + p.view.yMax) / 2,
          '绘制失败：' + (err && err.message ? err.message : err), { color: NS.palette().bad, size: 12 })
      }
      this.reportHeight()
    },

    /**
     * 发消息给父窗口。
     * @param {string} type 消息类型。
     * @param {object} payload 载荷。
     * @returns {void}
     */
    post: function (type, payload) {
      try {
        parent.postMessage(Object.assign({ type: type, token: this.token }, payload || {}), '*')
      } catch (err) { /* 父窗口不可达时忽略 */ }
    },

    /** 上报内容高度（父窗口据此调整 iframe 高度）。 */
    reportHeight: function () {
      var self = this
      if (this._heightTimer) return
      this._heightTimer = setTimeout(function () {
        self._heightTimer = 0
        var h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0)
        if (Math.abs(h - self.lastHeight) < 2) return
        self.lastHeight = h
        self.post(MSG.height, { height: h })
      }, 30)
    },
  }

  /**
   * 把主题变量写到 :root 上（父窗口把宿主的设计令牌桥接进来）。
   *
   * 过滤原则：宿主令牌里大量是 rgba()/color-mix() 这类**带括号的合法颜色**，
   * 所以不能简单地见括号就拒；真正要挡的是能扩大攻击面的构造——
   * url()（外部请求）、var()（跨帧引用解析不到、纯噪音）、以及能提前闭合
   * 声明块的 ; { }。
   * @param {object} theme 变量表（不带 --hst- 前缀）。
   * @returns {void}
   */
  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return
    var root = document.documentElement
    for (var key in theme) {
      if (!Object.prototype.hasOwnProperty.call(theme, key)) continue
      var value = String(theme[key] == null ? '' : theme[key]).trim()
      if (value === '' || value.length > 96) continue
      if (/[;{}\\]/.test(value)) continue
      if (/url\s*\(|var\s*\(|expression|@import|javascript:/i.test(value)) continue
      // 颜色/长度字面量允许的字符集：# 十六进制、函数式颜色、百分比、空格与逗号
      if (!/^[#0-9a-zA-Z.,%()\s/+-]+$/.test(value)) continue
      root.style.setProperty('--hst-' + key.replace(/[^a-zA-Z0-9_-]/g, ''), value)
    }
    if (theme.scheme === 'dark' || theme.scheme === 'light') root.style.colorScheme = theme.scheme
    NS.palette(true)
  }

  /**
   * 挂载演示器：注入样式、建 DOM、开始监听父窗口消息。
   * @param {object} [opts] 选项：token、mode、scene（可直接给初始场景）。
   * @returns {object} Player 实例。
   */
  function mount(opts) {
    var o = opts || {}
    var style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    var root = document.getElementById('hst-root') || document.body
    var player = new Player(root, o)
    NS.player = player

    window.addEventListener('message', function (ev) {
      var data = ev && ev.data
      if (!data || typeof data !== 'object') return
      if (data.type === MSG.scene) {
        // 文档本身是完全静态的（可被所有 iframe 复用），token 由父窗口随场景下发，
        // 此后所有回传消息都带上它，父窗口据此区分同页面里的多个演示。
        if (typeof data.token === 'string' && data.token !== '') player.token = data.token
        if (data.theme) applyTheme(data.theme)
        if (data.mode) { player.mode = data.mode }
        player.load(data.scene)
      } else if (data.type === MSG.step && typeof data.index === 'number') {
        if (player.token && data.token && data.token !== player.token) return
        player.playing = false
        player.stopTimer()
        player.btnPlay.textContent = '▶'
        player.go(data.index)
      }
    })

    if (o.theme) applyTheme(o.theme)
    if (o.scene) player.load(o.scene)
    player.post(MSG.ready, {})
    return player
  }

  NS.CSS = CSS
  NS.MSG = MSG
  NS.Player = Player
  NS.mount = mount
  NS.applyTheme = applyTheme
  NS.injectHtml = injectHtml
})(typeof globalThis !== 'undefined'
  ? (globalThis.__HST__ = globalThis.__HST__ || {})
  : (this.__HST__ = this.__HST__ || {}));
