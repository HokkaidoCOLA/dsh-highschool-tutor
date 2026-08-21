// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 展示用演示集（GitHub 展示 / 离线画廊）。
 *
 * 与 examples.js 的分工：
 *   examples.js  每种场景类型**一份**最具代表性的样例，喂给模型当 few-shot 模板，
 *                所以刻意保持简短、字段用法典型；
 *   showcase.js  真实讲题时产出的**完整演示**，用来展示这套引擎能画到什么程度。
 *                内容更长、步骤更多，不适合当模板，但适合放进画廊给人看。
 *
 * 这里的每一份都在会话里逐步渲染验证过（详见 scripts/showcase.mjs 的自检输出）：
 * 截面顶点顺序、键角、正午太阳高度、抛物线落点都与手算一致。
 *
 * 样式统一写成嵌套 `style: {}`：顶层写法与嵌套写法引擎都认，但嵌套写法对任何历史
 * 版本的 normalizeObject 都安全（早期版本会静默丢弃顶层样式字段）。
 *
 * @module dsh-highschool-tutor/showcase
 */

/** 演示：正方体中证明两个对角面互相垂直（立体几何 · 面面垂直判定）。 */
const GEOM_PERPENDICULAR = {
  id: 'math-perpendicular-planes',
  question: '在正方体 ABCD-A₁B₁C₁D₁ 中，求证：平面 ACC₁A₁ ⊥ 平面 BDD₁B₁。',
  scene: {
    kind: 'geom3d',
    title: '正方体中证明平面 ACC₁A₁ ⊥ 平面 BDD₁B₁',
    subject: 'math',
    topic: '立体几何初步',
    caption: '证面面垂直 = 在一个面里找一条直线垂直于另一个面',
    view: { yaw: 34, pitch: 18 },
    objects: [
      {
        id: 'cube', type: 'solid', shape: 'cube', w: 1.6, wire: true,
        vertices: ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'],
        style: { color: '#2f6df6' },
      },
      {
        id: 'p1', type: 'face', label: '平面ACC₁A₁', style: { color: '#dc2626', opacity: 0.26 },
        points: [[-0.8, -0.8, 0.8], [0.8, -0.8, -0.8], [0.8, 0.8, -0.8], [-0.8, 0.8, 0.8]],
      },
      {
        id: 'p2', type: 'face', label: '平面BDD₁B₁', style: { color: '#16a34a', opacity: 0.26 },
        points: [[0.8, -0.8, 0.8], [-0.8, -0.8, -0.8], [-0.8, 0.8, -0.8], [0.8, 0.8, 0.8]],
      },
      {
        id: 'base', type: 'face', label: '底面ABCD', hidden: true, style: { color: '#81858c', opacity: 0.16 },
        points: [[-0.8, -0.8, 0.8], [0.8, -0.8, 0.8], [0.8, -0.8, -0.8], [-0.8, -0.8, -0.8]],
      },
      { id: 'ac', type: 'segment3', label: 'AC', hidden: true, style: { color: '#dc2626', width: 3.2 }, points: [[-0.8, -0.8, 0.8], [0.8, -0.8, -0.8]] },
      { id: 'bd', type: 'segment3', label: 'BD', hidden: true, style: { color: '#16a34a', width: 3.2 }, points: [[0.8, -0.8, 0.8], [-0.8, -0.8, -0.8]] },
      { id: 'dd1', type: 'segment3', label: 'DD₁', hidden: true, style: { color: '#8b5cf6', width: 3.4 }, points: [[-0.8, -0.8, -0.8], [-0.8, 0.8, -0.8]] },
      { id: 'o', type: 'point3', label: 'O', hidden: true, x: 0, y: -0.8, z: 0, style: { color: '#dc2626' } },
      { id: 'ang1', type: 'angle3', hidden: true, r: 0.32, style: { color: '#e08b1a' }, points: [[0, -0.8, 0], [-0.8, -0.8, 0.8], [0.8, -0.8, 0.8]] },
      { id: 'ang2', type: 'angle3', hidden: true, r: 0.32, style: { color: '#e08b1a' }, points: [[-0.8, -0.8, -0.8], [-0.8, 0.8, -0.8], [-0.8, -0.8, 0.8]] },
      { id: 'tip', type: 'label3', hidden: true, x: 0, y: 1.5, z: 0, text: '两个对角面互相垂直', style: { color: '#61666b' } },
    ],
    steps: [
      {
        title: '看清要证的是哪两个面',
        detail: '平面 ACC₁A₁ 与平面 BDD₁B₁ 都是正方体的「对角面」——各自由一条底面对角线和两条竖棱围成的矩形。先在图上把它们分清楚，再谈证明。',
        focus: ['p1', 'p2'],
      },
      {
        title: '转化目标：不要去找两面的夹角',
        detail: '面面垂直的判定定理告诉我们：只要在其中一个平面里找到一条直线，它垂直于另一个平面，两面就垂直。所以任务变成「在平面 ACC₁A₁ 里挑一条线」——自然挑 AC。',
        formula: 'a ⊥ β，且 a ⊂ α  ⇒  α ⊥ β',
        hide: ['p1', 'p2'], show: ['base'],
      },
      {
        title: '第①步：AC ⊥ BD',
        detail: '底面 ABCD 是正方形，正方形的两条对角线互相垂直，交于中心 O。这一步只用到平面几何。',
        formula: 'ABCD 是正方形 ⇒ AC ⊥ BD',
        show: ['ac', 'bd', 'o', 'ang1'], focus: ['ac', 'bd', 'ang1'],
      },
      {
        title: '第②步：AC ⊥ DD₁',
        detail: 'DD₁ 是竖棱，垂直于底面 ABCD；而 AC 在底面内，所以 DD₁ ⊥ AC。注意：AC 与 DD₁ 并不相交（是异面直线），照样可以垂直——依据是「垂直于平面的直线垂直于平面内任意一条直线」。',
        formula: 'DD₁ ⊥ 平面ABCD，AC ⊂ 平面ABCD ⇒ DD₁ ⊥ AC',
        show: ['dd1', 'ang2'], focus: ['dd1', 'ang2'],
      },
      {
        title: '第③步：两条相交直线 ⇒ AC 垂直于整个平面',
        detail: '这是全题唯一容易丢分的地方：光有 AC⊥BD 或光有 AC⊥DD₁ 都不够，必须凑齐「两条相交直线」并交代它们都在平面 BDD₁B₁ 内。BD 与 DD₁ 恰好交于 D，条件齐了。',
        formula: 'BD ∩ DD₁ = D，BD、DD₁ ⊂ 平面BDD₁B₁ ⇒ AC ⊥ 平面BDD₁B₁',
        key: true, hide: ['base'], show: ['p2'], focus: ['p2', 'ac'],
      },
      {
        title: '第④步：回到面面垂直',
        detail: 'AC 垂直于平面 BDD₁B₁，而 AC 本身就在平面 ACC₁A₁ 里，判定定理的两个条件全部满足。答题时这句「AC ⊂ 平面 ACC₁A₁」不能省。',
        formula: 'AC ⊥ 平面BDD₁B₁，AC ⊂ 平面ACC₁A₁ ⇒ 平面ACC₁A₁ ⊥ 平面BDD₁B₁',
        key: true, show: ['p1', 'tip'], focus: ['p1', 'p2'], view: { yaw: 58, pitch: 24 },
      },
    ],
  },
}

