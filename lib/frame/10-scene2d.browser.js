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
