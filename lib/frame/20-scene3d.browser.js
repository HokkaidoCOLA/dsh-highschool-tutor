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