/** 演示：乙烯被酸性 KMnO₄ 氧化——C=C 断裂，两个碳各自成为 CO₂。 */
const CHEM_ETHYLENE = {
  id: 'chem-ethylene-oxidation',
  question: '将乙烯通入酸性 KMnO₄ 溶液，紫红色褪去。判断反应类型并写出化学方程式；能否用它除去乙烷中的乙烯？',
  scene: {
    kind: 'molecule3d',
    title: '乙烯被酸性 KMnO₄ 氧化：C=C 断裂 → 两个 CO₂',
    subject: 'chemistry',
    topic: '有机化合物（乙烯·乙醇·乙酸）',
    caption: '同一个碳原子从乙烯里的 −2 价，一路走到 CO₂ 里的 +4 价（可拖动旋转）',
    view: { yaw: 0, pitch: 12 },
    objects: [
      { id: 'c1', type: 'atom', element: 'C', x: -0.45, y: 0, z: 0, r: 0.20 },
      { id: 'c2', type: 'atom', element: 'C', x: 0.45, y: 0, z: 0, r: 0.20 },
      { id: 'h1', type: 'atom', element: 'H', x: -0.84, y: 0.675, z: 0, r: 0.13 },
      { id: 'h2', type: 'atom', element: 'H', x: -0.84, y: -0.675, z: 0, r: 0.13 },
      { id: 'h3', type: 'atom', element: 'H', x: 0.84, y: 0.675, z: 0, r: 0.13 },
      { id: 'h4', type: 'atom', element: 'H', x: 0.84, y: -0.675, z: 0, r: 0.13 },
      { id: 'db', type: 'bond', bonds: [['c1', 'c2', 2]], style: { width: 3.6 } },
      { id: 'hb', type: 'bond', style: { width: 2.6 }, bonds: [['c1', 'h1', 1], ['c1', 'h2', 1], ['c2', 'h3', 1], ['c2', 'h4', 1]] },
      { id: 'ang', type: 'anglelabel', hidden: true, r: 0.30, points: [[-0.45, 0, 0], [0.45, 0, 0], [-0.84, 0.675, 0]] },
      { id: 'oa1', type: 'atom', element: 'O', x: -1.45, y: 0, z: 0, r: 0.18, hidden: true },
      { id: 'oa2', type: 'atom', element: 'O', x: -0.55, y: 0, z: 0, r: 0.18, hidden: true },
      { id: 'ob1', type: 'atom', element: 'O', x: 0.55, y: 0, z: 0, r: 0.18, hidden: true },
      { id: 'ob2', type: 'atom', element: 'O', x: 1.45, y: 0, z: 0, r: 0.18, hidden: true },
      { id: 'cob', type: 'bond', hidden: true, style: { width: 3.2 }, bonds: [['c1', 'oa1', 2], ['c1', 'oa2', 2], ['c2', 'ob1', 2], ['c2', 'ob2', 2]] },
      { id: 'lbl_eth', type: 'label3', x: 0, y: 1.2, z: 0, text: '乙烯 CH₂=CH₂ · 平面形 · 键角 120°' },
      { id: 'cut', type: 'label3', hidden: true, x: 0, y: 0.34, z: 0, text: 'π 键在这里断开', style: { color: '#e08b1a' } },
      { id: 'lbl_prod', type: 'label3', hidden: true, x: 0, y: 1.2, z: 0, text: '两个 CO₂ · 直线形 · 碳被氧化到 +4 价' },
      { id: 'water', type: 'label3', hidden: true, x: 0, y: -1.05, z: 0, text: '4 个 H 进入水中 → 2H₂O', style: { color: '#2f6df6' } },
      { id: 'ea', type: 'label3', hidden: true, x: -1.0, y: 0.45, z: 0, text: '失 6e⁻', style: { color: '#dc2626' } },
      { id: 'eb', type: 'label3', hidden: true, x: 1.0, y: 0.45, z: 0, text: '失 6e⁻', style: { color: '#dc2626' } },
      { id: 'punch', type: 'label3', hidden: true, x: 0, y: -1.45, z: 0, text: '产物是气体 CO₂ ⇒ 不能用来除杂', style: { color: '#dc2626' } },
    ],
    steps: [
      {
        title: '先看清乙烯长什么样',
        detail: '6 个原子共平面，键角约 120°（碳是 sp² 杂化）。C=C 里有 1 根 σ 键和 1 根 π 键——π 键的电子云裸露在分子平面的上下方，是整个分子最「软」的地方。可以拖动旋转，确认它确实是平的。',
        formula: 'C₂H₄：平面形，∠HCH ≈ ∠HCC ≈ 120°',
        show: ['ang'], focus: ['c1', 'c2', 'db', 'ang'],
      },
      {
        title: 'π 键是反应的入口',
        detail: '溴水来了，π 键打开、两个 Br 各接一个碳——这是加成，碳链完好。但酸性 KMnO₄ 是强氧化剂，它不满足于只打开 π 键，而是要把整根 C=C 拆掉。同样是「使溶液褪色」，两条路完全不同。',
        formula: '加成：π 键打开，碳链保留　／　氧化：C=C 整根断裂',
        key: true, focus: ['db'],
      },
      {
        title: 'C=C 断裂',
        detail: '碳碳双键消失了。此时两个碳原子彼此不再相连，各自独立面对氧化剂——这一步是理解「为什么产物是两个 CO₂ 而不是一个有机物」的关键。',
        formula: 'CH₂=CH₂ → 两个互不相连的碳',
        hide: ['db'], show: ['cut'], focus: ['cut'],
      },
      {
        title: '每个碳都被氧化成 CO₂',
        detail: '注意看：这两个碳就是原来乙烯里的那两个碳，只是被拉开了。每个碳结合两个氧成为 CO₂，化合价从 −2 一路升到 +4；四个氢则进入水中。这也解释了为什么乙烯的碳「全部」变成 CO₂——因为两端都是端位碳。',
        formula: 'C：−2 → +4，每个碳失 6e⁻',
        key: true,
        hide: ['h1', 'h2', 'h3', 'h4', 'hb', 'cut', 'ang', 'lbl_eth'],
        show: ['oa1', 'oa2', 'ob1', 'ob2', 'cob', 'lbl_prod', 'water'],
        set: { c1: { x: -1.0 }, c2: { x: 1.0 } },
        focus: ['cob'],
      },
      {
        title: '电子守恒定系数',
        detail: '一个 C₂H₄ 有两个碳，共失 12 个电子；MnO₄⁻ 里的 Mn 从 +7 降到 +2，每个得 5 个电子。12 与 5 互质，最小公倍数 60 ⇒ 5 个 C₂H₄ 配 12 个 KMnO₄。两个关键系数一定，其余靠原子守恒补齐。',
        formula: '5C₂H₄ + 12KMnO₄ + 18H₂SO₄ = 10CO₂↑ + 12MnSO₄ + 6K₂SO₄ + 28H₂O',
        key: true, show: ['ea', 'eb'], focus: ['ea', 'eb'],
      },
      {
        title: '常考陷阱：除杂还是鉴别',
        detail: '产物 CO₂ 是气体——所以酸性 KMnO₄ 不能用来除去乙烷中的乙烯（除掉一个杂质又混进一个杂质）。除杂只能用溴水（乙烯加成被吸收，乙烷不反应）；若只是要鉴别乙烷与乙烯，两种试剂都可以。',
        formula: '除杂 → 溴水　　鉴别 → 溴水或酸性 KMnO₄ 均可',
        show: ['punch'], focus: ['punch'],
      },
    ],
  },
}

