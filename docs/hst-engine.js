/* ── 00-core.browser.js ── */
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 帧内引擎「基础层」。
 *
 * 本文件是**浏览器脚本**（不是 ESM 模块）：host 侧 lib/frame/index.js 会把
 * frame/ 下的 *.browser.js 按文件名顺序读出来拼成一整段脚本，内联进演示 iframe
 * 的 srcdoc。因此这里不能用 import/export，一切都挂在命名空间 __HST__ 上。
 *
 * 这样安排的理由：
 *   · 零构建——改完文件刷新页面即生效，不需要打包器；
 *   · 可测试——本文件不碰 DOM，node 侧可以 new Function 加载后直接单测
 *     表达式求值、投影矩阵、VSEPR 摆位这些纯逻辑（见 scripts/frame-smoke.mjs）；
 *   · 帧内无网络——iframe 的 CSP 只允许 blob:/data: 连接，所以引擎必须自带
 *     全部能力，不能依赖 CDN 上的 three.js/mathjax。
 *
 * 本层提供四件事：
 *   NS.expr     安全表达式求值（递归下降解析，不用 eval）
 *   NS.palette  主题色板（读父窗口注入的 --hst-* 变量）
 *   NS.Painter  2D 画笔（世界坐标 → 设备像素，箭头/虚线/文字/裁剪）
 *   NS.v3       三维向量、旋转、投影与深度排序
 */

(function (NS) {
  'use strict'

  // ══ 表达式求值 ═══════════════════════════════════════════════════════════
  // 支持：+ - * / % ^、一元负号、括号、|x| 绝对值、隐式乘法（2x、3(x+1)、2sin x）
  // 函数：sin cos tan asin acos atan sinh cosh tanh ln lg log log2 exp sqrt cbrt
  //       abs sign floor ceil round min max pow atan2 hypot
  // 常量：pi π e；变量：由调用方传入（通常是 x 或 t）
  // 域外取值返回 NaN（如 sqrt(-1)），绘图层遇到 NaN 会断线，这是正确行为。

  /** 单参函数表。 */
  var FN1 = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    ln: Math.log, lg: function (v) { return Math.log10(v) }, log10: function (v) { return Math.log10(v) },
    log2: Math.log2, exp: Math.exp, sqrt: Math.sqrt, cbrt: Math.cbrt,
    abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
    round: Math.round, trunc: Math.trunc,
  }

  /** 多参函数表。 */
  var FN2 = {
    min: Math.min, max: Math.max, pow: Math.pow,
    atan2: Math.atan2, hypot: Math.hypot,
    log: function (a, b) { return b === undefined ? Math.log(a) : Math.log(a) / Math.log(b) },
  }

  /** 常量表。 */
  var CONST = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2 }

  /**
   * 把表达式切成 token。
   * @param {string} src 表达式源码。
   * @returns {object[]} token 列表。
   */
  function tokenize(src) {
    var out = []
    var i = 0
    var s = String(src == null ? '' : src)
    while (i < s.length) {
      var ch = s[i]
      if (ch === ' ' || ch === '\t' || ch === '\n') { i += 1; continue }
      if (ch >= '0' && ch <= '9' || ch === '.') {
        var start = i
        while (i < s.length && (s[i] >= '0' && s[i] <= '9' || s[i] === '.')) i += 1
        // 科学计数法 1e-3
        if (s[i] === 'e' || s[i] === 'E') {
          var save = i
          i += 1
          if (s[i] === '+' || s[i] === '-') i += 1
          if (s[i] >= '0' && s[i] <= '9') { while (i < s.length && s[i] >= '0' && s[i] <= '9') i += 1 } else i = save
        }
        out.push({ t: 'num', v: parseFloat(s.slice(start, i)) })
        continue
      }
      if (/[A-Za-z_\u0370-\u03ff]/.test(ch)) {
        var st = i
        while (i < s.length && /[A-Za-z0-9_\u0370-\u03ff]/.test(s[i])) i += 1
        out.push({ t: 'name', v: s.slice(st, i) })
        continue
      }
      if ('+-*/%^(),|'.indexOf(ch) >= 0) { out.push({ t: ch }); i += 1; continue }
      if (ch === '×') { out.push({ t: '*' }); i += 1; continue }
      if (ch === '÷') { out.push({ t: '/' }); i += 1; continue }
      if (ch === '−') { out.push({ t: '-' }); i += 1; continue }
      throw new Error('表达式里有无法识别的字符：' + ch)
    }
    return out
  }

  /**
   * 编译表达式为求值函数。
   * @param {string} src 表达式（如 'x^2-2*x+1'、'2sin(x)+1'）。
   * @returns {(vars: object) => number} 求值函数；解析失败时返回恒 NaN 的函数。
   */
  function compile(src) {
    var toks
    try { toks = tokenize(src) } catch (err) { return function () { return NaN } }
    var pos = 0
    // 正在解析 |…| 内部的层数：此时右侧的 '|' 是结束符，不能被当成新原子的开头
    var barDepth = 0

    /** 当前 token。 */
    function peek() { return toks[pos] }
    /** 吃掉一个 token。 */
    function eat(t) {
      var tok = toks[pos]
      if (!tok || (t && tok.t !== t)) throw new Error('表达式语法错误')
      pos += 1
      return tok
    }

    /** 是否可以在此处开始一个原子（用于判断隐式乘法）。 */
    function atomStarts() {
      var tok = peek()
      if (!tok) return false
      if (tok.t === '|') return barDepth === 0
      return tok.t === 'num' || tok.t === 'name' || tok.t === '('
    }

    /** expr := term (('+'|'-') term)* */
    function parseExpr() {
      var node = parseTerm()
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = eat().t
        var rhs = parseTerm()
        node = { op: op, a: node, b: rhs }
      }
      return node
    }

    /** term := unary (('*'|'/'|'%'|隐式) unary)* */
    function parseTerm() {
      var node = parseUnary()
      for (;;) {
        var tok = peek()
        if (tok && (tok.t === '*' || tok.t === '/' || tok.t === '%')) {
          var op = eat().t
          node = { op: op, a: node, b: parseUnary() }
          continue
        }
        // 隐式乘法：2x、3(x+1)、2sin(x)、2|x|、x y 都按乘法处理。
        // 多字母标识符（xy）在分词阶段就是一个 token，不会被误拆成 x*y。
        if (atomStarts()) {
          node = { op: '*', a: node, b: parseUnary() }
          continue
        }
        break
      }
      return node
    }

    /** unary := ('-'|'+') unary | power */
    function parseUnary() {
      var tok = peek()
      if (tok && tok.t === '-') { eat(); return { op: 'neg', a: parseUnary() } }
      if (tok && tok.t === '+') { eat(); return parseUnary() }
      return parsePower()
    }

    /** power := atom ('^' unary)?  右结合 */
    function parsePower() {
      var base = parseAtom()
      if (peek() && peek().t === '^') {
        eat()
        return { op: '^', a: base, b: parseUnary() }
      }
      return base
    }

    /** atom := num | const | var | fn(args) | (expr) | |expr| */
    function parseAtom() {
      var tok = peek()
      if (!tok) throw new Error('表达式意外结束')
      if (tok.t === 'num') { eat(); return { op: 'num', v: tok.v } }
      if (tok.t === '(') {
        eat('(')
        var inner = parseExpr()
        eat(')')
        return inner
      }
      if (tok.t === '|') {
        eat('|')
        barDepth += 1
        var body = parseExpr()
        barDepth -= 1
        eat('|')
        return { op: 'fn1', fn: Math.abs, a: body }
      }
      if (tok.t === 'name') {
        eat()
        var name = tok.v
        var lower = name.toLowerCase()
        if (peek() && peek().t === '(') {
          eat('(')
          var args = []
          if (peek() && peek().t !== ')') {
            args.push(parseExpr())
            while (peek() && peek().t === ',') { eat(','); args.push(parseExpr()) }
          }
          eat(')')
          if (FN1[lower] && args.length === 1) return { op: 'fn1', fn: FN1[lower], a: args[0] }
          if (FN2[lower]) return { op: 'fnN', fn: FN2[lower], args: args }
          if (FN1[lower]) return { op: 'fn1', fn: FN1[lower], a: args[0] }
          throw new Error('未知函数 ' + name)
        }
        // 无括号函数调用：sin x
        if (FN1[lower] && atomStarts()) return { op: 'fn1', fn: FN1[lower], a: parseUnary() }
        if (CONST[lower] !== undefined) return { op: 'num', v: CONST[lower] }
        return { op: 'var', name: name }
      }
      throw new Error('表达式语法错误')
    }

    var ast
    try {
      ast = parseExpr()
      if (pos < toks.length) throw new Error('表达式有多余内容')
    } catch (err) {
      return function () { return NaN }
    }

    /**
     * 求值一棵 AST。
     * @param {object} node 节点。
     * @param {object} vars 变量表。
     * @returns {number} 值。
     */
    function evalNode(node, vars) {
      switch (node.op) {
        case 'num': return node.v
        case 'var': {
          var v = vars[node.name]
          if (v === undefined) v = vars[node.name.toLowerCase()]
          if (v === undefined) { var c = CONST[node.name.toLowerCase()]; if (c !== undefined) return c }
          return typeof v === 'number' ? v : NaN
        }
        case 'neg': return -evalNode(node.a, vars)
        case '+': return evalNode(node.a, vars) + evalNode(node.b, vars)
        case '-': return evalNode(node.a, vars) - evalNode(node.b, vars)
        case '*': return evalNode(node.a, vars) * evalNode(node.b, vars)
        case '/': return evalNode(node.a, vars) / evalNode(node.b, vars)
        case '%': return evalNode(node.a, vars) % evalNode(node.b, vars)
        case '^': return Math.pow(evalNode(node.a, vars), evalNode(node.b, vars))
        case 'fn1': return node.fn(evalNode(node.a, vars))
        case 'fnN': {
          var args = []
          for (var i = 0; i < node.args.length; i += 1) args.push(evalNode(node.args[i], vars))
          return node.fn.apply(null, args)
        }
        default: return NaN
      }
    }

    return function (vars) {
      try { return evalNode(ast, vars || {}) } catch (err) { return NaN }
    }
  }

  /**
   * 数值导数（中心差分）——切线、瞬时速度都用它，避免让模型自己求导。
   * @param {(vars: object) => number} f 函数。
   * @param {number} x 求导点。
   * @param {string} [name] 变量名。
   * @returns {number} 导数值。
   */
  function derivative(f, x, name) {
    var key = name || 'x'
    var h = Math.max(1e-6, Math.abs(x) * 1e-6)
    var a = {}
    var b = {}
    a[key] = x + h
    b[key] = x - h
    return (f(a) - f(b)) / (2 * h)
  }

  NS.expr = { compile: compile, derivative: derivative, tokenize: tokenize }

  // ══ 主题色板 ══════════════════════════════════════════════════════════════

  /** 兜底色板（父窗口没注入变量时用，亮色主题取值）。 */
  var FALLBACK = {
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
    math: '#2f6df6',
    physics: '#0f9d8f',
    chemistry: '#e08b1a',
    geography: '#6b8f2f',
    chinese: '#d4483b',
    english: '#8b5cf6',
  }

  /** 绘图用的循环配色（多条曲线时按顺序取）。 */
  var SERIES = ['#2f6df6', '#dc2626', '#16a34a', '#e08b1a', '#8b5cf6', '#0f9d8f', '#d4483b', '#6b8f2f']

  var paletteCache = null

  /**
   * 读取当前色板（父窗口把 --hst-* 注入到 :root）。
   * @param {boolean} [fresh] 是否强制重读。
   * @returns {object} 色板。
   */
  function palette(fresh) {
    if (paletteCache && !fresh) return paletteCache
    var out = {}
    var cs = null
    try { cs = getComputedStyle(document.documentElement) } catch (err) { cs = null }
    for (var key in FALLBACK) {
      if (!Object.prototype.hasOwnProperty.call(FALLBACK, key)) continue
      var v = cs ? cs.getPropertyValue('--hst-' + key).trim() : ''
      out[key] = v !== '' ? v : FALLBACK[key]
    }
    out.series = SERIES
    paletteCache = out
    return out
  }

  /**
   * 第 n 条曲线的颜色。
   * @param {number} i 序号。
   * @returns {string} 颜色。
   */
  function seriesColor(i) {
    return SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length]
  }

  NS.palette = palette
  NS.seriesColor = seriesColor

  // ══ 2D 画笔 ═══════════════════════════════════════════════════════════════

  /**
   * 世界坐标画笔：把 [xMin,xMax]×[yMin,yMax] 映射到画布，y 轴向上。
   * @param {HTMLCanvasElement} canvas 画布。
   * @constructor
   */
  function Painter(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.pad = { left: 34, right: 16, top: 14, bottom: 28 }
    this.view = { xMin: -5, xMax: 5, yMin: -4, yMax: 4, equal: false }
    this.dpr = 1
    this.w = 0
    this.h = 0
  }

  Painter.prototype = {
    /**
     * 按元素尺寸重设画布分辨率（含 devicePixelRatio）。
     * @param {number} cssW CSS 宽。
     * @param {number} cssH CSS 高。
     * @returns {void}
     */
    resize: function (cssW, cssH) {
      var dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
      this.dpr = dpr
      this.w = cssW
      this.h = cssH
      this.canvas.width = Math.max(1, Math.round(cssW * dpr))
      this.canvas.height = Math.max(1, Math.round(cssH * dpr))
      this.canvas.style.width = cssW + 'px'
      this.canvas.style.height = cssH + 'px'
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    },

    /**
     * 设置世界坐标范围；equal=true 时按最小缩放对齐两轴（圆才是圆）。
     * @param {object} view 视图。
     * @returns {void}
     */
    setView: function (view) {
      var v = {
        xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax,
        equal: view.equal === true,
      }
      var iw = this.w - this.pad.left - this.pad.right
      var ih = this.h - this.pad.top - this.pad.bottom
      if (v.equal && iw > 0 && ih > 0) {
        var sx = iw / (v.xMax - v.xMin)
        var sy = ih / (v.yMax - v.yMin)
        var s = Math.min(sx, sy)
        var cx = (v.xMin + v.xMax) / 2
        var cy = (v.yMin + v.yMax) / 2
        var halfW = iw / (2 * s)
        var halfH = ih / (2 * s)
        v.xMin = cx - halfW; v.xMax = cx + halfW
        v.yMin = cy - halfH; v.yMax = cy + halfH
      }
      this.view = v
    },

    /** 世界 x → 设备 x。 */
    X: function (x) {
      var v = this.view
      var iw = this.w - this.pad.left - this.pad.right
      return this.pad.left + ((x - v.xMin) / (v.xMax - v.xMin)) * iw
    },

    /** 世界 y → 设备 y（翻转）。 */
    Y: function (y) {
      var v = this.view
      var ih = this.h - this.pad.top - this.pad.bottom
      return this.pad.top + ih - ((y - v.yMin) / (v.yMax - v.yMin)) * ih
    },

    /** 设备 x → 世界 x。 */
    invX: function (px) {
      var v = this.view
      var iw = this.w - this.pad.left - this.pad.right
      return v.xMin + ((px - this.pad.left) / iw) * (v.xMax - v.xMin)
    },

    /** 设备 y → 世界 y。 */
    invY: function (py) {
      var v = this.view
      var ih = this.h - this.pad.top - this.pad.bottom
      return v.yMin + ((this.pad.top + ih - py) / ih) * (v.yMax - v.yMin)
    },

    /** 每世界单位对应多少像素（x 方向）。 */
    scaleX: function () { return (this.w - this.pad.left - this.pad.right) / (this.view.xMax - this.view.xMin) },

    /** 清空画布。 */
    clear: function () {
      this.ctx.clearRect(0, 0, this.w, this.h)
    },

    /**
     * 应用线条样式。
     * @param {object} [st] 样式：color/width/dash/opacity。
     * @returns {void}
     */
    style: function (st) {
      var s = st || {}
      var c = this.ctx
      c.strokeStyle = s.color || palette().fg
      c.fillStyle = s.fill || s.color || palette().fg
      c.lineWidth = s.width || 1.6
      c.globalAlpha = s.opacity === undefined ? 1 : s.opacity
      c.setLineDash(s.dash ? [5, 4] : [])
      c.lineJoin = 'round'
      c.lineCap = 'round'
    },

    /** 恢复默认合成状态。 */
    reset: function () {
      this.ctx.globalAlpha = 1
      this.ctx.setLineDash([])
    },

    /**
     * 画折线（世界坐标；NaN 断线）。
     * @param {number[][]} pts 点列。
     * @param {object} [st] 样式。
     * @returns {void}
     */
    path: function (pts, st) {
      this.style(st)
      var c = this.ctx
      c.beginPath()
      var pen = false
      for (var i = 0; i < pts.length; i += 1) {
        var p = pts[i]
        if (!p || !isFinite(p[0]) || !isFinite(p[1])) { pen = false; continue }
        var x = this.X(p[0])
        var y = this.Y(p[1])
        // 竖直渐近线附近的巨大跳变也断开，避免画出假的竖线
        if (!isFinite(x) || !isFinite(y) || Math.abs(y) > 1e5) { pen = false; continue }
        if (pen) c.lineTo(x, y)
        else { c.moveTo(x, y); pen = true }
      }
      c.stroke()
      this.reset()
    },

    /**
     * 填充多边形。
     * @param {number[][]} pts 点列。
     * @param {object} [st] 样式。
     * @returns {void}
     */
    fill: function (pts, st) {
      if (pts.length < 2) return
      this.style(st)
      var c = this.ctx
      c.beginPath()
      for (var i = 0; i < pts.length; i += 1) {
        var x = this.X(pts[i][0])
        var y = this.Y(pts[i][1])
        if (i === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      }
      c.closePath()
      c.fillStyle = (st && st.fill) || (st && st.color) || palette().brand
      c.globalAlpha = (st && st.opacity !== undefined) ? st.opacity : 0.18
      c.fill()
      if (st && st.stroke !== false) {
        c.globalAlpha = (st && st.opacity !== undefined) ? Math.min(1, st.opacity + 0.5) : 0.8
        c.stroke()
      }
      this.reset()
    },

    /**
     * 画点。
     * @param {number} x 世界 x。
     * @param {number} y 世界 y。
     * @param {object} [st] 样式（size 为半径像素）。
     * @returns {void}
     */
    dot: function (x, y, st) {
      var s = st || {}
      this.style(s)
      var c = this.ctx
      c.beginPath()
      c.arc(this.X(x), this.Y(y), s.size || 3.4, 0, Math.PI * 2)
      c.fillStyle = s.hollow ? (palette().bg || '#fff') : (s.color || palette().fg)
      c.fill()
      if (s.hollow) c.stroke()
      this.reset()
    },

    /**
     * 画圆（世界半径）。
     * @param {number} cx 圆心 x。
     * @param {number} cy 圆心 y。
     * @param {number} r 半径。
     * @param {object} [st] 样式。
     * @returns {void}
     */
    circle: function (cx, cy, r, st) {
      var pts = []
      for (var i = 0; i <= 96; i += 1) {
        var a = (i / 96) * Math.PI * 2
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      if (st && (st.fill || st.fillArea)) this.fill(pts, st)
      else this.path(pts, st)
    },

    /**
     * 画箭头（世界坐标起止点，箭头大小按像素）。
     * @param {number} x1 起点 x。
     * @param {number} y1 起点 y。
     * @param {number} x2 终点 x。
     * @param {number} y2 终点 y。
     * @param {object} [st] 样式（both=true 双向箭头）。
     * @returns {void}
     */
    arrow: function (x1, y1, x2, y2, st) {
      var s = st || {}
      this.style(s)
      var c = this.ctx
      var ax = this.X(x1)
      var ay = this.Y(y1)
      var bx = this.X(x2)
      var by = this.Y(y2)
      var head = s.head || 8
      var ang = Math.atan2(by - ay, bx - ax)
      var len = Math.hypot(bx - ax, by - ay)
      if (len < 0.5) { this.reset(); return }
      c.beginPath()
      c.moveTo(ax, ay)
      c.lineTo(bx, by)
      c.stroke()
      c.setLineDash([])
      /** 在 (px,py) 处朝 a 方向画一个实心箭头。 */
      var tip = function (px, py, a) {
        c.beginPath()
        c.moveTo(px, py)
        c.lineTo(px - head * Math.cos(a - 0.42), py - head * Math.sin(a - 0.42))
        c.lineTo(px - head * Math.cos(a + 0.42), py - head * Math.sin(a + 0.42))
        c.closePath()
        c.fillStyle = s.color || palette().fg
        c.fill()
      }
      if (s.arrow !== false) tip(bx, by, ang)
      if (s.both) tip(ax, ay, ang + Math.PI)
      this.reset()
    },

    /**
     * 写字（世界坐标定位，像素偏移微调）。
     * @param {number} x 世界 x。
     * @param {number} y 世界 y。
     * @param {string} text 文本（支持 \n 换行，_下标 ^上标 由调用方预处理）。
     * @param {object} [st] 样式：size/color/align/baseline/dx/dy/bold/bg。
     * @returns {void}
     */
    text: function (x, y, text, st) {
      var s = st || {}
      var c = this.ctx
      var size = s.size || 12
      c.font = (s.bold ? '600 ' : '') + size + 'px ' + (s.mono ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif')
      c.textAlign = s.align || 'center'
      c.textBaseline = s.baseline || 'middle'
      c.globalAlpha = s.opacity === undefined ? 1 : s.opacity
      var px = this.X(x) + (s.dx || 0)
      var py = this.Y(y) + (s.dy || 0)
      var lines = String(text).split('\n')
      for (var i = 0; i < lines.length; i += 1) {
        var ly = py + (i - (lines.length - 1) / 2) * (size * 1.3)
        if (s.bg) {
          var m = c.measureText(lines[i])
          var bw = m.width + 6
          var bh = size + 4
          var bx = c.textAlign === 'center' ? px - bw / 2 : c.textAlign === 'right' ? px - bw : px
          c.fillStyle = s.bg === true ? (palette().bg || '#fff') : s.bg
          c.globalAlpha = 0.82
          c.fillRect(bx, ly - bh / 2, bw, bh)
          c.globalAlpha = s.opacity === undefined ? 1 : s.opacity
        }
        c.fillStyle = s.color || palette().fg
        c.fillText(lines[i], px, ly)
      }
      this.reset()
    },

    /**
     * 画坐标轴与网格。
     * @param {object} [opts] grid/axis/xLabel/yLabel/ticks。
     * @returns {void}
     */
    axes: function (opts) {
      var o = opts || {}
      var p = palette()
      var v = this.view
      var c = this.ctx
      var stepX = niceStep(v.xMax - v.xMin)
      var stepY = niceStep(v.yMax - v.yMin)

      if (o.grid !== false) {
        this.style({ color: p.line, width: 1, opacity: 0.7 })
        c.beginPath()
        for (var gx = Math.ceil(v.xMin / stepX) * stepX; gx <= v.xMax; gx += stepX) {
          c.moveTo(this.X(gx), this.Y(v.yMin))
          c.lineTo(this.X(gx), this.Y(v.yMax))
        }
        for (var gy = Math.ceil(v.yMin / stepY) * stepY; gy <= v.yMax; gy += stepY) {
          c.moveTo(this.X(v.xMin), this.Y(gy))
          c.lineTo(this.X(v.xMax), this.Y(gy))
        }
        c.stroke()
        this.reset()
      }

      if (o.axis === false) return
      var y0 = Math.min(Math.max(0, v.yMin), v.yMax)
      var x0 = Math.min(Math.max(0, v.xMin), v.xMax)
      this.arrow(v.xMin, y0, v.xMax, y0, { color: p.fg2, width: 1.3, head: 7 })
      this.arrow(x0, v.yMin, x0, v.yMax, { color: p.fg2, width: 1.3, head: 7 })
      this.text(v.xMax, y0, o.xLabel || 'x', { color: p.fg2, size: 12, dx: -4, dy: 14, align: 'right' })
      this.text(x0, v.yMax, o.yLabel || 'y', { color: p.fg2, size: 12, dx: 14, dy: 6, align: 'left' })

      if (o.ticks !== false) {
        for (var tx = Math.ceil(v.xMin / stepX) * stepX; tx <= v.xMax; tx += stepX) {
          if (Math.abs(tx) < stepX / 100) continue
          this.text(tx, y0, fmtNum(tx), { color: p.fg3, size: 10.5, dy: 11 })
        }
        for (var ty = Math.ceil(v.yMin / stepY) * stepY; ty <= v.yMax; ty += stepY) {
          if (Math.abs(ty) < stepY / 100) continue
          this.text(x0, ty, fmtNum(ty), { color: p.fg3, size: 10.5, dx: -8, align: 'right' })
        }
        this.text(x0, y0, '0', { color: p.fg3, size: 10.5, dx: -8, dy: 10, align: 'right' })
      }
    },
  }

  /**
   * 取一个「好看」的刻度间距（1/2/5×10ⁿ）。
   * @param {number} span 跨度。
   * @returns {number} 间距。
   */
  function niceStep(span) {
    var raw = Math.abs(span) / 8 || 1
    var mag = Math.pow(10, Math.floor(Math.log10(raw)))
    var norm = raw / mag
    var mult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
    return mult * mag
  }

  /**
   * 数字短格式（去掉浮点毛刺）。
   * @param {number} n 数值。
   * @returns {string} 文本。
   */
  function fmtNum(n) {
    if (!isFinite(n)) return ''
    var r = Math.round(n * 1e6) / 1e6
    if (Math.abs(r) >= 1e5 || (Math.abs(r) < 1e-3 && r !== 0)) return r.toExponential(1)
    return String(r)
  }

  NS.Painter = Painter
  NS.niceStep = niceStep
  NS.fmtNum = fmtNum

  // ══ 三维：向量、旋转、投影 ════════════════════════════════════════════════

  /**
   * 三维工具集。绕 Y 轴 yaw、绕 X 轴 pitch，右手系，z 朝观察者。
   */
  var v3 = {
    /** 向量相加。 */
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] },
    /** 向量相减。 */
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] },
    /** 数乘。 */
    mul: function (a, k) { return [a[0] * k, a[1] * k, a[2] * k] },
    /** 点积。 */
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] },
    /** 叉积。 */
    cross: function (a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    },
    /** 模长。 */
    len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) },
    /** 单位化（零向量返回自身）。 */
    norm: function (a) {
      var l = v3.len(a)
      return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
    },
    /** 线性插值。 */
    lerp: function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] },
    /** 质心。 */
    centroid: function (pts) {
      var s = [0, 0, 0]
      for (var i = 0; i < pts.length; i += 1) s = v3.add(s, pts[i])
      return pts.length > 0 ? v3.mul(s, 1 / pts.length) : s
    },

    /**
     * 按相机角度旋转一个点。
     * @param {number[]} p 点。
     * @param {object} cam { yaw, pitch }（弧度）。
     * @returns {number[]} 旋转后的点（相机坐标系）。
     */
    rotate: function (p, cam) {
      var cy = Math.cos(cam.yaw)
      var sy = Math.sin(cam.yaw)
      var cp = Math.cos(cam.pitch)
      var sp = Math.sin(cam.pitch)
      // 先绕 y（yaw），再绕 x（pitch）
      var x1 = p[0] * cy + p[2] * sy
      var z1 = -p[0] * sy + p[2] * cy
      var y2 = p[1] * cp - z1 * sp
      var z2 = p[1] * sp + z1 * cp
      return [x1, y2, z2]
    },

    /**
     * 投影到平面坐标（供 Painter 当作世界坐标画）。
     * @param {number[]} p 点。
     * @param {object} cam { yaw, pitch, zoom, perspective, dist }。
     * @returns {{x: number, y: number, depth: number}} 屏幕点与深度（深度越大越近）。
     */
    project: function (p, cam) {
      var r = v3.rotate(p, cam)
      var zoom = cam.zoom || 1
      if (cam.perspective === false) {
        return { x: r[0] * zoom, y: r[1] * zoom, depth: r[2] }
      }
      var dist = cam.dist || 9
      var k = dist / Math.max(0.35, dist - r[2])
      return { x: r[0] * k * zoom, y: r[1] * k * zoom, depth: r[2] }
    },
  }

  NS.v3 = v3

  /**
   * 深度排序绘制队列：先收集所有面/线/点，按深度从远到近画（画家算法）。
   * @constructor
   */
  function Depth() {
    this.items = []
  }

  Depth.prototype = {
    /**
     * 入队一个绘制项。
     * @param {number} depth 深度（越大越靠前/越近）。
     * @param {Function} draw 绘制回调。
     * @param {number} [bias] 同深度时的优先级微调（大者后画）。
     * @returns {void}
     */
    push: function (depth, draw, bias) {
      this.items.push({ d: isFinite(depth) ? depth : -1e9, b: bias || 0, draw: draw })
    },

    /**
     * 按深度排序后依次绘制。
     * @returns {void}
     */
    flush: function () {
      this.items.sort(function (a, b) { return (a.d - b.d) || (a.b - b.b) })
      for (var i = 0; i < this.items.length; i += 1) this.items[i].draw()
      this.items.length = 0
    },
  }

  NS.Depth = Depth

  // ══ 杂项 ══════════════════════════════════════════════════════════════════

  /**
   * 把 x^2、v_0 这类写法转成 Unicode 上下标，便于 canvas 里直接画。
   * @param {string} text 原文。
   * @returns {string} 转换后的文本。
   */
  function sup(text) {
    var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ' }
    var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', n: 'ₙ', x: 'ₓ', a: 'ₐ' }
    return String(text == null ? '' : text)
      .replace(/\^\{([^}]*)\}|\^(\w)/g, function (m, g1, g2) {
        var body = g1 !== undefined ? g1 : g2
        var out = ''
        for (var i = 0; i < body.length; i += 1) out += SUP[body[i]] || body[i]
        return out
      })
      .replace(/_\{([^}]*)\}|_(\w)/g, function (m, g1, g2) {
        var body = g1 !== undefined ? g1 : g2
        var out = ''
        for (var i = 0; i < body.length; i += 1) out += SUB[body[i]] || body[i]
        return out
      })
  }

  /**
   * 角度转弧度。
   * @param {number} deg 角度。
   * @returns {number} 弧度。
   */
  function rad(deg) { return (deg || 0) * Math.PI / 180 }

  /**
   * 数值夹取。
   * @param {number} v 值。
   * @param {number} lo 下界。
   * @param {number} hi 上界。
   * @returns {number} 结果。
   */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  NS.sup = sup
  NS.rad = rad
  NS.clamp = clamp
})(typeof globalThis !== 'undefined'
  ? (globalThis.__HST__ = globalThis.__HST__ || {})
  : (this.__HST__ = this.__HST__ || {}));

