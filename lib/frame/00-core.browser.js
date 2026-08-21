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