/** 演示：太阳光照图——同一张图换直射点纬度，读出三个节气。 */
const GEO_SUNLIGHT = {
  id: 'geo-sunlight-altitude',
  question: '读太阳光照图：判断节气与极昼范围，计算北京（40°N）与悉尼（34°S）的正午太阳高度。',
  scene: {
    kind: 'globe3d',
    title: '太阳光照图：极昼极夜与正午太阳高度',
    subject: 'geography',
    topic: '地球的运动',
    caption: '同一张图只换直射点纬度 δ，就能读出三个节气（可拖动旋转地球）',
    view: { yaw: -30, pitch: 16 },
    objects: [
      { id: 'earth', type: 'globe', declination: -23.5, label: '冬至日（12 月 22 日前后）' },
      { id: 'rays', type: 'sunray', n: 5, label: '太阳光' },
      { id: 'spolar', type: 'arc', lat: -72, from: -180, to: 180, label: '南极圈内：极昼', hidden: true },
      { id: 'npolar', type: 'arc', lat: 72, from: -180, to: 180, label: '北极圈内：极夜', hidden: true },
      { id: 'bj', type: 'point', lat: 40, lon: 0, label: '北京 40°N', value: 1, hidden: true },
      { id: 'syd', type: 'point', lat: -34, lon: 0, label: '悉尼 34°S', value: 1, hidden: true },
    ],
    steps: [
      {
        title: '第一步：先定直射点纬度',
        detail: '冬至日太阳直射南回归线，即 δ = 23.5°S。图上那个黄点就是直射点，它所在的经线此刻是正午 12 点。所有计算都从这个 δ 开始。',
        formula: 'δ = 23°26′S ≈ −23.5°（南纬记作负）',
        focus: ['earth'],
      },
      {
        title: '第二步：读晨昏线——谁极昼谁极夜',
        detail: '黄色大圆是晨昏线，把地球分成昼半球（亮）与夜半球（暗）。记住：极昼出现在直射点所在的那个半球。现在直射南半球，所以南极圈内全天见太阳（极昼），北极圈内全天不见太阳（极夜）——很多人习惯性写成北极极昼，这里一看图就不会错。',
        formula: '极昼范围：南纬 66.5° ~ 90°　极夜范围：北纬 66.5° ~ 90°',
        show: ['spolar', 'npolar'], focus: ['spolar', 'npolar'],
      },
      {
        title: '第三步：用纬度差算正午太阳高度',
        detail: '公式只有一条：正午太阳高度 = 90° 减去「当地纬度与直射点纬度之差」。北京 40°N 与直射点 23.5°S 一南一北，纬度差要相加：40 + 23.5 = 63.5°。这是整道题最容易错的地方——把南纬记作负值代进绝对值就不会错。图上的数字是引擎按这个公式自己算出来的。',
        formula: 'H = 90° − |φ − δ| = 90° − |40° − (−23.5°)| = 26.5°',
        key: true, show: ['bj'], focus: ['bj'],
      },
      {
        title: '第四步：同一天的悉尼为何很高',
        detail: '悉尼 34°S 与直射点同在南半球，纬度差相减，只有 34 − 23.5 = 10.5°，所以正午太阳高度高达 79.5°。对照北京的 26.5°，规律很清楚：离直射点越近，正午太阳越高。',
        formula: 'H = 90° − |(−34°) − (−23.5°)| = 90° − 10.5° = 79.5°',
        show: ['syd'], focus: ['syd', 'bj'],
      },
      {
        title: '第五步：只换 δ，整张图翻过来',
        detail: '现在只把 δ 从 −23.5° 改成 +23.5°，其余一个字没动：整张光照图翻了过来——极昼跑到北极圈，北京的正午太阳高度变成 73.5°，而悉尼降到 32.5°。图上的数字是自动重算的，公式本身一个字都没改。',
        formula: '北京：90° − |40° − 23.5°| = 73.5°　悉尼：90° − |(−34°) − 23.5°| = 32.5°',
        key: true, hide: ['spolar', 'npolar'],
        set: { earth: { declination: 23.5, label: '夏至日（6 月 22 日前后）' } },
        focus: ['bj', 'syd'],
      },
      {
        title: '第六步：二分日作为第三个坐标',
        detail: '再把 δ 改为 0°：直射赤道，晨昏线正好过南北极点，全球昼夜等长，北京 H = 50°。三个日期一对比就彻底清楚了：正午太阳高度只取决于「当地纬度与直射点纬度的差」。北京一年的三个关键值：26.5° → 50° → 73.5°。',
        formula: '二分日 δ = 0°：北京 H = 90° − 40° = 50°，全球昼夜平分',
        set: { earth: { declination: 0, label: '春分 / 秋分（3 月 21 日 · 9 月 23 日前后）' } },
        focus: ['earth', 'bj'],
      },
    ],
  },
}

