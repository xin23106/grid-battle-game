/* =========================================================================
 * codex.js —— 英雄图鉴 / 机制百科（只读界面层）
 * -------------------------------------------------------------------------
 * 数据来源：
 *   - 英雄、生命、定位、技能次数、伤害、范围、限制：直接读取 heroes.js 的 HEROES
 *   - 立绘 / 主题色：读取 herovisuals.js
 *   - 本局可见英雄：读取 GameAPI.getCodexBattleData()（已过滤隐身/隐藏单位）
 *
 * 本文件不参与战斗判定，不写入棋盘、回合、服务器状态。
 * ========================================================================= */
(function () {
  "use strict";

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const attr = (v) => esc(v);
  const short = (v, n) => {
    const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const HERO_LIST = () => (window.GameAPI && Array.isArray(window.GameAPI.HEROES) ? window.GameAPI.HEROES : []);
  const heroById = (id) => HERO_LIST().find((h) => h && h.id === id) || null;
  const heroIndex = (id) => HERO_LIST().findIndex((h) => h && h.id === id);

  const RANGE_BY_TYPE = {
    bloodburst: "自身九宫格（周围 8 格）",
    charge: "相邻目标；沿远离自身方向击退",
    chase: "第一段：整行 / 整列直线贯穿；第二段：带标记敌人的相邻空格",
    crosstep: "上 / 下 / 左 / 右相邻 1 格（不能斜向）",
    damage_adjacent_all: "所有相邻敌人",
    damage_single: "按技能射程内的单个敌人",
    dash: "直线方向最多 3 格",
    divinepalm: "相邻敌人",
    dragonbreath: "前方 2×3 矩形（沿方向 2 格、垂直 3 格）",
    duanlang: "先前进 1 格，再以落点为中心的九宫格",
    exile: "全地图一名敌人，放逐到四角",
    freeze: "3 格范围内一名敌人",
    heal: "3 格范围内一名友军（含自己）",
    meditate: "以自身为中心的九宫格",
    metalarmor: "自身",
    metalpierce: "正前方 1–2 格，直线射线",
    metaltide: "自身（持续状态）",
    meteor: "全地图任意落点；以落点为中心 3×3",
    mirrorclone: "自身九宫格 + 上下左右第 2 格",
    mirrorshift: "场上任意己方镜像",
    mistdash: "十字方向最多 3 格；路径留下毒雾",
    passive: "常驻被动",
    push: "正前方 2 格内的第一个敌人；推击 2 格",
    qiankun: "以自身为中心 5×5",
    raikiri: "正前方第 1、2 格",
    shadowfang: "相邻敌人",
    shenluo: "自身九宫格（不含自身格）",
    shield_ally: "全地图一名己方存活英雄",
    shuidiao: "第一段：九宫格落点后突进 3 格；第二段：前方 2 格擒拿",
    skyarrow: "上 / 下 / 左 / 右直线，直到边界或阻挡",
    soulrevive: "墓地中的己方阵亡英雄；复活到死亡位置 / 最近空格",
    soulsteal: "全地图所有敌方英雄",
    steal: "全地图一名可复制技能的敌方英雄",
    stealth: "自身九宫格 + 上下左右第 2 格",
    susano_arrow: "正前方第 2 格为中心 3×3；随后中心与十字邻居生成黑炎",
    susano_crow: "正前方一格为中心 3×3",
    susano_dash: "斜线方向 2 格",
    susano_pull: "相邻目标；沿方向拉到距自身 2 格",
    thunder: "自身九宫格 + 上下左右第 2 格",
    thunderblade: "第一段：相邻；第二段：前方突进后插刀；第三段：九宫格落点与雷刀直线",
    tianwei: "全地图任意空格；落点九宫格",
    undeadarmy: "全地图所有死亡十字架",
    wxt: "第一段：前方九宫格；第二段：前方 2×3；第三段：相邻",
    ziwei: "自身九宫格 + 上下左右第 2 格",
  };

  const DURATION_BY_TYPE = {
    freeze: "目标下一个回合（冰封 1 回合）",
    meteor: "2 个完整对手行动回合后坠落",
    thunder: "强化 3 个自身行动回合",
    meditate: "3 个自身行动回合",
    stealth: "3 个完整回合",
    mistdash: "毒雾持续 3 个完整回合",
    susano_arrow: "黑炎持续 3 个完整回合",
    susano_crow: "鸦天狗形态持续 3 个自身行动回合",
    qiankun: "护盾持续 2 个自身行动回合",
    mirrorclone: "永久，直到被伤害摧毁",
    metaltide: "本回合及之后 2 个自身行动回合",
    empowerTurns: "",
  };

  const TYPE_LABEL = {
    damage_single: "单体伤害", damage_adjacent_all: "范围伤害", freeze: "控制",
    heal: "治疗", shield_ally: "护盾", dash: "位移 / 伤害", chase: "连招 / 标记",
    skyarrow: "直线攻击", meteor: "延迟范围", passive: "被动", steal: "复制",
    soulsteal: "群体控制", mirrorclone: "召唤", mirrorshift: "换位",
    soulrevive: "复活", undeadarmy: "召唤", bloodburst: "范围 / 吸血",
    ziwei: "传送 / 范围", exile: "强制位移", tianwei: "传送 / 范围",
    shenluo: "范围 / 击退", wxt: "三段连招", metalpierce: "直线穿刺",
    metalarmor: "强化 / 定身", metaltide: "减伤", meditate: "形态 / 无敌",
    divinepalm: "伤害 / 击退", stealth: "隐身 / 位移", mistdash: "突进 / 地形",
    shadowfang: "单体攻击", push: "推击 / 地形", charge: "冲锋 / 击退", crosstep: "十字位移",
    raikiri: "直线二段", thunderblade: "三段连招", susano_dash: "斜线位移",
    susano_pull: "拉拽", susano_arrow: "范围 / 地形", susano_crow: "变身 / 范围",
  };

  /* 机制百科：文案只解释玩家可见规则；不替代服务端结算。 */
  const MECHANICS = [
    {
      id: "flank", icon: "⚔️", title: "夹击与反夹击",
      summary: "只看上下左右；相邻敌人与棋盘边界都可能形成夹击方向。",
      body: "目标每个相邻敌人、以及紧贴目标的棋盘边界（墙）各算 1 个夹击方向。相邻至少 1 名敌人且方向总数 ≥ 2 时触发夹击，额外伤害 = 方向数 − 1（2 方向 +1、3 方向 +2、4 方向 +3）。技能不受夹击加成。若目标相邻存在未被夹击的队友，则队友保护生效，夹击被取消。",
      example: "目标左侧和右侧各有一名敌人、没有队友保护：2 个方向，普通攻击 +1。目标在角落，身边只有 1 名敌人但另一侧贴墙：仍可形成 2 个方向。",
    },
    {
      id: "attack", icon: "🗡️", title: "普通攻击",
      summary: "基础 1 点伤害；击杀后攻击者会占据目标原来的格子。",
      body: "普通攻击默认只能攻击上下左右相邻的敌人；天穹射手可以沿同一行/列直线攻击 1–2 格。普通攻击会正常触发夹击、暗杀、鬼雄等与普攻相关的效果。若目标被这次攻击击杀，攻击者会进入目标原位置；目标位置被其他单位、石柱或剑刃占据时，按实际规则停留在合法位置。",
      example: "刺客攻击被夹击的目标时，普通攻击基础 1 点 + 夹击加成 + 暗杀被动，再统一结算护盾与减伤。",
    },
    {
      id: "move", icon: "👣", title: "位移",
      summary: "普通移动通常为相邻 1 格；技能位移各有独立规则。",
      body: "普通移动只能走向上下左右相邻空格，英雄、石柱、剑刃和边界都会阻挡。技能位移包括突进、传送、击退、拉拽和换位；不同技能对中间阻挡、落点占用和是否造成伤害有不同限制。定身会禁止移动与主动位移技能，但仍允许普通攻击和非位移技能。",
      example: "被定身的单位不能使用突进或传送，但仍可以原地普通攻击；抓取 / 眩晕则会进一步禁止攻击和技能。",
    },
    {
      id: "push", icon: "💥", title: "击退与抓取",
      summary: "击退沿方向移动，遇到阻挡停在最远合法位置；抓取让目标短暂无法行动。",
      body: "击退 / 推击会沿指定方向把目标推离，遇到英雄、石柱、剑刃或边界时停下；部分技能会把被撞到的其他英雄向侧方推开并造成额外伤害。抓取属于强控制，目标在持续时间内不能移动、攻击或使用技能；结束时可能结算额外伤害。霸体等免控效果可以抵抗强制位移或抓取，但伤害仍按统一规则结算。",
      example: "花木兰所向披靡将目标击退两格；若目标被墙挡住未能完成击退，则改为眩晕 2 个自身行动回合。",
    },
    {
      id: "root", icon: "⛓️", title: "定身",
      summary: "不能移动或使用主动位移技能，但仍可普通攻击和非位移技能。",
      body: "定身是位置限制，不是沉默。被定身的英雄不能走步，也不能使用需要位移的主动技能；普通攻击、原地技能以及不依赖位移的技能仍可执行。定身持续按目标自己的行动回合结算。",
      example: "金元素的金属装甲命中后使目标定身 1 个自身行动回合；目标仍可普通攻击，但不能追上来或瞬移。",
    },
    {
      id: "silence", icon: "🤐", title: "沉默",
      summary: "主动与被动技能全部失效，但普通攻击仍可进行。",
      body: "沉默期间不能使用主动技能，依赖被动触发的效果也会失效（包括闪避、霸体、暗杀、鬼雄、锻剑、天眼等已知被动）。普通攻击不受影响；毒雾、黑炎、陨星、持续地形等不是“释放技能”，会继续结算。窃魂造成的沉默持续一个完整敌方行动回合。",
      example: "窃神使用窃魂后，敌方本回合无法用技能或被动保护自己，但仍可以普通攻击；敌方回合结束后定身与沉默同时解除。",
    },
    {
      id: "timestop", icon: "⏳", title: "时间停止 / 时序控制",
      summary: "当前版本没有全局永久停止时间的技能；时序效果表现为额外回合、跳过行动与延迟结算。",
      body: "游戏中的时序控制主要有三类：获得额外回合（行军令）、让目标跳过行动（冰封 / 眩晕 / 抓取）以及把效果延迟到未来回合（天罚、持续地形）。打开图鉴只会暂停本地输入，不会推进回合、不会触发服务器行动；关闭后从原状态继续。",
      example: "行军令在自己回合结束后插入一个额外回合；天罚会在 2 个完整对手行动回合后坠落，而不是立即造成伤害。",
    },
    {
      id: "stun", icon: "💫", title: "眩晕",
      summary: "不能移动、攻击或使用技能；持续到目标的行动回合结束。",
      body: "眩晕期间英雄完全无法执行正常行动；持续时间按目标自己的行动回合计时。眩晕会与定身 / 沉默等状态同时存在，但效果不叠加为额外行动次数。控制抗性（如霸体）可能阻止部分控制；具体以技能说明和服务端结算为准。",
      example: "花木兰的冲锋因边界未能完成击退时，目标眩晕 2 个自身行动回合；杨戬的逆转乾坤可让 5×5 最外圈敌人眩晕 1 回合。",
    },
    {
      id: "shield", icon: "🛡️", title: "护盾",
      summary: "先于生命值吸收伤害；多层护盾可以独立叠加与计时。",
      body: "受到伤害时先扣护盾，再扣生命值。临时护盾可以有多层，每层拥有独立剩余量与持续时间；在拥有者自己的行动回合开始时递减 / 结算。护盾不阻止控制、击退或抓取，也不会被普通治疗自动补满。",
      example: "守卫的铁壁给友军 +2 护盾；杨戬的逆转乾坤按实际造成的总伤害获得持续 2 个自身行动回合的护盾。",
    },
    {
      id: "dodge", icon: "🌪️", title: "闪避",
      summary: "龙魂每受到一次实际伤害进行 1/2 概率判定；成功则免伤并积累龙胆。",
      body: "龙人的龙魂在每次受到实际伤害时独立判定 50% 闪避。成功时本次伤害为 0，并积累 1 次额外移动机会（龙胆）；同一次伤害最多奖励 1 次。闪避发生在伤害结算前，但不会绕过已经生效的强制位移或控制。",
      example: "龙人被普通攻击命中时掷出闪避成功：不扣血，获得 1 次龙胆；对手回合结束时保留，到龙人自己的下个回合仍可使用。",
    },
    {
      id: "stealth", icon: "🌫️", title: "隐身",
      summary: "敌方无法把隐身单位作为普通目标；持续 3 个完整回合。",
      body: "渡鸦潜行后进入隐身，敌方看不到其位置，也不能用普通攻击或单体技能选中它。范围伤害仍可能命中隐身单位；普通攻击或影牙会主动破除隐身，雾冲不会。线上模式只同步对手可见的信息，图鉴不会读取隐身敌人的位置。",
      example: "渡鸦潜行后绕到敌后，下一次普通攻击 / 影牙获得 +1 并解除隐身；若在隐身期间踩进范围伤害，仍会被结算。",
    },
    {
      id: "revive", icon: "💫", title: "复活",
      summary: "让阵亡英雄回到棋盘；保留阵亡瞬间状态，仅恢复部分生命。",
      body: "还魂令复活至 3 HP，亡灵之主的亡语复活至 2 HP。两者都优先回到死亡位置；原位置被占据时，回到最近合法空格。复活会保留阵亡瞬间的技能剩余次数、护盾、负面状态、强化 / 连招阶段与携带剑等状态（具体按对应技能规则）。复活后移除对应死亡十字架，但不返还已消耗的行动。",
      example: "友军阵亡后，亡灵之主使用亡语在最近空格以 2 HP 复活；若之后再用还魂令，已复活的英雄不会再次进入墓地。",
    },
    {
      id: "dot", icon: "☠️", title: "持续伤害",
      summary: "毒雾、黑炎等在自己的回合结束时结算 0.5 点伤害。",
      body: "持续地形不会阻挡移动；敌方英雄在自己的回合结束时若仍站在毒雾 / 黑炎格上，会受到 0.5 点伤害，每个来源每回合通常只结算一次。施放者一方免疫自己生成的地形伤害。持续伤害仍会先经过护盾、减伤等统一结算。",
      example: "渡鸦的雾冲留下毒雾；敌人停在雾里结束回合会掉 0.5 HP，离开后不再受到该格伤害。",
    },
    {
      id: "summon", icon: "👻", title: "召唤单位",
      summary: "小亡灵、镜像等会占据棋盘，但能力与英雄不同。",
      body: "亡灵军团把死亡十字架转化为 2 HP 小亡灵；小亡灵可以移动、普通攻击、参与夹击，但不能使用技能，死亡时不会进入墓地、不会留下剑或十字架。镜影召唤的 1 HP 镜像会阻挡通行，不能移动 / 攻击 / 使用技能，受到任意伤害立即消失。召唤物是否计入胜负与行动，按各自规则处理。",
      example: "亡灵军团清空全部十字架并召唤小亡灵；小亡灵攻击 1 点，被击杀后直接移除，不会产生新的死亡十字架。",
    },
    {
      id: "anchor", icon: "🌌", title: "时空锚点（延迟 / 持久标记）",
      summary: "记录棋盘坐标，在后续回合触发或持续存在的效果。",
      body: "当前版本没有独立的“时空锚点”英雄技能；这类效果以延迟落点、持续地形和持久标记实现，例如天罚的陨星预警、黑炎 / 毒雾、石柱、死亡十字架与雷刀。锚点按各自规则计时、占格与结算；打开图鉴不会推进这些计时。",
      example: "天罚落下前会显示 3×3 预警；敌方可以离开区域躲避，也可以进入区域承受 2 点伤害。",
    },
    {
      id: "uses", icon: "🔢", title: "技能次数与步数消耗",
      summary: "技能没有冷却，只有整局 / 每回合次数；不耗步技能不占正常行动。",
      body: "每个主动技能有使用次数或每回合次数限制，次数耗尽后不能再释放。普通移动、普通攻击和大多数技能消耗 1 次正常行动；标记为“不消耗行动”的技能可以在移动 / 普攻后继续使用。部分技能有独立代价（生命、剑、阶段）并仍然受次数限制。回合不会自动结束，玩家完成行动后需要手动结束回合；若还有合法行动，不能直接跳过。",
      example: "阿修罗的剑圣每回合最多 2 次且每次消耗 1 把剑，不占正常行动；技能次数与携带剑数是两套独立资源。",
    },
    {
      id: "timing", icon: "🕰️", title: "回合计时与状态持续时间",
      summary: "区分“自身行动回合”“完整回合”“对手行动回合”，状态按各自时机递减。",
      body: "标注为“自身行动回合”的状态，通常在该英雄自己的回合开始或结束时递减；标注为“完整回合 / 完整对手回合”的效果，则跨过双方行动才计数。冰封会让目标跳过下一个回合，陨星在天罚施放后的 2 个完整对手行动回合后坠落。护盾层在自己回合开始时结算；控制状态在目标回合结束时递减。",
      example: "鸦天狗持续 3 个自身行动回合，额外回合不会按真实自身回合推进；天罚在 2 个完整对手回合后才落地。",
    },
  ];

  function skillKind(sk) {
    if (!sk) return "active";
    return sk.type === "passive" ? "passive" : "active";
  }

  function normalizeSkill(sk, source) {
    return Object.assign({}, sk, { _kind: skillKind(sk), _source: source || "" });
  }

  /* 读取一名英雄的完整技能表：主动技能按配置顺序，被动放在后面。 */
  function skillsOf(hero) {
    if (!hero) return [];
    const active = [];
    if (hero.skill && skillKind(hero.skill) === "active") active.push(normalizeSkill(hero.skill, "skill"));
    for (const sk of hero.extraSkills || []) {
      if (sk) active.push(normalizeSkill(sk, "extraSkills"));
    }
    const passives = [];
    const seen = new Set();
    const addPassive = (p) => {
      if (!p || !p.name) return;
      const key = p.name;
      if (seen.has(key)) return;
      seen.add(key);
      passives.push(normalizeSkill(p, "passive"));
    };
    if (hero.passive) addPassive(hero.passive);
    for (const p of hero.passives || []) addPassive(p);
    if (hero.skill && skillKind(hero.skill) === "passive") addPassive(hero.skill);
    return active.concat(passives);
  }

  function rangeText(sk) {
    if (!sk) return "—";
    // 有明确范围字段时优先展示字段，保证修改配置后图鉴立即同步。
    if (sk.range != null) {
      if (sk.range === 0) return RANGE_BY_TYPE[sk.type] || "全地图 / 自身";
      return sk.range + " 格";
    }
    if (RANGE_BY_TYPE[sk.type]) return RANGE_BY_TYPE[sk.type];
    if (sk.radius != null) return "半径 " + sk.radius + "（" + (sk.radius * 2 + 1) + "×" + (sk.radius * 2 + 1) + "）";
    return "见完整效果说明";
  }

  function durationText(sk) {
    if (!sk) return "—";
    if (sk._kind === "passive") return "常驻 / 被动触发";
    // 数值字段优先于类型文案，避免修改配置后仍显示旧的固定文案。
    if (sk.delayTurns != null) return "延迟 " + sk.delayTurns + " 个完整对手行动回合";
    if (sk.empowerTurns != null) return "强化 " + sk.empowerTurns + " 个自身行动回合";
    if (sk.shieldTurns != null) return "护盾持续 " + sk.shieldTurns + " 个自身行动回合";
    if (sk.freeze != null) return "冰封 " + sk.freeze + " 回合";
    if (sk.stun != null) return "眩晕 " + sk.stun + " 回合";
    if (DURATION_BY_TYPE[sk.type]) return DURATION_BY_TYPE[sk.type];
    return "即时 / 见完整效果";
  }

  function usesText(sk) {
    if (!sk) return "—";
    if (sk._kind === "passive") return "被动 · 常驻";
    const out = [];
    if (sk.perTurn != null) out.push("每回合 " + sk.perTurn + " 次");
    if (sk.uses != null && sk.uses > 0) out.push("整局 " + sk.uses + " 次");
    if (sk.refreshOnKill) out.push("击杀刷新");
    if (sk.refreshOnSkillKill) out.push("技能击杀刷新");
    return out.length ? out.join(" · ") : "无次数限制";
  }

  function actionText(sk) {
    if (!sk) return "—";
    if (sk._kind === "passive") return "被动，不占用行动";
    return sk.free ? "不消耗行动" : "消耗 1 次行动";
  }

  function valueParts(sk) {
    if (!sk) return [];
    const parts = [];
    if (sk.damage != null) parts.push("伤害 " + sk.damage);
    if (sk.damage1 != null || sk.damage2 != null) parts.push("第一格 " + (sk.damage1 == null ? "—" : sk.damage1) + " / 第二格 " + (sk.damage2 == null ? "—" : sk.damage2));
    if (sk.heal != null) parts.push("治疗 " + sk.heal);
    if (sk.shield != null) parts.push("护盾 " + sk.shield);
    if (sk.empowerShield != null) parts.push("强化护盾 " + sk.empowerShield);
    if (sk.grabDamage != null) parts.push("擒拿结束伤害 " + sk.grabDamage);
    if (sk.push != null) parts.push("击退 " + sk.push + " 格");
    if (sk.knockback != null) parts.push("击退 " + sk.knockback + " 格");
    if (sk.freeze != null) parts.push("冰封 " + sk.freeze + " 回合");
    if (sk.stun != null) parts.push("眩晕 " + sk.stun + " 回合");
    if (sk.delayTurns != null) parts.push("延迟 " + sk.delayTurns + " 个对手回合");
    if (sk.empowerTurns != null) parts.push("强化 " + sk.empowerTurns + " 个自身回合");
    if (sk.empowerActions != null) parts.push("强化期间每回合 " + sk.empowerActions + " 次行动");
    if (sk.costHp != null) parts.push("生命代价 " + sk.costHp);
    if (sk.costSwords != null) parts.push("消耗剑 " + sk.costSwords + " 把");
    if (sk.radius != null) parts.push("范围半径 " + sk.radius);
    if (sk.range != null) parts.push("射程 " + (sk.range === 0 ? "全地图" : sk.range + " 格"));
    return parts.length ? parts : ["无直接伤害 / 治疗数值"];
  }

  /* 把带“第一段 / 第二段 / 第三段”的描述拆成有序段落。 */
  function splitStages(text) {
    const src = String(text || "");
    // 只把真正作为段落标题的“第一段：/ 第一段·/ 第二段（…）：”视为分段，
    // 避免把“第一段、第二段各消耗…”这种概述误拆成额外段落。
    const re = /第[一二三四五六七八九十百]+段(?:[（(][^）)]{1,40}[）)])?(?=\s*[：:·])/g;
    const marks = [];
    let m;
    while ((m = re.exec(src))) marks.push({ index: m.index, title: m[0] });
    if (marks.length < 2) return { intro: src.trim(), stages: [] };
    const intro = src.slice(0, marks[0].index).trim();
    const stages = marks.map((mark, i) => {
      const start = mark.index + mark.title.length;
      const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
      let body = src.slice(start, end).trim();
      body = body.replace(/^[：:]\s*/, "").replace(/^[·•]\s*/, "");
      return { title: mark.title, body };
    });
    return { intro, stages };
  }

  function heroArt(hero, cls) {
    if (window.HeroVisuals && window.HeroVisuals.portraitHTML) {
      try { return window.HeroVisuals.portraitHTML(hero.id, cls || ""); } catch (e) { /* fallback */ }
    }
    return '<span class="cx-art-fallback">' + esc(hero.icon || "✦") + "</span>";
  }

  function heroVars(hero) {
    const look = (window.HeroVisuals && window.HeroVisuals.look) ? window.HeroVisuals.look(hero.id) : {};
    return '--cx1:' + attr(look.c1 || "#93c5fd") + ';--cx2:' + attr(look.c2 || "#334155") + ';--cx3:' + attr(look.c3 || "#e2e8f0") + ';';
  }

  function skillIcon(sk) {
    if (window.HeroVisuals && window.HeroVisuals.skillIcon) {
      try { return window.HeroVisuals.skillIcon(sk && sk.type); } catch (e) { /* fallback */ }
    }
    return "✦";
  }

  function skillTag(sk) {
    return sk._kind === "passive" ? "被动" : "主动";
  }

  function roleList() {
    const set = [];
    for (const h of HERO_LIST()) if (h && h.tag && !set.includes(h.tag)) set.push(h.tag);
    return set.sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function hpList() {
    return Array.from(new Set(HERO_LIST().map((h) => Number(h.hp)).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
  }

  function filteredHeroes() {
    const q = state.search.trim().toLowerCase();
    let rows = HERO_LIST().map((h, index) => ({ h, index })).filter(({ h }) => {
      if (!h) return false;
      if (state.hp && String(h.hp) !== String(state.hp)) return false;
      if (state.role && h.tag !== state.role) return false;
      if (!q) return true;
      const skills = skillsOf(h);
      const hay = [h.name, h.id, h.tag, h.desc, ...skills.map((s) => s.name + " " + (s.desc || ""))].join(" ").toLowerCase();
      return hay.includes(q);
    });
    const byName = (a, b) => String(a.h.name).localeCompare(String(b.h.name), "zh-CN");
    if (state.sort === "name") rows.sort(byName);
    else if (state.sort === "old") rows.sort((a, b) => a.index - b.index);
    else if (state.sort === "hp") rows.sort((a, b) => (b.h.hp - a.h.hp) || byName(a, b));
    else rows.sort((a, b) => b.index - a.index); // 最新加入：配置表末尾优先
    return rows;
  }

  function cardHTML({ h, index }) {
    const skills = skillsOf(h);
    const isNew = index >= Math.max(0, HERO_LIST().length - 4);
    const skillPills = skills.slice(0, 4).map((sk) =>
      '<span class="cx-skill-pill" data-tip="' + attr(sk.name + "：" + short(sk.desc || sk.condition || "", 92)) + '">' +
      skillIcon(sk) + "<span>" + esc(sk.name) + "</span></span>"
    ).join("");
    return '<button type="button" class="cx-card' + (isNew ? " cx-new" : "") + '" data-hero-id="' + attr(h.id) + '" style="' + heroVars(h) + '" title="' + attr(skills.map((s) => s.name).join(" / ")) + '">' +
      '<span class="cx-card-shine" aria-hidden="true"></span>' +
      '<span class="cx-card-art">' + heroArt(h, "cx-card-portrait") + '<span class="cx-card-vignette" aria-hidden="true"></span></span>' +
      '<span class="cx-card-body">' +
        '<span class="cx-card-title"><b>' + esc(h.name) + '</b><em class="cx-hp">❤ ' + esc(h.hp) + "</em></span>" +
        '<span class="cx-card-tags"><span class="cx-role">' + esc(h.tag || "未分类") + '</span><span class="cx-count">' + skills.length + ' 项技能</span>' + (isNew ? '<span class="cx-new-badge">新</span>' : "") + "</span>" +
        '<span class="cx-card-desc">' + esc(short(h.desc, 92)) + "</span>" +
        '<span class="cx-card-skills">' + skillPills + "</span>" +
      "</span></button>";
  }

  function battleStripHTML() {
    const api = window.GameAPI;
    if (!api || typeof api.getCodexBattleData !== "function") return "";
    let data;
    try { data = api.getCodexBattleData(); } catch (e) { return ""; }
    if (!data || !data.sides) return "";
    const s1 = data.sides[1] || [], s2 = data.sides[2] || [];
    if (!s1.length && !s2.length) return "";
    const side = (p, list) => {
      const label = data.mode === "online" && data.myPlayer
        ? (p === data.myPlayer ? "我方" : "对手")
        : "玩家" + p;
      return '<div class="cx-roster-side cx-p' + p + '"><div class="cx-roster-label">' + label + "</div><div class=\"cx-roster-units\">" +
        list.map((u) => {
          const h = heroById(u.heroId);
          return '<button type="button" class="cx-roster-unit" data-hero-id="' + attr(u.heroId) + '">' +
            '<span class="cx-roster-icon">' + esc(h ? h.icon : "✦") + "</span>" +
            "<span>" + esc(h ? h.name : u.heroId) + "</span><em>" + esc(u.hp) + "/" + esc(u.maxHp) + "</em></button>";
        }).join("") + "</div></div>";
    };
    return '<section class="cx-battle-strip"><div class="cx-strip-head"><b>本局可见英雄</b><span>点击英雄直接查看完整技能</span></div>' +
      '<div class="cx-roster-row">' + side(1, s1) + side(2, s2) + "</div>" +
      '<div class="cx-strip-note">仅显示当前可见单位；隐身敌人、未公开技能与隐藏信息不会出现在图鉴中。</div></section>';
  }

  function overviewHTML() {
    const roleOpts = roleList().map((r) => '<option value="' + attr(r) + '"' + (state.role === r ? " selected" : "") + ">" + esc(r) + "</option>").join("");
    const hpOpts = hpList().map((hp) => '<option value="' + hp + '"' + (String(state.hp) === String(hp) ? " selected" : "") + ">" + hp + " HP</option>").join("");
    return '<section class="cx-view cx-overview">' +
      '<div class="cx-heading"><div><span class="cx-eyebrow">HERO ARCHIVE · 星穹档案</span><h2>英雄总览</h2><p>全部正式英雄、技能与战斗定位；数据实时读取当前英雄配置。</p></div>' +
      '<div class="cx-heading-stat"><b id="cx-count">' + HERO_LIST().length + '</b><span>位英雄</span></div></div>' +
      battleStripHTML() +
      '<div class="cx-toolbar">' +
        '<label class="cx-search"><span>⌕</span><input id="cx-search" type="search" autocomplete="off" placeholder="搜索英雄 / 定位 / 技能…" value="' + attr(state.search) + '" aria-label="搜索英雄"></label>' +
        '<label class="cx-select-wrap"><span>生命</span><select id="cx-hp" aria-label="按生命值筛选"><option value="">全部</option>' + hpOpts + "</select></label>" +
        '<label class="cx-select-wrap"><span>定位</span><select id="cx-role" aria-label="按定位筛选"><option value="">全部</option>' + roleOpts + "</select></label>" +
        '<label class="cx-select-wrap"><span>排序</span><select id="cx-sort" aria-label="排序">' +
          '<option value="new"' + (state.sort === "new" ? " selected" : "") + ">最新加入</option>" +
          '<option value="old"' + (state.sort === "old" ? " selected" : "") + ">最早加入</option>" +
          '<option value="name"' + (state.sort === "name" ? " selected" : "") + ">名称 A→Z</option>" +
          '<option value="hp"' + (state.sort === "hp" ? " selected" : "") + ">生命值从高到低</option>" +
        "</select></label>" +
        '<button type="button" id="cx-reset" class="cx-reset">重置</button>' +
      "</div>" +
      '<div id="cx-grid" class="cx-grid">' + filteredHeroes().map(cardHTML).join("") + "</div>" +
      '<div class="cx-empty" id="cx-empty"' + (filteredHeroes().length ? " hidden" : "") + ">没有符合条件的英雄，试试清除筛选。</div>" +
      '<div class="cx-legend"><span>✦ 新加入英雄</span><span>悬停技能可查看简介</span><span>点击任意技能查看完整说明</span></div>' +
    "</section>";
  }

  function detailHTML(hero, index) {
    const skills = skillsOf(hero);
    if (!skills.length) return '<section class="cx-view cx-detail"><button class="cx-back" data-back>← 返回总览</button><p class="cx-muted">该英雄暂无技能配置。</p></section>';
    const activeCount = skills.filter((s) => s._kind === "active").length;
    const passiveCount = skills.length - activeCount;
    const idx = Math.max(0, Math.min(skills.length - 1, state.skillIndex || 0));
    state.skillIndex = idx;
    const selected = skills[idx];
    const buttons = skills.map((sk, i) =>
      '<button type="button" class="cx-skill-row' + (i === idx ? " active" : "") + '" data-skill-index="' + i + '">' +
        '<span class="cx-skill-icon">' + skillIcon(sk) + "</span>" +
        '<span class="cx-skill-row-main"><b>' + esc(sk.name) + "</b><small>" + skillTag(sk) + " · " + esc(usesText(sk)) + "</small></span>" +
        '<span class="cx-skill-arrow">›</span></button>'
    ).join("");
    const featured = index >= Math.max(0, HERO_LIST().length - 4);
    return '<section class="cx-view cx-detail" style="' + heroVars(hero) + '">' +
      '<button type="button" class="cx-back" data-back>← 返回英雄总览</button>' +
      '<div class="cx-detail-layout">' +
        '<aside class="cx-detail-art-col">' +
          '<div class="cx-detail-art">' + heroArt(hero, "cx-detail-portrait") + '<span class="cx-detail-rune" aria-hidden="true">✦</span></div>' +
          '<div class="cx-detail-art-caption"><span>生命值</span><b>❤ ' + esc(hero.hp) + "</b></div>" +
          '<div class="cx-detail-facts">' +
            '<div><span>定位</span><b>' + esc(hero.tag || "未分类") + "</b></div>" +
            '<div><span>主动技能</span><b>' + activeCount + " 项</b></div>" +
            '<div><span>被动能力</span><b>' + passiveCount + " 项</b></div>" +
            (featured ? '<div><span>档案</span><b class="cx-new-text">最新加入</b></div>' : "") +
          "</div>" +
        "</aside>" +
        '<div class="cx-detail-main">' +
          '<div class="cx-detail-eyebrow">' + (featured ? "NEW HERO · " : "") + "HERO CODEX</div>" +
          '<h2 class="cx-detail-name">' + esc(hero.name) + ' <span class="cx-detail-hp">❤ ' + esc(hero.hp) + "</span></h2>" +
          '<p class="cx-detail-tagline">' + esc(hero.tag || "") + "</p>" +
          '<div class="cx-lore"><span class="cx-label">英雄介绍 / 战斗特色</span><p>' + esc(hero.desc || "暂无介绍。") + "</p></div>" +
          '<div class="cx-skill-heading"><h3>技能档案</h3><span>共 ' + skills.length + ' 项 · 点击切换详情</span></div>' +
          '<div class="cx-skill-layout">' +
            '<div class="cx-skill-list">' + buttons + "</div>" +
            '<div class="cx-skill-detail" id="cx-skill-detail">' + skillDetailHTML(selected, idx) + "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</section>";
  }

  function skillDetailHTML(sk, index) {
    const stage = splitStages(sk.desc || "");
    const values = valueParts(sk).map((v) => "<span>" + esc(v) + "</span>").join("");
    let desc = "";
    if (stage.stages.length) {
      desc = (stage.intro ? '<p class="cx-skill-intro">' + esc(stage.intro) + "</p>" : "") +
        '<div class="cx-stages">' + stage.stages.map((st) =>
          '<div class="cx-stage"><span class="cx-stage-title">' + esc(st.title) + "</span><p>" + esc(st.body) + "</p></div>"
        ).join("") + "</div>";
    } else {
      desc = '<p class="cx-skill-intro">' + esc(sk.desc || "暂无说明。") + "</p>";
    }
    const condition = sk.condition || (sk._kind === "passive" ? "被动常驻；沉默等状态可能使其失效。" : "无额外限制；仍需符合通用行动、目标与棋盘规则。");
    return '<div class="cx-skill-detail-head"><span class="cx-big-skill-icon">' + skillIcon(sk) + "</span>" +
      '<div><span class="cx-skill-kicker">' + skillTag(sk) + (TYPE_LABEL[sk.type] ? " · " + TYPE_LABEL[sk.type] : "") + "</span>" +
      "<h3>" + esc(sk.name) + "</h3></div></div>" +
      '<div class="cx-stat-grid">' +
        '<div><span>使用次数</span><b>' + esc(usesText(sk)) + "</b></div>" +
        '<div><span>行动消耗</span><b>' + esc(actionText(sk)) + "</b></div>" +
        '<div><span>伤害 / 数值</span><b>' + values + "</b></div>" +
        '<div><span>作用范围</span><b>' + esc(rangeText(sk)) + "</b></div>" +
        '<div><span>持续回合</span><b>' + esc(durationText(sk)) + "</b></div>" +
      "</div>" +
      '<div class="cx-detail-section"><span class="cx-label">完整技能效果</span>' + desc + "</div>" +
      '<div class="cx-condition"><span class="cx-label">特殊限制 / 边界规则</span><p>' + esc(condition) + "</p></div>" +
      '<div class="cx-skill-foot">技能编号 ' + (index + 1) + " · 规则以服务端权威结算为准</div>";
  }

  function mechanicsHTML() {
    return '<section class="cx-view cx-mechanics">' +
      '<div class="cx-heading"><div><span class="cx-eyebrow">BATTLE LEXICON · 规则档案</span><h2>机制百科</h2><p>把容易混淆的战斗规则拆开讲清楚；示例只解释规则，不改变实际结算。</p></div><div class="cx-heading-stat"><b>' + MECHANICS.length + '</b><span>条机制</span></div></div>' +
      '<div class="cx-mech-list">' + MECHANICS.map((m, i) =>
        '<details class="cx-mech-card" data-mech="' + attr(m.id) + '"' + (i === 0 ? " open" : "") + ">" +
          '<summary><span class="cx-mech-icon">' + m.icon + '</span><span class="cx-mech-summary"><b>' + esc(m.title) + "</b><small>" + esc(m.summary) + "</small></span><span class=\"cx-mech-plus\">＋</span></summary>" +
          '<div class="cx-mech-body"><p>' + esc(m.body) + '</p><div class="cx-example"><b>战例</b><span>' + esc(m.example) + "</span></div></div>" +
        "</details>"
      ).join("") + "</div></section>";
  }

  const state = {
    tab: "heroes",
    heroId: null,
    search: "",
    hp: "",
    role: "",
    sort: "new",
    skillIndex: 0,
    reduce: false,
  };
  let overlay = null;
  let content = null;
  let lastFocus = null;

  function loadReduce() {
    try { state.reduce = localStorage.getItem("herochess.codex.reduce") === "1"; } catch (e) { /* ignore */ }
  }
  function saveReduce() {
    try { localStorage.setItem("herochess.codex.reduce", state.reduce ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function shellHTML() {
    return '<div class="cx-shell" role="dialog" aria-modal="true" aria-label="英雄图鉴">' +
      '<header class="cx-topbar"><div class="cx-brand"><span class="cx-brand-mark">✦</span><div><b>星穹英雄图鉴</b><small>HERO CODEX · 实时读取战场配置</small></div></div>' +
      '<nav class="cx-tabs" aria-label="图鉴栏目">' +
        '<button type="button" class="cx-tab' + (state.tab === "heroes" ? " active" : "") + '" data-tab="heroes">英雄总览</button>' +
        '<button type="button" class="cx-tab' + (state.tab === "mechanics" ? " active" : "") + '" data-tab="mechanics">机制百科</button>' +
      "</nav>" +
      '<div class="cx-top-actions"><button type="button" class="cx-reduce-btn" data-reduce title="减少动画与粒子效果">动效：' + (state.reduce ? "精简" : "标准") + "</button>" +
      '<button type="button" class="cx-close" data-close aria-label="关闭图鉴">✕</button></div></header>' +
      '<main class="cx-content" id="cx-content"></main>' +
      '<footer class="cx-footer"><span>打开图鉴不会消耗行动、不会推进回合，也不会触发战斗事件。</span><span>ESC 关闭 · 数据来自当前英雄配置</span></footer>' +
    "</div>";
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "hero-codex";
    overlay.className = "cx-overlay hidden" + (state.reduce ? " cx-reduce" : "");
    overlay.innerHTML = '<div class="cx-backdrop" data-close></div>' + shellHTML();
    document.body.appendChild(overlay);
    content = overlay.querySelector("#cx-content");
    overlay.addEventListener("click", onClick);
    overlay.addEventListener("input", onInput);
    overlay.addEventListener("change", onChange);
    document.addEventListener("keydown", onKeydown, true);
  }

  function renderTabs() {
    overlay.querySelectorAll(".cx-tab").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === state.tab));
    const reduceBtn = overlay.querySelector("[data-reduce]");
    if (reduceBtn) reduceBtn.textContent = "动效：" + (state.reduce ? "精简" : "标准");
    overlay.classList.toggle("cx-reduce", state.reduce);
  }

  function renderContent() {
    if (!overlay || !content) return;
    renderTabs();
    if (state.tab === "mechanics") {
      content.innerHTML = mechanicsHTML();
      return;
    }
    if (state.heroId) {
      const hero = heroById(state.heroId);
      if (hero) {
        content.innerHTML = detailHTML(hero, heroIndex(hero.id));
        return;
      }
      state.heroId = null;
    }
    content.innerHTML = overviewHTML();
  }

  function renderGridOnly() {
    if (!content || state.tab !== "heroes" || state.heroId) return;
    const rows = filteredHeroes();
    const grid = content.querySelector("#cx-grid");
    const empty = content.querySelector("#cx-empty");
    const count = content.querySelector("#cx-count");
    if (grid) grid.innerHTML = rows.map(cardHTML).join("");
    if (empty) empty.hidden = rows.length > 0;
    if (count) count.textContent = rows.length;
  }

  function open(heroId) {
    ensureOverlay();
    loadReduce();
    lastFocus = document.activeElement;
    state.tab = "heroes";
    state.heroId = heroId || null;
    state.skillIndex = 0;
    overlay.classList.remove("hidden");
    document.body.classList.add("codex-open");
    renderContent();
    const focusTarget = overlay.querySelector(".cx-close");
    if (focusTarget) setTimeout(() => { try { focusTarget.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function close() {
    if (!overlay || overlay.classList.contains("hidden")) return;
    overlay.classList.add("hidden");
    document.body.classList.remove("codex-open");
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus(); } catch (e) { /* ignore */ }
    }
    if (window.GameAPI && typeof window.GameAPI.resumeAfterCodex === "function") {
      try { window.GameAPI.resumeAfterCodex(); } catch (e) { /* ignore */ }
    }
  }

  function toggle(heroId) {
    if (overlay && !overlay.classList.contains("hidden")) close();
    else open(heroId);
  }

  function onClick(e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      state.tab = tab.getAttribute("data-tab");
      state.heroId = null;
      renderContent();
      return;
    }
    if (e.target.closest("[data-close]")) { close(); return; }
    if (e.target.closest("[data-reduce]")) {
      state.reduce = !state.reduce;
      saveReduce();
      renderTabs();
      return;
    }
    const reset = e.target.closest("#cx-reset");
    if (reset) {
      state.search = ""; state.hp = ""; state.role = ""; state.sort = "new";
      renderContent();
      return;
    }
    const back = e.target.closest("[data-back]");
    if (back) {
      state.heroId = null;
      renderContent();
      return;
    }
    const skill = e.target.closest("[data-skill-index]");
    if (skill) {
      const hero = heroById(state.heroId);
      const skills = skillsOf(hero);
      const idx = Number(skill.getAttribute("data-skill-index"));
      if (skills[idx]) {
        state.skillIndex = idx;
        const box = content.querySelector("#cx-skill-detail");
        if (box) box.innerHTML = skillDetailHTML(skills[idx], idx);
        content.querySelectorAll(".cx-skill-row").forEach((row) => row.classList.toggle("active", row === skill));
      }
      return;
    }
    const unit = e.target.closest("[data-hero-id]");
    if (unit) {
      const id = unit.getAttribute("data-hero-id");
      if (heroById(id)) {
        state.heroId = id;
        state.skillIndex = 0;
        state.tab = "heroes";
        renderContent();
      }
    }
  }

  function onInput(e) {
    if (e.target && e.target.id === "cx-search") {
      state.search = e.target.value || "";
      renderGridOnly();
    }
  }

  function onChange(e) {
    if (!e.target) return;
    if (e.target.id === "cx-hp") { state.hp = e.target.value || ""; renderGridOnly(); }
    else if (e.target.id === "cx-role") { state.role = e.target.value || ""; renderGridOnly(); }
    else if (e.target.id === "cx-sort") { state.sort = e.target.value || "new"; renderGridOnly(); }
  }

  function onKeydown(e) {
    if (!overlay || overlay.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function bindEntryButtons() {
    const top = document.getElementById("codex-btn");
    if (top) top.addEventListener("click", () => open());
    const menu = document.getElementById("menu-codex-open");
    if (menu) menu.addEventListener("click", () => open());
  }

  loadReduce();
  bindEntryButtons();
  // 配置变化后可刷新；打开时也会自动重新读取 HEROES。
  window.Codex = {
    open,
    close,
    toggle,
    refresh() { renderContent(); },
    isOpen() { return !!(overlay && !overlay.classList.contains("hidden")); },
    getState() { return Object.assign({}, state); },
    getHeroes() { return HERO_LIST().slice(); },
    getMechanics() { return MECHANICS.slice(); },
    skillsOf,
  };
})();
