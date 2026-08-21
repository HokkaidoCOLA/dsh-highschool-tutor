// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 内置起始卡片包（六科高频必背）。
 *
 * 空题库对间隔复习没有意义，所以插件自带一套「开箱即用」的核心卡片：
 * 每科 9~10 张，全是三年反复用到的公式、判定规律、答题口径与必背名句。
 * 通过设置页的「导入内置卡片包」或 POST /seed 一键写入；每张卡带 seedKey，
 * 重复导入只会更新、不会产生重复条目。
 *
 * 这些卡片只是起点——真正的主力内容来自你自己的错题（模型在对话里随手
 * 调用 tutor_add_items 写入）与导入的 Markdown/CSV/Anki 文件。
 *
 * @module dsh-highschool-tutor/seed
 */

/**
 * 起始卡片包。
 * @type {Array<{subject: string, topic: string, question: string, answer: string, explanation?: string, tags?: string[], difficulty?: number}>}
 */
export const SEED_CARDS = [
  // ── 数学 ────────────────────────────────────────────────────────────────
  { subject: 'math', topic: '一元二次函数、方程和不等式', question: '韦达定理：方程 ax²+bx+c=0（a≠0）两根 x₁、x₂ 的和与积分别是？', answer: 'x₁+x₂ = −b/a，x₁·x₂ = c/a', explanation: '判别式 Δ=b²−4ac 决定根的情况：Δ>0 两不等实根，Δ=0 重根，Δ<0 无实根。常用于「不解方程求对称式」。', tags: ['公式', '必背'] },
  { subject: 'math', topic: '三角函数', question: '两角和差公式：sin(α±β)、cos(α±β)、tan(α±β) 各是什么？', answer: 'sin(α±β)=sinαcosβ±cosαsinβ；cos(α±β)=cosαcosβ∓sinαsinβ；tan(α±β)=(tanα±tanβ)/(1∓tanαtanβ)', explanation: 'cos 的符号与括号内相反（「余弦变号」），tan 分母符号也相反。', tags: ['公式', '必背'] },
  { subject: 'math', topic: '三角函数', question: '二倍角公式 cos2α 的三种等价形式？', answer: 'cos2α = cos²α − sin²α = 2cos²α − 1 = 1 − 2sin²α', explanation: '后两式反过来就是降幂公式：cos²α=(1+cos2α)/2，sin²α=(1−cos2α)/2，化简三角函数式的第一步。', tags: ['公式', '降幂'] },
  { subject: 'math', topic: '三角函数与解三角形', question: '正弦定理与余弦定理的标准形式？', answer: 'a/sinA = b/sinB = c/sinC = 2R；a² = b²+c²−2bc·cosA', explanation: '已知两角一边或两边及一边对角 → 正弦定理；已知两边夹角或三边 → 余弦定理。面积 S=½ab·sinC。', tags: ['公式', '解三角形'] },
  { subject: 'math', topic: '数列', question: '等差数列与等比数列的前 n 项和公式？', answer: 'Sₙ = n(a₁+aₙ)/2 = na₁ + n(n−1)d/2；等比 q≠1 时 Sₙ = a₁(1−qⁿ)/(1−q)', explanation: '等比求和必须先讨论 q=1，这是最常见的扣分点。', tags: ['公式', '易错'] },
  { subject: 'math', topic: '一元函数的导数及其应用', question: '常用导数公式：(xⁿ)′、(sin x)′、(cos x)′、(eˣ)′、(ln x)′、(aˣ)′？', answer: 'nx^(n−1)；cos x；−sin x；eˣ；1/x；aˣ·ln a', explanation: '再配合乘法法则 (uv)′=u′v+uv′ 与商法则 (u/v)′=(u′v−uv′)/v²。', tags: ['公式', '必背'] },
  { subject: 'math', topic: '一元二次函数、方程和不等式', question: '基本不等式 a+b ≥ 2√(ab) 的使用条件与「一正二定三相等」是什么意思？', answer: '条件 a>0, b>0；一正（各项为正）、二定（和或积为定值）、三相等（能取到 a=b）', explanation: '取不到等号时要改用单调性或换元法；这是求最值题的经典陷阱。', tags: ['易错', '最值'] },
  { subject: 'math', topic: '圆锥曲线的方程', question: '椭圆 x²/a²+y²/b²=1（a>b>0）的 a、b、c 关系与离心率？', answer: 'c² = a² − b²，离心率 e = c/a ∈ (0,1)', explanation: '双曲线是 c²=a²+b²、e>1；抛物线 y²=2px 的焦点 (p/2, 0)、准线 x=−p/2。三者不要混。', tags: ['公式', '易错'] },
  { subject: 'math', topic: '计数原理', question: '二项式定理的通项公式是什么？', answer: '(a+b)ⁿ 的通项 T_{k+1} = C(n,k)·a^(n−k)·b^k（k=0,1,…,n）', explanation: '求常数项/特定次数项都靠这个通项列方程；注意「第 k+1 项」的编号。', tags: ['公式', '易错'] },
  { subject: 'math', topic: '随机变量及其分布', question: '条件概率与全概率公式？', answer: 'P(B|A)=P(AB)/P(A)；P(B)=ΣP(Aᵢ)P(B|Aᵢ)', explanation: '再加贝叶斯公式 P(Aᵢ|B)=P(Aᵢ)P(B|Aᵢ)/P(B)。二项分布 E(X)=np，D(X)=np(1−p)。', tags: ['公式', '概率'] },

  // ── 物理 ────────────────────────────────────────────────────────────────
  { subject: 'physics', topic: '匀变速直线运动的研究', question: '匀变速直线运动的三个基本公式？', answer: 'v = v₀+at；x = v₀t + ½at²；v² − v₀² = 2ax', explanation: '再加平均速度 v̄=(v₀+v)/2=x/t，以及连续相等时间间隔内位移差 Δx=aT²（纸带实验求 a 的依据）。', tags: ['公式', '必背'] },
  { subject: 'physics', topic: '运动和力的关系（牛顿运动定律）', question: '牛顿第二定律的表达式与三条使用要点？', answer: 'F合 = ma；① 加速度方向与合力方向始终相同 ② 对每个物体单独受力分析 ③ 正交分解沿加速度方向列方程', explanation: '连接体问题优先整体法求加速度、隔离法求内力。超重失重看的是加速度方向，不是速度方向。', tags: ['必背', '易错'] },
  { subject: 'physics', topic: '抛体运动', question: '平抛运动如何分解，落地时间由什么决定？', answer: '水平方向匀速 x=v₀t；竖直方向自由落体 y=½gt²；落地时间只由高度 h 决定：t=√(2h/g)', explanation: '合速度方向 tanθ=v_y/v₀=gt/v₀，位移方向 tanα=y/x=gt/(2v₀)，所以 tanθ=2tanα。', tags: ['公式', '易错'] },
  { subject: 'physics', topic: '万有引力与宇宙航行', question: '卫星环绕的基本方程与第一宇宙速度？', answer: 'GMm/r² = mv²/r = mω²r = m(4π²/T²)r；第一宇宙速度 v₁ ≈ 7.9 km/s', explanation: '「黄金代换」GM=gR²。轨道半径越大，v 越小、T 越大。同步卫星只能在赤道上方约 3.6×10⁴ km。', tags: ['公式', '必背'] },
  { subject: 'physics', topic: '机械能守恒定律', question: '动能定理与机械能守恒的条件分别是什么？', answer: '动能定理：W合 = ΔEk = ½mv² − ½mv₀²（对一切过程成立）；机械能守恒条件：只有重力或弹力做功', explanation: '有摩擦时用能量守恒：Q=f·s相对。功能关系是力学大题的通用突破口。', tags: ['必背', '易错'] },
  { subject: 'physics', topic: '动量守恒定律', question: '动量定理与动量守恒定律的表达式与适用条件？', answer: '动量定理 F·t = Δp = mv′ − mv；动量守恒条件：系统合外力为零（或碰撞瞬间内力远大于外力）', explanation: '完全弹性碰撞动能也守恒；完全非弹性碰撞碰后同速。爆炸、反冲、碰撞一律先想动量守恒。', tags: ['必背'] },
  { subject: 'physics', topic: '静电场中的能量', question: '匀强电场中 E、U、d 的关系与电场力做功公式？', answer: 'E = U/d（d 为沿场强方向的距离）；W = qU；电势能 Ep = qφ', explanation: '电场力做功只与初末位置电势差有关，与路径无关。沿电场线方向电势降低。', tags: ['公式'] },
  { subject: 'physics', topic: '电磁感应', question: '法拉第电磁感应定律的两种形式与楞次定律口诀？', answer: 'E = n·ΔΦ/Δt（平均）；E = BLv（导体棒切割，v⊥B⊥L）；楞次定律「增反减同」', explanation: '感应电流的磁场总是阻碍原磁通量变化；配合右手定则判方向、安培力方向恒阻碍相对运动。', tags: ['必背', '易错'] },
  { subject: 'physics', topic: '电路及其应用', question: '闭合电路欧姆定律与电源效率？', answer: 'E = U外 + I·r，即 I = E/(R+r)；效率 η = U外/E = R/(R+r)', explanation: '外电阻 R=r 时电源输出功率最大（P_max=E²/4r），但此时效率仅 50%。', tags: ['公式'] },
  { subject: 'physics', topic: '机械振动', question: '单摆与弹簧振子的周期公式？', answer: '单摆 T = 2π√(L/g)；弹簧振子 T = 2π√(m/k)', explanation: '单摆周期与摆球质量、振幅无关（小角度）；简谐运动 F=−kx，加速度与位移反向。', tags: ['公式', '必背'] },

  // ── 化学 ────────────────────────────────────────────────────────────────
  { subject: 'chemistry', topic: '物质及其变化', question: '物质的量 n 与质量、微粒数、气体体积、浓度的换算关系？', answer: 'n = m/M = N/N_A = V/V_m（标准状况 V_m=22.4 L/mol）= c·V(溶液)', explanation: '22.4 L/mol 只在标准状况（0 ℃、101 kPa）且为气体时成立——这是最高频的陷阱。', tags: ['公式', '易错'] },
  { subject: 'chemistry', topic: '物质及其变化', question: '氧化还原反应的「升失氧还」口诀完整含义？', answer: '化合价升高 → 失电子 → 被氧化 → 发生氧化反应 → 作还原剂；降低则反之', explanation: '配平用电子守恒：氧化剂得电子总数 = 还原剂失电子总数。强弱比较：氧化性 氧化剂>氧化产物。', tags: ['必背', '易错'] },
  { subject: 'chemistry', topic: '离子共存与离子方程式', question: '书写离子方程式时哪些物质不能拆成离子？', answer: '弱电解质（弱酸弱碱水）、沉淀、气体、氧化物、单质，以及浓硫酸、微溶物作反应物时的处理', explanation: '检查三件事：电荷守恒、原子守恒、是否符合客观事实（如 Fe 与稀硝酸不能只生成 Fe²⁺）。', tags: ['易错', '大题'] },
  { subject: 'chemistry', topic: '物质结构 元素周期律', question: '同周期、同主族元素性质的递变规律？', answer: '同周期从左到右：原子半径减小，金属性减弱、非金属性增强；同主族从上到下：半径增大，金属性增强', explanation: '判断依据：最高价氧化物对应水化物的酸碱性、单质与水/酸反应剧烈程度、气态氢化物稳定性。', tags: ['必背'] },
  { subject: 'chemistry', topic: '化学反应速率与化学平衡', question: '勒夏特列原理如何表述，哪个因素不影响平衡移动？', answer: '改变影响平衡的一个条件，平衡向减弱这种改变的方向移动；催化剂只改变速率、不移动平衡', explanation: '恒温恒容加入惰性气体也不移动平衡。判断转化率变化时要看是「等效压缩」还是稀释。', tags: ['必背', '易错'] },
  { subject: 'chemistry', topic: '水溶液中的离子反应与平衡', question: '盐类水解规律的口诀？', answer: '有弱才水解，无弱不水解；越弱越水解，都弱都水解；谁强显谁性，同强显中性', explanation: '例：CH₃COONa 显碱性、NH₄Cl 显酸性、NaHCO₃ 水解>电离显碱性、NaHSO₃ 电离>水解显酸性。', tags: ['必背', '易错'] },
  { subject: 'chemistry', topic: '化学反应与电能', question: '原电池与电解池的两极反应类型如何对应？', answer: '原电池：负极氧化（电子流出）、正极还原；电解池：阳极氧化（接电源正极）、阴极还原', explanation: '记忆钩子：不论哪种池子，「阳/负极」都发生氧化。放电顺序：阳极 活性电极>S²⁻>I⁻>Br⁻>Cl⁻>OH⁻。', tags: ['必背', '易错'] },
  { subject: 'chemistry', topic: '化学反应的热效应', question: 'ΔH 的符号规定与盖斯定律？', answer: '放热 ΔH<0，吸热 ΔH>0；反应热只与始末状态有关，可将多个热化学方程式线性组合求目标 ΔH', explanation: '书写热化学方程式必须标注物质状态与 ΔH 单位 kJ/mol，且系数改变时 ΔH 同倍变化。', tags: ['公式', '大题'] },
  { subject: 'chemistry', topic: '有机化合物（乙烯·乙醇·乙酸）', question: '常见官能团对应的典型反应类型？', answer: '碳碳双键/三键→加成、加聚、氧化；卤代烃→取代（NaOH水溶液）、消去（NaOH醇溶液）；醇→取代、消去、氧化、酯化；羧酸→酯化、中和；酯→水解', explanation: '苯环取代（卤代、硝化、磺化）、加成（H₂）。检验方法：溴水褪色（碳碳双键）、银镜反应/斐林（醛基）。', tags: ['必背', '有机'] },
  { subject: 'chemistry', topic: '铁 金属材料', question: '常见沉淀与溶液的特征颜色？', answer: 'Fe(OH)₃ 红褐色沉淀、Fe(OH)₂ 白色→灰绿→红褐、Cu(OH)₂ 蓝色、AgCl 白色、BaSO₄ 白色（不溶于酸）、Fe³⁺ 溶液黄色、Fe²⁺ 浅绿色、Cu²⁺ 蓝色、MnO₄⁻ 紫红色', explanation: 'Fe³⁺ 遇 KSCN 变血红色是检验特征反应；Fe²⁺ 需先验无 Fe³⁺ 再用酸性 KMnO₄ 褪色。', tags: ['必背', '实验'] },

  // ── 地理 ────────────────────────────────────────────────────────────────
  { subject: 'geography', topic: '大气的运动', question: '全球气压带、风带的分布与季节移动规律？', answer: '7 个气压带（赤道低压、副热带高压×2、副极地低压×2、极地高压×2）与 6 个风带（信风、西风、极地东风各 2）相间分布；随太阳直射点北半球夏季北移、冬季南移', explanation: '地中海气候=副高与西风带交替控制；热带草原气候=赤道低压与信风带交替控制。', tags: ['必背', '成因'] },
  { subject: 'geography', topic: '气候类型判别与成因', question: '判断气候类型的三步法？', answer: '① 以温定带（最冷月均温：>15 ℃ 热带，0~15 ℃ 亚热带/温带海洋，<0 ℃ 温带）② 以水定型（年雨型、夏雨型、冬雨型、少雨型）③ 结合海陆位置与纬度验证', explanation: '注意南北半球气温曲线相反（7 月低温为南半球）。', tags: ['答题模板', '判读'] },
  { subject: 'geography', topic: '等值线判读（等高线·等温线·等压线）', question: '等高线图中山谷、山脊如何判断，「凸高为低」指什么？', answer: '等高线凸向高处（凸向高值）为山谷（其中有河流），凸向低处为山脊；即「凸高为低、凸低为高」', explanation: '等高线密集处坡陡；两山峰之间为鞍部；陡崖处等高线重合。等温线也适用同一口径（凸高为低值区）。', tags: ['判读', '易错'] },
  { subject: 'geography', topic: '水的运动', question: '洋流分布的基本规律与著名渔场成因？', answer: '中低纬大洋环流「北顺南逆」，中高纬北半球呈逆时针；寒暖流交汇（纽芬兰、北海道）或上升补偿流（秘鲁）形成大渔场', explanation: '暖流增温增湿、寒流降温减湿；西欧温带海洋性气候得益于北大西洋暖流。', tags: ['必背', '成因'] },
  { subject: 'geography', topic: '产业区位因素', question: '分析农业区位因素的答题框架？', answer: '自然：气候（光热水）、地形、土壤、水源；社会经济：市场、交通、政策、劳动力、技术、地价、种植历史', explanation: '设问若是「优势条件」只答有利项；若是「评价」需正反两面。注意区分主导因素与限制性因素。', tags: ['答题模板', '大题'] },
  { subject: 'geography', topic: '工业区位与产业转移', question: '五种工业导向型及其代表？', answer: '原料导向（制糖、水果罐头）、市场导向（啤酒、家具）、动力导向（电解铝）、劳动力导向（服装、电子装配）、技术导向（集成电路、精密仪器）', explanation: '产业转移的推力=土地劳动力成本上升、环境压力；拉力=市场、政策、廉价要素。', tags: ['必背'] },
  { subject: 'geography', topic: '人口与城镇化问题', question: '城镇化过程中的主要问题与解决方向？', answer: '问题：交通拥堵、住房紧张、就业困难、环境污染、热岛效应、内涝；对策：建卫星城分散职能、完善公共交通、增加绿地与透水面、产业升级', explanation: '城镇化三阶段：初期（缓慢）→ 加速（问题集中）→ 后期（逆城镇化、再城镇化）。', tags: ['答题模板'] },
  { subject: 'geography', topic: '地表形态的塑造', question: '褶皱、断层与「背斜成谷」的原因？', answer: '背斜岩层向上拱起、顶部受张力易被侵蚀成谷；向斜槽部受挤压岩性坚实反而成山，即地形倒置', explanation: '背斜是良好的储油储气与隧道选址构造，向斜利于储水。三大类岩石通过岩石圈物质循环相互转化。', tags: ['成因', '易错'] },
  { subject: 'geography', topic: '天气系统与锋面', question: '冷锋与暖锋过境时和过境后的天气差异？', answer: '冷锋：过境时阴雨、大风、降温，雨区在锋后；过境后气温下降、气压升高、天气转晴。暖锋：过境时连续性降水，雨区在锋前；过境后气温上升、气压下降、转晴', explanation: '我国北方夏季暴雨、冬季寒潮多由冷锋造成；江淮准静止锋形成梅雨。', tags: ['必背', '易错'] },
  { subject: 'geography', topic: '地理综合题答题模板', question: '描述河流水文特征应从哪几个方面作答？', answer: '流量大小与季节变化、汛期（长短与出现时间）、含沙量、结冰期与凌汛、水位变化、流速（落差）、水能蕴藏量', explanation: '水系特征则答：流域面积、支流数量与分布、河网密度、流向、河道弯曲度——两者别混。', tags: ['答题模板', '大题'] },

  // ── 语文 ────────────────────────────────────────────────────────────────
  { subject: 'chinese', topic: '名篇名句默写（必背72篇）', question: '《劝学》：故木受绳则直，______；君子博学而日参省乎己，______。', answer: '金就砺则利；则知明而行无过矣', explanation: '「知」通「智」，默写时不可写成「智」。', tags: ['默写', '必背'] },
  { subject: 'chinese', topic: '名篇名句默写（必背72篇）', question: '《赤壁赋》：寄蜉蝣于天地，______；哀吾生之须臾，______。', answer: '渺沧海之一粟；羡长江之无穷', explanation: '易错字：「蜉蝣」「渺」「沧」「须臾」。', tags: ['默写', '易错字'] },
  { subject: 'chinese', topic: '名篇名句默写（必背72篇）', question: '《离骚》：亦余心之所善兮，______。／《琵琶行》：同是天涯沦落人，______。', answer: '虽九死其犹未悔；相逢何必曾相识', explanation: '两句都是高频「情志类」默写点，常以情境题形式出现。', tags: ['默写', '必背'] },
  { subject: 'chinese', topic: '文言实词与虚词', question: '「爱」在文言中的常见义项有哪些？「齐国虽褊小，吾何爱一牛」中作何解？', answer: '义项：喜爱、爱护、吝惜、爱惜；此处作「吝惜」', explanation: '一词多义靠语境定夺：先代入常用义，再看是否与句意/语法搭配一致。', tags: ['文言', '一词多义'] },
  { subject: 'chinese', topic: '文言句式与翻译', question: '文言词类活用有哪几种主要类型？', answer: '名词作动词、名词作状语、形容词作动词、形容词作名词、动词作名词、使动用法、意动用法', explanation: '翻译口诀「留、删、换、调、补、变」：人名地名保留，虚词删除，古今异义替换，倒装调序，省略补齐。', tags: ['文言', '必背'] },
  { subject: 'chinese', topic: '病句辨析与修改', question: '病句的六大类型？', answer: '语序不当、搭配不当、成分残缺或多余、结构混乱（句式杂糅）、表意不明、不合逻辑', explanation: '快速排查信号：多重定语顺序、「的」字结构、两面词（是否/能否）、否定叠加、介词开头易缺主语。', tags: ['语用', '必背'] },
  { subject: 'chinese', topic: '古代诗歌鉴赏', question: '诗歌鉴赏常用表达技巧术语有哪些？', answer: '借景抒情、托物言志、虚实结合、动静结合（以动衬静）、视听结合、正侧结合、用典、对比衬托、比兴、白描、渲染烘托', explanation: '答题三步：指出手法 → 结合诗句解释 → 说明表达效果与情感。', tags: ['答题模板', '鉴赏'] },
  { subject: 'chinese', topic: '文学类文本阅读（小说）', question: '小说中环境描写的作用可从哪些角度作答？', answer: '交代时间地点背景、渲染气氛、烘托人物心理/性格、推动情节发展、暗示或深化主题、与后文形成呼应', explanation: '情节作用类题目同理：结构上（铺垫、伏笔、照应、悬念）+ 内容上（塑造人物、表现主题）。', tags: ['答题模板'] },
  { subject: 'chinese', topic: '议论文结构与素材', question: '考场议论文的稳定结构模板？', answer: '标题（观点鲜明）→ 引（材料+提出中心论点）→ 议（并列或递进 3 个分论点，每段「分论点+论据+分析」）→ 联（联系现实/自身）→ 结（回扣论点升华）', explanation: '分析比举例更值分：论据后必须有 2~3 句因果分析，避免「例后无议」。', tags: ['写作', '模板'] },
  { subject: 'chinese', topic: '论述类文本阅读', question: '论述类文本选择题最常见的三类设错方式？', answer: '偷换概念/张冠李戴、以偏概全（扩大或缩小范围）、混淆时态或强加因果（无中生有、逻辑倒置）', explanation: '方法：圈定关键词（所有/都/必然/唯一/主要原因）回原文逐字比对。', tags: ['阅读', '易错'] },

  // ── 英语 ────────────────────────────────────────────────────────────────
  { subject: 'english', topic: '非谓语动词', question: 'remember / forget / regret 接 to do 与 doing 的意义差别？', answer: 'remember to do 记得去做（未做）／remember doing 记得做过（已做）；forget、regret 同理：to do 指向未来，doing 指向已发生', explanation: '同类高频：stop to do（停下来去做）vs stop doing（停止做）；try to do（努力）vs try doing（试试）。', tags: ['语法', '易错'] },
  { subject: 'english', topic: '定语从句', question: '关系词选择的判断步骤，什么时候必须用 which 而不能用 that？', answer: '先看先行词（人/物/时间/地点/原因），再看在从句中充当的成分（主/宾/定/状）；介词后、非限制性定语从句中只能用 which', explanation: '先行词被 all/the only/the very/序数词或最高级修饰时优先 that；whose=of which，可指人也可指物。', tags: ['语法', '必背'] },
  { subject: 'english', topic: '虚拟语气', question: 'if 条件句虚拟语气三种时间的谓语形式？', answer: '与现在相反：if + 过去式（were），主句 would/could/might + do；与过去相反：if + had done，主句 would have done；与将来相反：if + were to do / should do，主句 would do', explanation: '省略 if 时把 were/had/should 提前构成倒装：Were I you, …／Had he come, …', tags: ['语法', '必背'] },
  { subject: 'english', topic: '时态与语态', question: '现在完成时与一般过去时的核心区别及各自信号词？', answer: '现在完成时强调对现在的影响，与 already/yet/ever/never/just/since/for/so far/recently 连用；一般过去时只叙述过去的事，与 yesterday/last week/ago/in 2020 连用', explanation: '「过去的时间点状语」一律用过去时——这是语法填空最常见的送分/失分点。', tags: ['语法', '易错'] },
  { subject: 'english', topic: '倒装与强调', question: '哪些情况构成部分倒装？', answer: '否定词/否定短语置句首（Never/Not only/Little/Hardly/No sooner）、Only + 状语置句首、so/neither 表同样如此、as/though 引导让步（形容词提前）、虚拟条件句省略 if', explanation: 'Not only … but also… 只有前半句倒装。There be、Here comes 属完全倒装。', tags: ['语法', '必背'] },
  { subject: 'english', topic: '读后续写（情节+情感）', question: '读后续写拿高分的四个要点？', answer: '① 承接上文伏笔与人物设定 ② 两段各设一个小高潮，动作细节化（动词+副词+身体反应）③ 适当加入直接引语与心理描写 ④ 结尾情感升华、点出主题', explanation: '句式多样化：分词短语作状语、with 复合结构、倒装、非限制性定语从句各用一两处即可。', tags: ['写作', '模板'] },
  { subject: 'english', topic: '应用文写作（申请·建议·邀请·投稿）', question: '应用文三段式框架？', answer: '第一段点明写信目的（I am writing to…）；第二段展开 2~3 个具体内容/理由；第三段礼貌收尾并提出期待（I would appreciate it if…／Looking forward to your reply）', explanation: '注意格式与人称：不写地址与日期，署名统一 Li Hua；词数 80 左右不跑题优先。', tags: ['写作', '模板'] },
  { subject: 'english', topic: '高频动词短语', question: '写出下列短语的含义：make up for / put up with / look forward to / come up with / take advantage of', answer: '弥补 / 容忍 / 期待（后接 doing）/ 想出（主意）/ 利用', explanation: 'look forward to、be used to、devote to 中的 to 都是介词，后面必须接 doing。', tags: ['词汇', '必背'] },
  { subject: 'english', topic: '熟词生义', question: '猜出加粗词义：address the problem / be subjected to pressure / The meeting lasted two hours.', answer: 'address = 处理、解决；subject (v.) = 使遭受；last (v.) = 持续', explanation: '熟词生义靠词性判断：名词位置突然出现动词形态，就要想它的动词义项。', tags: ['词汇', '易错'] },
  { subject: 'english', topic: '主谓一致', question: 'a number of 与 the number of、以及 there be 就近原则如何处理主谓一致？', answer: 'a number of + 复数名词 + 复数谓语（许多）；the number of + 复数名词 + 单数谓语（……的数量）；There be 与最靠近的主语一致', explanation: '其他高频：each/every/either/neither + 单数；分数/百分数 of + 名词随名词；neither A nor B 就远原则用 B。', tags: ['语法', '易错'] },
]

/**
 * 带 seedKey 的卡片列表（可直接交给 Store.upsertItems，重复导入自动去重）。
 * @returns {object[]} 卡片。
 */
export function seedItems() {
  return SEED_CARDS.map((c, i) => ({
    ...c,
    kind: 'card',
    difficulty: c.difficulty ?? 3,
    tags: c.tags ?? [],
    source: '内置卡片包',
    seedKey: `seed:${c.subject}:${i}`,
  }))
}