/** 演示：平抛运动——三个初速度不同的小球同时落地。 */
const PHYS_PROJECTILE = {
  id: 'physics-projectile',
  question: '小球以 v₀ = 5 m/s 从 h = 20 m 高处水平抛出，求飞行时间、水平射程、落地速度；若 v₀ 加倍会怎样？',
  scene: {
    kind: 'mech2d',
    title: '平抛运动：分解、落地时间与落地速度',
    subject: 'physics',
    topic: '抛体运动',
    caption: '轨迹由引擎按 v₀、g 逐点算出；最后一步按播放键，三个球会同时落地',
    view: { xMin: -4, xMax: 26, yMin: -8, yMax: 24, equal: true, axis: false },
    objects: [
      { id: 'gnd', type: 'ground', y: 0, x1: -4, x2: 26, style: { color: '#61666b' } },
      { id: 'plat', type: 'body', shape: 'rect', x: -1.5, y: 10, w: 3, h: 20, style: { color: '#81858c' } },
      { id: 'ball', type: 'body', shape: 'circle', x: 0, y: 20, r: 0.6, style: { color: '#0f9d8f' } },
      { id: 'v0', type: 'velocity', x: 0, y: 20, angle: 0, mag: 5, scale: 0.55, label: 'v₀=5 m/s', style: { color: '#2f6df6' } },
      { id: 'hdim', type: 'dim', x1: -2.9, y1: 0, x2: -2.9, y2: 20, label: 'h=20 m', style: { color: '#81858c' } },
      { id: 'traj', type: 'path', preset: 'projectile', x: 0, y: 20, value: 5, angle: 0, a: 10, to: 2, hidden: true, style: { color: '#2f6df6', dash: true } },
      { id: 'xdim', type: 'dim', x1: 0, y1: -2.4, x2: 10, y2: -2.4, label: 'x=10 m', hidden: true, style: { color: '#2f6df6' } },
      { id: 'land', type: 'label', x: 10, y: 1.6, text: '落地点', hidden: true },
      { id: 'vx', type: 'velocity', x: 10, y: 0, angle: 0, mag: 5, scale: 0.3, label: 'v₀=5', hidden: true, style: { color: '#2f6df6' } },
      { id: 'vy', type: 'velocity', x: 10, y: 0, angle: -90, mag: 20, scale: 0.3, label: 'v_y=20', hidden: true, style: { color: '#2f6df6' } },
      { id: 'vres', type: 'velocity', x: 10, y: 0, angle: -76, mag: 20.6, scale: 0.3, label: 'v≈20.6 m/s', hidden: true, style: { color: '#dc2626', width: 2.6 } },
      { id: 'ang', type: 'angle', label: 'θ≈76°', r: 2.6, hidden: true, style: { color: '#e08b1a' }, points: [[10, 0], [13.5, 0], [11.5, -6]] },
      { id: 'traj2', type: 'path', preset: 'projectile', x: 0, y: 20, value: 10, angle: 0, a: 10, to: 2, hidden: true, style: { color: '#e08b1a', dash: true } },
      { id: 'traj3', type: 'path', preset: 'projectile', x: 0, y: 20, value: 0, angle: 0, a: 10, to: 2, hidden: true, style: { color: '#16a34a', dash: true } },
      { id: 'note', type: 'label', x: 17, y: 22, text: '三球始终同高、同时落地', hidden: true, style: { color: '#dc2626' } },
    ],
    steps: [
      {
        title: '第一步：标出已知量',
        detail: '「水平抛出」两个关键词：初速度水平，抛出后只受重力。先把已知量标在图上：抛出点高 20 m，初速度 5 m/s 指向水平。',
        formula: 'v₀ = 5 m/s　h = 20 m　g = 10 m/s²',
        focus: ['ball', 'v0', 'hdim'],
      },
      {
        title: '第二步：分解——两个方向各自独立',
        detail: '平抛只有一个解题思路：把运动拆成两个互不影响的方向——水平方向没有力，所以匀速；竖直方向只有重力，所以是自由落体。图上这条抛物线就是引擎按这两个公式逐点算出来的。',
        formula: '水平：x = v₀t（匀速）　竖直：y = ½gt²（自由落体）',
        key: true, show: ['traj'], focus: ['traj'],
      },
      {
        title: '第三步：求时间（只由高度决定）',
        detail: '求时间只能看竖直方向。竖直上它就是一个从 20 m 高处的自由落体，与水平初速度完全无关——公式里根本没有 v₀。这是本题后面几问的基础。',
        formula: 'h = ½gt² ⇒ t = √(2h/g) = √(2×20/10) = 2 s',
        focus: ['hdim'],
      },
      {
        title: '第四步：求水平射程',
        detail: '时间算出来了，带回水平方向即可。注意对照图形：引擎画出的抛物线恰好落在 x = 10 m 处——这条曲线不是画上去的，而是用 v₀ 与 g 逐点算的，所以它可以用来验算答案。',
        formula: 'x = v₀t = 5 × 2 = 10 m',
        show: ['xdim', 'land'], focus: ['xdim', 'land'],
      },
      {
        title: '第五步：求落地速度与方向',
        detail: '落地速度是两个分速度的矢量合成，不能直接相加。图上蓝色是两个分速度（长度比 1:4），红色是合速度。另外提醒：速度偏角 θ≈76° 与位移偏角 α≈63.4° 不是同一个角，两者永远满足 tanθ = 2tanα。',
        formula: 'v_y = gt = 20 m/s　v = √(5²+20²) = √425 ≈ 20.6 m/s　tanθ = 4 ⇒ θ ≈ 76°',
        show: ['vx', 'vy', 'vres', 'ang'], focus: ['vres', 'ang'],
      },
      {
        title: '第六步：改大 v₀——时间不变、射程加倍',
        detail: '现在同时抛出三个球：绿色 v₀=0（自由落体）、蓝色 v₀=5、橙色 v₀=10。按下播放键会看到：三个球始终处在同一水平高度上，并且同时落地，只是飞得远近不同。因为竖直方向的运动完全一样，v₀ 只影响水平位移。',
        formula: 't = √(2h/g) 与 v₀ 无关（仍 2 s）　x = v₀t ∵ v₀ 加倍 ⇒ 射程加倍为 20 m',
        key: true, hide: ['vx', 'vy', 'vres', 'ang', 'xdim', 'land'],
        show: ['traj2', 'traj3', 'note'], focus: ['traj2', 'traj3', 'note'],
      },
    ],
  },
}