;

/* ── 10-scene2d.browser.js ── */
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 帧内引擎「2D 场景层」。
 *
 * 五种平面场景，共用一套 Painter 世界坐标：
 *   plot2d     数学：函数图像、切线、面积、圆锥曲线、向量、角标注
 *   chart2d    化/地/物：平衡移动、滴定曲线、能量图、气温降水、任意统计曲线
 *   mech2d     物理力学：受力分析、斜面、弹簧滑轮、抛体/圆周轨迹、电磁场
 *   circuit    物理电路：电源电阻电表开关滑动变阻器，电流流向
 *   diagram2d  六科通用：方框箭头流程、锋面剖面、分区示意
 *
 * 每种场景导出 { is3d, view(scene), draw(painter, scene, state) }，由 shell 层
 * 统一负责画布、缩放平移、步骤状态与高亮集合（state.focus）。
 *
 * 高亮实现：canvas 的 shadowBlur——被 focus 的对象自带一圈光晕，无需为每个
 * 图元单独写高亮分支。
 */

(function (NS) {
  'use strict'

  var v3 = NS.v3
  var sup = NS.sup
  var rad = NS.rad

  /** 高亮光晕颜色。 */
  function focusColor() { return NS.palette().brand }

  /**
   * 在可能带高亮光晕的上下文里绘制。
   * @param {object} p Painter。
   * @param {boolean} focused 是否高亮。
   * @param {Function} fn 绘制回调。
   * @returns {void}
   */
  function withFocus(p, focused, fn) {
    if (focused) {
      p.ctx.shadowColor = focusColor()
      p.ctx.shadowBlur = 14
    }
    fn()
    p.ctx.shadowBlur = 0
  }

  /**
   * 合并对象自身样式与默认样式，并按高亮状态加粗。
   * @param {object} obj 对象。
   * @param {object} st 状态。
   * @param {object} [def] 默认样式。
   * @returns {object} 样式。
   */
  function styleOf(obj, st, def) {
    var d = def || {}
    var focused = st.focus && st.focus.has(obj.id)
    return {
      color: obj.color || d.color || NS.palette().fg,
      fill: obj.fill || d.fill,
      width: (obj.width || d.width || 1.8) * (focused ? 1.7 : 1),
      dash: obj.dash !== undefined ? obj.dash : d.dash,
      opacity: obj.opacity !== undefined ? obj.opacity : d.opacity,
      size: obj.size || d.size,
      hollow: obj.hollow,
    }
  }

  /**
   * 按表达式采样出折线点列。
   * @param {string} expr 表达式（含变量 x）。
   * @param {number} from 起点。
   * @param {number} to 终点。
   * @param {number} samples 采样数。
   * @param {string} [varName] 变量名。
   * @returns {number[][]} 点列。
   */
  function sample(expr, from, to, samples, varName) {
    var f = NS.expr.compile(expr)
    var n = Math.max(8, Math.min(2000, samples || 420))
    var key = varName || 'x'
    var pts = []
    var vars = {}
    for (var i = 0; i <= n; i += 1) {
      var x = from + ((to - from) * i) / n
      vars[key] = x
      pts.push([x, f(vars)])
    }
    return pts
  }

  /**
   * 文本按像素宽度折行。
   * @param {object} ctx canvas 上下文。
   * @param {string} text 文本。
   * @param {number} maxPx 最大宽度。
   * @param {number} size 字号。
   * @returns {string[]} 行数组。
   */
  function wrap(ctx, text, maxPx, size) {
    ctx.font = size + 'px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
    var raw = String(text == null ? '' : text).split('\n')
    var out = []
    for (var r = 0; r < raw.length; r += 1) {
      var line = ''
      var chars = raw[r].split('')
      for (var i = 0; i < chars.length; i += 1) {
        var next = line + chars[i]
        if (ctx.measureText(next).width > maxPx && line !== '') {
          out.push(line)
          line = chars[i]
        } else line = next
      }
      out.push(line)
    }
    return out
  }

  NS.draw2d = { withFocus: withFocus, styleOf: styleOf, sample: sample, wrap: wrap }

  // ══ plot2d ═══════════════════════════════════════════════════════════════

  /** plot2d 的对象绘制表。 */
  var PLOT = {
    /** y = f(x) 曲线。 */
    func: function (p, o, st) {
      var v = p.view
      var from = o.from !== undefined ? o.from : v.xMin
      var to = o.to !== undefined ? o.to : v.xMax
      p.path(sample(o.expr, from, to, o.samples), styleOf(o, st, { color: NS.seriesColor(o._i || 0), width: 2.1 }))
      if (o.label) {
        var f = NS.expr.compile(o.expr)
        var lx = o.labelAt !== undefined ? o.labelAt : from + (to - from) * 0.78
        p.text(lx, f({ x: lx }), sup(o.label), { color: o.color || NS.seriesColor(o._i || 0), size: 12.5, dy: -12, bg: true })
      }
    },

    /** 参数曲线 (x(t), y(t))。 */
    param: function (p, o, st) {
      var from = o.from !== undefined ? o.from : 0
      var to = o.to !== undefined ? o.to : Math.PI * 2
      var fx = NS.expr.compile(o.exprX || o.expr || 'cos(t)')
      var fy = NS.expr.compile(o.exprY || 'sin(t)')
      var n = Math.max(16, Math.min(2000, o.samples || 480))
      var pts = []
      for (var i = 0; i <= n; i += 1) {
        var t = from + ((to - from) * i) / n
        pts.push([fx({ t: t, x: t }), fy({ t: t, x: t })])
      }
      p.path(pts, styleOf(o, st, { color: NS.seriesColor(o._i || 0), width: 2.1 }))
    },

    /** 点（可带标签）。 */
    point: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().bad, size: 3.8 })
      p.dot(o.x, o.y, s)
      if (o.label) p.text(o.x, o.y, sup(o.label), { color: s.color, size: 12.5, dx: 9, dy: -9, align: 'left', bg: true })
    },

    /** 直线：k/b、两点、或 ax+by+c=0。 */
    line: function (p, o, st) {
      var v = p.view
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.5, dash: true })
      var pts
      if (o.k !== undefined) {
        var b = o.b || 0
        pts = [[v.xMin, o.k * v.xMin + b], [v.xMax, o.k * v.xMax + b]]
      } else if (o.a !== undefined && o.b !== undefined) {
        // ax + by + c = 0
        var c = o.c || 0
        if (Math.abs(o.b) < 1e-9) {
          var xv = -c / o.a
          pts = [[xv, v.yMin], [xv, v.yMax]]
        } else {
          pts = [[v.xMin, (-c - o.a * v.xMin) / o.b], [v.xMax, (-c - o.a * v.xMax) / o.b]]
        }
      } else if (o.x1 !== undefined) {
        if (Math.abs(o.x2 - o.x1) < 1e-9) pts = [[o.x1, v.yMin], [o.x1, v.yMax]]
        else {
          var k = (o.y2 - o.y1) / (o.x2 - o.x1)
          pts = [[v.xMin, o.y1 + k * (v.xMin - o.x1)], [v.xMax, o.y1 + k * (v.xMax - o.x1)]]
        }
      } else return
      p.path(pts, s)
      if (o.label) p.text(pts[1][0], pts[1][1], sup(o.label), { color: s.color, size: 12, dx: -6, dy: -10, align: 'right', bg: true })
    },

    /** 线段。 */
    segment: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.8 })
      p.path([[o.x1, o.y1], [o.x2, o.y2]], s)
      if (o.label) p.text((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, sup(o.label), { color: s.color, size: 12, dy: -10, bg: true })
    },

    /** 向量箭头。 */
    vector: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().brand, width: 2 })
      var x1 = o.x1 !== undefined ? o.x1 : 0
      var y1 = o.y1 !== undefined ? o.y1 : 0
      p.arrow(x1, y1, o.x2, o.y2, s)
      if (o.label) p.text((x1 + o.x2) / 2, (y1 + o.y2) / 2, sup(o.label), { color: s.color, size: 12.5, dx: 8, dy: -8, align: 'left', bg: true })
    },

    /** 圆。 */
    circle: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().physics, width: 1.9 })
      if (o.fillArea) s.fill = s.fill || s.color
      p.circle(o.cx || 0, o.cy || 0, Math.abs(o.r || 1), s)
      if (o.label) p.text(o.cx || 0, (o.cy || 0) + Math.abs(o.r || 1), sup(o.label), { color: s.color, size: 12, dy: -10, bg: true })
    },

    /** 椭圆（轴对齐；a 为半长轴、b 为半短轴）。 */
    ellipse: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().physics, width: 1.9 })
      var cx = o.cx || 0
      var cy = o.cy || 0
      var a = Math.abs(o.a || 2)
      var b = Math.abs(o.b || 1)
      var pts = []
      for (var i = 0; i <= 128; i += 1) {
        var t = (i / 128) * Math.PI * 2
        pts.push([cx + a * Math.cos(t), cy + b * Math.sin(t)])
      }
      p.path(pts, s)
    },

    /** 多边形。 */
    polygon: function (p, o, st) {
      var pts = (o.points || []).slice()
      if (pts.length < 2) return
      var s = styleOf(o, st, { color: NS.palette().brand, width: 1.8 })
      if (o.fillArea || o.fill) p.fill(pts, s)
      else {
        if (o.close !== false) pts = pts.concat([pts[0]])
        p.path(pts, s)
      }
      if (o.label) {
        var cx = 0
        var cy = 0
        for (var i = 0; i < (o.points || []).length; i += 1) { cx += o.points[i][0]; cy += o.points[i][1] }
        p.text(cx / o.points.length, cy / o.points.length, sup(o.label), { color: s.color, size: 12, bg: true })
      }
    },

    /** 面积：曲线与 x 轴（或与另一条曲线）之间，定积分与「面积法」用。 */
    area: function (p, o, st) {
      var v = p.view
      var from = o.from !== undefined ? o.from : v.xMin
      var to = o.to !== undefined ? o.to : v.xMax
      var top = sample(o.expr || '0', from, to, o.samples || 200)
      var bottom = o.expr2 ? sample(o.expr2, from, to, o.samples || 200) : null
      var pts = top.slice()
      if (bottom) {
        for (var i = bottom.length - 1; i >= 0; i -= 1) pts.push(bottom[i])
      } else {
        pts.push([to, 0], [from, 0])
      }
      var s = styleOf(o, st, { color: NS.palette().brand, opacity: 0.2 })
      p.fill(pts.filter(function (q) { return isFinite(q[1]) }), { color: s.color, fill: s.fill || s.color, opacity: s.opacity === undefined ? 0.2 : s.opacity, stroke: false })
      if (o.label) p.text((from + to) / 2, (top[Math.floor(top.length / 2)] || [0, 0])[1] / 2, sup(o.label), { color: s.color, size: 12, bg: true })
    },

    /** 切线：对某条 func 在 x0 处作切线（数值求导，模型不用自己算）。 */
    tangent: function (p, o, st, scene) {
      var target = null
      for (var i = 0; i < scene.objects.length; i += 1) {
        if (scene.objects[i].id === o.of) { target = scene.objects[i]; break }
      }
      var expr = target && target.expr ? target.expr : o.expr
      if (!expr) return
      var f = NS.expr.compile(expr)
      var x0 = o.at !== undefined ? o.at : 1
      var y0 = f({ x: x0 })
      var k = NS.expr.derivative(f, x0)
      if (!isFinite(y0) || !isFinite(k)) return
      var s = styleOf(o, st, { color: NS.palette().bad, width: 1.7 })
      var half = o.extend === false ? (p.view.xMax - p.view.xMin) * 0.18 : (p.view.xMax - p.view.xMin)
      p.path([[x0 - half, y0 - k * half], [x0 + half, y0 + k * half]], s)
      p.dot(x0, y0, { color: s.color, size: 4 })
      var text = o.label !== undefined ? o.label : 'k=' + NS.fmtNum(Math.round(k * 1000) / 1000)
      if (text) p.text(x0, y0, sup(text), { color: s.color, size: 12, dx: 10, dy: 12, align: 'left', bg: true })
    },

    /** 文本标注。 */
    label: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2 })
      p.text(o.x || 0, o.y || 0, sup(o.text || o.label || ''), {
        color: s.color, size: o.size || 12.5, align: o.anchor || 'center', bg: o.fill ? o.fill : true, bold: o.bold,
      })
    },

    /** 角标注：在 at 处画从 from 到 to 的圆弧。 */
    angle: function (p, o, st) {
      var at = o.points && o.points[0] ? o.points[0] : [o.x || 0, o.y || 0]
      var from = o.points && o.points[1] ? o.points[1] : [at[0] + 1, at[1]]
      var to = o.points && o.points[2] ? o.points[2] : [at[0], at[1] + 1]
      var a1 = Math.atan2(from[1] - at[1], from[0] - at[0])
      var a2 = Math.atan2(to[1] - at[1], to[0] - at[0])
      var r = o.r || (p.view.xMax - p.view.xMin) * 0.06
      var s = styleOf(o, st, { color: NS.palette().warn, width: 1.5 })
      var pts = []
      var span = a2 - a1
      while (span > Math.PI) span -= Math.PI * 2
      while (span < -Math.PI) span += Math.PI * 2
      for (var i = 0; i <= 40; i += 1) {
        var a = a1 + (span * i) / 40
        pts.push([at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)])
      }
      p.path(pts, s)
      if (o.label) {
        var mid = a1 + span / 2
        p.text(at[0] + r * 1.5 * Math.cos(mid), at[1] + r * 1.5 * Math.sin(mid), sup(o.label), { color: s.color, size: 12, bg: true })
      }
    },

    /** 坐标轴上的刻度标注（如标出 x=2 这条位置）。 */
    mark: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg3, width: 1.2, dash: true })
      if (o.x !== undefined) {
        p.path([[o.x, 0], [o.x, o.y !== undefined ? o.y : 0]], s)
        p.text(o.x, 0, sup(o.text || String(o.x)), { color: s.color, size: 11, dy: 12, bg: true })
      } else if (o.y !== undefined) {
        p.path([[0, o.y], [o.x !== undefined ? o.x : 0, o.y]], s)
        p.text(0, o.y, sup(o.text || String(o.y)), { color: s.color, size: 11, dx: -8, align: 'right', bg: true })
      }
    },
  }

  // ══ chart2d ══════════════════════════════════════════════════════════════

  /** chart2d 的对象绘制表（复用 plot2d 的若干图元）。 */
  var CHART = {
    /** 数据系列：给 data 点列或 expr 表达式。 */
    series: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.seriesColor(o._i || 0), width: 2.2 })
      var pts = o.data && o.data.length > 0
        ? o.data
        : sample(o.expr || '0', o.from !== undefined ? o.from : p.view.xMin, o.to !== undefined ? o.to : p.view.xMax, o.samples)
      if (o.shape === 'step') {
        var stepped = []
        for (var i = 0; i < pts.length; i += 1) {
          if (i > 0) stepped.push([pts[i][0], pts[i - 1][1]])
          stepped.push(pts[i])
        }
        pts = stepped
      }
      p.path(pts, s)
      if (o.fillArea) {
        var poly = pts.concat([[pts[pts.length - 1][0], p.view.yMin], [pts[0][0], p.view.yMin]])
        p.fill(poly, { color: s.color, fill: s.color, opacity: 0.14, stroke: false })
      }
      if (o.shape === 'dots' || o.shape === 'line-dots') {
        for (var j = 0; j < pts.length; j += 1) p.dot(pts[j][0], pts[j][1], { color: s.color, size: 3 })
      }
      if (o.label) {
        var last = pts[pts.length - 1]
        p.text(last[0], last[1], sup(o.label), { color: s.color, size: 12, dx: -4, dy: -11, align: 'right', bg: true })
      }
    },

    /** 柱状（气温降水、人口结构）。 */
    bar: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.seriesColor(o._i || 0), opacity: 0.75 })
      var data = o.data || []
      var w = o.w !== undefined ? o.w : (data.length > 1 ? (data[1][0] - data[0][0]) * 0.62 : 0.6)
      for (var i = 0; i < data.length; i += 1) {
        var x = data[i][0]
        var y = data[i][1]
        var base = o.from !== undefined ? o.from : 0
        p.fill([[x - w / 2, base], [x + w / 2, base], [x + w / 2, y], [x - w / 2, y]],
          { color: s.color, fill: s.color, opacity: s.opacity, stroke: false })
      }
      if (o.label) p.text(data.length > 0 ? data[data.length - 1][0] : 0, o.y || 0, sup(o.label), { color: s.color, size: 12, bg: true })
    },

    /** 关键点标记（如平衡点、突跃点、拐点）。 */
    marker: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().bad, size: 4.2 })
      p.dot(o.x || 0, o.y || 0, s)
      if (o.label) p.text(o.x || 0, o.y || 0, sup(o.label), { color: s.color, size: 12, dx: 9, dy: -9, align: 'left', bg: true })
      if (o.dashed !== false) {
        p.path([[o.x, p.view.yMin], [o.x, o.y]], { color: s.color, width: 1, dash: true, opacity: 0.55 })
        p.path([[p.view.xMin, o.y], [o.x, o.y]], { color: s.color, width: 1, dash: true, opacity: 0.55 })
      }
    },

    /** 区间阴影（如缓冲区、适宜区间）。 */
    region: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().warn, opacity: 0.14 })
      var x1 = o.x1 !== undefined ? o.x1 : p.view.xMin
      var x2 = o.x2 !== undefined ? o.x2 : p.view.xMax
      var y1 = o.y1 !== undefined ? o.y1 : p.view.yMin
      var y2 = o.y2 !== undefined ? o.y2 : p.view.yMax
      p.fill([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], { color: s.color, fill: s.color, opacity: s.opacity, stroke: false })
      if (o.label) p.text((x1 + x2) / 2, (y1 + y2) / 2, sup(o.label), { color: s.color, size: 12, bg: true })
    },

    /** 水平参考线。 */
    hline: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg3, width: 1.2, dash: true })
      p.path([[p.view.xMin, o.y || 0], [p.view.xMax, o.y || 0]], s)
      if (o.label) p.text(p.view.xMax, o.y || 0, sup(o.label), { color: s.color, size: 11, dx: -4, dy: -8, align: 'right', bg: true })
    },

    /** 竖直参考线。 */
    vline: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg3, width: 1.2, dash: true })
      p.path([[o.x || 0, p.view.yMin], [o.x || 0, p.view.yMax]], s)
      if (o.label) p.text(o.x || 0, p.view.yMax, sup(o.label), { color: s.color, size: 11, dy: 10, bg: true })
    },

    label: PLOT.label,
    arrow: PLOT.vector,
  }

  // ══ mech2d ═══════════════════════════════════════════════════════════════

  /** 力学场景对象绘制表。世界坐标建议 0..100 × 0..60。 */
  var MECH = {
    /** 地面（带斜纹）。 */
    ground: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 2 })
      var y = o.y !== undefined ? o.y : 10
      var x1 = o.x1 !== undefined ? o.x1 : p.view.xMin
      var x2 = o.x2 !== undefined ? o.x2 : p.view.xMax
      p.path([[x1, y], [x2, y]], s)
      var span = x2 - x1
      var n = Math.max(6, Math.floor(span / 3))
      var h = (p.view.yMax - p.view.yMin) * 0.022
      for (var i = 0; i < n; i += 1) {
        var x = x1 + (span * i) / n
        p.path([[x, y], [x + span / n * 0.55, y - h * 2]], { color: s.color, width: 1, opacity: 0.6 })
      }
    },

    /** 斜面（直角三角形，可标角度）。 */
    incline: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.9 })
      var x = o.x !== undefined ? o.x : 20
      var y = o.y !== undefined ? o.y : 10
      var ang = rad(o.angle !== undefined ? o.angle : 30)
      var len = o.w !== undefined ? o.w : 40
      var dir = o.dir === 'left' ? -1 : 1
      var tipX = x + dir * len
      var tipY = y + len * Math.tan(ang)
      p.fill([[x, y], [tipX, y], [tipX, tipY]], { color: s.color, fill: s.color, opacity: 0.1, stroke: true, width: s.width })
      var lab = o.label !== undefined ? o.label : (o.angle !== undefined ? o.angle + '°' : '')
      if (lab) p.text(tipX - dir * len * 0.28, tipY - len * Math.tan(ang) * 0.72, sup(lab), { color: s.color, size: 12 })
    },

    /** 物块/小球（带质量标签）。 */
    body: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().physics, width: 1.8 })
      var x = o.x || 0
      var y = o.y || 0
      var w = o.w !== undefined ? o.w : 8
      var h = o.h !== undefined ? o.h : 6
      if (o.shape === 'circle' || o.shape === 'ball') {
        var r = o.r !== undefined ? o.r : Math.max(w, h) / 2
        p.circle(x, y, r, { color: s.color, fill: s.color, opacity: 0.22, width: s.width })
        p.circle(x, y, r, { color: s.color, width: s.width })
      } else {
        var rot = rad(o.rotate || 0)
        var pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(function (q) {
          return [x + q[0] * Math.cos(rot) - q[1] * Math.sin(rot), y + q[0] * Math.sin(rot) + q[1] * Math.cos(rot)]
        })
        p.fill(pts, { color: s.color, fill: s.color, opacity: 0.22, stroke: true, width: s.width })
      }
      var text = o.label !== undefined ? o.label : (o.mass !== undefined ? 'm=' + o.mass : '')
      if (text) p.text(x, y, sup(text), { color: NS.palette().fg, size: 12, bold: true })
    },

    /** 力箭头：以 (x,y) 为起点，按角度与大小画。 */
    force: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().bad, width: 2.2 })
      var x = o.x || 0
      var y = o.y || 0
      var ang = rad(o.angle !== undefined ? o.angle : 0)
      var mag = o.mag !== undefined ? o.mag : (o.value !== undefined ? o.value : 10)
      var scale = o.scale !== undefined ? o.scale : 1
      var len = mag * scale
      var x2 = x + len * Math.cos(ang)
      var y2 = y + len * Math.sin(ang)
      p.arrow(x, y, x2, y2, s)
      if (o.label) {
        p.text(x2, y2, sup(o.label), {
          color: s.color, size: 12.5, bold: true, bg: true,
          dx: 11 * Math.cos(ang), dy: -11 * Math.sin(ang),
        })
      }
    },

    /** 速度箭头（默认蓝色，与力区分）。 */
    velocity: function (p, o, st) {
      return MECH.force(p, Object.assign({}, o, { color: o.color || NS.palette().brand }), st)
    },

    /** 加速度箭头（默认橙色虚线）。 */
    accel: function (p, o, st) {
      return MECH.force(p, Object.assign({}, o, { color: o.color || NS.palette().warn, dash: o.dash !== undefined ? o.dash : true }), st)
    },

    /** 弹簧（锯齿线）。 */
    spring: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.6 })
      var x1 = o.x1 || 0
      var y1 = o.y1 || 0
      var x2 = o.x2 !== undefined ? o.x2 : x1 + 14
      var y2 = o.y2 !== undefined ? o.y2 : y1
      var coils = o.n !== undefined ? o.n : 8
      var dx = x2 - x1
      var dy = y2 - y1
      var len = Math.hypot(dx, dy) || 1
      var nx = -dy / len
      var ny = dx / len
      var amp = o.h !== undefined ? o.h : (p.view.yMax - p.view.yMin) * 0.035
      var pts = [[x1, y1]]
      var total = coils * 2
      for (var i = 1; i < total; i += 1) {
        var t = i / total
        var sign = i % 2 === 0 ? 1 : -1
        pts.push([x1 + dx * t + nx * amp * sign, y1 + dy * t + ny * amp * sign])
      }
      pts.push([x2, y2])
      p.path(pts, s)
      if (o.label) p.text((x1 + x2) / 2, (y1 + y2) / 2, sup(o.label), { color: s.color, size: 11.5, dy: -amp * 12, bg: true })
    },

    /** 绳/杆。 */
    rope: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.5 })
      p.path([[o.x1 || 0, o.y1 || 0], [o.x2 || 0, o.y2 || 0]], s)
      if (o.label) p.text(((o.x1 || 0) + (o.x2 || 0)) / 2, ((o.y1 || 0) + (o.y2 || 0)) / 2, sup(o.label), { color: s.color, size: 11.5, dx: 8, align: 'left', bg: true })
    },

    /** 滑轮。 */
    pulley: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.8 })
      var r = o.r !== undefined ? o.r : 4
      p.circle(o.x || 0, o.y || 0, r, { color: s.color, width: s.width })
      p.dot(o.x || 0, o.y || 0, { color: s.color, size: 2 })
      if (o.label) p.text(o.x || 0, (o.y || 0) + r, sup(o.label), { color: s.color, size: 11.5, dy: -10, bg: true })
    },

    /** 轨迹（点列，或抛体/圆周预设）。 */
    path: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().brand, width: 1.5, dash: o.dash !== undefined ? o.dash : true })
      var pts = o.points && o.points.length > 1 ? o.points : null
      if (!pts && o.preset === 'projectile') {
        // 平抛/斜抛：v0、angle、g、from
        var v0 = o.value !== undefined ? o.value : 10
        var ang = rad(o.angle !== undefined ? o.angle : 0)
        var g = o.a !== undefined ? o.a : 10
        var x0 = o.x || 0
        var y0 = o.y || 0
        var tMax = o.to !== undefined ? o.to : 3
        pts = []
        for (var i = 0; i <= 120; i += 1) {
          var t = (tMax * i) / 120
          var yy = y0 + v0 * Math.sin(ang) * t - 0.5 * g * t * t
          pts.push([x0 + v0 * Math.cos(ang) * t, yy])
          if (yy < p.view.yMin) break
        }
      }
      if (!pts && o.preset === 'circle') {
        pts = []
        var cx = o.x || 0
        var cy = o.y || 0
        var rr = o.r !== undefined ? o.r : 10
        for (var j = 0; j <= 96; j += 1) {
          var a = (j / 96) * Math.PI * 2
          pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
        }
      }
      if (!pts) return
      p.path(pts, s)
      // 动画：沿轨迹放一个跟随点，t 由 shell 的播放进度给出
      if (st.t !== undefined && o.animate !== false) {
        var idx = Math.max(0, Math.min(pts.length - 1, Math.round(st.t * (pts.length - 1))))
        p.dot(pts[idx][0], pts[idx][1], { color: o.color || NS.palette().brand, size: 5 })
      }
      if (o.label) p.text(pts[Math.floor(pts.length / 2)][0], pts[Math.floor(pts.length / 2)][1], sup(o.label), { color: s.color, size: 11.5, dy: -10, bg: true })
    },

    /** 匀强场：区域里铺满 × 或 · 或箭头。 */
    field: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().physics, width: 1.2, opacity: 0.75 })
      var x1 = o.x1 !== undefined ? o.x1 : p.view.xMin + 2
      var y1 = o.y1 !== undefined ? o.y1 : p.view.yMin + 2
      var x2 = o.x2 !== undefined ? o.x2 : p.view.xMax - 2
      var y2 = o.y2 !== undefined ? o.y2 : p.view.yMax - 2
      var step = o.d !== undefined ? o.d : 8
      var sym = o.kind || o.shape || 'into'
      for (var x = x1; x <= x2 + 1e-6; x += step) {
        for (var y = y1; y <= y2 + 1e-6; y += step) {
          if (sym === 'into') {
            var r = step * 0.12
            p.path([[x - r, y - r], [x + r, y + r]], s)
            p.path([[x - r, y + r], [x + r, y - r]], s)
          } else if (sym === 'out') {
            p.dot(x, y, { color: s.color, size: 2.2, opacity: s.opacity })
            p.circle(x, y, step * 0.13, { color: s.color, width: 1, opacity: s.opacity })
          } else {
            var ang = rad(o.angle !== undefined ? o.angle : 90)
            p.arrow(x, y - step * 0.3, x + step * 0.5 * Math.cos(ang), y - step * 0.3 + step * 0.5 * Math.sin(ang), { color: s.color, width: 1.1, head: 5, opacity: s.opacity })
          }
        }
      }
      if (o.label) p.text((x1 + x2) / 2, y2, sup(o.label), { color: s.color, size: 12, dy: -10, bg: true })
    },

    /** 电荷（带正负号）。 */
    charge: function (p, o, st) {
      var pos = (o.value === undefined ? 1 : o.value) >= 0
      var s = styleOf(o, st, { color: pos ? NS.palette().bad : NS.palette().brand, width: 1.6 })
      var r = o.r !== undefined ? o.r : 2.6
      p.circle(o.x || 0, o.y || 0, r, { color: s.color, fill: s.color, opacity: 0.2, width: s.width })
      p.text(o.x || 0, o.y || 0, pos ? '+' : '−', { color: s.color, size: 14, bold: true })
      if (o.label) p.text(o.x || 0, (o.y || 0) - r, sup(o.label), { color: s.color, size: 11.5, dy: 12, bg: true })
    },

    /** 尺寸标注线（双向箭头 + 文字）。 */
    dim: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg3, width: 1.2 })
      p.arrow(o.x1 || 0, o.y1 || 0, o.x2 || 0, o.y2 || 0, { color: s.color, width: s.width, both: true, head: 6 })
      if (o.label) p.text(((o.x1 || 0) + (o.x2 || 0)) / 2, ((o.y1 || 0) + (o.y2 || 0)) / 2, sup(o.label), { color: s.color, size: 11.5, dy: -9, bg: true })
    },

    label: PLOT.label,
    angle: PLOT.angle,
  }

  // ══ circuit ══════════════════════════════════════════════════════════════

  /**
   * 电路元件绘制：所有元件都在 (x,y) 处、按 orient（'h' 横 / 'v' 竖）绘制，
   * 长度固定 LEAD*2+BODY，两端自动画引线，便于用 wire 连成回路。
   */
  var CIR_LEAD = 3.5
  var CIR_BODY = 7

  /**
   * 计算元件两端点与方向。
   * @param {object} o 元件。
   * @returns {object} 几何信息。
   */
  function cirGeom(o) {
    var vertical = (o.orient || o.axis || 'h') === 'v'
    var x = o.x || 0
    var y = o.y || 0
    var half = CIR_LEAD + CIR_BODY / 2
    return {
      vertical: vertical,
      x: x,
      y: y,
      a: vertical ? [x, y - half] : [x - half, y],
      b: vertical ? [x, y + half] : [x + half, y],
      bodyA: vertical ? [x, y - CIR_BODY / 2] : [x - CIR_BODY / 2, y],
      bodyB: vertical ? [x, y + CIR_BODY / 2] : [x + CIR_BODY / 2, y],
    }
  }

  /**
   * 画引线（元件本体两侧）。
   * @param {object} p Painter。
   * @param {object} g 几何。
   * @param {object} s 样式。
   * @returns {void}
   */
  function cirLeads(p, g, s) {
    p.path([g.a, g.bodyA], s)
    p.path([g.bodyB, g.b], s)
  }

  /**
   * 元件标签（横放画在上方，竖放画在右侧）。
   * @param {object} p Painter。
   * @param {object} g 几何。
   * @param {string} text 文本。
   * @param {object} s 样式。
   * @returns {void}
   */
  function cirLabel(p, g, text, s) {
    if (!text) return
    if (g.vertical) p.text(g.x, g.y, sup(text), { color: s.color, size: 11.5, dx: 15, align: 'left', bg: true })
    else p.text(g.x, g.y, sup(text), { color: s.color, size: 11.5, dy: -14, bg: true })
  }

  /** 电路对象绘制表。 */
  var CIRCUIT = {
    /** 电源（长短线）。 */
    battery: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.7 })
      var g = cirGeom(o)
      cirLeads(p, g, s)
      var long = 3.4
      var short = 1.9
      if (g.vertical) {
        p.path([[g.x - long, g.y - 1.2], [g.x + long, g.y - 1.2]], s)
        p.path([[g.x - short, g.y + 1.2], [g.x + short, g.y + 1.2]], s)
      } else {
        p.path([[g.x - 1.2, g.y - long], [g.x - 1.2, g.y + long]], s)
        p.path([[g.x + 1.2, g.y - short], [g.x + 1.2, g.y + short]], s)
      }
      cirLabel(p, g, o.label !== undefined ? o.label : 'E', s)
    },

    /** 定值电阻（矩形）。 */
    resistor: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.6 })
      var g = cirGeom(o)
      cirLeads(p, g, s)
      var hw = g.vertical ? 2.6 : CIR_BODY / 2
      var hh = g.vertical ? CIR_BODY / 2 : 2.6
      p.fill([[g.x - hw, g.y - hh], [g.x + hw, g.y - hh], [g.x + hw, g.y + hh], [g.x - hw, g.y + hh]],
        { color: s.color, fill: NS.palette().bg, opacity: 1, stroke: true, width: s.width })
      cirLabel(p, g, o.label !== undefined ? o.label : 'R', s)
    },

    /** 滑动变阻器（矩形 + 斜箭头）。 */
    rheostat: function (p, o, st) {
      CIRCUIT.resistor(p, Object.assign({}, o, { label: '' }), st)
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.4 })
      var g = cirGeom(o)
      p.arrow(g.x - 3, g.y + 5.5, g.x + 3, g.y - 1.5, { color: s.color, width: s.width, head: 5 })
      cirLabel(p, g, o.label !== undefined ? o.label : 'R′', s)
    },

    /** 灯泡（圆 + 叉）。 */
    lamp: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().warn, width: 1.7 })
      var g = cirGeom(o)
      cirLeads(p, g, s)
      var r = CIR_BODY / 2
      p.circle(g.x, g.y, r, { color: s.color, width: s.width })
      var d = r * 0.7
      p.path([[g.x - d, g.y - d], [g.x + d, g.y + d]], { color: s.color, width: 1.2 })
      p.path([[g.x - d, g.y + d], [g.x + d, g.y - d]], { color: s.color, width: 1.2 })
      cirLabel(p, g, o.label !== undefined ? o.label : 'L', s)
    },

    /** 开关（断开时抬起一角）。 */
    switch: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.7 })
      var g = cirGeom(o)
      cirLeads(p, g, s)
      var closed = o.open !== true
      p.dot(g.bodyA[0], g.bodyA[1], { color: s.color, size: 1.9 })
      p.dot(g.bodyB[0], g.bodyB[1], { color: s.color, size: 1.9 })
      if (closed) p.path([g.bodyA, g.bodyB], s)
      else if (g.vertical) p.path([g.bodyA, [g.x + 4.2, g.y + CIR_BODY / 2 - 1]], s)
      else p.path([g.bodyA, [g.x + CIR_BODY / 2 - 1, g.y + 4.2]], s)
      cirLabel(p, g, o.label !== undefined ? o.label : 'S', s)
    },

    /** 电流表。 */
    ammeter: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().physics, width: 1.7 })
      var g = cirGeom(o)
      cirLeads(p, g, s)
      p.circle(g.x, g.y, CIR_BODY / 2, { color: s.color, width: s.width })
      p.text(g.x, g.y, 'A', { color: s.color, size: 11, bold: true })
      cirLabel(p, g, o.label || '', s)
    },

    /** 电压表。 */
    voltmeter: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().physics, width: 1.7 })
      var g = cirGeom(o)
      cirLeads(p, g, s)
      p.circle(g.x, g.y, CIR_BODY / 2, { color: s.color, width: s.width })
      p.text(g.x, g.y, 'V', { color: s.color, size: 11, bold: true })
      cirLabel(p, g, o.label || '', s)
    },

    /** 电容（两条平行板）。 */
    capacitor: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.8 })
      var g = cirGeom(o)
      var gap = 1.3
      if (g.vertical) {
        p.path([g.a, [g.x, g.y - gap]], s)
        p.path([[g.x, g.y + gap], g.b], s)
        p.path([[g.x - 3.4, g.y - gap], [g.x + 3.4, g.y - gap]], s)
        p.path([[g.x - 3.4, g.y + gap], [g.x + 3.4, g.y + gap]], s)
      } else {
        p.path([g.a, [g.x - gap, g.y]], s)
        p.path([[g.x + gap, g.y], g.b], s)
        p.path([[g.x - gap, g.y - 3.4], [g.x - gap, g.y + 3.4]], s)
        p.path([[g.x + gap, g.y - 3.4], [g.x + gap, g.y + 3.4]], s)
      }
      cirLabel(p, g, o.label !== undefined ? o.label : 'C', s)
    },

    /** 导线（折线，可带电流箭头）。 */
    wire: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.5 })
      var pts = o.points || []
      if (pts.length < 2) return
      p.path(pts, s)
      if (o.arrow) {
        var i = Math.max(1, Math.floor(pts.length / 2))
        var a = pts[i - 1]
        var b = pts[i]
        p.arrow(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { color: o.color || NS.palette().bad, width: s.width, head: 6 })
      }
      if (o.label) p.text(pts[0][0], pts[0][1], sup(o.label), { color: s.color, size: 11, dy: -9, bg: true })
    },

    /** 节点（导线交点实心圆）。 */
    junction: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, size: 2.4 })
      p.dot(o.x || 0, o.y || 0, s)
      if (o.label) p.text(o.x || 0, o.y || 0, sup(o.label), { color: s.color, size: 11, dx: 7, dy: -7, align: 'left', bg: true })
    },

    label: PLOT.label,
  }

  // ══ diagram2d ════════════════════════════════════════════════════════════

  /** 通用示意图对象绘制表（世界坐标建议 0..100 × 0..60）。 */
  var DIAGRAM = {
    /** 方框（矩形/圆角/椭圆/菱形，文字自动折行）。 */
    box: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().brand, width: 1.6 })
      var x = o.x || 0
      var y = o.y || 0
      var w = o.w !== undefined ? o.w : 20
      var h = o.h !== undefined ? o.h : 9
      var shape = o.shape || 'rect'
      var fill = o.fill || s.color
      if (shape === 'ellipse') {
        var pts = []
        for (var i = 0; i <= 64; i += 1) {
          var t = (i / 64) * Math.PI * 2
          pts.push([x + (w / 2) * Math.cos(t), y + (h / 2) * Math.sin(t)])
        }
        p.fill(pts, { color: s.color, fill: fill, opacity: 0.13, stroke: true, width: s.width })
      } else if (shape === 'diamond') {
        p.fill([[x, y - h / 2], [x + w / 2, y], [x, y + h / 2], [x - w / 2, y]],
          { color: s.color, fill: fill, opacity: 0.13, stroke: true, width: s.width })
      } else {
        p.fill([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]],
          { color: s.color, fill: fill, opacity: 0.13, stroke: true, width: s.width })
      }
      var text = o.text || o.label || ''
      if (text) {
        var size = o.size || 12
        var maxPx = Math.abs(p.X(x + w / 2) - p.X(x - w / 2)) - 10
        var lines = wrap(p.ctx, sup(text), Math.max(20, maxPx), size)
        p.text(x, y, lines.join('\n'), { color: NS.palette().fg, size: size, bold: o.bold !== false })
      }
    },

    /** 箭头：端点可以是坐标，也可以是方框 id（自动从边缘出发）。 */
    arrow: function (p, o, st, scene) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.7 })
      /** 解析端点：id → 方框中心与尺寸。 */
      var resolve = function (ref, fallback) {
        if (typeof ref === 'string' && ref !== '') {
          for (var i = 0; i < scene.objects.length; i += 1) {
            var t = scene.objects[i]
            if (t.id === ref) {
              return { x: t.x || 0, y: t.y || 0, w: t.w !== undefined ? t.w : 20, h: t.h !== undefined ? t.h : 9 }
            }
          }
        }
        return fallback
      }
      var A = resolve(o.of, { x: o.x1 !== undefined ? o.x1 : 0, y: o.y1 !== undefined ? o.y1 : 0, w: 0, h: 0 })
      var B = resolve(o.to !== undefined && typeof o.to === 'string' ? o.to : o.target,
        { x: o.x2 !== undefined ? o.x2 : 10, y: o.y2 !== undefined ? o.y2 : 0, w: 0, h: 0 })
      // 从 A 边缘到 B 边缘：按连线方向裁掉方框内部那一段
      var dx = B.x - A.x
      var dy = B.y - A.y
      var len = Math.hypot(dx, dy) || 1
      /** 沿方向裁剪到矩形边缘。 */
      var clip = function (box, sx, sy) {
        if (box.w === 0 && box.h === 0) return [box.x, box.y]
        var tx = Math.abs(sx) > 1e-6 ? (box.w / 2) / Math.abs(sx) : Infinity
        var ty = Math.abs(sy) > 1e-6 ? (box.h / 2) / Math.abs(sy) : Infinity
        var t = Math.min(tx, ty)
        return [box.x + sx * t, box.y + sy * t]
      }
      var a = clip(A, dx / len, dy / len)
      var b = clip(B, -dx / len, -dy / len)
      p.arrow(a[0], a[1], b[0], b[1], { color: s.color, width: s.width, dash: s.dash, both: o.both, head: 8 })
      if (o.text || o.label) {
        p.text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, sup(o.text || o.label), { color: s.color, size: 11.5, dy: -9, bg: true })
      }
    },

    /** 纯文字。 */
    text: PLOT.label,

    /** 半透明分区（带标题）。 */
    region: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().warn, opacity: 0.1 })
      var x = o.x || 0
      var y = o.y || 0
      var w = o.w !== undefined ? o.w : 30
      var h = o.h !== undefined ? o.h : 20
      p.fill([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]],
        { color: s.color, fill: o.fill || s.color, opacity: s.opacity, stroke: true, width: 1.2 })
      if (o.text || o.label) {
        p.text(x, y + h / 2, sup(o.text || o.label), { color: s.color, size: 12, dy: 11, bold: true })
      }
    },

    /** 直线/折线。 */
    line: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2, width: 1.5 })
      var pts = o.points && o.points.length > 1 ? o.points : [[o.x1 || 0, o.y1 || 0], [o.x2 || 0, o.y2 || 0]]
      p.path(pts, s)
      if (o.label) p.text(pts[0][0], pts[0][1], sup(o.label), { color: s.color, size: 11.5, dy: -9, bg: true })
    },

    /** 大括号（标注一段范围）。 */
    bracket: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg3, width: 1.4 })
      var x1 = o.x1 || 0
      var y1 = o.y1 || 0
      var x2 = o.x2 !== undefined ? o.x2 : x1 + 20
      var y2 = o.y2 !== undefined ? o.y2 : y1
      var tick = (p.view.yMax - p.view.yMin) * 0.03
      p.path([[x1, y1 + tick], [x1, y1], [x2, y2], [x2, y2 + tick]], s)
      if (o.label) p.text((x1 + x2) / 2, (y1 + y2) / 2, sup(o.label), { color: s.color, size: 11.5, dy: 12, bg: true })
    },

    /** 简单图标（用 Unicode 字符当图标，如 ☀ ☁ ↑）。 */
    icon: function (p, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2 })
      p.text(o.x || 0, o.y || 0, o.text || '●', { color: s.color, size: o.size || 20 })
      if (o.label) p.text(o.x || 0, o.y || 0, sup(o.label), { color: s.color, size: 11, dy: (o.size || 20) * 0.75 })
    },
  }

  // ══ 场景装配 ══════════════════════════════════════════════════════════════

  /**
   * 生成一个「按对象表绘制」的 2D 场景处理器。
   * @param {object} table 对象绘制表。
   * @param {object} [opts] 选项：axes（是否画坐标轴）。
   * @returns {object} 场景处理器。
   */
  function make2d(table, opts) {
    var o = opts || {}
    return {
      is3d: false,
      /**
       * 绘制整个场景。
       * @param {object} p Painter。
       * @param {object} scene 场景。
       * @param {object} state 状态：focus 集合、t 播放进度。
       * @returns {void}
       */
      draw: function (p, scene, state) {
        var view = scene.view || {}
        if (o.axes !== false) {
          p.axes({
            grid: view.grid !== false && o.grid !== false,
            axis: view.axis !== false,
            xLabel: view.xLabel,
            yLabel: view.yLabel,
            ticks: o.ticks !== false && view.axis !== false,
          })
        }
        var seriesIndex = 0
        for (var i = 0; i < scene.objects.length; i += 1) {
          var obj = scene.objects[i]
          if (obj.hidden) continue
          var fn = table[obj.type]
          if (!fn) continue
          if (obj.type === 'func' || obj.type === 'series' || obj.type === 'param' || obj.type === 'bar') {
            obj._i = seriesIndex
            seriesIndex += 1
          }
          var focused = state.focus && state.focus.has(obj.id)
          withFocus(p, focused, (function (f, ob) {
            return function () { f(p, ob, state, scene) }
          })(fn, obj))
        }
      },
    }
  }

  NS.kinds = NS.kinds || {}
  NS.kinds.plot2d = make2d(PLOT)
  NS.kinds.chart2d = make2d(CHART)
  NS.kinds.mech2d = make2d(MECH, { grid: false, ticks: false })
  NS.kinds.circuit = make2d(CIRCUIT, { axes: false })
  NS.kinds.diagram2d = make2d(DIAGRAM, { axes: false })
  NS.tables2d = { PLOT: PLOT, CHART: CHART, MECH: MECH, CIRCUIT: CIRCUIT, DIAGRAM: DIAGRAM }
})(typeof globalThis !== 'undefined'
  ? (globalThis.__HST__ = globalThis.__HST__ || {})
  : (this.__HST__ = this.__HST__ || {}));

