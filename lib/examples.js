// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 示例场景库（每种场景类型一份「够真」的样例）。
 *
 * 三个用途，一份数据：
 *   ① tutor_scene_guide 把它们当 few-shot 样例返回给模型——模型照着改比照着
 *      字段说明凭空写要准得多；
 *   ② scripts/preview.mjs 用它们生成预览 HTML，改引擎后截图做视觉回归；
 *   ③ 侧栏面板的「示例」入口可直接加载，用户不用先攒题目也能看到效果。
 *
 * 每个样例都取自真实高中题型，解题步骤按讲课顺序排，key:true 标在真正的关键
 * 一步上（也就是学生最容易卡住、最需要停下来看图的那一步）。
 *
 * @module dsh-highschool-tutor/examples
 */

/** 示例场景：kind → 场景规范。 */
export const EXAMPLES = {
  // ── 数学 · 导数的几何意义 ──────────────────────────────────────────────────
  plot2d: {
    kind: 'plot2d',
    title: '导数的几何意义：f(x)=x³−3x 在 x=1 处的切线',
    subject: 'math',
    topic: '一元函数的导数及其应用',
    caption: '切线斜率 = 该点导数值；极值点处导数为 0',
    view: { xMin: -2.6, xMax: 2.6, yMin: -3.4, yMax: 3.4, xLabel: 'x', yLabel: 'y' },
    objects: [
      { id: 'curve', type: 'func', expr: 'x^3-3x', label: 'f(x)=x^3-3x', width: 2.3 },
      { id: 'dmin', type: 'point', x: 1, y: -2, label: 'B(1,−2)', color: '#dc2626' },
      { id: 'dmax', type: 'point', x: -1, y: 2, label: 'A(−1,2)', color: '#16a34a', hidden: true },
      { id: 'tan', type: 'tangent', of: 'curve', at: 1, label: 'k=f′(1)=0', hidden: true },
      { id: 'tan2', type: 'tangent', of: 'curve', at: 2, label: 'k=f′(2)=9', color: '#8b5cf6', hidden: true },
      { id: 'p2', type: 'point', x: 2, y: 2, label: 'C(2,2)', color: '#8b5cf6', hidden: true },
      { id: 'zero', type: 'line', k: 0, b: 0, color: '#81858c', dash: true, hidden: true },
      { id: 'note', type: 'label', x: -1.55, y: 2.75, text: '极大值 f(−1)=2', color: '#16a34a', hidden: true },
      { id: 'note2', type: 'label', x: 1.5, y: -2.75, text: '极小值 f(1)=−2', color: '#dc2626', hidden: true },
    ],
    steps: [
      {
        title: '先画出函数图象', detail: '三次函数，最高次系数为正，图象「先升后降再升」。',
        formula: 'f(x) = x³ − 3x', focus: ['curve'],
      },
      {
        title: '求导，找导数为零的点', detail: 'f′(x)=3x²−3=3(x−1)(x+1)，令它为 0 得 x=±1。',
        formula: "f′(x) = 3x² − 3 = 3(x−1)(x+1)", show: ['dmax', 'zero'], focus: ['dmin', 'dmax'],
      },
      {
        title: '导数为零处切线水平', detail: '在 x=1 处作切线，斜率恰为 f′(1)=0——切线与 x 轴平行，这正是「极值点处导数为零」的图形含义。',
        formula: 'f′(1) = 3·1² − 3 = 0', key: true, show: ['tan', 'note', 'note2'], focus: ['tan', 'dmin'],
      },
      {
        title: '换一点看斜率', detail: '在 x=2 处，f′(2)=9，切线明显变陡。导数值的大小就是切线的倾斜程度。',
        formula: 'f′(2) = 3·4 − 3 = 9', show: ['p2', 'tan2'], hide: ['tan'], focus: ['tan2', 'p2'],
      },
      {
        title: '结论', detail: '导数 = 切线斜率。求极值先解 f′(x)=0，再用 f′ 的符号判断是极大还是极小。',
        formula: 'f′(x) > 0 ⇒ 递增；f′(x) < 0 ⇒ 递减', show: ['tan'], focus: ['curve'],
      },
    ],
  },

  // ── 数学 · 立体几何截面 ───────────────────────────────────────────────────
  geom3d: {
    kind: 'geom3d',
    title: '正方体中过 A、C、B₁ 的截面',
    subject: 'math',
    topic: '空间向量与立体几何',
    caption: '截面是正三角形；可拖动旋转从不同角度确认',
    view: { yaw: 38, pitch: 20 },
    objects: [
      {
        id: 'cube', type: 'solid', shape: 'cube', w: 1.6,
        vertices: ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'],
        color: '#2f6df6', hollow: true,
      },
      { id: 'sec', type: 'section', of: 'cube', normal: [1, 1, 1], through: [0.27, 0.27, 0.27], label: '截面', color: '#dc2626', hidden: true },
      { id: 'ac', type: 'segment3', points: [[-0.8, -0.8, 0.8], [0.8, -0.8, -0.8]], label: 'AC', color: '#16a34a', width: 2.4, hidden: true },
      { id: 'ab1', type: 'segment3', points: [[-0.8, -0.8, 0.8], [0.8, 0.8, 0.8]], label: 'AB₁', color: '#16a34a', width: 2.4, hidden: true },
      { id: 'cb1', type: 'segment3', points: [[0.8, -0.8, -0.8], [0.8, 0.8, 0.8]], label: 'CB₁', color: '#16a34a', width: 2.4, hidden: true },
      { id: 'diag', type: 'segment3', points: [[-0.8, -0.8, 0.8], [0.8, 0.8, -0.8]], label: '体对角线 AC₁', color: '#8b5cf6', dash: true, hidden: true },
      { id: 'tip', type: 'label3', x: 0, y: 1.35, z: 0, text: '三条棱上的对角线两两相等 ⇒ 正三角形', color: '#61666b', hidden: true },
    ],
    steps: [
      { title: '看清正方体的顶点标注', detail: '底面 ABCD，上面 A₁B₁C₁D₁，注意 A 与 A₁ 上下对应。', focus: ['cube'] },
      { title: '连出三条面对角线', detail: 'A、C、B₁ 三点分别在三个不同的面上，两两连线都是正方形的对角线。', show: ['ac', 'ab1', 'cb1'], focus: ['ac', 'ab1', 'cb1'] },
      {
        title: '三边相等 ⇒ 正三角形', detail: '设棱长为 a，则 AC=AB₁=CB₁=√2·a，所以截面 △ACB₁ 是正三角形。',
        formula: 'AC = AB₁ = CB₁ = √2 a', key: true, show: ['sec', 'tip'], focus: ['sec'],
      },
      {
        title: '与体对角线的关系', detail: '体对角线 AC₁ 垂直于这个截面——这是「三垂线」与向量法都常用的结论。',
        formula: 'AC₁ ⊥ 平面 ACB₁', key: true, show: ['diag'], focus: ['diag', 'sec'], view: { yaw: 62, pitch: 26 },
      },
    ],
  },

  // ── 物理 · 斜面受力分析 ───────────────────────────────────────────────────
  mech2d: {
    kind: 'mech2d',
    title: '斜面上滑块的受力分析与分解',
    subject: 'physics',
    topic: '相互作用——力',
    caption: '重力沿斜面／垂直斜面分解，是斜面问题的通用第一步',
    view: { xMin: 0, xMax: 100, yMin: 0, yMax: 60, axis: false },
    objects: [
      { id: 'gnd', type: 'ground', y: 12, x1: 5, x2: 95 },
      { id: 'slope', type: 'incline', x: 15, y: 12, angle: 30, w: 62, label: 'θ=30°' },
      { id: 'block', type: 'body', x: 52, y: 34, w: 11, h: 8, rotate: 30, mass: 'm', color: '#0f9d8f' },
      { id: 'G', type: 'force', x: 52, y: 34, angle: -90, mag: 17, label: 'G=mg', color: '#dc2626' },
      { id: 'N', type: 'force', x: 52, y: 34, angle: 120, mag: 15, label: 'N', color: '#2f6df6', hidden: true },
      { id: 'f', type: 'force', x: 52, y: 34, angle: 210, mag: 9, label: 'f', color: '#e08b1a', hidden: true },
      { id: 'G1', type: 'force', x: 52, y: 34, angle: 210, mag: 8.5, label: 'G sinθ', color: '#dc2626', dash: true, hidden: true },
      { id: 'G2', type: 'force', x: 52, y: 34, angle: -60, mag: 14.7, label: 'G cosθ', color: '#dc2626', dash: true, hidden: true },
      { id: 'ang', type: 'angle', points: [[15, 12], [45, 12], [40, 26]], label: '30°', r: 12 },
      { id: 'eq', type: 'label', x: 74, y: 50, text: '沿斜面：mg sinθ − f = ma\n垂直斜面：N = mg cosθ', color: '#61666b', hidden: true },
    ],
    steps: [
      { title: '先只画重力', detail: '受力分析从「重力一定有」开始，方向竖直向下，作用点画在重心。', focus: ['G'] },
      { title: '再画接触面给的力', detail: '斜面与滑块接触 ⇒ 有垂直于接触面的支持力 N，以及沿接触面的摩擦力 f。', show: ['N', 'f'], focus: ['N', 'f'] },
      {
        title: '把重力沿斜面方向分解', detail: '关键一步：不要分解 N 和 f，而是把 G 分解到「沿斜面」与「垂直斜面」两个方向——这样两个方向的方程各自独立。',
        formula: 'G∥ = mg sinθ    G⊥ = mg cosθ', key: true, show: ['G1', 'G2'], focus: ['G1', 'G2'],
      },
      {
        title: '分方向列方程', detail: '沿斜面方向用牛顿第二定律，垂直方向合力为零。θ=30° 时 sinθ=0.5、cosθ=√3/2。',
        formula: 'mg sinθ − f = ma\nN − mg cosθ = 0', key: true, show: ['eq'], focus: ['eq'],
      },
    ],
  },

  // ── 物理 · 电路 ───────────────────────────────────────────────────────────
  circuit: {
    kind: 'circuit',
    title: '滑动变阻器对电路的影响',
    subject: 'physics',
    topic: '电路及其应用',
    caption: '滑片移动 → R 变 → 总电阻变 → 干路电流变 → 各表读数变',
    view: { xMin: 0, xMax: 100, yMin: 0, yMax: 56 },
    objects: [
      { id: 'w1', type: 'wire', points: [[18, 14], [18, 42], [40, 42]] },
      { id: 'w2', type: 'wire', points: [[58, 42], [82, 42], [82, 14]] },
      { id: 'w3', type: 'wire', points: [[18, 14], [40, 14]] },
      { id: 'w4', type: 'wire', points: [[58, 14], [82, 14]] },
      { id: 'bat', type: 'battery', x: 18, y: 28, orient: 'v', label: 'E, r' },
      { id: 'A', type: 'ammeter', x: 49, y: 42, label: 'A' },
      { id: 'R', type: 'resistor', x: 49, y: 14, label: 'R₀' },
      { id: 'Rh', type: 'rheostat', x: 82, y: 28, orient: 'v', label: 'R′' },
      { id: 'V', type: 'voltmeter', x: 63, y: 28, orient: 'v', label: 'V', hidden: true },
      { id: 'vw1', type: 'wire', points: [[63, 21.5], [63, 14]], hidden: true },
      { id: 'vw2', type: 'wire', points: [[63, 34.5], [63, 42]], hidden: true },
      { id: 'cur', type: 'wire', points: [[26, 42], [34, 42]], arrow: true, color: '#dc2626', label: 'I', hidden: true },
      { id: 'note', type: 'label', x: 50, y: 51, text: '滑片右移 ⇒ R′ 增大 ⇒ I 减小 ⇒ U_R 减小', color: '#61666b', hidden: true },
    ],
    steps: [
      { title: '先认清是串联还是并联', detail: '电源、电流表、R₀、滑动变阻器首尾相接，只有一条路径 ⇒ 串联电路。', focus: ['bat', 'A', 'R', 'Rh'] },
      { title: '标出电流方向', detail: '电流从电源正极流出，经外电路回到负极；串联电路各处电流相同。', show: ['cur'], focus: ['cur'] },
      { title: '接入电压表测 R₀ 两端电压', detail: '电压表要并联在被测元件两端，且内阻很大、几乎不分流。', show: ['V', 'vw1', 'vw2'], focus: ['V'] },
      {
        title: '滑片移动后的连锁反应', detail: '这类题的通用思路：局部电阻变化 → 总电阻 → 干路电流 → 再回到各元件的电压。',
        formula: 'I = E / (R₀ + R′ + r)\nU_R = I·R₀', key: true, show: ['note'], focus: ['Rh', 'note'],
      },
    ],
  },

  // ── 化学 · 化学平衡 ───────────────────────────────────────────────────────
  chart2d: {
    kind: 'chart2d',
    title: '升温对化学平衡的影响（v−t 图）',
    subject: 'chemistry',
    topic: '化学反应速率与化学平衡',
    caption: '正逆反应速率都增大，但吸热方向增得更多 ⇒ 平衡正向移动',
    view: { xMin: 0, xMax: 10, yMin: 0, yMax: 10, xLabel: 't', yLabel: 'v' },
    objects: [
      { id: 'vf', type: 'series', data: [[0, 6], [1, 4.4], [2, 3.5], [3, 3.1], [4, 3], [5, 3]], label: 'v(正)', color: '#dc2626' },
      { id: 'vr', type: 'series', data: [[0, 0], [1, 1.7], [2, 2.5], [3, 2.9], [4, 3], [5, 3]], label: 'v(逆)', color: '#2f6df6' },
      { id: 'eq1', type: 'marker', x: 4, y: 3, label: '第一次平衡', dashed: true, color: '#61666b' },
      { id: 'jump', type: 'vline', x: 5, label: '升温', color: '#e08b1a', hidden: true },
      { id: 'vf2', type: 'series', data: [[5, 7.6], [6, 6.6], [7, 6.1], [8, 5.9], [9, 5.9], [10, 5.9]], color: '#dc2626', hidden: true },
      { id: 'vr2', type: 'series', data: [[5, 6.4], [6, 5.9], [7, 5.9], [8, 5.9], [9, 5.9], [10, 5.9]], color: '#2f6df6', hidden: true },
      { id: 'eq2', type: 'marker', x: 8, y: 5.9, label: '新平衡', dashed: true, color: '#61666b', hidden: true },
      { id: 'gap', type: 'region', x1: 5, x2: 6.4, y1: 6.4, y2: 7.6, label: 'v正 > v逆', color: '#e08b1a', hidden: true },
      { id: 'note', type: 'label', x: 7.4, y: 1.6, text: '正反应吸热：升温 → 正向移动\n（若放热则相反）', color: '#61666b', hidden: true },
    ],
    steps: [
      { title: '读第一段：建立平衡', detail: '起始只有反应物 ⇒ v正 从最大开始降，v逆 从 0 开始升，相等时达到平衡。', focus: ['vf', 'vr', 'eq1'] },
      { title: 't=5 时升高温度', detail: '温度升高使正逆速率同时突增——注意两条线都是「跳一下」，不是只跳一条。', show: ['jump', 'vf2', 'vr2'], focus: ['jump'] },
      {
        title: '比较跳后的高低决定移动方向', detail: '关键：升温后 v正 跳得比 v逆 高（吸热方向增幅更大），所以平衡向正反应方向移动。',
        formula: 'ΔH > 0，升温 ⇒ v正 > v逆 ⇒ 正向移动', key: true, show: ['gap'], focus: ['gap'],
      },
      { title: '重新达到平衡', detail: '新平衡时速率仍相等，但数值比原来更大——温度越高，达到平衡越快。', show: ['eq2', 'note'], focus: ['eq2'] },
    ],
  },

  // ── 化学 · 分子构型 ───────────────────────────────────────────────────────
  molecule3d: {
    kind: 'molecule3d',
    title: 'CH₄ / NH₃ / H₂O：价层电子对与分子形状',
    subject: 'chemistry',
    topic: '分子结构与性质',
    caption: '价层电子对数都是 4，孤对电子越多键角越小',
    view: { yaw: 28, pitch: 12 },
    objects: [
      { id: 'ch4', type: 'molecule', center: 'C', ligands: ['H', 'H', 'H', 'H'], geometry: 'tetrahedral', x: -1.5, label: 'CH₄ 正四面体 109°28′' },
      { id: 'nh3', type: 'molecule', center: 'N', ligands: ['H', 'H', 'H'], geometry: 'trigonal-pyramidal', value: 1, x: 0.15, label: 'NH₃ 三角锥 107°', hidden: true },
      { id: 'h2o', type: 'molecule', center: 'O', ligands: ['H', 'H'], geometry: 'bent', value: 2, x: 1.75, label: 'H₂O V 形 104.5°', hidden: true },
      { id: 'tip', type: 'label3', x: 0, y: -1.55, z: 0, text: '孤对电子对成键电子对的排斥更强 ⇒ 键角被压小', color: '#61666b', hidden: true },
    ],
    steps: [
      { title: 'CH₄：4 对成键电子', detail: '中心 C 有 4 个 σ 键、0 个孤对，价层电子对相互排斥取正四面体，键角 109°28′。', formula: '价层电子对数 = 4，孤对 = 0', focus: ['ch4'] },
      { title: 'NH₃：3 键 + 1 孤对', detail: '仍是 4 对电子，但其中一对是孤对，占据一个顶点后分子呈三角锥形。', formula: '4 = 3 + 1（孤对）', show: ['nh3'], focus: ['nh3'] },
      {
        title: 'H₂O：2 键 + 2 孤对', detail: '关键规律：孤对电子的排斥作用更强，把成键电子对「挤」得更近，所以键角 109°28′ → 107° → 104.5° 依次减小。',
        formula: '109°28′ > 107° > 104.5°', key: true, show: ['h2o', 'tip'], focus: ['h2o', 'tip'],
      },
    ],
  },

  // ── 化学 · 晶胞 ───────────────────────────────────────────────────────────
  lattice3d: {
    kind: 'lattice3d',
    title: 'NaCl 晶胞：微粒数与配位数',
    subject: 'chemistry',
    topic: '晶体结构与性质',
    caption: '顶点计 1/8、棱心 1/4、面心 1/2、体心 1',
    view: { yaw: 38, pitch: 18 },
    objects: [
      { id: 'cell', type: 'cell', preset: 'nacl', w: 1.7, label: 'NaCl 晶胞' },
    ],
    steps: [
      { title: '看清两种离子的位置', detail: 'Cl⁻ 在顶点和面心，Na⁺ 在棱心和体心——两套面心立方相互穿插。', focus: ['cell'] },
      {
        title: '按「归属分数」数微粒', detail: '关键一步：晶胞是重复单元，边界上的微粒被邻胞共享。顶点属 8 个胞（记 1/8），棱心属 4 个（1/4），面心属 2 个（1/2），体心独占（1）。',
        formula: 'Cl⁻：8×1/8 + 6×1/2 = 4\nNa⁺：12×1/4 + 1 = 4', key: true, focus: ['cell'],
      },
      { title: '得出化学式与配位数', detail: 'Na⁺ : Cl⁻ = 4 : 4 = 1 : 1，与化学式 NaCl 一致；每个离子周围最近的异种离子有 6 个。', formula: '配位数 = 6', focus: ['cell'] },
    ],
  },

  // ── 地理 · 地球光照 ───────────────────────────────────────────────────────
  globe3d: {
    kind: 'globe3d',
    title: '夏至日光照图与正午太阳高度',
    subject: 'geography',
    topic: '地球的运动',
    caption: '太阳直射北回归线，北极圈内极昼',
    view: { yaw: -28, pitch: 14 },
    objects: [
      { id: 'earth', type: 'globe', declination: 23.5, label: '夏至日（6 月 22 日前后）' },
      { id: 'rays', type: 'sunray', n: 5, label: '太阳光' },
      { id: 'bj', type: 'point', lat: 40, lon: 0, label: '北京 N40°', value: 1, hidden: true },
      { id: 'trop', type: 'point', lat: 23.5, lon: 0, label: '直射点', color: '#e08b1a', hidden: true },
      { id: 'polar', type: 'arc', lat: 70, from: -180, to: 180, label: '极昼', color: '#16a34a', hidden: true },
    ],
    steps: [
      { title: '先定直射点纬度', detail: '夏至日太阳直射北回归线，即直射点纬度 δ = 23.5°N。这是全部计算的起点。', formula: 'δ = 23°26′N ≈ 23.5°N', show: ['trop'], focus: ['trop'] },
      { title: '找晨昏线与昼夜分布', detail: '黄色大圆是晨昏线，它把地球分成昼半球与夜半球；此时北极圈及其以北出现极昼。', show: ['polar'], focus: ['polar'] },
      {
        title: '用纬度差求正午太阳高度', detail: '关键公式：正午太阳高度 = 90° − |当地纬度 − 直射点纬度|。北京 40°N 与 23.5°N 相差 16.5°，所以 H = 73.5°。',
        formula: 'H = 90° − |φ − δ| = 90° − |40° − 23.5°| = 73.5°', key: true, show: ['bj'], focus: ['bj'],
      },
      { title: '推广到其他日期', detail: '换成冬至就把 δ 取 −23.5°，二分取 0°；公式不变，只换 δ。', formula: '冬至：H = 90° − |40° − (−23.5°)| = 26.5°', focus: ['earth'] },
    ],
  },

  // ── 通用示意图 ────────────────────────────────────────────────────────────
  diagram2d: {
    kind: 'diagram2d',
    title: '工业制硫酸的流程',
    subject: 'chemistry',
    topic: '化工生产中的重要非金属元素（硫·氮）',
    caption: '三步转化 + 逆流吸收，注意每步的条件',
    view: { xMin: 0, xMax: 100, yMin: 0, yMax: 46 },
    objects: [
      { id: 'b1', type: 'box', x: 14, y: 32, w: 22, h: 10, text: '硫铁矿\n沸腾炉', color: '#e08b1a' },
      { id: 'b2', type: 'box', x: 50, y: 32, w: 22, h: 10, text: '接触室\n2SO₂+O₂⇌2SO₃', color: '#2f6df6' },
      { id: 'b3', type: 'box', x: 86, y: 32, w: 20, h: 10, text: '吸收塔\n浓硫酸', color: '#16a34a' },
      { id: 'a1', type: 'arrow', of: 'b1', target: 'b2', text: 'SO₂' },
      { id: 'a2', type: 'arrow', of: 'b2', target: 'b3', text: 'SO₃' },
      { id: 'c1', type: 'text', x: 14, y: 20, text: '4FeS₂+11O₂ → 2Fe₂O₃+8SO₂', size: 11, color: '#61666b', hidden: true },
      { id: 'c2', type: 'text', x: 50, y: 20, text: '催化剂 V₂O₅ · 400~500℃ · 常压', size: 11, color: '#61666b', hidden: true },
      { id: 'c3', type: 'text', x: 86, y: 20, text: '用浓硫酸而不是水，防止形成酸雾', size: 11, color: '#61666b', hidden: true },
      { id: 'r', type: 'region', x: 50, y: 32, w: 96, h: 16, label: '尾气循环利用', color: '#8b5cf6', hidden: true },
    ],
    steps: [
      { title: '第一步：造气', detail: '硫铁矿在沸腾炉中焙烧得到 SO₂，同时得到副产物 Fe₂O₃。', show: ['c1'], focus: ['b1', 'c1'] },
      {
        title: '第二步：接触氧化（关键）', detail: '这是全流程的核心：可逆反应且放热，所以既要催化剂加快速率，又不能温度过高——温度过高平衡逆向移动，转化率反而下降。',
        formula: '2SO₂ + O₂ ⇌ 2SO₃  （ΔH < 0）', key: true, show: ['c2'], focus: ['b2', 'c2'],
      },
      { title: '第三步：吸收', detail: '用 98.3% 的浓硫酸逆流吸收 SO₃；若用水会放出大量热形成酸雾，吸收效率反而低。', show: ['c3'], focus: ['b3', 'c3'] },
      { title: '绿色化学：尾气处理', detail: '未反应的 SO₂ 循环回接触室，既提高原料利用率又减少污染。', show: ['r'], focus: ['r'] },
    ],
  },
}