/** 演示：气温降水图判读——三步定出地中海气候（地理 · 过程曲线） */
const GEO_CLIMATE = {
  id: "geo-climate-chart",
  question: "读某地各月气温与降水量图：判断半球、气候类型、分布规律与成因。",
  scene: {
    kind: "chart2d",
    title: "气温降水图判读：三步定出地中海气候",
    subject: "geography",
    topic: "气候类型判别与成因",
    caption: "三步定案：看气温定半球 → 看最冷月定温带 → 看降水季节分配定类型",
    view: { xMin: 0.2, xMax: 12.8, yMin: -5, yMax: 30, xLabel: "月份", yLabel: "气温℃（降水 mm = ×10）" },
    objects: [
      {
        id: "rain",
        type: "bar",
        label: "降水量",
        w: 0.62,
        data: [
          [1,8],
          [2,7.5],
          [3,6.5],
          [4,5.5],
          [5,4],
          [6,2],
          [7,1.5],
          [8,2.5],
          [9,7],
          [10,11],
          [11,11.5],
          [12,10]
        ],
        style: { color: "#2f6df6", opacity: 0.7 }
      },
      {
        id: "temp",
        type: "series",
        label: "气温",
        shape: "line-dots",
        data: [
          [1,8],
          [2,9],
          [3,11],
          [4,14],
          [5,18],
          [6,22],
          [7,25],
          [8,25],
          [9,22],
          [10,17],
          [11,12],
          [12,9]
        ],
        style: { color: "#dc2626", width: 2.4 }
      },
      { id: "hot", type: "marker", label: "最热月 7—8月 25℃", hidden: true, x: 7.5, y: 25, style: { color: "#dc2626" } },
      { id: "cold", type: "marker", label: "最冷月 1月 8℃", hidden: true, x: 1, y: 8, style: { color: "#2f6df6" } },
      { id: "l15", type: "hline", label: "15℃", hidden: true, y: 15, style: { color: "#e08b1a" } },
      { id: "l0", type: "hline", label: "0℃", hidden: true, y: 0, style: { color: "#81858c" } },
      {
        id: "zone",
        type: "label",
        text: "最冷月在 0~15℃ 之间 ⇒ 亚热带",
        hidden: true,
        x: 4.4,
        y: 11.6,
        style: { color: "#e08b1a", size: 12 }
      },
      {
        id: "summer",
        type: "region",
        label: "夏季降水极少",
        hidden: true,
        x1: 5.5,
        y1: -3,
        x2: 8.5,
        y2: 28,
        style: { color: "#e08b1a", opacity: 0.16 }
      },
      {
        id: "winter1",
        type: "region",
        label: "冬季多雨",
        hidden: true,
        x1: 0.4,
        y1: -3,
        x2: 2.5,
        y2: 28,
        style: { color: "#2f6df6", opacity: 0.14 }
      },
      {
        id: "winter2",
        type: "region",
        hidden: true,
        x1: 11.5,
        y1: -3,
        x2: 12.6,
        y2: 28,
        style: { color: "#2f6df6", opacity: 0.14 }
      },
      {
        id: "verdict",
        type: "label",
        text: "夏干冬雨 ⇒ 地中海气候",
        hidden: true,
        x: 7,
        y: -3.6,
        style: { color: "#dc2626", size: 13 }
      },
      {
        id: "cause",
        type: "label",
        text: "夏：副高控制，下沉→干燥　冬：西风带影响→湿潪",
        hidden: true,
        x: 6.6,
        y: 28.6,
        style: { color: "#61666b", size: 11.5 }
      }
    ],
    steps: [
      {
        title: "第一步：先读懂两条曲线",
        detail: "这类图上有两套数据：**蓝色柱是降水（mm）、红色线是气温（℃）**。按教材惯例，温度轴 1℃ 对应降水 10mm——所以图上 8 格高的柱子代表 80mm 降水。先把两套数据分清楚，再动手判断。",
        formula: "左轴：气温 ℃　右轴（隐含）：降水 mm = ℃ × 10",
        key: false,
        focus: ["rain","temp"]
      },
      {
        title: "第二步：定半球——看气温最高月",
        detail: "定半球**只看气温，不看降水**。气温最高出现在 7、8 月，最低在 1 月——七八月是北半球的夏季，所以该地在北半球。很多人习惯性先去找雨季，结果第一步就错了。",
        formula: "7、8 月温高 ⇒ 北半球（1、2 月温高则为南半球）",
        key: true,
        show: ["hot","cold"],
        focus: ["hot","cold"]
      },
      {
        title: "第三步：定温带——只看最冷月",
        detail: "定温带**只看最冷月**，不看年均温。1 月约 8℃，落在 0℃ 与 15℃ 两条线之间，所以是亚热带。判据记牢：>15℃ 热带；0~15℃ 亚热带或温带海洋性；−15~0℃ 温带；<−15℃ 寒带。",
        formula: "最冷月 8℃ ∈ (0℃, 15℃) ⇒ 亚热带",
        key: true,
        show: ["l15","l0","zone"],
        focus: ["cold","zone"]
      },
      {
        title: "第四步：定类型——看雨季落在哪个季节",
        detail: "关键一步。看柱子：夏季 6—8 月降水最少（局部 15~25mm），冬季 12—2 月反而最多（近 80~115mm）——**夏干冬雨**。十二种气候里只有地中海气候长这个样，这就是它的身份证。",
        formula: "亚热带 + 夏干冬雨 ⇒ 地中海气候",
        key: true,
        show: ["summer","winter1","winter2","verdict"],
        focus: ["summer","winter1","verdict"]
      },
      {
        title: "第五步：分布与成因",
        detail: "分布在南北纬 30°~40° 大陆西岸。成因是**气压带与风带的季节移动**：夏季整体北移，该地落入副热带高气压带，气流下沉、炎热干燥；冬季整体南移，该地落入西风带，温和湿潪。这也解释了为何它只出现在这个纬度带的西岸。",
        formula: "夏：副热高控制　冬：西风带控制",
        key: false,
        show: ["cause"],
        focus: ["cause"]
      },
      {
        title: "易错对比：别和亚热带季风搞反",
        detail: "**亚热带季风气候**的最冷月也在 0~15℃，光看温带两者分不出来；但它是**夏雨冬干**（雨季在 6—9 月），与地中海气候正好相反。所以第四步那个「雨季落在哪个季节」不能省。农业上本地以柑橘、油橄榄、葡萄等亚热带水果为特色。",
        formula: "地中海：夏干冬雨　亚热季风：夏雨冬干",
        key: true,
        focus: ["summer","winter1"]
      }
    ]
  },
}