;

/* ── 20-scene3d.browser.js ── */
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 帧内引擎「3D 场景层」。
 *
 * 四种三维场景，共用一台「画家算法」渲染器：把所有面/棱/点投影后按深度从远到
 * 近绘制，不用 WebGL——高中题目的图形量级下 canvas 2D 完全够用，而且没有着色器
 * 兼容性问题、iframe 里也不需要联网加载任何库。
 *
 *   geom3d      立体几何：棱柱棱锥圆锥球、空间向量、平面、**截面求交**、二面角
 *   molecule3d  分子构型：给中心原子与配体自动按 VSEPR 摆位，画键与孤对电子
 *   lattice3d   晶胞：NaCl/CsCl/金刚石/干冰/面心立方等预设，自动算每胞微粒数
 *   globe3d     地球光照：经纬网、晨昏线、昼夜半球着色、太阳直射点、正午太阳高度
 *
 * 交互（由 shell 层接管事件、这里只读 state.cam）：拖拽旋转、滚轮缩放、双击复位。
 */

(function (NS) {
  'use strict'

  var v3 = NS.v3
  var sup = NS.sup
  var rad = NS.rad
  var withFocus = NS.draw2d.withFocus
  var styleOf = NS.draw2d.styleOf

  /** 3D 场景的绘制半径：世界坐标固定 [-R, R]，由 setView(equal) 保证不变形。 */
  var R = 1.75

  /**
   * 生成投影函数。
   * @param {object} state 状态（含 cam）。
   * @returns {(p: number[]) => {x: number, y: number, depth: number}} 投影函数。
   */
  function projector(state) {
    var cam = state.cam
    return function (p) { return v3.project(p, cam) }
  }

  // ══ 几何体生成 ════════════════════════════════════════════════════════════

  /**
   * 按参数生成多面体/曲面体：返回顶点、面（顶点索引数组）、棱。
   * @param {object} o 对象参数。
   * @returns {{verts: number[][], faces: number[][], edges: number[][], smooth: boolean}} 几何。
   */
  function buildSolid(o) {
    var shape = o.shape || 'cube'
    var w = (o.w !== undefined ? o.w : 1) / 2
    var h = (o.h !== undefined ? o.h : (o.shape === 'cube' ? 1 : 1.2)) / 2
    var d = (o.d !== undefined ? o.d : 1) / 2
    var n = Math.max(3, Math.min(24, o.n !== undefined ? o.n : 4))
    var verts = []
    var faces = []
    var edges = []

    /** 添加一条棱（去重）。 */
    var edge = function (a, b) {
      for (var i = 0; i < edges.length; i += 1) {
        if ((edges[i][0] === a && edges[i][1] === b) || (edges[i][0] === b && edges[i][1] === a)) return
      }
      edges.push([a, b])
    }
    /** 按面补全棱。 */
    var edgesFromFaces = function () {
      for (var i = 0; i < faces.length; i += 1) {
        var f = faces[i]
        for (var j = 0; j < f.length; j += 1) edge(f[j], f[(j + 1) % f.length])
      }
    }

    if (shape === 'cube' || shape === 'cuboid' || shape === 'box') {
      if (shape === 'cube') { h = w; d = w }
      verts = [
        [-w, -h, d], [w, -h, d], [w, -h, -d], [-w, -h, -d],
        [-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d],
      ]
      faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
      edgesFromFaces()
    } else if (shape === 'prism' || shape === 'cylinder') {
      var m = shape === 'cylinder' ? 40 : n
      var bottom = []
      var top = []
      for (var i = 0; i < m; i += 1) {
        var a = (i / m) * Math.PI * 2 + (shape === 'prism' ? Math.PI / m : 0)
        var px = w * Math.cos(a)
        var pz = d * Math.sin(a)
        verts.push([px, -h, pz]); bottom.push(verts.length - 1)
        verts.push([px, h, pz]); top.push(verts.length - 1)
      }
      faces.push(bottom.slice().reverse())
      faces.push(top.slice())
      for (var k = 0; k < m; k += 1) {
        var k2 = (k + 1) % m
        faces.push([bottom[k], bottom[k2], top[k2], top[k]])
      }
      if (shape === 'prism') edgesFromFaces()
      else {
        for (var e = 0; e < m; e += 1) {
          edge(bottom[e], bottom[(e + 1) % m])
          edge(top[e], top[(e + 1) % m])
        }
        edge(bottom[0], top[0])
        edge(bottom[Math.floor(m / 2)], top[Math.floor(m / 2)])
      }
    } else if (shape === 'pyramid' || shape === 'cone') {
      var mm = shape === 'cone' ? 40 : n
      var base = []
      for (var i2 = 0; i2 < mm; i2 += 1) {
        var a2 = (i2 / mm) * Math.PI * 2 + (shape === 'pyramid' ? Math.PI / mm : 0)
        verts.push([w * Math.cos(a2), -h, d * Math.sin(a2)])
        base.push(verts.length - 1)
      }
      verts.push([0, h, 0])
      var apex = verts.length - 1
      faces.push(base.slice().reverse())
      for (var k2 = 0; k2 < mm; k2 += 1) faces.push([base[k2], base[(k2 + 1) % mm], apex])
      if (shape === 'pyramid') edgesFromFaces()
      else {
        for (var e2 = 0; e2 < mm; e2 += 1) edge(base[e2], base[(e2 + 1) % mm])
        edge(base[0], apex)
        edge(base[Math.floor(mm / 2)], apex)
      }
    } else if (shape === 'tetra' || shape === 'tetrahedron') {
      var s = w * 1.15
      verts = [[s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]]
      faces = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
      edgesFromFaces()
    } else if (shape === 'sphere') {
      var rr = o.r !== undefined ? o.r : Math.max(w, h)
      var lat = 12
      var lon = 20
      for (var i3 = 0; i3 <= lat; i3 += 1) {
        var phi = (i3 / lat) * Math.PI - Math.PI / 2
        for (var j3 = 0; j3 < lon; j3 += 1) {
          var th = (j3 / lon) * Math.PI * 2
          verts.push([rr * Math.cos(phi) * Math.cos(th), rr * Math.sin(phi), rr * Math.cos(phi) * Math.sin(th)])
        }
      }
      for (var i4 = 0; i4 < lat; i4 += 1) {
        for (var j4 = 0; j4 < lon; j4 += 1) {
          var a3 = i4 * lon + j4
          var b3 = i4 * lon + ((j4 + 1) % lon)
          var c3 = (i4 + 1) * lon + ((j4 + 1) % lon)
          var d3 = (i4 + 1) * lon + j4
          faces.push([a3, b3, c3, d3])
        }
      }
      return { verts: verts, faces: faces, edges: [], smooth: true }
    }
    return { verts: verts, faces: faces, edges: edges, smooth: false }
  }

  /**
   * 应用对象的整体位移与缩放。
   * @param {number[][]} verts 顶点。
   * @param {object} o 对象。
   * @returns {number[][]} 变换后的顶点。
   */
  function placeVerts(verts, o) {
    var sc = o.scale !== undefined ? o.scale : 1
    var ox = o.x || 0
    var oy = o.y || 0
    var oz = o.z || 0
    var out = []
    for (var i = 0; i < verts.length; i += 1) {
      out.push([verts[i][0] * sc + ox, verts[i][1] * sc + oy, verts[i][2] * sc + oz])
    }
    return out
  }

  /**
   * 平面与凸多面体求截面多边形。
   *
   * 做法：对每条棱求与平面的交点，收集所有交点后按「绕截面质心的极角」排序——
   * 凸体的截面一定是凸多边形，因此极角排序就是正确的顶点顺序。
   * @param {number[][]} verts 顶点。
   * @param {number[][]} edges 棱（顶点索引对）。
   * @param {number[]} normal 平面法向量。
   * @param {number[]} through 平面上一点。
   * @returns {number[][]} 截面多边形顶点（可能为空）。
   */
  function sectionPolygon(verts, edges, normal, through) {
    var nrm = v3.norm(normal)
    if (v3.len(nrm) < 1e-9) return []
    /** 点到平面的有符号距离。 */
    var sd = function (p) { return v3.dot(v3.sub(p, through), nrm) }
    var pts = []
    for (var i = 0; i < edges.length; i += 1) {
      var a = verts[edges[i][0]]
      var b = verts[edges[i][1]]
      var da = sd(a)
      var db = sd(b)
      if (Math.abs(da) < 1e-9) { pts.push(a.slice()); continue }
      if (Math.abs(db) < 1e-9) { pts.push(b.slice()); continue }
      if (da * db < 0) {
        var t = da / (da - db)
        pts.push(v3.lerp(a, b, t))
      }
    }
    if (pts.length < 3) return []
    // 去重（同一顶点可能被多条棱重复贡献）
    var uniq = []
    for (var j = 0; j < pts.length; j += 1) {
      var dup = false
      for (var k = 0; k < uniq.length; k += 1) {
        if (v3.len(v3.sub(pts[j], uniq[k])) < 1e-6) { dup = true; break }
      }
      if (!dup) uniq.push(pts[j])
    }
    if (uniq.length < 3) return []
    // 在平面内建立正交基，按极角排序
    var c = v3.centroid(uniq)
    var u = v3.norm(v3.sub(uniq[0], c))
    var w = v3.norm(v3.cross(nrm, u))
    uniq.sort(function (p, q) {
      var ap = Math.atan2(v3.dot(v3.sub(p, c), w), v3.dot(v3.sub(p, c), u))
      var aq = Math.atan2(v3.dot(v3.sub(q, c), w), v3.dot(v3.sub(q, c), u))
      return ap - aq
    })
    return uniq
  }

  NS.geom3 = { buildSolid: buildSolid, sectionPolygon: sectionPolygon, placeVerts: placeVerts }

  // ══ 3D 绘制基元 ═══════════════════════════════════════════════════════════

  /**
   * 画一条 3D 线段（投影后交给 2D 画笔）。
   * @param {object} p Painter。
   * @param {Function} pr 投影函数。
   * @param {number[]} a 起点。
   * @param {number[]} b 终点。
   * @param {object} st 样式。
   * @returns {void}
   */
  function line3(p, pr, a, b, st) {
    var pa = pr(a)
    var pb = pr(b)
    p.path([[pa.x, pa.y], [pb.x, pb.y]], st)
  }

  /**
   * 画一个 3D 箭头。
   * @param {object} p Painter。
   * @param {Function} pr 投影函数。
   * @param {number[]} a 起点。
   * @param {number[]} b 终点。
   * @param {object} st 样式。
   * @returns {void}
   */
  function arrow3(p, pr, a, b, st) {
    var pa = pr(a)
    var pb = pr(b)
    p.arrow(pa.x, pa.y, pb.x, pb.y, st)
  }

  /**
   * 画一个 3D 多边形面。
   * @param {object} p Painter。
   * @param {Function} pr 投影函数。
   * @param {number[][]} pts 顶点。
   * @param {object} st 样式。
   * @returns {void}
   */
  function face3(p, pr, pts, st) {
    var flat = []
    for (var i = 0; i < pts.length; i += 1) {
      var q = pr(pts[i])
      flat.push([q.x, q.y])
    }
    p.fill(flat, st)
  }

  /**
   * 3D 文字标注。
   * @param {object} p Painter。
   * @param {Function} pr 投影函数。
   * @param {number[]} at 位置。
   * @param {string} text 文本。
   * @param {object} st 样式。
   * @returns {void}
   */
  function text3(p, pr, at, text, st) {
    var q = pr(at)
    p.text(q.x, q.y, sup(text), st)
  }

  /**
   * 简单朗伯光照：法向量与固定光源方向的夹角决定明暗。
   * @param {number[]} normal 面法向量（世界坐标）。
   * @param {object} cam 相机。
   * @returns {number} 0.35~1 的亮度系数。
   */
  function shade(normal, cam) {
    var n = v3.rotate(v3.norm(normal), cam)
    var lightDir = v3.norm([0.35, 0.6, 0.72])
    return 0.42 + 0.58 * Math.abs(v3.dot(n, lightDir))
  }

  /**
   * 把颜色按亮度调暗（支持 #rgb/#rrggbb，其它格式原样返回）。
   * @param {string} color 颜色。
   * @param {number} k 亮度系数。
   * @returns {string} 结果颜色。
   */
  function tint(color, k) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || ''))
    if (!m) return color
    var hex = m[1]
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    var r = Math.round(Math.min(255, parseInt(hex.slice(0, 2), 16) * k))
    var g = Math.round(Math.min(255, parseInt(hex.slice(2, 4), 16) * k))
    var b = Math.round(Math.min(255, parseInt(hex.slice(4, 6), 16) * k))
    return 'rgb(' + r + ',' + g + ',' + b + ')'
  }

  NS.shade3 = { line3: line3, arrow3: arrow3, face3: face3, text3: text3, shade: shade, tint: tint }

  // ══ geom3d ═══════════════════════════════════════════════════════════════

  /** 立体几何对象绘制表：每个绘制器把绘制任务压入深度队列。 */
  var GEOM = {
    /** 几何体（面 + 棱 + 顶点标注）。 */
    solid: function (q, p, pr, o, st) {
      var g = buildSolid(o)
      var verts = placeVerts(g.verts, o)
      var s = styleOf(o, st, { color: NS.palette().math, width: 1.6 })
      var pal = NS.palette()
      var wire = o.wire === true || (st.view && st.view.wireframe === true)

      // 面：按质心深度入队，背面可选剔除
      if (!wire) {
        for (var i = 0; i < g.faces.length; i += 1) {
          var f = g.faces[i]
          var pts = []
          for (var j = 0; j < f.length; j += 1) pts.push(verts[f[j]])
          var c = v3.centroid(pts)
          var nrm = v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0]))
          var rc = v3.rotate(c, st.cam)
          var rn = v3.rotate(nrm, st.cam)
          var facing = rn[2] > 0
          if (o.hollow && !facing) continue
          var k = shade(nrm, st.cam)
          ;(function (pts2, depth, k2, facing2) {
            q.push(depth, function () {
              face3(p, pr, pts2, {
                color: tint(s.color, k2 * 0.9),
                fill: tint(s.color, k2),
                opacity: g.smooth ? 0.95 : (facing2 ? 0.5 : 0.34),
                stroke: !g.smooth,
                width: 0.8,
              })
            }, 0)
          })(pts, rc[2], k, facing)
        }
      }

      // 棱：始终画，被面挡住的部分靠深度排序自然处理
      for (var e = 0; e < g.edges.length; e += 1) {
        var a = verts[g.edges[e][0]]
        var b = verts[g.edges[e][1]]
        var mid = v3.rotate(v3.mul(v3.add(a, b), 0.5), st.cam)
        ;(function (a2, b2, depth) {
          q.push(depth, function () {
            line3(p, pr, a2, b2, { color: tint(s.color, 0.75), width: s.width, dash: s.dash })
          }, 1)
        })(a, b, mid[2])
      }

      // 顶点标注：vertices 给出顶点名（如 A B C D A₁ B₁ C₁ D₁），按顶点顺序对应
      if (o.vertices && o.vertices.length > 0) {
        for (var vi = 0; vi < Math.min(o.vertices.length, verts.length); vi += 1) {
          var name = o.vertices[vi]
          if (!name) continue
          var vp = verts[vi]
          var rv = v3.rotate(vp, st.cam)
          // 标签朝远离质心的方向偏一点，避免压在棱上
          var away = v3.norm(v3.sub(vp, [o.x || 0, o.y || 0, o.z || 0]))
          ;(function (vp2, away2, name2, depth) {
            q.push(depth, function () {
              var at = v3.add(vp2, v3.mul(away2, 0.13))
              text3(p, pr, at, name2, { color: pal.fg, size: 12.5, bold: true, bg: true })
              var d = pr(vp2)
              p.dot(d.x, d.y, { color: pal.fg, size: 2.4 })
            }, 3)
          })(vp, away, name, rv[2] + 0.02)
        }
      }
      if (o.label) {
        var top = [o.x || 0, (o.y || 0) + ((o.h !== undefined ? o.h : 1) / 2) * (o.scale || 1) + 0.22, o.z || 0]
        q.push(9e8, function () { text3(p, pr, top, o.label, { color: s.color, size: 12.5, bold: true, bg: true }) }, 4)
      }
    },

    /** 空间中的点。 */
    point3: function (q, p, pr, o, st) {
      var s = styleOf(o, st, { color: NS.palette().bad, size: 4 })
      var at = [o.x || 0, o.y || 0, o.z || 0]
      var r = v3.rotate(at, st.cam)
      q.push(r[2], function () {
        var d = pr(at)
        p.dot(d.x, d.y, s)
        if (o.label) p.text(d.x, d.y, sup(o.label), { color: s.color, size: 12.5, dx: 10, dy: -10, align: 'left', bg: true })
      }, 3)
    },

    /** 线段（可虚线，用于辅助线）。 */
    segment3: function (q, p, pr, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg, width: 1.7 })
      var a = o.points && o.points[0] ? o.points[0] : [o.x1 || 0, o.y1 || 0, o.z1 || 0]
      var b = o.points && o.points[1] ? o.points[1] : [o.x2 || 0, o.y2 || 0, o.z2 || 0]
      var mid = v3.rotate(v3.mul(v3.add(a, b), 0.5), st.cam)
      q.push(mid[2], function () {
        line3(p, pr, a, b, s)
        if (o.label) {
          var m = pr(v3.mul(v3.add(a, b), 0.5))
          p.text(m.x, m.y, sup(o.label), { color: s.color, size: 12, dy: -10, bg: true })
        }
      }, 2)
    },

    /** 任意 3D 多边形面（如作辅助平面截面）。 */
    face: function (q, p, pr, o, st) {
      var pts = o.points || []
      if (pts.length < 3) return
      var s = styleOf(o, st, { color: NS.palette().warn, opacity: 0.3 })
      var c = v3.rotate(v3.centroid(pts), st.cam)
      q.push(c[2], function () {
        face3(p, pr, pts, { color: s.color, fill: s.fill || s.color, opacity: s.opacity, stroke: true, width: 1.4 })
        if (o.label) text3(p, pr, v3.centroid(pts), o.label, { color: s.color, size: 12, bg: true })
      }, 2)
    },

    /** 空间向量。 */
    vector3: function (q, p, pr, o, st) {
      var s = styleOf(o, st, { color: NS.palette().brand, width: 2.1 })
      var a = o.points && o.points[0] ? o.points[0] : [o.x1 || 0, o.y1 || 0, o.z1 || 0]
      var b = o.points && o.points[1] ? o.points[1] : [o.x2 !== undefined ? o.x2 : o.x || 0, o.y2 !== undefined ? o.y2 : o.y || 0, o.z2 !== undefined ? o.z2 : o.z || 0]
      var mid = v3.rotate(v3.mul(v3.add(a, b), 0.5), st.cam)
      q.push(mid[2], function () {
        arrow3(p, pr, a, b, s)
        if (o.label) {
          var m = pr(v3.lerp(a, b, 0.62))
          p.text(m.x, m.y, sup(o.label), { color: s.color, size: 12.5, dx: 10, dy: -8, align: 'left', bg: true })
        }
      }, 3)
    },

    /** 平面（法向量 + 过点，画成一片半透明平行四边形）。 */
    plane: function (q, p, pr, o, st) {
      var nrm = v3.norm(o.normal || [0, 1, 0])
      var thr = o.through || [o.x || 0, o.y || 0, o.z || 0]
      var size = o.scale !== undefined ? o.scale : 1.1
      // 在平面内取两个正交方向
      var helper = Math.abs(nrm[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
      var u = v3.mul(v3.norm(v3.cross(nrm, helper)), size)
      var w = v3.mul(v3.norm(v3.cross(nrm, u)), size)
      var pts = [
        v3.add(v3.add(thr, u), w), v3.add(v3.sub(thr, u), w),
        v3.sub(v3.sub(thr, u), w), v3.sub(v3.add(thr, u), w),
      ]
      var s = styleOf(o, st, { color: NS.palette().geography, opacity: 0.22 })
      var c = v3.rotate(thr, st.cam)
      q.push(c[2] - 0.01, function () {
        face3(p, pr, pts, { color: s.color, fill: s.fill || s.color, opacity: s.opacity, stroke: true, width: 1.2 })
        if (o.label) text3(p, pr, pts[0], o.label, { color: s.color, size: 12, bg: true })
        if (o.arrow) arrow3(p, pr, thr, v3.add(thr, v3.mul(nrm, 0.5)), { color: s.color, width: 1.6 })
      }, 1)
    },

    /** 截面：平面切某个几何体，自动求出截面多边形（立体几何最常考的一步）。 */
    section: function (q, p, pr, o, st, scene) {
      var target = null
      for (var i = 0; i < scene.objects.length; i += 1) {
        if (scene.objects[i].id === o.of) { target = scene.objects[i]; break }
      }
      if (!target) return
      var g = buildSolid(target)
      var verts = placeVerts(g.verts, target)
      var nrm = o.normal || [0, 1, 0]
      var thr = o.through || [target.x || 0, target.y || 0, target.z || 0]
      var poly = sectionPolygon(verts, g.edges, nrm, thr)
      if (poly.length < 3) return
      var s = styleOf(o, st, { color: NS.palette().bad, opacity: 0.32 })
      var c = v3.rotate(v3.centroid(poly), st.cam)
      q.push(c[2] + 0.005, function () {
        face3(p, pr, poly, { color: s.color, fill: s.fill || s.color, opacity: s.opacity, stroke: true, width: 1.9 })
        if (o.label) text3(p, pr, v3.centroid(poly), o.label, { color: s.color, size: 12, bold: true, bg: true })
      }, 3)
    },

    /** 空间角标注（顶点 + 两条边，画一段圆弧）。 */
    angle3: function (q, p, pr, o, st) {
      var pts = o.points || []
      if (pts.length < 3) return
      var at = pts[0]
      var u = v3.norm(v3.sub(pts[1], at))
      var w = v3.norm(v3.sub(pts[2], at))
      var s = styleOf(o, st, { color: NS.palette().warn, width: 1.6 })
      var r = o.r !== undefined ? o.r : 0.22
      var arc = []
      var total = Math.acos(NS.clamp(v3.dot(u, w), -1, 1))
      var axis = v3.norm(v3.cross(u, w))
      for (var i = 0; i <= 24; i += 1) {
        var ang = (total * i) / 24
        // 绕 axis 把 u 旋转 ang（罗德里格斯公式）
        var cosA = Math.cos(ang)
        var sinA = Math.sin(ang)
        var rotated = v3.add(
          v3.add(v3.mul(u, cosA), v3.mul(v3.cross(axis, u), sinA)),
          v3.mul(axis, v3.dot(axis, u) * (1 - cosA)),
        )
        arc.push(v3.add(at, v3.mul(rotated, r)))
      }
      var c = v3.rotate(at, st.cam)
      q.push(c[2] + 0.02, function () {
        for (var i2 = 1; i2 < arc.length; i2 += 1) line3(p, pr, arc[i2 - 1], arc[i2], s)
        var text = o.label !== undefined ? o.label : Math.round((total * 180) / Math.PI) + '°'
        if (text) text3(p, pr, arc[Math.floor(arc.length / 2)], text, { color: s.color, size: 11.5, bg: true })
      }, 3)
    },

    /** 纯文字标注。 */
    label3: function (q, p, pr, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg2 })
      var at = [o.x || 0, o.y || 0, o.z || 0]
      var r = v3.rotate(at, st.cam)
      q.push(r[2] + 0.03, function () {
        text3(p, pr, at, o.text || o.label || '', { color: s.color, size: o.size || 12.5, bg: true, bold: o.bold })
      }, 4)
    },

    /** 线框球（外接球/内切球）。 */
    sphere3: function (q, p, pr, o, st) {
      var s = styleOf(o, st, { color: NS.palette().fg3, width: 1.2, opacity: 0.7 })
      var c = [o.cx || o.x || 0, o.cy || o.y || 0, o.cz || o.z || 0]
      var r = o.r !== undefined ? o.r : 1
      var rc = v3.rotate(c, st.cam)
      q.push(rc[2] - 0.02, function () {
        // 三个正交大圆足以表达球
        for (var axis = 0; axis < 3; axis += 1) {
          var pts = []
          for (var i = 0; i <= 72; i += 1) {
            var a = (i / 72) * Math.PI * 2
            var pt = axis === 0 ? [r * Math.cos(a), r * Math.sin(a), 0]
              : axis === 1 ? [r * Math.cos(a), 0, r * Math.sin(a)]
                : [0, r * Math.cos(a), r * Math.sin(a)]
            pts.push(v3.add(c, pt))
          }
          for (var j = 1; j < pts.length; j += 1) line3(p, pr, pts[j - 1], pts[j], s)
        }
        if (o.label) text3(p, pr, v3.add(c, [0, r, 0]), o.label, { color: s.color, size: 12, bg: true })
      }, 1)
    },
  }

  // ══ molecule3d ═══════════════════════════════════════════════════════════

  /** 元素颜色（近似 CPK 配色）。 */
  var ELEMENT_COLOR = {
    H: '#e8e8e8', C: '#404448', N: '#2f5fe0', O: '#dc2626', F: '#4fc36b', Cl: '#3fa34d',
    Br: '#a0522d', I: '#8b3fa8', S: '#e0b820', P: '#e8801a', B: '#f0a0a0', Si: '#c8a06a',
    Na: '#7b4fd8', K: '#6a3fc0', Mg: '#2fa05a', Ca: '#5aa070', Al: '#9aa0a8', Fe: '#c86a20',
    Cu: '#b06a30', Zn: '#7a8a9a', Ba: '#3fa070', Li: '#8b5cf6', He: '#7fd8d8', Ne: '#7fd8d8', Ar: '#7fd8d8',
  }

  /** 元素相对半径。 */
  var ELEMENT_R = {
    H: 0.30, C: 0.44, N: 0.42, O: 0.40, F: 0.38, Cl: 0.52, Br: 0.58, I: 0.64,
    S: 0.54, P: 0.53, B: 0.46, Si: 0.55, Na: 0.66, K: 0.74, Mg: 0.60, Ca: 0.70, Al: 0.58, Fe: 0.60,
  }

  /**
   * VSEPR 构型的键方向单位向量表。
   * @param {string} geometry 构型名。
   * @returns {number[][]} 方向向量列表。
   */
  function vseprDirs(geometry) {
    var g = String(geometry || '').toLowerCase()
    var t = 1 / Math.sqrt(3)
    if (g === 'linear' || g === '直线形' || g === '直线') return [[0, 1, 0], [0, -1, 0]]
    if (g === 'bent' || g === 'v' || g === 'v形' || g === 'v型' || g === '角形') {
      var half = rad(104.5 / 2)
      return [[Math.sin(half), Math.cos(half), 0], [-Math.sin(half), Math.cos(half), 0]]
    }
    if (g === 'trigonal-planar' || g === 'planar' || g === '平面三角形' || g === '平面三角') {
      return [[0, 1, 0], [Math.cos(rad(-30)), Math.sin(rad(-30)), 0], [Math.cos(rad(210)), Math.sin(rad(210)), 0]]
    }
    if (g === 'trigonal-pyramidal' || g === 'pyramidal' || g === '三角锥形' || g === '三角锥') {
      return [[t, -t, t], [t, -t, -t], [-t * 1.41, -t, 0]]
    }
    if (g === 'tetrahedral' || g === '正四面体' || g === '四面体') {
      return [[t, t, t], [t, -t, -t], [-t, t, -t], [-t, -t, t]]
    }
    if (g === 'trigonal-bipyramidal' || g === '三角双锥') {
      return [[0, 1, 0], [0, -1, 0], [1, 0, 0], [Math.cos(rad(120)), 0, Math.sin(rad(120))], [Math.cos(rad(240)), 0, Math.sin(rad(240))]]
    }
    if (g === 'octahedral' || g === '正八面体' || g === '八面体') {
      return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    }
    if (g === 'square-planar' || g === '平面四边形' || g === '平面正方形') {
      return [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
    }
    return [[0, 1, 0], [0, -1, 0]]
  }

  NS.vseprDirs = vseprDirs

  /**
   * 画一个原子球（带高光与元素符号）。
   * @param {object} p Painter。
   * @param {Function} pr 投影函数。
   * @param {number[]} at 位置。
   * @param {string} element 元素符号。
   * @param {object} opts 选项：r、label、focused。
   * @returns {void}
   */
  function atomBall(p, pr, at, element, opts) {
    var o = opts || {}
    var color = o.color || ELEMENT_COLOR[element] || NS.palette().fg3
    var d = pr(at)
    var rr = (o.r !== undefined ? o.r : (ELEMENT_R[element] || 0.45)) * (o.scale || 1)
    // 半径按投影后的透视缩放（近大远小）
    var px = Math.max(3, rr * p.scaleX() * (o.persp || 1))
    var ctx = p.ctx
    var cx = p.X(d.x)
    var cy = p.Y(d.y)
    var grad = ctx.createRadialGradient(cx - px * 0.32, cy - px * 0.34, px * 0.15, cx, cy, px)
    grad.addColorStop(0, tint(color, 1.5))
    grad.addColorStop(1, tint(color, 0.78))
    ctx.beginPath()
    ctx.arc(cx, cy, px, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = 0.9
    ctx.strokeStyle = tint(color, 0.55)
    ctx.stroke()
    var text = o.label !== undefined ? o.label : element
    if (text && px > 7) {
      p.text(d.x, d.y, sup(text), {
        color: isLight(color) ? '#1a1c20' : '#ffffff',
        size: Math.min(15, Math.max(9, px * 0.85)),
        bold: true,
      })
    }
  }

  /**
   * 判断颜色是否偏亮（决定字用黑还是白）。
   * @param {string} color 颜色。
   * @returns {boolean} 是否偏亮。
   */
  function isLight(color) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(color || ''))
    if (!m) return false
    var hex = m[1]
    var r = parseInt(hex.slice(0, 2), 16)
    var g = parseInt(hex.slice(2, 4), 16)
    var b = parseInt(hex.slice(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 165
  }

  /**
   * 画化学键（单/双/三键用平行线表示）。
   * @param {object} p Painter。
   * @param {Function} pr 投影函数。
   * @param {number[]} a 起点。
   * @param {number[]} b 终点。
   * @param {number} order 键级。
   * @param {object} st 样式。
   * @returns {void}
   */
  function bond3(p, pr, a, b, order, st) {
    var pa = pr(a)
    var pb = pr(b)
    var dx = pb.x - pa.x
    var dy = pb.y - pa.y
    var len = Math.hypot(dx, dy) || 1
    var nx = -dy / len
    var ny = dx / len
    var n = Math.max(1, Math.min(3, Math.round(order || 1)))
    var gap = (p.view.xMax - p.view.xMin) * 0.012
    for (var i = 0; i < n; i += 1) {
      var off = (i - (n - 1) / 2) * gap
      p.path([[pa.x + nx * off, pa.y + ny * off], [pb.x + nx * off, pb.y + ny * off]], st)
    }
  }

  /** 分子构型对象绘制表。 */
  var MOLECULE = {
    /** 一整个分子：给中心原子 + 配体 + 构型，自动摆位。 */
    molecule: function (q, p, pr, o, st) {
      var center = o.center || 'C'
      var ligands = o.ligands && o.ligands.length > 0 ? o.ligands : ['H', 'H', 'H', 'H']
      var dirs = vseprDirs(o.geometry)
      var bondLen = o.d !== undefined ? o.d : 1.05
      var origin = [o.x || 0, o.y || 0, o.z || 0]
      var pal = NS.palette()
      var rc = v3.rotate(origin, st.cam)
      // 中心原子
      q.push(rc[2], function () { atomBall(p, pr, origin, center, { scale: o.scale }) }, 2)
      for (var i = 0; i < ligands.length && i < dirs.length; i += 1) {
        var at = v3.add(origin, v3.mul(v3.norm(dirs[i]), bondLen))
        var ra = v3.rotate(at, st.cam)
        var order = o.n !== undefined ? o.n : 1
        ;(function (at2, el, depth, mid) {
          q.push(mid, function () {
            bond3(p, pr, origin, at2, order, { color: pal.fg3, width: 3.4, opacity: 0.85 })
          }, 1)
          q.push(depth, function () { atomBall(p, pr, at2, el, { scale: o.scale }) }, 2)
        })(at, ligands[i], ra[2], (rc[2] + ra[2]) / 2)
      }
      // 孤对电子（在剩余方向上画两个小点）
      var lone = o.value !== undefined ? Math.max(0, Math.round(o.value)) : 0
      for (var L = 0; L < lone && ligands.length + L < dirs.length; L += 1) {
        var ld = v3.mul(v3.norm(dirs[ligands.length + L]), bondLen * 0.55)
        var lp = v3.add(origin, ld)
        ;(function (lp2) {
          q.push(v3.rotate(lp2, st.cam)[2] + 0.01, function () {
            var d = pr(lp2)
            p.dot(d.x - 0.05, d.y, { color: pal.brand, size: 2.6 })
            p.dot(d.x + 0.05, d.y, { color: pal.brand, size: 2.6 })
          }, 3)
        })(lp)
      }
      if (o.label) {
        q.push(9e8, function () {
          text3(p, pr, v3.add(origin, [0, bondLen + 0.45, 0]), o.label, { color: pal.fg, size: 13, bold: true, bg: true })
        }, 4)
      }
    },

    /** 单个原子（手工摆位时用）。 */
    atom: function (q, p, pr, o, st) {
      var at = [o.x || 0, o.y || 0, o.z || 0]
      var r = v3.rotate(at, st.cam)
      q.push(r[2], function () {
        atomBall(p, pr, at, o.element || 'C', { r: o.r, label: o.label, color: o.color, scale: o.scale })
      }, 2)
    },

    /** 手工连键：bonds 里写 [原子id, 原子id, 键级]。 */
    bond: function (q, p, pr, o, st, scene) {
      var pal = NS.palette()
      /** 按 id 找原子坐标。 */
      var find = function (id) {
        for (var i = 0; i < scene.objects.length; i += 1) {
          var t = scene.objects[i]
          if (t.id === id) return [t.x || 0, t.y || 0, t.z || 0]
        }
        return null
      }
      var pairs = o.bonds && o.bonds.length > 0
        ? o.bonds
        : [[o.of || '', typeof o.to === 'string' ? o.to : '', o.n !== undefined ? o.n : 1]]
      for (var i = 0; i < pairs.length; i += 1) {
        var a = find(pairs[i][0])
        var b = find(pairs[i][1])
        if (!a || !b) continue
        var order = pairs[i][2] || 1
        var mid = v3.rotate(v3.mul(v3.add(a, b), 0.5), st.cam)
        ;(function (a2, b2, ord, depth) {
          q.push(depth, function () {
            bond3(p, pr, a2, b2, ord, { color: o.color || pal.fg3, width: o.width || 3.2, opacity: 0.85, dash: o.dash })
          }, 1)
        })(a, b, order, mid[2])
      }
      if (o.label) {
        var a0 = find(pairs[0] && pairs[0][0])
        var b0 = find(pairs[0] && pairs[0][1])
        if (a0 && b0) {
          q.push(9e7, function () {
            text3(p, pr, v3.mul(v3.add(a0, b0), 0.5), o.label, { color: pal.fg2, size: 11.5, bg: true })
          }, 4)
        }
      }
    },

    /** 孤对电子。 */
    lonepair: function (q, p, pr, o, st) {
      var at = [o.x || 0, o.y || 0, o.z || 0]
      var pal = NS.palette()
      q.push(v3.rotate(at, st.cam)[2] + 0.01, function () {
        var d = pr(at)
        p.dot(d.x - 0.05, d.y, { color: o.color || pal.brand, size: 2.6 })
        p.dot(d.x + 0.05, d.y, { color: o.color || pal.brand, size: 2.6 })
        if (o.label) p.text(d.x, d.y, sup(o.label), { color: o.color || pal.brand, size: 11, dy: -11, bg: true })
      }, 3)
    },

    /** 键角标注。 */
    anglelabel: GEOM.angle3,
    label3: GEOM.label3,
  }

  // ══ lattice3d ════════════════════════════════════════════════════════════

  /**
   * 晶胞预设：返回 { atoms: [{element, pos(0..1), site}], bonds, note }。
   * site 用于自动计算每胞微粒数：corner 1/8、edge 1/4、face 1/2、body 1。
   * @param {string} preset 预设名。
   * @returns {object} 晶胞定义。
   */
  function latticePreset(preset) {
    var name = String(preset || 'nacl').toLowerCase()
    var atoms = []
    /** 追加一批位置。 */
    var add = function (element, list, site) {
      for (var i = 0; i < list.length; i += 1) atoms.push({ element: element, pos: list[i], site: site })
    }
    var corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
    var faces = [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]]
    var edges = [
      [0.5, 0, 0], [0.5, 1, 0], [0.5, 0, 1], [0.5, 1, 1],
      [0, 0.5, 0], [1, 0.5, 0], [0, 0.5, 1], [1, 0.5, 1],
      [0, 0, 0.5], [1, 0, 0.5], [0, 1, 0.5], [1, 1, 0.5],
    ]

    if (name === 'nacl' || name === '氯化钠') {
      add('Cl', corners, 'corner')
      add('Cl', faces, 'face')
      add('Na', edges, 'edge')
      add('Na', [[0.5, 0.5, 0.5]], 'body')
      return { atoms: atoms, note: 'NaCl 型：配位数均为 6', bond: 0.52 }
    }
    if (name === 'cscl' || name === '氯化铯') {
      add('Cl', corners, 'corner')
      add('Cs', [[0.5, 0.5, 0.5]], 'body')
      return { atoms: atoms, note: 'CsCl 型：配位数均为 8', bond: 0.9 }
    }
    if (name === 'diamond' || name === '金刚石') {
      add('C', corners, 'corner')
      add('C', faces, 'face')
      add('C', [[0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]], 'body')
      return { atoms: atoms, note: '金刚石：每个 C 与 4 个 C 成键，最小环为 6 元环', bond: 0.46 }
    }
    if (name === 'co2' || name === '干冰') {
      add('CO₂', corners, 'corner')
      add('CO₂', faces, 'face')
      return { atoms: atoms, note: '干冰：分子晶体，面心立方堆积，配位数 12', bond: 0 }
    }
    if (name === 'fcc' || name === '面心立方') {
      add('M', corners, 'corner')
      add('M', faces, 'face')
      return { atoms: atoms, note: '面心立方最密堆积：配位数 12，空间利用率 74%', bond: 0 }
    }
    if (name === 'bcc' || name === '体心立方') {
      add('M', corners, 'corner')
      add('M', [[0.5, 0.5, 0.5]], 'body')
      return { atoms: atoms, note: '体心立方堆积：配位数 8，空间利用率 68%', bond: 0 }
    }
    if (name === 'sc' || name === '简单立方') {
      add('M', corners, 'corner')
      return { atoms: atoms, note: '简单立方堆积：配位数 6，空间利用率 52%', bond: 0 }
    }
    if (name === 'zns' || name === '闪锌矿') {
      add('S', corners, 'corner')
      add('S', faces, 'face')
      add('Zn', [[0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]], 'body')
      return { atoms: atoms, note: 'ZnS 型：配位数均为 4', bond: 0.46 }
    }
    if (name === 'caf2' || name === '萤石') {
      add('Ca', corners, 'corner')
      add('Ca', faces, 'face')
      add('F', [
        [0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75],
        [0.75, 0.25, 0.25], [0.25, 0.75, 0.25], [0.25, 0.25, 0.75], [0.75, 0.75, 0.75],
      ], 'body')
      return { atoms: atoms, note: 'CaF₂ 型：Ca²⁺ 配位数 8，F⁻ 配位数 4', bond: 0.46 }
    }
    // 默认回到 NaCl
    return latticePreset('nacl')
  }

  /** site → 归属权重。 */
  var SITE_WEIGHT = { corner: 1 / 8, edge: 1 / 4, face: 1 / 2, body: 1 }

  /**
   * 统计每个晶胞里各元素的微粒数（化学高频考点）。
   * @param {object[]} atoms 原子列表。
   * @returns {object} 元素 → 个数。
   */
  function latticeCount(atoms) {
    var out = {}
    for (var i = 0; i < atoms.length; i += 1) {
      var a = atoms[i]
      var w = SITE_WEIGHT[a.site] !== undefined ? SITE_WEIGHT[a.site] : 1
      out[a.element] = (out[a.element] || 0) + w
    }
    for (var k in out) {
      if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = Math.round(out[k] * 100) / 100
    }
    return out
  }

  NS.latticePreset = latticePreset
  NS.latticeCount = latticeCount

  /** 晶胞对象绘制表。 */
  var LATTICE = {
    /** 一个晶胞（预设或手工 atoms）。 */
    cell: function (q, p, pr, o, st) {
      var pal = NS.palette()
      var side = o.w !== undefined ? o.w : 1.5
      var half = side / 2
      var def = o.preset ? latticePreset(o.preset) : { atoms: [], note: '', bond: 0 }
      var atoms = def.atoms
      if (o.atoms && o.atoms.length > 0) {
        atoms = []
        for (var i = 0; i < o.atoms.length; i += 1) {
          var a = o.atoms[i]
          atoms.push({ element: a.element || 'M', pos: [a.x || 0, a.y || 0, a.z || 0], site: siteOf(a.x || 0, a.y || 0, a.z || 0) })
        }
      }
      /** 分数坐标 → 世界坐标。 */
      var toWorld = function (pos) {
        return [pos[0] * side - half + (o.x || 0), pos[1] * side - half + (o.y || 0), pos[2] * side - half + (o.z || 0)]
      }

      // 晶胞框线
      var cubeVerts = []
      for (var cz = 0; cz <= 1; cz += 1) {
        for (var cy = 0; cy <= 1; cy += 1) {
          for (var cx = 0; cx <= 1; cx += 1) cubeVerts.push(toWorld([cx, cy, cz]))
        }
      }
      var cubeEdges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
      for (var e = 0; e < cubeEdges.length; e += 1) {
        var A = cubeVerts[cubeEdges[e][0]]
        var B = cubeVerts[cubeEdges[e][1]]
        var mid = v3.rotate(v3.mul(v3.add(A, B), 0.5), st.cam)
        ;(function (A2, B2, depth) {
          q.push(depth, function () {
            line3(p, pr, A2, B2, { color: pal.fg3, width: 1.2, opacity: 0.65, dash: o.dash })
          }, 0)
        })(A, B, mid[2])
      }

      // 键（相邻异种原子之间）
      var bondLen = o.d !== undefined ? o.d : def.bond
      if (bondLen > 0) {
        for (var i2 = 0; i2 < atoms.length; i2 += 1) {
          for (var j2 = i2 + 1; j2 < atoms.length; j2 += 1) {
            var pa = atoms[i2].pos
            var pb = atoms[j2].pos
            var dist = Math.sqrt(Math.pow(pa[0] - pb[0], 2) + Math.pow(pa[1] - pb[1], 2) + Math.pow(pa[2] - pb[2], 2))
            if (dist > bondLen + 1e-6) continue
            var wa = toWorld(pa)
            var wb = toWorld(pb)
            var m2 = v3.rotate(v3.mul(v3.add(wa, wb), 0.5), st.cam)
            ;(function (wa2, wb2, depth) {
              q.push(depth, function () {
                line3(p, pr, wa2, wb2, { color: pal.fg2, width: 2, opacity: 0.5 })
              }, 1)
            })(wa, wb, m2[2])
          }
        }
      }

      // 原子球
      var scale = o.scale !== undefined ? o.scale : 0.62
      for (var k = 0; k < atoms.length; k += 1) {
        var at = toWorld(atoms[k].pos)
        var depth3 = v3.rotate(at, st.cam)[2]
        ;(function (at2, el, depth) {
          q.push(depth, function () {
            atomBall(p, pr, at2, el, { scale: scale, label: el.length > 2 ? '' : undefined })
          }, 2)
        })(at, atoms[k].element, depth3)
      }

      // 说明：微粒数与配位数（高中必考的那两句）
      var lines = []
      if (o.label) lines.push(o.label)
      if (o.value !== 0) {
        var counts = latticeCount(atoms)
        var parts = []
        for (var el in counts) {
          if (Object.prototype.hasOwnProperty.call(counts, el)) parts.push(el + ' ' + counts[el])
        }
        if (parts.length > 0) lines.push('每胞微粒数：' + parts.join(' ： '))
        if (def.note) lines.push(def.note)
      }
      if (lines.length > 0) {
        q.push(9e8, function () {
          var top = [o.x || 0, (o.y || 0) + half + 0.5, o.z || 0]
          text3(p, pr, top, lines.join('\n'), { color: pal.fg2, size: 11.5, bg: true })
        }, 4)
      }
    },

    atom: MOLECULE.atom,
    bond: MOLECULE.bond,
    label3: GEOM.label3,
  }

  /**
   * 判断分数坐标属于哪种位置（角/棱/面/体心）。
   * @param {number} x 分数 x。
   * @param {number} y 分数 y。
   * @param {number} z 分数 z。
   * @returns {string} site。
   */
  function siteOf(x, y, z) {
    /** 是否在边界上。 */
    var edge = function (v) { return Math.abs(v) < 1e-6 || Math.abs(v - 1) < 1e-6 }
    var n = (edge(x) ? 1 : 0) + (edge(y) ? 1 : 0) + (edge(z) ? 1 : 0)
    return n === 3 ? 'corner' : n === 2 ? 'edge' : n === 1 ? 'face' : 'body'
  }

  // ══ globe3d ══════════════════════════════════════════════════════════════

  /** 地球光照对象绘制表。 */
  var GLOBE = {
    /**
     * 地球本体：经纬网 + 昼夜半球着色 + 晨昏线 + 地轴。
     * declination 为太阳直射点纬度（夏至 23.5、冬至 −23.5、二分 0）。
     */
    globe: function (q, p, pr, o, st) {
      var pal = NS.palette()
      var r = o.r !== undefined ? o.r : 1.15
      var dec = rad(o.declination !== undefined ? o.declination : 23.5)
      // 地轴：n=(sin δ, cos δ, 0)，阳光沿 +x 射来 ⇒ 直射点纬度恰为 δ
      var axis = [Math.sin(dec), Math.cos(dec), 0]
      var sun = [1, 0, 0]
      var east = v3.norm(v3.cross(axis, [0, 0, 1]))
      if (v3.len(east) < 1e-6) east = [1, 0, 0]
      var north = axis
      var third = v3.norm(v3.cross(north, east))

      /**
       * 经纬度 → 世界坐标。
       * @param {number} latDeg 纬度。
       * @param {number} lonDeg 经度（0 为正对太阳的经线）。
       * @returns {number[]} 世界坐标点。
       */
      var at = function (latDeg, lonDeg) {
        var la = rad(latDeg)
        var lo = rad(lonDeg)
        var dir = v3.add(
          v3.mul(north, Math.sin(la)),
          v3.add(v3.mul(east, Math.cos(la) * Math.cos(lo)), v3.mul(third, Math.cos(la) * Math.sin(lo))),
        )
        return v3.mul(v3.norm(dir), r)
      }
      st._globeAt = at
      st._globeR = r
      st._globeSun = sun
      st._globeDec = o.declination !== undefined ? o.declination : 23.5

      // 球面网格着色：每个小四边形按是否受光取昼/夜色。
      // 密度取 14×28：背面的一半会被剔除，实际约 200 个四边形，
      // 既能让晨昏线边缘不显毛刺，拖动旋转时也不掉帧。
      var latN = 14
      var lonN = 28
      for (var i = 0; i < latN; i += 1) {
        var la1 = -90 + (180 * i) / latN
        var la2 = -90 + (180 * (i + 1)) / latN
        for (var j = 0; j < lonN; j += 1) {
          var lo1 = -180 + (360 * j) / lonN
          var lo2 = -180 + (360 * (j + 1)) / lonN
          var quad = [at(la1, lo1), at(la1, lo2), at(la2, lo2), at(la2, lo1)]
          var c = v3.centroid(quad)
          var rc = v3.rotate(c, st.cam)
          if (rc[2] < 0) continue // 背面不画
          var lit = v3.dot(v3.norm(c), sun) > 0
          var k = shade(c, st.cam)
          ;(function (quad2, depth, lit2, k2) {
            q.push(depth, function () {
              face3(p, pr, quad2, {
                color: lit2 ? tint('#4f9be8', k2) : tint('#2a3a55', k2 * 0.8),
                fill: lit2 ? tint('#6fb0f0', k2) : tint('#33455f', k2 * 0.85),
                opacity: lit2 ? 0.92 : 0.96,
                stroke: false,
              })
            }, 0)
          })(quad, rc[2], lit, k)
        }
      }

      /** 画一条球面曲线（自动剔除背面段）。 */
      var arc = function (fn, stl, samples) {
        var n = samples || 96
        var prev = null
        for (var s = 0; s <= n; s += 1) {
          var cur = fn(s / n)
          var rcur = v3.rotate(cur, st.cam)
          if (prev && rcur[2] > 0 && prev.r[2] > 0) {
            ;(function (a2, b2, depth) {
              q.push(depth, function () { line3(p, pr, a2, b2, stl) }, 2)
            })(prev.p, cur, Math.max(rcur[2], prev.r[2]) + 0.001)
          }
          prev = { p: cur, r: rcur }
        }
      }

      // 主要纬线：赤道、南北回归线、南北极圈
      var special = [
        { lat: 0, color: pal.fg, width: 1.6, label: '赤道' },
        { lat: 23.5, color: pal.warn, width: 1.2, label: '北回归线' },
        { lat: -23.5, color: pal.warn, width: 1.2, label: '南回归线' },
        { lat: 66.5, color: pal.brand, width: 1.1, label: '北极圈' },
        { lat: -66.5, color: pal.brand, width: 1.1, label: '南极圈' },
      ]
      if (o.wire !== false) {
        for (var g = -75; g <= 75; g += 15) {
          if (g === 0) continue
          ;(function (lat) {
            arc(function (t) { return at(lat, -180 + 360 * t) }, { color: pal.fg3, width: 0.7, opacity: 0.4 })
          })(g)
        }
        for (var lo = -180; lo < 180; lo += 30) {
          ;(function (lon) {
            arc(function (t) { return at(-90 + 180 * t, lon) }, { color: pal.fg3, width: 0.7, opacity: 0.4 })
          })(lo)
        }
      }
      for (var s2 = 0; s2 < special.length; s2 += 1) {
        ;(function (sp) {
          arc(function (t) { return at(sp.lat, -180 + 360 * t) }, { color: sp.color, width: sp.width, opacity: 0.9, dash: sp.lat !== 0 })
        })(special[s2])
      }

      // 晨昏线：与阳光垂直的大圆（x=0 平面）
      if (o.value !== 0) {
        arc(function (t) {
          var a = t * Math.PI * 2
          return v3.mul(v3.norm(v3.add(v3.mul([0, 1, 0], Math.cos(a)), v3.mul([0, 0, 1], Math.sin(a)))), r * 1.002)
        }, { color: '#f5c542', width: 2.2, opacity: 1 })
      }

      // 地轴
      if (o.arrow !== false) {
        var top = v3.mul(axis, r * 1.28)
        var bottom = v3.mul(axis, -r * 1.28)
        q.push(9e7, function () {
          line3(p, pr, bottom, top, { color: pal.fg2, width: 1.3, dash: true })
          text3(p, pr, top, 'N', { color: pal.fg2, size: 12, bold: true, bg: true })
        }, 3)
      }

      // 太阳直射点
      var sub = at(st._globeDec, 0)
      q.push(9e7 + 1, function () {
        var d = pr(sub)
        p.dot(d.x, d.y, { color: '#f5b023', size: 5 })
        p.text(d.x, d.y, '直射点 ' + fmtLat(st._globeDec), { color: '#c98410', size: 11, dy: -13, bg: true })
      }, 4)

      if (o.label) {
        q.push(9e8, function () {
          text3(p, pr, v3.mul(axis, r * 1.55), o.label, { color: pal.fg, size: 12.5, bold: true, bg: true })
        }, 4)
      }
    },

    /** 平行光（太阳光线）。 */
    sunray: function (q, p, pr, o, st) {
      var pal = NS.palette()
      var r = st._globeR || 1.15
      var n = o.n !== undefined ? o.n : 5
      var len = o.d !== undefined ? o.d : 0.7
      for (var i = 0; i < n; i += 1) {
        var frac = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
        var y = frac * r * 0.92
        var a = [r * 2.05, y, 0]
        var b = [r * 1.06, y, 0]
        ;(function (a2, b2) {
          q.push(9e6, function () {
            p.ctx.save()
            arrow3(p, pr, a2, b2, { color: '#f5b023', width: 1.5, head: 7 })
            p.ctx.restore()
          }, 3)
        })(a, b)
      }
      if (o.label !== '') {
        q.push(9e6 + 1, function () {
          text3(p, pr, [r * 2.15, 0, 0], o.label || '太阳光', { color: '#c98410', size: 11.5, bg: true })
        }, 4)
      }
    },

    /** 地表某点（可自动算正午太阳高度）。 */
    point: function (q, p, pr, o, st) {
      var pal = NS.palette()
      var at = st._globeAt
      if (!at) return
      var lat = o.lat !== undefined ? o.lat : 0
      var lon = o.lon !== undefined ? o.lon : 0
      var pos = at(lat, lon)
      var rp = v3.rotate(pos, st.cam)
      if (rp[2] < -0.05) return
      var s = styleOf(o, st, { color: pal.bad, size: 4.6 })
      var text = o.label !== undefined ? o.label : fmtLat(lat)
      if (o.value === 1) {
        var h = 90 - Math.abs(lat - (st._globeDec || 0))
        text += '\n正午太阳高度 ' + (Math.round(h * 10) / 10) + '°'
      }
      q.push(rp[2] + 0.02, function () {
        var d = pr(pos)
        p.dot(d.x, d.y, s)
        if (text) p.text(d.x, d.y, text, { color: s.color, size: 11.5, dx: 10, dy: -10, align: 'left', bg: true })
      }, 4)
    },

    /** 球面上的一段弧（如某条经线的昼弧）。 */
    arc: function (q, p, pr, o, st) {
      var at = st._globeAt
      if (!at) return
      var s = styleOf(o, st, { color: NS.palette().good, width: 2.2 })
      var lat = o.lat !== undefined ? o.lat : 0
      var from = o.from !== undefined ? o.from : -90
      var to = o.to !== undefined ? o.to : 90
      var prev = null
      for (var i = 0; i <= 64; i += 1) {
        var lon = from + ((to - from) * i) / 64
        var cur = v3.mul(at(lat, lon), 1.004)
        var rc = v3.rotate(cur, st.cam)
        if (prev && rc[2] > 0 && prev.r[2] > 0) {
          ;(function (a2, b2, depth) {
            q.push(depth, function () { line3(p, pr, a2, b2, s) }, 3)
          })(prev.p, cur, Math.max(rc[2], prev.r[2]) + 0.002)
        }
        prev = { p: cur, r: rc }
      }
      if (o.label) {
        var mid = v3.mul(at(lat, (from + to) / 2), 1.1)
        q.push(9e7, function () { text3(p, pr, mid, o.label, { color: s.color, size: 11.5, bg: true }) }, 4)
      }
    },

    /** 显式画晨昏线（globe 里默认已画，这里用于单独强调）。 */
    terminator: function (q, p, pr, o, st) {
      var r = st._globeR || 1.15
      var s = styleOf(o, st, { color: '#f5c542', width: 2.6 })
      var prev = null
      for (var i = 0; i <= 96; i += 1) {
        var a = (i / 96) * Math.PI * 2
        var cur = v3.mul(v3.norm([0, Math.cos(a), Math.sin(a)]), r * 1.006)
        var rc = v3.rotate(cur, st.cam)
        if (prev && rc[2] > 0 && prev.r[2] > 0) {
          ;(function (a2, b2, depth) {
            q.push(depth, function () { line3(p, pr, a2, b2, s) }, 3)
          })(prev.p, cur, Math.max(rc[2], prev.r[2]) + 0.003)
        }
        prev = { p: cur, r: rc }
      }
      if (o.label) {
        q.push(9e7, function () { text3(p, pr, [0, r * 1.2, 0], o.label, { color: s.color, size: 11.5, bg: true }) }, 4)
      }
    },

    label: GEOM.label3,
  }

  /**
   * 纬度的中文写法。
   * @param {number} lat 纬度。
   * @returns {string} 文本。
   */
  function fmtLat(lat) {
    var v = Math.round(Math.abs(lat) * 10) / 10
    if (Math.abs(lat) < 0.05) return '0°'
    return (lat > 0 ? 'N' : 'S') + v + '°'
  }

  // ══ 场景装配 ══════════════════════════════════════════════════════════════

  /**
   * 生成一个 3D 场景处理器。
   * @param {object} table 对象绘制表。
   * @param {object} [opts] 选项。
   * @returns {object} 场景处理器。
   */
  function make3d(table, opts) {
    var o = opts || {}
    return {
      is3d: true,
      defaultCam: o.cam || { yaw: 0.62, pitch: 0.34, zoom: 1, dist: 9, perspective: true },
      /**
       * 绘制整个 3D 场景。
       * @param {object} p Painter。
       * @param {object} scene 场景。
       * @param {object} state 状态（含 cam、focus）。
       * @returns {void}
       */
      draw: function (p, scene, state) {
        var pr = projector(state)
        var q = new NS.Depth()
        // 坐标轴（立体几何默认画，分子/晶胞/地球默认不画）
        if (o.axes === true && scene.view.axis !== false) {
          var L = 1.35
          var pal = NS.palette()
          var axes = [
            { v: [L, 0, 0], t: 'x' },
            { v: [0, L, 0], t: 'z' },
            { v: [0, 0, L], t: 'y' },
          ]
          for (var i = 0; i < axes.length; i += 1) {
            ;(function (ax) {
              q.push(-9e8, function () {
                arrow3(p, pr, [0, 0, 0], ax.v, { color: pal.fg3, width: 1.1, head: 6, opacity: 0.8 })
                text3(p, pr, v3.mul(ax.v, 1.1), ax.t, { color: pal.fg3, size: 11 })
              }, 0)
            })(axes[i])
          }
        }
        for (var k = 0; k < scene.objects.length; k += 1) {
          var obj = scene.objects[k]
          if (obj.hidden) continue
          var fn = table[obj.type]
          if (!fn) continue
          var focused = state.focus && state.focus.has(obj.id)
          if (focused) {
            // 高亮：把该对象的绘制包在光晕里（用一层包装 push 保序）
            ;(function (f, ob) {
              var inner = new NS.Depth()
              f(inner, p, pr, ob, state, scene)
              for (var m = 0; m < inner.items.length; m += 1) {
                ;(function (item) {
                  q.push(item.d, function () {
                    withFocus(p, true, item.draw)
                  }, item.b)
                })(inner.items[m])
              }
              inner.items.length = 0
            })(fn, obj)
          } else {
            fn(q, p, pr, obj, state, scene)
          }
        }
        q.flush()
      },
    }
  }

  NS.kinds = NS.kinds || {}
  NS.kinds.geom3d = make3d(GEOM, { axes: true })
  NS.kinds.molecule3d = make3d(MOLECULE, { cam: { yaw: 0.5, pitch: 0.22, zoom: 1, dist: 10, perspective: true } })
  NS.kinds.lattice3d = make3d(LATTICE, { cam: { yaw: 0.66, pitch: 0.3, zoom: 1, dist: 10, perspective: true } })
  NS.kinds.globe3d = make3d(GLOBE, { cam: { yaw: -0.5, pitch: 0.22, zoom: 1, dist: 11, perspective: true } })
  NS.tables3d = { GEOM: GEOM, MOLECULE: MOLECULE, LATTICE: LATTICE, GLOBE: GLOBE }
  NS.R3 = R
})(typeof globalThis !== 'undefined'
  ? (globalThis.__HST__ = globalThis.__HST__ || {})
  : (this.__HST__ = this.__HST__ || {}));

;

/* ── 30-shell.browser.js ── */
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
      this.elTop = top
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
      this.applyBare()
    },

    /** bare/compact：只画图示与步骤条——bare 隐藏顶部标题行，
     *  compact 同时收起步骤说明（给抽题卡的右侧图示区让高度、不挤画布）。 */
    applyBare: function () {
      if (this.elTop) this.elTop.style.display = (this.bare === true || this.compact === true) ? 'none' : ''
      if (this.elStep) {
        var has = this.scene && this.scene.steps && this.scene.steps.length > 0
        this.elStep.style.display = (this.compact === true || has !== true) ? 'none' : ''
      }
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
      var ratio = Number.isFinite(this.viewRatio) ? this.viewRatio : (this.mode === 'panel' ? 0.78 : 0.62)
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
        if (data.bare === true) player.bare = true
        if (data.compact === true) player.compact = true
        if (Number.isFinite(data.ratio)) player.viewRatio = data.ratio
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

;