/**
 * 取某类型的示例场景（深拷贝，调用方可随意改）。
 * @param {string} kind 场景类型。
 * @returns {object|null} 示例场景。
 */
export function exampleOf(kind) {
  const found = EXAMPLES[kind]
  return found ? JSON.parse(JSON.stringify(found)) : null
}

/**
 * 全部示例的清单（标题与所属学科，用于界面上的示例入口）。
 * @returns {Array<{kind: string, title: string, subject: string|null, topic: string, steps: number}>} 清单。
 */
export function exampleList() {
  return Object.keys(EXAMPLES).map((kind) => ({
    kind,
    title: EXAMPLES[kind].title,
    subject: EXAMPLES[kind].subject ?? null,
    topic: EXAMPLES[kind].topic ?? '',
    steps: (EXAMPLES[kind].steps ?? []).length,
  }))
}

/**
 * 各场景类型的对象字段速查表——tutor_scene_guide 把它连同示例一起返回给模型。
 *
 * 写法约定（所有类型通用）：
 *   id       建议手写成有意义的短名（tan、G1、b2），步骤里要靠它引用
 *   label    图上的文字标注；支持 x^2 / v_0 这种写法，引擎会转成 x²、v₀
 *   color    十六进制色；不给就按类型取默认色（多条曲线自动轮换配色）
 *   dash     true 画虚线（辅助线、分解线、渐近线都用它）
 *   width    线宽；opacity 透明度；size 点/字号
 *   hidden   true = 初始不显示，等某一步 show 出来（讲解节奏全靠它）
 */