/** 演示：议论文递进式论证骨架（语文 · 示意图） */
const CHINESE_ARGUMENT = {
  id: "chinese-argument-skeleton",
  question: "【2024 新高考 I 卷】答案越来越易得，我们的问题是否会越来越少？——写出立意层次、递进式骨架与可用论据。",
  scene: {
    kind: "diagram2d",
    title: "议论文论证骨架：《答案易得，问题难求》",
    subject: "chinese",
    topic: "议论文结构与素材",
    caption: "递进式骨架：先让一步，再翻过来，最后升到价值层",
    view: { xMin: 0, xMax: 100, yMin: 0, yMax: 66 },
    objects: [
      { id: "m0", type: "box", text: "材料：答案越来越易得，问题是否会越来越少？", x: 40, y: 58, w: 46, h: 7, style: { color: "#81858c" } },
      { id: "b1", type: "box", text: "引｜亮出中心论点\n答案易得，问题难求", x: 40, y: 47, w: 40, h: 8, style: { color: "#2f6df6" } },
      {
        id: "b2",
        type: "box",
        text: "承｜先承认：答案确实前所未有地易得",
        hidden: true,
        x: 40,
        y: 37,
        w: 40,
        h: 8,
        style: { color: "#16a34a" }
      },
      {
        id: "b3",
        type: "box",
        text: "转｜但问题不会减少\n每个答案都推开新的边界",
        hidden: true,
        x: 40,
        y: 27,
        w: 40,
        h: 8,
        style: { color: "#e08b1a" }
      },
      {
        id: "b4",
        type: "box",
        text: "深｜提问权不可让渡\n问题是人的困惑与在意",
        hidden: true,
        x: 40,
        y: 17,
        w: 40,
        h: 8,
        style: { color: "#dc2626" }
      },
      { id: "b5", type: "box", text: "结｜落到“我们应当怎么做”", hidden: true, x: 40, y: 7, w: 40, h: 7, style: { color: "#8b5cf6" } },
      { id: "a01", type: "arrow", hidden: true, of: "m0", target: "b1", style: { color: "#81858c" } },
      { id: "a12", type: "arrow", hidden: true, of: "b1", target: "b2", style: { color: "#61666b" } },
      {
        id: "a23",
        type: "arrow",
        text: "转折",
        hidden: true,
        of: "b2",
        target: "b3",
        style: { color: "#e08b1a", width: 2.2 }
      },
      {
        id: "a34",
        type: "arrow",
        text: "升维",
        hidden: true,
        of: "b3",
        target: "b4",
        style: { color: "#dc2626", width: 2.2 }
      },
      { id: "a45", type: "arrow", hidden: true, of: "b4", target: "b5", style: { color: "#61666b" } },
      {
        id: "e1",
        type: "box",
        text: "开普勒问“为何是椭圆”\n→ 牛顿问“为何遵此律”",
        hidden: true,
        x: 81,
        y: 30,
        w: 30,
        h: 6.5,
        style: { color: "#e08b1a" }
      },
      {
        id: "e2",
        type: "box",
        text: "AlphaFold 解了折叠\n→ 又开“设计新蛋白”",
        hidden: true,
        x: 81,
        y: 22,
        w: 30,
        h: 6.5,
        style: { color: "#e08b1a" }
      },
      {
        id: "e3",
        type: "box",
        text: "屈原《天问》170 余问\n不得一答而成典范",
        hidden: true,
        x: 81,
        y: 13,
        w: 30,
        h: 6.5,
        style: { color: "#dc2626" }
      },
      {
        id: "e4",
        type: "box",
        text: "苏格拉底：自知无知\n以追问为方法",
        hidden: true,
        x: 81,
        y: 5,
        w: 30,
        h: 6.5,
        style: { color: "#dc2626" }
      },
      { id: "ae1", type: "arrow", hidden: true, of: "e1", target: "b3", style: { color: "#e08b1a", dash: true } },
      { id: "ae2", type: "arrow", hidden: true, of: "e2", target: "b3", style: { color: "#e08b1a", dash: true } },
      { id: "ae3", type: "arrow", hidden: true, of: "e3", target: "b4", style: { color: "#dc2626", dash: true } },
      { id: "ae4", type: "arrow", hidden: true, of: "e4", target: "b4", style: { color: "#dc2626", dash: true } },
      { id: "m1", type: "text", text: "先立后破", hidden: true, x: 10, y: 37, style: { color: "#16a34a", size: 11 } },
      { id: "m2", type: "text", text: "因果+举例", hidden: true, x: 10, y: 27, style: { color: "#e08b1a", size: 11 } },
      {
        id: "m3",
        type: "text",
        text: "事实层→价值层\n（拉分处）",
        hidden: true,
        x: 10,
        y: 17,
        style: { color: "#dc2626", size: 11.5 }
      },
      {
        id: "tip",
        type: "text",
        text: "材料是“是否”疑问句 ⇒ 用递进式，不用并列式",
        hidden: true,
        x: 40,
        y: 63,
        style: { color: "#61666b", size: 11.5 }
      }
    ],
    steps: [
      {
        title: "审题：抄住那组对立概念",
        detail: "材料的张力在两个词上：“答案”与“问题”。它问的是数量（会不会变少），但真正可写的是两者的**性质差别**——答案可以检索，问题只能自己提。审题第一步就是找到这组对立概念，而不是满脑子 AI。",
        formula: "核心概念对：可检索的答案　vs　只能自求的问题",
        key: false,
        show: ["tip"],
        focus: ["m0"]
      },
      {
        title: "立意：从“数量”跳到“性质”",
        detail: "三层台阶：平庸的写“问题不会变少”（只是把材料反面重说一遍）；中等的写“答案多了、问题也多了”（讲出了因果）；优秀的把讨论推到“提问能力与人的主体性”。标题就把立意抬出来：答案易得，问题难求。",
        formula: "立意 = 在材料的问题上再进一层，而不是回答是/否",
        key: true,
        show: ["a01"],
        focus: ["b1"]
      },
      {
        title: "骨架：递进式五步",
        detail: "材料是一个“是否”疑问句，天然适合**递进式**（承认—转折—深化），而不是并列三个分论点。并列式容易写成三段话重复一个意思；递进式才能把“辨析”做出来。",
        formula: "引 → 承 → 转 → 深 → 结",
        key: true,
        show: ["b2","b3","b4","b5","a12","a23","a34","a45"],
        focus: ["b2","b3","b4","b5"]
      },
      {
        title: "承与转：先立后破，再举证",
        detail: "先让一步：大方承认技术确实让答案前所未有地易得——这叫先立后破，后面的转折才有力量。然后用两个例子把“答案生出新问题”的因果链打通：开普勒算出椭圆轨道，紧接着的新问题是“为何遵守这个律”，那才逆出牛顿。",
        formula: "承认对方合理处 → 再指出它不充分",
        key: false,
        show: ["e1","e2","ae1","ae2","m1","m2"],
        focus: ["b2","b3","e1","e2"]
      },
      {
        title: "深化：把“问题”重新定义",
        detail: "这一段是拉开分数的地方。前面还在比“多与少”，这里把“问题”**重新定义**：它不是信息的缺口，而是人的困惑与在意。于是论题从事实层（会不会变少）升到价值层（该不该把提问权交出去）。《天问》与苏格拉底都是“无答案但有价值”的铁证。",
        formula: "问题 ≠ 信息的缺口；问题 = 人的在意",
        key: true,
        show: ["e3","e4","ae3","ae4","m3"],
        focus: ["b4","e3","e4","m3"]
      },
      {
        title: "结：落到行动，并可迁移",
        detail: "结尾不能只喊口号，要落到“我们”的行动：学会与答案相处，并保有追问的姿态。这套写法可以直接搬到其它“是否”型材料：先承认 → 再翻转 → 重新定义关键词 → 落到行动。",
        formula: "可迁移模板：承认 → 翻转 → 重定义 → 行动",
        key: false,
        focus: ["b5"]
      }
    ]
  },
}

/** 演示：阅读理解题文对应——四类题各自看哪里（英语 · 示意图） */
const ENGLISH_READING = {
  id: "english-reading-mapping",
  question: "高考英语阅读理解：细节题、推理题、猜词题、主旨题各自该回原文的哪个位置？",
  scene: {
    kind: "diagram2d",
    title: "阅读理解题文对应：四类题各自看哪里",
    subject: "english",
    topic: "阅读理解（细节·推断·主旨·猜词）",
    caption: "四类题 = 四种「离原文的距离」：细节贴着句子，推理跳一步，猜词看上下文，主旨看结构",
    view: { xMin: 0, xMax: 100, yMin: 0, yMax: 63 },
    objects: [
      { id: "p1", type: "box", text: "① 引入现象：人人反复读笔记，感觉很有效", x: 28, y: 50, w: 42, h: 8, style: { color: "#81858c" } },
      {
        id: "p2",
        type: "box",
        text: "② 实验：一组重读 / 一组回忆默写\n五分钟后重读组略优，一周后反转",
        x: 28,
        y: 39,
        w: 42,
        h: 8,
        style: { color: "#2f6df6" }
      },
      { id: "p3", type: "box", text: "③ 解释：流畅感骗了他们\n回忆难，而难正是关键", x: 28, y: 28, w: 42, h: 8, style: { color: "#e08b1a" } },
      { id: "p4", type: "box", text: "④ 启示：合上书、自问、分散到多天", x: 28, y: 17, w: 42, h: 8, style: { color: "#16a34a" } },
      {
        id: "whole",
        type: "box",
        text: "全文结构：现象 → 实验 → 反转 → 主张",
        hidden: true,
        x: 28,
        y: 5,
        w: 42,
        h: 7,
        style: { color: "#8b5cf6" }
      },
      { id: "q1", type: "box", text: "第1题　细节理解", hidden: true, x: 80, y: 44, w: 34, h: 7, style: { color: "#2f6df6" } },
      { id: "q2", type: "box", text: "第2题　推理判断", hidden: true, x: 80, y: 32, w: 34, h: 7, style: { color: "#e08b1a" } },
      { id: "q3", type: "box", text: "第3题　词义猜测", hidden: true, x: 80, y: 20, w: 34, h: 7, style: { color: "#16a34a" } },
      { id: "q4", type: "box", text: "第4题　主旨标题", hidden: true, x: 80, y: 6, w: 34, h: 7, style: { color: "#8b5cf6" } },
      {
        id: "a1",
        type: "arrow",
        text: "定位一句",
        hidden: true,
        of: "q1",
        target: "p2",
        style: { color: "#2f6df6", dash: true }
      },
      {
        id: "a2",
        type: "arrow",
        text: "跳一步",
        hidden: true,
        of: "q2",
        target: "p3",
        style: { color: "#e08b1a", dash: true }
      },
      {
        id: "a3",
        type: "arrow",
        text: "看上下文",
        hidden: true,
        of: "q3",
        target: "p4",
        style: { color: "#16a34a", dash: true }
      },
      {
        id: "a4",
        type: "arrow",
        text: "看结构",
        hidden: true,
        of: "q4",
        target: "whole",
        style: { color: "#8b5cf6", dash: true }
      },
      {
        id: "trap",
        type: "text",
        text: "干扰项四套路：无关项・相反项・过度推断・以偏概全",
        hidden: true,
        x: 50,
        y: 57,
        style: { color: "#dc2626", size: 11 }
      },
      {
        id: "flow",
        type: "text",
        text: "通用流程：读题干定题型 → 回原文定位 → 比对同义改写 → 逐项排干扰",
        hidden: true,
        x: 50,
        y: 60.5,
        style: { color: "#61666b", size: 11 }
      }
    ],
    steps: [
      {
        title: "第一遍：只标段落功能，不逐词读",
        detail: "高考阅读不是逐词翻译。第一遍只做一件事：搞清每段在干什么。这篇是典型的科普说明文四段式：提现象 → 举实验 → 给解释 → 落启示。把这四个功能标出来，后面四道题就知道去哪段找。",
        formula: "科普说明文常规骨架：现象 → 实验 → 解释 → 启示",
        key: false,
        focus: ["p1","p2","p3","p4"]
      },
      {
        title: "细节题：贴着原文一句",
        detail: "题干里的 five minutes after 是定位词，直接回第二段找到“Five minutes later, the rereaders performed slightly better”。细节题的答案就是这句的**同义改写**，多推一步就错。注意选项 B 把两个时间点的结果调了个头——这是“相反项”。",
        formula: "细节题：题干定位词 → 原文一句 → 同义改写",
        key: true,
        show: ["q1","a1"],
        focus: ["q1","p2"]
      },
      {
        title: "推理题：只能跳一步",
        detail: "问“为何仍在重读”，原文没有直接回答，但第三段说了“Fluency had fooled them… took that ease as evidence of learning”。从“读得顺就以为学会了”到“所以他们继续重读”，只跳了一步——这就是推理题的尺度。**跳两步就叫过度推断**，比如把“重读不高效”读成“重读没用”。",
        formula: "推理题：有原文依据 + 只跳一步",
        key: true,
        show: ["q2","a2"],
        focus: ["q2","p3"]
      },
      {
        title: "猜词题：不靠背过的词义",
        detail: "unglamorous 背不背得过都不要紧，后文就是解释：“None of this is pleasant, and none of it will make you feel clever”——不让人舒服、不让人显得聊明 ⇒ 不光鲜、不吸引人。猜词线索只有三类：后文解释、并列同义、因果与对比。",
        formula: "猜词题：答案永远在上下文，不在单词表里",
        key: false,
        show: ["q3","a3"],
        focus: ["q3","p4"]
      },
      {
        title: "主旨题：靠结构，不靠句子",
        detail: "主旨题要回到四段的整体走向：文章不是为了介绍一个实验，而是为了主张“少读多测”。标题三标准：覆盖全文、点明主张、不过窄不过宽。“A Classic Experiment in Psychology”过窄（实验只是论据），这就是“以偏概全”型干扰。",
        formula: "主旨题：看段落结构，不看某一句",
        key: true,
        show: ["whole","q4","a4"],
        focus: ["q4","whole"]
      },
      {
        title: "总结：四种距离与四套干扰",
        detail: "四条虚线把四类题各自的“离原文距离”画清楚了：越往下，允许离原文越远。做题时先用题干定题型，就知道自己该贴多紧。干扰项则只有四套路，认熟了就能反向排除。",
        formula: "读题干定题型 → 回原文定位 → 比对同义改写 → 逐项排干扰",
        key: false,
        show: ["trap","flow"],
        focus: ["a1","a2","a3","a4","trap"]
      }
    ]
  },
}

/** 展示用演示集（顺序即画廊顺序）。 */
export const SHOWCASE = [
  GEOM_PERPENDICULAR,
  PHYS_PROJECTILE,
  CHEM_ETHYLENE,
  GEO_SUNLIGHT,
  GEO_CLIMATE,
  CHINESE_ARGUMENT,
  ENGLISH_READING,
]

/**
 * 按 id 取一份展示演示（深拷贝）。
 * @param {string} id 演示 id。
 * @returns {object|null} 演示。
 */
export function showcaseOf(id) {
  const found = SHOWCASE.find((s) => s.id === id)
  return found ? JSON.parse(JSON.stringify(found)) : null
}