export const FIELD_DOCS = {
  plot2d: {
    _view: 'xMin/xMax/yMin/yMax 必给（否则默认 ±5/±4）；equal:true 让两轴等比例（画圆必用）；grid/axis:false 关网格与坐标轴；xLabel/yLabel 轴名',
    func: 'y=f(x) 曲线。expr 必填（支持 x^3-3x、2sin(x)、|x-1|、sqrt(x)、ln(x)、pi 等）；from/to 限定定义域；samples 采样数；label 曲线名',
    param: '参数曲线。exprX/exprY 为关于 t 的表达式，from/to 为 t 的范围。画圆、椭圆、螺线、圆周运动轨迹用它',
    point: '点。x/y 必填；label 标注（如「A(1,2)」）',
    line: '直线。三种给法：{k,b} 斜截式 ／ {a,b,c} 一般式 ax+by+c=0 ／ {x1,y1,x2,y2} 两点式',
    segment: '线段。x1/y1/x2/y2',
    vector: '向量箭头。x1/y1 起点（省略为原点）、x2/y2 终点',
    circle: '圆。cx/cy/r；fillArea:true 填充',
    ellipse: '椭圆。cx/cy/a（半长轴）/b（半短轴）',
    polygon: '多边形。points:[[x,y],…]；close:false 不闭合；fillArea:true 填充',
    area: '面积填充（定积分）。expr 上边界、expr2 下边界（省略则到 x 轴）、from/to 区间',
    tangent: '切线（引擎自动数值求导，不用自己算斜率）。of 指向某条 func 的 id、at 切点横坐标；extend:false 只画短切线；label 省略时自动写出 k=…',
    label: '文字。x/y/text；anchor 取 left/center/right；bold:true 加粗',
    angle: '角标注圆弧。points:[[顶点],[边1上一点],[边2上一点]]；r 弧半径；label 角度文字',
    mark: '坐标轴虚线标记。给 x（画竖虚线并在 x 轴标数）或 y（横虚线）',
  },
  geom3d: {
    _view: 'yaw/pitch 初始视角（度）；zoom 缩放；wireframe:true 只画棱不画面。用户可拖动旋转，不必追求完美初始角度',
    solid: '几何体。shape 取 cube/cuboid/prism/pyramid/cone/cylinder/sphere/tetra；w/h/d 三向尺寸；n 底面边数（prism/pyramid 用）；vertices:["A","B",…] 按顶点顺序标名（立方体顺序为底面 4 个再上面 4 个）；hollow:true 只显示朝前的面，便于看内部',
    point3: '空间点。x/y/z + label',
    segment3: '线段。points:[[x,y,z],[x,y,z]]；dash:true 画辅助线',
    face: '空间多边形面。points:[[x,y,z],…]',
    vector3: '空间向量。points:[[起点],[终点]]',
    plane: '平面（画成半透明片）。normal:[nx,ny,nz] 法向量、through:[x,y,z] 过点；scale 片的大小；arrow:true 画出法向量',
    section: '**截面（引擎自动求交，立体几何最有用的一个）**。of 指向某个 solid 的 id、normal 截面法向量、through 截面过的一点，引擎自动算出截面多边形并画出来',
    angle3: '空间角。points:[[顶点],[边1点],[边2点]]；label 省略时自动写出角度',
    label3: '空间文字。x/y/z/text',
    sphere3: '线框球（外接球/内切球）。cx/cy/cz/r',
  },
  mech2d: {
    _view: '建议 xMin:0,xMax:100,yMin:0,yMax:60，axis:false。所有坐标按这个 100×60 的画面来摆',
    ground: '地面（带斜纹）。y 高度、x1/x2 左右端',
    incline: '斜面三角形。x/y 直角顶点、angle 倾角（度）、w 底边长、dir:"left" 朝左',
    body: '物块/小球。x/y 中心、w/h 尺寸（shape:"circle" 时用 r）、rotate 旋转角（放在斜面上要跟斜面同角度）、mass 标注质量',
    force: '力箭头。x/y 作用点、angle 方向（度，0=向右、90=向上）、mag 大小（决定箭头长度）、scale 长度缩放、label 力的名字',
    velocity: '速度箭头（默认蓝色），字段同 force',
    accel: '加速度箭头（默认橙色虚线），字段同 force',
    spring: '弹簧锯齿线。x1/y1/x2/y2、n 圈数、h 振幅',
    rope: '绳或杆。x1/y1/x2/y2',
    pulley: '滑轮。x/y/r',
    path: '轨迹。给 points 点列，或 preset:"projectile"（配 x/y 起点、value 初速、angle 抛射角、a 重力加速度、to 时长）、preset:"circle"（配 x/y/r）。播放时有小球沿轨迹运动',
    field: '匀强场符号。x1/y1/x2/y2 区域、d 间距、kind 取 into（×，垂直纸面向里）/out（·，向外）/arrow（配 angle）',
    charge: '点电荷。x/y、value 正负（≥0 画 +）、r 半径',
    dim: '尺寸标注（双向箭头）。x1/y1/x2/y2 + label',
    label: '文字。x/y/text',
    angle: '角标注，同 plot2d 的 angle',
  },
  circuit: {
    _view: '建议 xMin:0,xMax:100,yMin:0,yMax:56。元件都画在 (x,y)，orient:"h" 横放（默认）或 "v" 竖放，元件自带引线，用 wire 把它们连成回路',
    battery: '电源。x/y/orient、label（如「E, r」）',
    resistor: '定值电阻。x/y/orient、label（如「R₀」）',
    rheostat: '滑动变阻器（带斜箭头）。同 resistor',
    lamp: '灯泡。同 resistor',
    switch: '开关。open:true 画成断开状态',
    ammeter: '电流表。x/y/orient',
    voltmeter: '电压表（记得并联在被测元件两端）',
    capacitor: '电容器',
    wire: '导线折线。points:[[x,y],…]；arrow:true 在中点画电流箭头',
    junction: '节点实心圆。x/y',
    label: '文字。x/y/text',
  },
  chart2d: {
    _view: 'xMin/xMax/yMin/yMax + xLabel/yLabel（如 t 与 v、V(NaOH) 与 pH）',
    series: '曲线。给 data:[[x,y],…] 逐点数据，或 expr 表达式；shape 取 step（阶梯）/dots（散点）；fillArea:true 填充到底；label 曲线名',
    bar: '柱状。data:[[x,y],…]、w 柱宽、from 基线',
    marker: '关键点。x/y + label；dashed:false 关掉引出的虚线',
    region: '矩形阴影区间。x1/x2/y1/y2 + label',
    hline: '水平参考线。y + label',
    vline: '竖直参考线。x + label（如「加入 NaOH」「升温」）',
    label: '文字。x/y/text',
    arrow: '箭头。x1/y1/x2/y2（标注「平衡移动方向」这类）',
  },
  molecule3d: {
    _view: 'yaw/pitch 初始视角。多个分子并排时用各自的 x 拉开距离（如 -1.5 / 0 / 1.5）',
    molecule: '**整个分子（推荐用法，自动摆位）**。center 中心原子（如 "C"）、ligands ["H","H","H","H"] 配体、geometry 取 linear/bent/trigonal-planar/trigonal-pyramidal/tetrahedral/trigonal-bipyramidal/octahedral/square-planar（也认中文「正四面体」「三角锥」「V形」）、value 孤对电子数、d 键长、x/y/z 整体位置、label 分子名与键角',
    atom: '单个原子（需要手工摆位时用）。element 元素符号、x/y/z、r 半径',
    bond: '手工连键。bonds:[["原子id","原子id",键级],…]，键级 1/2/3 画单/双/三键',
    lonepair: '孤对电子。x/y/z',
    anglelabel: '键角标注。points:[[顶点],[边1],[边2]] + label',
    label3: '空间文字。x/y/z/text',
  },
  lattice3d: {
    _view: 'yaw/pitch 初始视角',
    cell: '**晶胞（推荐用 preset）**。preset 取 nacl/cscl/diamond/zns/caf2/co2/fcc/bcc/sc，引擎自动摆好微粒、连键，并按「顶点 1/8、棱心 1/4、面心 1/2、体心 1」算出每胞微粒数标在图上；w 晶胞边长、scale 原子球大小、value:0 关掉自动标注；也可用 atoms:[{element,x,y,z},…] 手工给分数坐标（0~1）',
    atom: '单个原子，同 molecule3d',
    bond: '手工连键，同 molecule3d',
    label3: '空间文字',
  },
  globe3d: {
    _view: 'yaw/pitch 初始视角。阳光固定从右侧（+x）射来',
    globe: '**地球本体**。declination 太阳直射点纬度（夏至 23.5、冬至 −23.5、二分 0），引擎据此自动算出昼夜半球着色、晨昏线、直射点位置；wire:false 关经纬网、arrow:false 关地轴、value:0 关晨昏线；label 图名',
    point: '地表某点。lat 纬度、lon 经度（0 为正对太阳的那条经线，即地方时 12 点）、value:1 时自动算出并标注该点的正午太阳高度、label 地名',
    arc: '纬线上的一段弧（画昼弧夜弧）。lat 纬度、from/to 经度范围',
    sunray: '平行太阳光箭头。n 条数',
    terminator: '单独强调晨昏线',
    label: '文字。x/y/z/text',
  },
  diagram2d: {
    _view: '建议 xMin:0,xMax:100,yMin:0,yMax:46',
    box: '方框。x/y 中心、w/h 尺寸、text 框内文字（自动折行，可用 \\n）、shape 取 rect/round/ellipse/diamond',
    arrow: '箭头。**端点可以直接写方框 id**：of 起点框、target 终点框，引擎自动从框边缘出发；也可用 x1/y1/x2/y2 给坐标；text 箭头上的文字；both:true 双向',
    text: '文字。x/y/text/size',
    region: '半透明分区。x/y 中心、w/h、label 区名',
    line: '折线。points:[[x,y],…]',
    bracket: '大括号（标注一段范围）。x1/y1/x2/y2 + label',
    icon: '用 Unicode 字符当图标。x/y、text 如 ☀ ☁ ↑ ⇌',
  },
  html: {
    _view: '不使用；把完整 HTML 片段写进 scene.html 即可（可含 <style> 与 <script>，帧内沙箱执行、无网络）',
  },
}

/**
 * 取某场景类型的字段说明。
 * @param {string} kind 场景类型。
 * @returns {object|null} 字段说明。
 */
export function fieldDocsOf(kind) {
  return FIELD_DOCS[kind] ?? null
}
