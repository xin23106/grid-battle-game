/* =========================================================================
 * game.js —— 英雄战棋核心逻辑
 * -------------------------------------------------------------------------
 * 在原有“士兵棋”基础上做二次开发，保留：
 *   6×6 棋盘、左右半场、回合制（每回合操作 1 名己方单位、行动 1 次）、
 *   每方 3 名单位、移动 / 普通攻击 / 胜负判定等核心玩法。
 * 新增：
 *   · 英雄化改造（生命 5~8、专属技能、冷却、护盾、冰封）
 *   · 夹击机制（正交夹击 + 棋盘边界夹击 + 队友保护）
 *   · 技能系统、界面反馈、战斗日志
 * ========================================================================= */

/* ----------------------------- 常量 ----------------------------- */
const SIZE = 6;                    // 棋盘 6×6
const SIDE_COLS = 3;               // 玩家 1 占左侧 3 列
const SOLDIERS_PER_PLAYER = 3;     // 每方最多 3 名英雄
const BASE_ATTACK = 1;             // 普通攻击基础伤害
const FLANK_BONUS = 1;             // 夹击最小额外伤害（2 个夹击方向时 +1，方向更多则递增）

const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]; // 仅上下左右四个正交方向（不含斜对角）

/* ----------------------------- DOM ----------------------------- */
const boardEl = document.getElementById("board");
const turnPlayerEl = document.getElementById("turn-player");
const turnHintEl = document.getElementById("turn-hint");
const p1CountEl = document.getElementById("p1-count");
const p2CountEl = document.getElementById("p2-count");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlay-title");
const overlaySubEl = document.getElementById("overlay-sub");
const overlayStatsEl = document.getElementById("overlay-stats");
const overlayBtn = document.getElementById("overlay-btn");
const restartBtn = document.getElementById("restart");
const heroRosterEl = document.getElementById("hero-roster");
const rosterListEl = document.getElementById("roster-list");
const heroCardEl = document.getElementById("hero-card");
const skillBarEl = document.getElementById("skill-bar");
const skipBtn = document.getElementById("skip-btn");
const logEl = document.getElementById("log");
const bgmEl = document.getElementById("bgm");
const bgmBtn = document.getElementById("bgm-btn");
const menuEl = document.getElementById("menu");
const menuHome = document.getElementById("menu-home");
const menuAi = document.getElementById("menu-ai");
const menuOnline = document.getElementById("menu-online");
const menuSettings = document.getElementById("menu-settings");
const menuBtn = document.getElementById("menu-btn");
const menuCloseEl = document.getElementById("menu-close");
const modeBadge = document.getElementById("mode-badge");
const connBadge = document.getElementById("conn-badge");
const readyRow = document.getElementById("ready-row");
const readyP1 = document.getElementById("ready-p1");
const readyP2 = document.getElementById("ready-p2");
const onlineStatus = document.getElementById("online-status");
const overlayMenuBtn = document.getElementById("overlay-menu");
const serverInputEl = document.getElementById("server-input");
const serverConnectEl = document.getElementById("server-connect");
const serverHintEl = document.getElementById("server-hint");
const shareRowEl = document.getElementById("share-row");
const shareInputEl = document.getElementById("share-input");
const shareHostRowEl = document.getElementById("share-host-row");
const shareHostSelEl = document.getElementById("share-host");
const shareHintEl = document.getElementById("share-hint");
const phoneRowEl = document.getElementById("phone-row");
const phoneInputEl = document.getElementById("phone-input");
const phoneHintEl = document.getElementById("phone-hint");
const talismanCardEl = document.getElementById("talisman-card");
const tzIconEl = document.getElementById("tz-icon");
const tzNameEl = document.getElementById("tz-name");
const tzDescEl = document.getElementById("tz-desc");
const talismanBtn = document.getElementById("talisman-btn");
const detailCardEl = document.getElementById("detail-card");
const dcIconEl = document.getElementById("dc-icon");
const dcNameEl = document.getElementById("dc-name");
const dcHpEl = document.getElementById("dc-hp");
const dcSkillsEl = document.getElementById("dc-skills");
const dcStatusEl = document.getElementById("dc-status");
const detailCloseEl = document.getElementById("detail-close");

/* ----------------------------- 状态 ----------------------------- */
let board = [];                    // board[r][c] = 单位对象 或 null
let mists = {};                    // "r_c" -> { turns, fresh, owner } 毒雾地形（不阻挡移动）
let turnSerial = 0;                // 回合序号（用于记录潜行开始时间）
let phase = "placement";           // placement(布阵) / battle(对战) / over(结束)
let currentPlayer = 1;
let toPlace = SOLDIERS_PER_PLAYER;
let placedIds = { 1: [], 2: [] };  // 每方已选英雄 id（防重复）
let onlinePool = null;             // 联机随机选将：本人的候选英雄池（服务端下发，客户端不可指定）
let onlineLogSeq = 0;              // 联机：已合并的服务端日志最大 id（去重，避免重连/重复广播刷屏）
let bfxPrevSnap = null;            // 联机：上一份权威棋盘快照（用于派生表现事件，不改变任何状态）
let bfxPillarSnap = null;          // 联机：上一份石柱位置（用于升起 / 碎裂表现）
let bfxOnlineLogSeq = 0;           // 联机：表现层已消费的日志 id（横幅去重）
let onlinePlacementDone = { 1: false, 2: false }; // 联机布阵：双方是否已完成（仅状态，不含具体选择）
let pendingHero = null;            // 布阵阶段待放置的英雄 id
let selected = null;               // { r, c }
let moveTargets = [];
let attackTargets = [];
let skillTargets = [];
let skillMode = false;             // 是否处于“选择技能目标”状态
let winner = 0;
let logs = [];
let unitSeq = 1;
let fx = [];                       // 一次性飘字特效（渲染后清空）
let inputLockUntil = 0;            // 表现层输入锁（防止动画期间连点重复行动）
let turnFxExtra = false;           // 本次 beginTurn 是否是“行军令额外回合”
let turnFxSuppress = false;        // 自动跳过回合时抑制完整转场（避免动画连播）
/* 对局统计（真实数据，用于结算面板） */
let matchStats = { damage: { 1: 0, 2: 0 }, kills: { 1: 0, 2: 0 }, startedAt: 0, endedAt: 0, lastKiller: null };
/* 结算演出状态 */
let victorySeq = { active: false, played: false, resultShown: false, timers: [] };
let dashOptions = [];              // 阿修罗·剑圣：本次可选的突进方向

/* 游戏模式 / AI */
let gameMode = "local";            // "local" | "ai" | "online"
let aiPlayer = 2;                  // AI 控制的阵营
let aiDifficulty = "normal";       // "easy" | "normal" | "hard"
let aiThinking = false;
let netState = { connected: false, room: null, role: null }; // 联机状态（前端展示用）
let autoJoinRoom = "";             // 通过分享链接进入时待加入的房间号
let turnActionUsed = false;        // 本回合是否已使用“正常行动”（移动/普攻/普通技能）
let turnActionsMax = 1;            // 本回合行动上限（雷电之主强化时为 2）
let turnActionsLeft = 1;           // 本回合剩余行动机会
let turnActorUid = 0;              // 本回合可继续行动的英雄（强化时限定为该英雄）
let empowerTurnActive = false;     // 本回合是否为强化回合

/* ----------------------------- 锦囊系统状态 ----------------------------- */
let talisman = { 1: null, 2: null };   // 各自持有的锦囊 id（使用后置 null）
let talismanUsed = { 1: false, 2: false }; // 是否已使用
let talismanMode = null;               // 正在选择目标的锦囊 id
let talismanTargets = [];              // 当前锦囊的可选目标格
let talismanBuff = { assaultPlayer: 0, guardPlayer: 0 }; // 猛攻令 / 坚守令 生效阵营
let extraMoves = 0;                    // （已废弃）行军令旧机制：本回合额外移动次数
let extraTurnPending = false;          // 行军令：本回合结束后，当前玩家额外获得一个完整回合
let graveyard = [];                    // 阵亡记录（供还魂令）
let reviveOptions = [];                // 还魂令：可复活的阵亡记录
let detailUnit = null;                 // 详情面板当前展示的英雄
let activeSkillIdx = 0;                // 当前选中英雄正在操作第几个技能
let skillSub = null;                    // 多段技能的子步骤（如“水调歌头”第一段的突进方向）
let chaseRefreshSeq = 0;               // 刺客·追猎：击杀刷新的序号（用于避免刷新被次数扣除覆盖）
let dragonMoveUnit = null;              // 龙胆：正在使用额外移动的龙人
let dragonMoveTargets = [];

/* ----------------------------- 工具 ----------------------------- */
function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}
function territoryOf(c) {
  return c < SIDE_COLS ? 1 : 2;
}
function unitAt(r, c) {
  if (!inBounds(r, c)) return null;
  const cell = board[r][c];
  return cell && !cell.pillar ? cell : null; // 石柱不是单位，不可被选中/攻击
}
function heroDef(id) {
  return getHeroById(id);
}
function label(u) {
  if (!u) return "空格";
  return "玩家" + u.player + "·" + heroDef(u.heroId).name;
}
function findPos(u) {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (board[r][c] === u) return { r, c };
  return null;
}
function unitsOf(player) {
  const list = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const u = board[r][c];
      if (u && u.player === player) list.push(u);
    }
  return list;
}
function aliveCount(player) {
  return unitsOf(player).length;
}
function addLog(msg) {
  logs.push(msg);
  if (logs.length > 60) logs.shift();
}
function isTarget(list, r, c) {
  return list.some(([tr, tc]) => tr === r && tc === c);
}

/* ---------------- 阿修罗·锻剑：棋盘上的“剑刃”物体 ---------------- */
/* 剑刃是类似墙体的特殊物体：占据一格、阻挡移动、不可被攻击。
   只有阿修罗移动到该格时才会回收。 */
function isSword(cell) {
  return !!cell && cell.sword === true;
}
/* 石柱：独立临时地形对象（不是单位），阻挡移动/突进/传送/推击，不可被攻击 */
function isPillar(cell) {
  return !!cell && cell.pillar === true;
}
function isUnit(cell) {
  return !!cell && !cell.sword && !cell.pillar;
}
function hasAsuraAlive() {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const u = board[r][c];
      if (u && !u.sword && u.heroId === "asura") return true;
    }
  return false;
}
function spawnSword(r, c) {
  // 阿修罗存活时才生成；同一格只能有一个物体；同一场阵亡只生成一把
  if (!hasAsuraAlive()) return false;
  if (!inBounds(r, c) || board[r][c]) return false;
  board[r][c] = { sword: true, uid: unitSeq++ };
  if (window.BFX) window.BFX.swordSpawn(r, c);
  return true;
}
function collectSwordAt(r, c, unit) {
  if (unit && unit.heroId === "asura" && isSword(board[r][c])) {
    unit.swords = (unit.swords || 0) + 1;
    return true;
  }
  return false;
}
function sfxOf(u) {
  const d = u && heroDef(u.heroId);
  return (d && d.sfx) || "sword";
}
/* 「不耗步」技能判定：perTurn（如剑圣）或 free:true（如骑士横扫 / 守卫铁壁）不占用行动机会 */
function isFreeSkill(s) {
  return !!(s && (s.perTurn || s.free));
}
function heroHasFreeUses(u) {
  // 仅“每回合型”（剑圣）会让回合在行动后继续保持开放
  if (!u || u.sword) return false;
  const skills = heroSkills(heroDef(u.heroId));
  return skills.some((s, i) => s.perTurn && skillUsesLeft(u, i) > 0);
}
/* 技能是否消耗“剑”，以及是否支付得起 */
function skillSwordCost(s) {
  return (s && s.costSwords) || 0;
}
function canPaySwords(u, s) {
  const c = skillSwordCost(s);
  return c === 0 || (u && (u.swords || 0) >= c);
}

/* ---------------- 霸体 / 负面状态 / 孤胆 ---------------- */
function isPassiveSkill(s) {
  return !!(s && s.type === "passive");
}
/* 英雄的全部可配置技能（含 extraSkills） */
function heroSkills(def) {
  if (!def) return [];
  return [def.skill, ...(def.extraSkills || [])].filter(Boolean);
}
/* 当前正在操作的技能（默认为第 0 个） */
function activeSkillOf(u) {
  if (!u) return null;
  const skills = heroSkills(heroDef(u.heroId));
  return skills[activeSkillIdx] || skills[0] || null;
}
/* 英雄的被动技能列表（支持多个） */
function heroPassives(def) {
  if (!def) return [];
  if (def.passives && def.passives.length) return def.passives;
  return def.passive ? [def.passive] : [];
}
/* 龙魂闪避概率（1/2），可注入用于测试 */
let dodgeRoller = Math.random;
function dragonDodged() {
  return dodgeRoller() < 1 / 2;
}
/* 龙胆：每次成功闪避获得 1 次额外移动机会 */
function grantDragonMove(u) {
  u.dragonMoves = (u.dragonMoves || 0) + 1;
  addLog("🐉 龙胆触发：" + label(u) + " 获得 1 次额外移动机会（当前 " + u.dragonMoves + " 次）。");
}
/* 龙息区域：沿方向 2 格 × 垂直方向 3 格（居中在英雄所在轴线两侧） */
function dragonBreathArea(u, r, c, dr, dc) {
  const out = [];
  for (let k = 1; k <= 2; k++) {
    for (const o of [-1, 0, 1]) {
      const rr = r + dr * k + (dr === 0 ? o : 0);
      const cc = c + dc * k + (dc === 0 ? o : 0);
      if (inBounds(rr, cc)) out.push([rr, cc]);
    }
  }
  return out;
}
/* 该英雄第 idx 个技能的剩余次数（uses==null 视为无限） */
function skillUsesLeft(u, idx) {
  const skills = heroSkills(heroDef(u.heroId));
  const s = skills[idx];
  if (!s) return 0;
  if (s.uses == null) return Infinity;
  if (skills.length === 1) return u.usesLeft;
  return u.usesArr && u.usesArr[idx] != null ? u.usesArr[idx] : s.uses;
}
function setSkillUsesLeft(u, idx, v) {
  const skills = heroSkills(heroDef(u.heroId));
  if (skills.length === 1) {
    u.usesLeft = v;
    return;
  }
  u.usesArr = u.usesArr || [];
  u.usesArr[idx] = v;
  if (idx === 0) u.usesLeft = v; // 兼容：主技能次数镜像到 usesLeft（供 hasAnyAction 等读取）
}
function initUnitUses(u, def) {
  u.usesLeft = def.skill && def.skill.uses != null ? def.skill.uses : Infinity;
  const skills = heroSkills(def);
  if (skills.length > 1) u.usesArr = skills.map((s) => (s.uses == null ? Infinity : s.uses));
}
/* 统一突进路径：可穿过友军（不伤害友军）；敌人造成伤害且不停顿；墙 / 边界停止。
 * 返回 { dir, dest, hits }：dest=最远合法落点，hits=沿途敌人。 */
function computeDashPath(u, r, c, dr, dc, maxSteps) {
  const hits = [];
  let dest = null;
  for (let k = 1; k <= maxSteps; k++) {
    const rr = r + dr * k;
    const cc = c + dc * k;
    if (!inBounds(rr, cc)) break;                 // 墙 / 棋盘边界
    const cell = board[rr][cc];
    if (!cell) { dest = { r: rr, c: cc }; continue; }
    if (isSword(cell)) { dest = { r: rr, c: cc }; continue; }
    if (isPillar(cell)) break;                    // 石柱：阻挡突进
    if (cell.player === u.player) continue;       // 友军：穿过，不挡不伤
    hits.push({ r: rr, c: cc });                  // 敌人：造成伤害（不停顿）
  }
  return { dir: [dr, dc], dest, hits };
}

/* ---------------- 刺客·追猎 / 暗杀 ---------------- */
/* 追猎第一段：从 (r,c) 沿 (dr,dc) 贯穿到棋盘边界的整条线。
 * 飞镖穿过一切（友军 / 剑刃 / 敌人）直到边界；记录路径格与命中的敌人。 */
function computeChaseLine(u, r, c, dr, dc) {
  const path = [];
  const hits = [];
  let rr = r + dr;
  let cc = c + dc;
  while (inBounds(rr, cc)) {
    path.push([rr, cc]);
    const cell = board[rr][cc];
    if (cell && !cell.sword && !cell.pillar && cell.player !== u.player) hits.push({ r: rr, c: cc });
    rr += dr;
    cc += dc;
  }
  return { dir: [dr, dc], path, hits };
}
/* 该刺客当前可执行的第二段目标：被「自己」标记、且仍存活的敌方英雄 */
function chaseTargetsOf(a) {
  if (!a || a.sword) return [];
  const out = [];
  for (const v of unitsOf(a.player === 1 ? 2 : 1)) if (v.chaseMark === a.uid) out.push(v);
  return out;
}
/* 清除某个刺客遗留的所有追猎标记 */
function clearChaseMarks(uid) {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v && !v.sword && v.chaseMark === uid) v.chaseMark = 0;
    }
}
/* 结束本次追猎连招：清除本次产生的标记 + 退出待释放状态 */
function endChase(a) {
  if (!a) return;
  clearChaseMarks(a.uid);
  a.chaseStage = 0;
  skillSub = null;
}
/* 单位击杀任意敌人 → 刷新其标记了 refreshOnKill 的技能（刺客·追猎）。
 * 标记 refreshOnlyOnSkillKill 的技能（吸血鬼·血崩）不在此处刷新，只由“技能自身击杀”触发。
 * 同一次击杀只刷新一次（技能次数已满时不再重复触发）。返回是否真的刷新。 */
function refreshSkillOnKill(a) {
  if (!a || a.sword) return false;
  const skills = heroSkills(heroDef(a.heroId));
  let refreshed = false;
  let name = "";
  for (let i = 0; i < skills.length; i++) {
    const sk = skills[i];
    if (!sk || !sk.refreshOnKill) continue;
    if (sk.refreshOnlyOnSkillKill) continue; // 仅“技能击杀”才刷新的技能，普攻击杀不刷新
    const max = sk.uses == null ? Infinity : sk.uses;
    const cur = skillUsesLeft(a, i);
    if (cur === Infinity || cur >= max) continue; // 已满 → 不重复触发刷新事件
    setSkillUsesLeft(a, i, max);
    refreshed = true;
    name = sk.name;
  }
  if (refreshed) {
    chaseRefreshSeq++; // 记录一次刷新，供“先结算后扣次数”的流程校正
    addLog("♻ " + label(a) + " 击杀了敌人，【" + name + "】使用次数已刷新。");
    const p = findPos(a);
    if (p) fx.push({ r: p.r, c: p.c, text: "刷新!", kind: "skill" });
  }
  return refreshed;
}
/* 技能自身击杀 → 刷新标记 refreshOnlyOnSkillKill 的技能（吸血鬼·血崩）。
 * 仅当该技能真的把敌人打死时调用；返回是否真的刷新。 */
function refreshSkillOnSkillKill(a, idx) {
  if (!a || a.sword) return false;
  const skills = heroSkills(heroDef(a.heroId));
  const sk = skills[idx];
  if (!sk || !sk.refreshOnlyOnSkillKill) return false;
  const max = sk.uses == null ? Infinity : sk.uses;
  const cur = skillUsesLeft(a, idx);
  if (cur === Infinity || cur >= max) return false;
  setSkillUsesLeft(a, idx, max);
  chaseRefreshSeq++; // 与“先扣次数后结算”的流程保持一致
  const p = findPos(a);
  if (p) fx.push({ r: p.r, c: p.c, text: "刷新!", kind: "skill" });
  return true;
}
/* 兼容旧名（刺客·追猎） */
function refreshChase(a) { return refreshSkillOnKill(a); }
/* 「不耗步」判定（含英雄上下文）：追猎第二段不消耗行动机会，第一段正常消耗 */
function skillFreeFor(u, s) {
  if (!s) return false;
  if (s.type === "chase") return !!(u && (u.chaseStage || 0) === 1);
  return isFreeSkill(s);
}
/* 追猎第二段：目标四周的合法闪身落点（越界 / 被占用 / 剑刃所在都不可进入） */
function chaseBlinkCells(tr, tc) {
  const out = [];
  for (const [dr, dc] of DIRS) {
    const nr = tr + dr;
    const nc = tc + dc;
    if (!inBounds(nr, nc)) continue;
    if (board[nr][nc]) continue; // 被占用的格子（含友军/敌人/剑刃）不可进入
    out.push([nr, nc]);
  }
  return out;
}

/* ---------------- 玉皇大帝：紫薇神步 / 放逐 / 天威 ---------------- */
/* 某格九宫格（3×3）内的敌方英雄（不含剑刃、不含友军） */
function enemiesInBox3(r, c, player) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const v = unitAt(r + dr, c + dc);
      if (v && !v.sword && v.player !== player) out.push(v);
    }
  }
  return out;
}
/* 四个墙角及其对应的 2×2 四宫格（含墙角格本身） */
const BOARD_CORNERS = [
  { corner: { r: 0, c: 0 }, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { corner: { r: 0, c: 5 }, cells: [[0, 4], [0, 5], [1, 4], [1, 5]] },
  { corner: { r: 5, c: 0 }, cells: [[4, 0], [4, 1], [5, 0], [5, 1]] },
  { corner: { r: 5, c: 5 }, cells: [[4, 4], [4, 5], [5, 4], [5, 5]] },
];
/* 该墙角是否可用于放逐：四宫格内没有任何英雄，且墙角格本身为空 */
function cornerExileOk(cn) {
  if (!cn || !cn.cells.every(([r, c]) => !unitAt(r, c))) return false;
  const cr = cn.corner.r, cc = cn.corner.c;
  return inBounds(cr, cc) && !board[cr][cc];
}
/* 将单位击飞出 (boxR,boxC) 的九宫格：移到九宫格以外的最近合法空格；无解返回 null */
function knockOutOfBox3(v, boxR, boxC) {
  const p = findPos(v);
  if (!p) return null;
  const inBox = (r, c) => Math.abs(r - boxR) <= 1 && Math.abs(c - boxC) <= 1;
  const cand = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (inBox(r, c)) continue;
      if (board[r][c]) continue;
      cand.push({ r, c, d: Math.abs(r - p.r) + Math.abs(c - p.c) });
    }
  }
  if (!cand.length) return null;
  cand.sort((A, B) => A.d - B.d || A.r - B.r || A.c - B.c);
  const dest = cand[0];
  board[dest.r][dest.c] = v;
  board[p.r][p.c] = null;
  if (window.BFX) window.BFX.knockback({ from: p, to: dest, color: window.BFX.heroColor(v.heroId) });
  if (window.SFX) window.SFX.play("knockback", { hero: v.heroId });
  return dest;
}
/* ---------------- 天道超：神罗天征 / 万象天引 ---------------- */
/* 按棋盘位置排序（多目标逐个结算，保证顺序固定、不重叠） */
function sortUnitsByPos(list) {
  return list.slice().sort((x, y) => {
    const px = findPos(x), py = findPos(y);
    if (!px) return 1;
    if (!py) return -1;
    return (px.r - py.r) || (px.c - py.c);
  });
}
/* 神罗天征：把目标击退出 (boxR,boxC) 九宫格；优先沿远离 (fromR,fromC) 的方向 */
function knockOutBoxAway(t, boxR, boxC, fromR, fromC) {
  const p = findPos(t);
  if (!p) return null;
  const inBox = (r, c) => Math.abs(r - boxR) <= 1 && Math.abs(c - boxC) <= 1;
  const ok = (r, c) => inBounds(r, c) && !board[r][c] && !inBox(r, c) && !(r === fromR && c === fromC);
  const dirs = [];
  const sx = p.r === fromR ? 0 : (p.r > fromR ? 1 : -1);
  const sy = p.c === fromC ? 0 : (p.c > fromC ? 1 : -1);
  if (sx || sy) dirs.push([sx, sy]);            // 首选：远离方向
  for (const d of DIRS) if (!dirs.some((q) => q[0] === d[0] && q[1] === d[1])) dirs.push(d);
  for (const d of dirs) {
    const nr = p.r + d[0], nc = p.c + d[1];
    if (!ok(nr, nc)) continue;
    board[nr][nc] = t;
    board[p.r][p.c] = null;
    if (window.BFX) window.BFX.knockback({ from: p, to: { r: nr, c: nc }, color: window.BFX.heroColor(t.heroId) });
    if (window.SFX) window.SFX.play("knockback", { hero: t.heroId });
    return { r: nr, c: nc };
  }
  const far = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (ok(r, c)) far.push({ r, c, d: Math.abs(r - p.r) + Math.abs(c - p.c) });
  }
  if (!far.length) return null;
  far.sort((A, B) => A.d - B.d || A.r - B.r || A.c - B.c);
  const dest = far[0];
  board[dest.r][dest.c] = t;
  board[p.r][p.c] = null;
  if (window.BFX) window.BFX.knockback({ from: p, to: dest, color: window.BFX.heroColor(t.heroId) });
  if (window.SFX) window.SFX.play("knockback", { hero: t.heroId });
  return dest;
}
/* 万象天引第三段：沿远离 (fromR,fromC) 的方向击退 1 格 */
function pushAwayOne(t, fromR, fromC) {
  const p = findPos(t);
  if (!p) return null;
  const ok = (r, c) => inBounds(r, c) && !board[r][c] && !(r === fromR && c === fromC);
  const dirs = [];
  const sx = p.r === fromR ? 0 : (p.r > fromR ? 1 : -1);
  const sy = p.c === fromC ? 0 : (p.c > fromC ? 1 : -1);
  if (sx || sy) dirs.push([sx, sy]);
  for (const d of DIRS) if (!dirs.some((q) => q[0] === d[0] && q[1] === d[1])) dirs.push(d);
  for (const d of dirs) {
    const nr = p.r + d[0], nc = p.c + d[1];
    if (!ok(nr, nc)) continue;
    board[nr][nc] = t;
    board[p.r][p.c] = null;
    if (window.BFX) window.BFX.knockback({ from: p, to: { r: nr, c: nc }, color: window.BFX.heroColor(t.heroId) });
    if (window.SFX) window.SFX.play("knockback", { hero: t.heroId });
    return { r: nr, c: nc };
  }
  return null;
}
/* 万象天引某阶段的合法目标格：
 * stage 0 = 前方九宫格（中心为正前方一格）；stage 1 = 龙息范围（复用同一算法）；stage 2 = 普攻相邻 */
function wxtStageTargets(u, r, c, dr, dc, stage) {
  const out = [];
  if (stage === 2) {
    for (const d of DIRS) {
      const t = unitAt(r + d[0], c + d[1]);
      if (t && !t.sword && t.player !== u.player) out.push([r + d[0], c + d[1]]);
    }
    return out;
  }
  if (stage === 0) {
    const cr = r + dr, cc = c + dc;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t = unitAt(cr + i, cc + j);
      if (t && !t.sword && t.player !== u.player) out.push([cr + i, cc + j]);
    }
    return out;
  }
  for (const [rr, cc] of dragonBreathArea(u, r, c, dr, dc)) {
    const t = unitAt(rr, cc);
    if (t && !t.sword && t.player !== u.player) out.push([rr, cc]);
  }
  return out;
}
/* 孤胆侠九宫格内的存活友军（不含自己、不含剑刃） */
function alliesIn3x3(u) {
  const p = findPos(u);
  if (!p) return [];
  const res = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const v = unitAt(p.r + dr, p.c + dc);
      if (v && !v.sword && v.player === u.player) res.push(v);
    }
  }
  return res;
}
/* 孤胆：九宫格内没有友军 → 生效（实时判定） */
function isLoneActive(u) {
  return !!(u && !u.sword && u.heroId === "lone" && alliesIn3x3(u).length === 0);
}
/* 霸体：规则层统一判定（当前由“孤胆侠·孤胆生效”提供） */
function hasSuperArmor(u) {
  return isLoneActive(u);
}
/* 夹击免疫：孤胆侠在“孤胆”被动激活时免疫夹击加成 */
function flankImmune(u) {
  return isLoneActive(u);
}
/* 攻击方伤害加成：猛攻令 +1 / 孤胆（无友军）+1 */
function attackerBonus(u) {
  if (!u || u.sword) return 0;
  return assaultBonus(u.player) + (isLoneActive(u) ? 1 : 0);
}
/* 技能是否被负面状态禁止（抓取 / 眩晕；定身只禁止位移类技能） */
function skillBlockedByStatus(u) {
  return !!(u && u.statuses && ((u.statuses.grab && u.statuses.grab.turns > 0) || (u.statuses.stun && u.statuses.stun.turns > 0)));
}
/* 被抓取：该单位在其回合内不能做任何动作（移动 / 普攻 / 技能） */
function isGrabbed(u) {
  return !!(u && u.statuses && u.statuses.grab && u.statuses.grab.turns > 0);
}
/* 被眩晕：不能移动 / 普攻 / 使用技能；按目标自身行动回合计时 */
function isStunned(u) {
  return !!(u && u.statuses && u.statuses.stun && u.statuses.stun.turns > 0);
}
/* 被定身：不能移动 / 普攻 / 使用主动技能；按目标自身行动回合计时 */
function isRooted(u) {
  return !!(u && u.statuses && u.statuses.root && u.statuses.root.turns > 0);
}
function isDisabled(u) {
  return isGrabbed(u) || isStunned(u);
}
/* 定身：不能移动 / 主动位移，但仍可普通攻击与非位移技能 */
const SELF_MOVE_SKILLS = ["dash", "blink", "ziwei", "tianwei", "shuidiao", "duanlang", "thunder", "mistdash", "stealth"];
function isSelfMoveSkill(u, s) {
  if (!s) return false;
  if (SELF_MOVE_SKILLS.indexOf(s.type) >= 0) return true;
  if (s.type === "chase" && (u.chaseStage || 0) === 1) return true; // 追猎第二段需要闪身
  return false;
}
function actionBlockReason(u) {
  if (isGrabbed(u)) return "抓取";
  if (isStunned(u)) return "眩晕";
  if (isRooted(u)) return "定身";
  return "";
}
/* 雷电之主：本方的强化英雄（empowerTurns>0） */
function empoweredActorFor(player) {
  for (const u of unitsOf(player)) {
    if (u.heroId === "thunder" && (u.empowerTurns || 0) > 0) return u;
  }
  return null;
}
/* 本回合该单位是否还能行动（强化回合内限定同一英雄连续行动） */
function canActNow(u) {
  if (turnActionUsed) return false;
  if (turnActionsLeft < turnActionsMax && turnActorUid && u && u.uid !== turnActorUid) return false;
  return true;
}
/* 施加负面状态：伤害先进入统一结算（不受霸体影响），负面状态本身受霸体免疫。
 * 返回 { applied, immune, damage, dead } —— 便于测试与联机验证。 */
function applyNegativeStatus(target, kind, opts) {
  opts = opts || {};
  let dmg = 0;
  if (opts.damage) dmg = applyDamage(target, opts.damage, opts.fxKind || "skill");
  const alive = !!findPos(target);
  if (!alive) return { applied: false, immune: false, damage: dmg, dead: true };
  if (hasSuperArmor(target)) {
    addLog("🛡 霸体：抵抗了【" + (opts.label || kind) + "】的负面效果（伤害仍已结算）。");
    const p = findPos(target);
    if (p) fx.push({ r: p.r, c: p.c, text: "霸体", kind: "shield" });
    if (p && window.BFX) window.BFX.immune({ r: p.r, c: p.c, text: "霸体·抵抗" });
    return { applied: false, immune: true, damage: dmg };
  }
  target.statuses = target.statuses || {};
  target.statuses[kind] = Object.assign({ kind, label: opts.label || kind }, opts);
  if (!opts.silent) addLog(label(target) + " 被施加【" + (opts.label || kind) + "】（持续 " + (opts.turns != null ? opts.turns : 1) + " 个其回合）。");
  {
    const p = findPos(target);
    if (p && window.BFX) {
      window.BFX.grab({ from: opts.from || p, to: p, color: kind === "grab" ? "#38bdf8" : "#a5f3fc" });
    }
    if (window.SFX && kind === "grab") window.SFX.play("grab", { hero: target.heroId });
  }
  return { applied: true, immune: false, damage: dmg };
}
/* 回合结束时递减负面状态；到期结算尾段伤害并解除 */
function tickStatuses(player) {
  for (const u of unitsOf(player)) {
    if (!u.statuses) continue;
    for (const k of Object.keys(u.statuses)) {
      const st = u.statuses[k];
      if (st.turns == null) continue;
      st.turns -= 1;
      if (st.turns <= 0) {
        if (st.endDamage) {
          addLog("⛓ 【" + (st.label || k) + "】结束，" + label(u) + " 受到 " + st.endDamage + " 点伤害。");
          applyDamage(u, st.endDamage, "skill");
        }
        delete u.statuses[k];
      }
    }
  }
}
/* ---------------- 锦囊辅助 ---------------- */
function assaultBonus(player) {
  return talismanBuff.assaultPlayer === player ? 1 : 0;
}
function guardOn(player) {
  return talismanBuff.guardPlayer === player;
}
function drawTalismanId() {
  return TALISMANS[Math.floor(Math.random() * TALISMANS.length)].id;
}
/* 还魂令落点：优先原位置；若被占据（例如击杀者已站上目标格），退回最近的空格 */
function reviveCellFor(g) {
  if (!g) return null;
  if (inBounds(g.r, g.c) && !board[g.r][g.c]) return { r: g.r, c: g.c };
  let best = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c]) continue;
      const d = Math.abs(r - g.r) + Math.abs(c - g.c);
      if (!best || d < best.d || (d === best.d && (r < best.r || (r === best.r && c < best.c)))) {
        best = { r, c, d };
      }
    }
  }
  return best ? { r: best.r, c: best.c } : null;
}
/* 某锦囊对某玩家的合法目标格 */
function talismanTargetsFor(id, player) {
  const t = getTalismanById(id);
  const res = [];
  if (!t) return res;
  if (t.target === "allyWounded") {
    for (const u of unitsOf(player)) {
      if (u.hp < u.maxHp) {
        const p = findPos(u);
        if (p) res.push([p.r, p.c]);
      }
    }
  } else if (t.target === "allyAlive") {
    for (const u of unitsOf(player)) {
      const p = findPos(u);
      if (p) res.push([p.r, p.c]);
    }
  } else if (t.target === "deadAlly") {
    for (const g of graveyard) {
      if (g.player !== player) continue;
      const cell = reviveCellFor(g);
      if (cell && !res.some(([r, c]) => r === cell.r && c === cell.c)) res.push([cell.r, cell.c]);
    }
  }
  return res;
}
/* 当前玩家是否还有任何可执行的行动（用于“不能直接跳过回合”的兜底） */
function hasAnyAction(player) {
  for (const u of unitsOf(player)) {
    if (u.frozen > 0) continue;
    if (isDisabled(u)) continue; // 被抓取 / 眩晕：本回合无法行动
    const pos = findPos(u);
    if (!pos) continue;
    const s = heroDef(u.heroId).skill;
    const canMove = !isRooted(u); // 定身：不能移动，但仍可攻击 / 非位移技能
    if (!turnActionUsed && s && u.usesLeft > 0 && !(isRooted(u) && isSelfMoveSkill(u, s))) return true; // 仍可用普通技能
    for (const [dr, dc] of DIRS) {
      const nr = pos.r + dr;
      const nc = pos.c + dc;
      if (!inBounds(nr, nc)) continue;
      const t = board[nr][nc];
      if (!t) { if (canMove && !turnActionUsed) return true; continue; }
      if (t.sword) { if (u.heroId === "asura" && canMove && !turnActionUsed) return true; continue; }
      if (isPillar(t)) continue; // 石柱不可攻击、不可进入
      if (t.player !== player && !turnActionUsed) return true;
    }
    // 游侠：距离 2 的敌人也可普攻
    if (u.heroId === "ranger" && !turnActionUsed) {
      for (const [rr, cc] of cellsWithin(pos.r, pos.c, 2, false)) {
        if (Math.abs(rr - pos.r) + Math.abs(cc - pos.c) !== 2) continue;
        const t = unitAt(rr, cc);
        if (t && t.player !== player) return true;
      }
    }
    if (heroHasFreeUses(u)) return true; // 剑圣仍可使用
    // 不耗行动步数的主动技能（金元素等）：即使本回合已行动也可用
    {
      const skills = heroSkills(heroDef(u.heroId));
      for (let i = 0; i < skills.length; i++) {
        const sk = skills[i];
        if (!sk || isPassiveSkill(sk)) continue;
        if (sk.free && skillUsesLeft(u, i) > 0 && !(isRooted(u) && isSelfMoveSkill(u, sk))) return true;
      }
    }
  }
  return false;
}
/* 是否还有合法“移动”可做（定身 / 冰封 / 被抓 / 眩晕、四周被占或石柱均不算） */
function hasAnyMove(player) {
  for (const u of unitsOf(player)) {
    if (u.frozen > 0) continue;
    if (isDisabled(u) || isRooted(u)) continue;
    const pos = findPos(u);
    if (!pos) continue;
    for (const [dr, dc] of DIRS) {
      const nr = pos.r + dr, nc = pos.c + dc;
      if (!inBounds(nr, nc)) continue;
      const t = board[nr][nc];
      if (!t) return true;
      if (t.sword && u.heroId === "asura") return true;
    }
  }
  return false;
}
function dirName(dir) {
  if (dir[0] === -1) return "上";
  if (dir[0] === 1) return "下";
  if (dir[1] === -1) return "左";
  return "右";
}

/* ========================= 夹击判定（核心） =========================
 * 判定流程（严格分三步，避免递归）：
 *   第 1 步：根据“单位位置 / 阵营 / 棋盘边界”计算每名英雄的【基础夹击】
 *   第 2 步：对处于基础夹击的英雄，检查是否有【未被基础夹击的相邻队友】提供保护
 *   第 3 步：最终夹击 = 基础夹击 且 未被保护
 * 注意：保护者是否“自身被夹击”只参考其【基础夹击】，不再考虑它是否被保护，
 *       因此不会出现递归或循环判定。
 * ================================================================== */

/* 统计某格在四个正交方向上的“夹击方向数”：
 *   每有一名相邻敌人 → +1
 *   每有一侧紧贴棋盘边界（墙）→ +1
 * 直角相邻（如 左+上）、斜对角不额外限制；同方向的队友/空格不计。
 * 返回 { enemy, wall, total }。 */
function flankCountAt(r, c) {
  const u = board[r][c];
  if (!u || u.sword) return { enemy: 0, wall: 0, total: 0 };
  const f = u.player;
  let enemy = 0;
  let wall = 0;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) {
      wall++; // 棋盘边界（墙）算 1 个夹击方向
      continue;
    }
    const t = board[nr][nc];
    if (t && !t.sword && t.player !== f) enemy++; // 相邻敌人算 1 个夹击方向（剑刃不算）
  }
  return { enemy, wall, total: enemy + wall };
}

/* 基础夹击：至少相邻 1 名敌人，且夹击方向总数 ≥ 2（敌人 + 墙）。
 * 例：两名敌人（正相对或直角）→ 触发；一名敌人 + 一侧墙 → 触发；
 *     一名敌人且四周无墙 → 不触发。 */
function baseFlankedAt(r, c) {
  const fc = flankCountAt(r, c);
  return fc.enemy >= 1 && fc.total >= 2;
}

/* 计算全体英雄的夹击信息：Map<uid, {base, protected, flanked}> */
function computeFlankInfo() {
  const info = new Map();

  // 第 1 步：基础夹击 + 夹击方向数
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const u = board[r][c];
      if (!u || u.sword) continue;
      const fc = flankCountAt(r, c);
      info.set(u.uid, {
        enemy: fc.enemy,
        wall: fc.wall,
        count: fc.total,
        base: fc.enemy >= 1 && fc.total >= 2,
        protected: false,
        flanked: false,
        bonus: 0,
      });
    }

  // 第 2 步：队友保护（仅相邻正交的、自身【基础】未被夹击的队友才有资格保护）
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const u = board[r][c];
      if (!u || u.sword) continue;
      const d = info.get(u.uid);
      if (!d.base) continue;
      for (const [dr, dc] of DIRS) {
        const v = unitAt(r + dr, c + dc);
        if (v && v.player === u.player && !info.get(v.uid).base) {
          d.protected = true;
          break;
        }
      }
    }

  // 第 3 步：最终夹击 + 额外伤害（孤胆侠·孤胆激活时【免疫夹击加成】）
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const u = board[r][c];
      if (!u || u.sword) continue;
      const d = info.get(u.uid);
      if (!d) continue;
      d.immune = flankImmune(u);                       // 免疫夹击（孤胆侠·孤胆生效）
      d.flanked = d.base && !d.protected && !d.immune; // 免疫时不算夹击
      d.bonus = d.flanked ? d.count - 1 : 0;
    }

  return info;
}

/* 刺客·暗杀：刺客是否参与了针对 target 的夹击。
 * 包含两种情况：攻击者本身是刺客；或目标相邻存在「与攻击者同阵营」的刺客（协助夹击）。 */
function assassinInFlank(attacker, target) {
  if (!attacker || attacker.sword) return false;
  const p = findPos(target);
  if (!p) return false;
  for (const [dr, dc] of DIRS) {
    const v = unitAt(p.r + dr, p.c + dc);
    if (v && !v.sword && v.player === attacker.player && v.heroId === "assassin") return true;
  }
  return false;
}

/* ---------------- 西楚霸王·鬼雄 ---------------- */
/* 鬼雄是否已触发（触发后进入「绝境」：普通攻击伤害永久 +1） */
function isGuixiongActive(u) {
  return !!(u && !u.sword && u.heroId === "xiangyu" && u.guixiongUsed);
}
/* 鬼雄触发时的九宫格反击：对周围 8 格内所有敌方英雄各造成 2 点伤害（走统一伤害结算） */
function guixiongCounter(u) {
  const pos = findPos(u);
  if (!pos) return 0;
  const victims = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const t = unitAt(pos.r + dr, pos.c + dc);
      if (t && !t.sword && t.player !== u.player) victims.push(t);
    }
  }
  let hit = 0;
  for (const t of victims) {
    if (!findPos(t)) continue;
    applyDamage(t, 2, "skill", u); // 统一结算：护盾 / 闪避 / 阵亡 / 被动均生效
    hit++;
  }
  return hit;
}

/* 普通攻击伤害结算（纯计算，不产生副作用，便于测试）：
 * 基础伤害 1；若目标被夹击，额外 =（夹击方向数 − 1）。
 * 例：2 个方向 +1（共 2 点）、3 个方向 +2（共 3 点）、4 个方向 +3（共 4 点）。
 * 【刺客·暗杀】：刺客参与本次夹击时，夹击额外 +1（同一次夹击最多 +1）。
 * 【西楚霸王·绝境】：鬼雄触发后，普通攻击额外 +1（永久，仅普攻）。 */
function resolveNormalAttack(attacker, target) {
  const info = computeFlankInfo();
  const d = info.get(target.uid) || { base: false, protected: false, flanked: false, count: 0, bonus: 0 };
  const assassin = d.flanked && assassinInFlank(attacker, target) ? 1 : 0;
  const guixiong = isGuixiongActive(attacker) ? 1 : 0;
  return {
    base: d.base,
    protected: d.protected,
    count: d.count,
    flank: d.flanked,
    bonus: d.bonus,
    assassin,
    guixiong,
    damage: BASE_ATTACK + d.bonus + assassin + guixiong,
  };
}

/* ============================ 初始化 / 布阵 ============================ */
function firstAvailableHero(player) {
  const used = placedIds[player] || [];
  const list = (gameMode === "online" && onlinePool && onlinePool.length)
    ? onlinePool.map((id) => heroDef(id)).filter(Boolean)
    : HEROES;
  const h = list.find((x) => !used.includes(x.id));
  return h ? h.id : null;
}

function init() {
  board = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) row.push(null);
    board.push(row);
  }
  phase = "placement";
  currentPlayer = 1;
  toPlace = SOLDIERS_PER_PLAYER;
  placedIds = { 1: [], 2: [] };
  pendingHero = firstAvailableHero(1);
  selected = null;
  moveTargets = [];
  attackTargets = [];
  skillTargets = [];
  skillMode = false;
  winner = 0;
  logs = [];
  if (window.BFX) window.BFX.clear(); // 新开一局：清空上一局的战场痕迹与粒子
  if (window.SFX) window.SFX.stopAll(); // 清理上一局可能残留的持续音
  inputLockUntil = 0;
  unitSeq = 1;
  fx = [];
  // 锦囊：重新随机抽取，并清空所有临时效果
  talisman = { 1: drawTalismanId(), 2: drawTalismanId() };
  talismanUsed = { 1: false, 2: false };
  talismanMode = null;
  talismanTargets = [];
  talismanBuff = { assaultPlayer: 0, guardPlayer: 0 };
  extraMoves = 0;
  graveyard = [];
  reviveOptions = [];
  mists = {};
  // 对局统计 & 结算演出：重置
  matchStats = { damage: { 1: 0, 2: 0 }, kills: { 1: 0, 2: 0 }, startedAt: Date.now(), endedAt: 0, lastKiller: null };
  clearVictoryTimers();
  victorySeq = { active: false, played: false, resultShown: false, timers: [] };
  if (window.BFX) window.BFX.victoryHide();
  const _skip0 = document.getElementById("victory-skip");
  if (_skip0) _skip0.classList.add("hidden");
  if (overlayStatsEl) overlayStatsEl.innerHTML = "";
  overlayEl.classList.add("hidden");
  addLog("对局开始：双方各自选择并放置 3 名英雄。");
  addLog("🎴 双方各抽取了一张锦囊（见右侧「我的锦囊」）。");
  render();
  aiKick();
}

function handlePlacement(r, c) {
  if (gameMode === "online") {
    const me = mySide();
    if (territoryOf(c) !== me) { addLog("只能在自己的半场放置英雄。"); render(); return; }
    if (!pendingHero) { addLog("请先选择一名候选英雄。"); render(); return; }
    if (onlinePool && onlinePool.length && onlinePool.indexOf(pendingHero) < 0) {
      addLog("只能部署候选池中的英雄（本局由服务器随机抽取）。");
      render();
      return;
    }
    if (board[r][c]) { addLog("该格已被占用。"); render(); return; }
    onlineForward({ type: "place", heroId: pendingHero, r, c });
    return;
  }
  if (territoryOf(c) !== currentPlayer) {
    addLog("只能在自己的半场放置英雄。");
    render();
    return;
  }
  if (board[r][c]) return;
  if (!pendingHero) {
    addLog("请先在右侧选择一名英雄。");
    render();
    return;
  }
  if (placedIds[currentPlayer].includes(pendingHero)) {
    addLog("同一阵营不能重复选择同一名英雄。");
    render();
    return;
  }
  const def = heroDef(pendingHero);
  const unit = {
    uid: unitSeq++,
    heroId: def.id,
    player: currentPlayer,
    hp: def.hp,
    maxHp: def.hp,
    shield: 0,
    frozen: 0,
    swords: def.blades || 0,    // 阿修罗：携带剑数
    statuses: {},               // 负面状态（抓取等）
    lockUsed: false,            // 孤胆侠：致命伤锁血是否已用
    sdStage: 0,                 // 沧·水调歌头阶段（0=未开始 / 1=第二段待释放）
    dragonMoves: 0,             // 龙人·龙胆：额外移动机会
    empowerTurns: 0,            // 雷电之主·强化剩余自身回合
    chaseStage: 0,              // 刺客·追猎阶段（0=未开始 / 1=第二段待释放）
    chaseMark: 0,               // 被哪个刺客（uid）附加了追猎标记，0=无
    guixiongUsed: false,        // 西楚霸王·鬼雄：首次致命锁血是否已触发
    wxtStage: 0,                // 天道超·万象天引：连招阶段（0=第一段可用 / 1=第二段待执行 / 2=第三段待执行）
    stealth: null,              // 渡鸦·潜行：{ turns, fresh, startTurn, reason, broken }
    ravenBuff: false,           // 渡鸦·影袭强化：下一次主动攻击 +1
    ravenDouble: false,         // 渡鸦·潜行双动：本次潜行是否还有一次双动机会
    ravenDoubleUsed: false,     // 双动的第一次「走」是否已使用
    metalBuff: false,           // 金元素·金属强化：下一次普通攻击 +1 并定身
    metalTide: 0,               // 金元素·金属狂潮：剩余自身行动回合（受伤减半）
  };
  initUnitUses(unit, def);
  board[r][c] = unit;
  placedIds[currentPlayer].push(def.id);
  toPlace -= 1;
  addLog("玩家" + currentPlayer + " 放置了 " + def.name + "（" + def.hp + " 血）。");

  if (toPlace === 0) {
    if (currentPlayer === 1) {
      currentPlayer = 2;
      toPlace = SOLDIERS_PER_PLAYER;
      pendingHero = firstAvailableHero(2);
    } else {
      phase = "battle";
      currentPlayer = 1;
      beginTurn();
    }
  } else {
    pendingHero = firstAvailableHero(currentPlayer);
  }
  render();
}

/* ============================ 回合 / 选择 ============================ */
function clearSelection() {
  selected = null;
  moveTargets = [];
  attackTargets = [];
  skillTargets = [];
  skillMode = false;
  dashOptions = [];
  talismanMode = null;
  talismanTargets = [];
  skillSub = null;
  // 龙胆选点与普通选择互斥；换回合 / 执行其它行动时一并取消
  dragonMoveUnit = null;
  dragonMoveTargets = [];
}

/* 一方的回合开始：恢复“每回合型”技能次数（如阿修罗·剑圣），并清空选中 */
function beginTurn() {
  turnSerial += 1;
  for (const u of unitsOf(currentPlayer)) {
    const skills = heroSkills(heroDef(u.heroId));
    skills.forEach((s, i) => {
      if (s && s.perTurn) setSkillUsesLeft(u, i, s.perTurn);
    });
  }
  turnActionUsed = false;
  // 雷电之主：强化回合 → 每回合 2 次行动（仅限该英雄）
  const emp = empoweredActorFor(currentPlayer);
  empowerTurnActive = !!emp;
  const tdef = heroDef("thunder");
  turnActionsMax = emp ? ((tdef && tdef.skill && tdef.skill.empowerActions) || 2) : 1;
  turnActionsLeft = turnActionsMax;
  turnActorUid = emp ? emp.uid : 0;
  extraMoves = 0;
  // 锦囊：清理只为上一方生效的临时效果
  if (talismanBuff.assaultPlayer && talismanBuff.assaultPlayer !== currentPlayer) talismanBuff.assaultPlayer = 0;
  if (talismanBuff.guardPlayer === currentPlayer) talismanBuff.guardPlayer = 0; // 坚守令持续到本方下个回合开始
  clearSelection();
  if (window.SFX) window.SFX.unlock();
  if (phase === "battle") {
    if (!turnFxSuppress && window.BFX) {
      let title;
      if (gameMode === "online" && window.NET && window.NET.myPlayer) {
        title = currentPlayer === window.NET.myPlayer ? "你的回合" : "对手回合";
      } else if (gameMode === "ai") {
        title = currentPlayer === aiPlayer ? "对手回合" : "你的回合";
      } else {
        title = "玩家 " + currentPlayer + " 的回合";
      }
      const extra = turnFxExtra;
      try {
        window.BFX.turnTransition({
          player: currentPlayer,
          extra,
          title: extra ? "额外回合" : title,
          sub: extra
            ? "玩家 " + currentPlayer + " 继续行动 · 技能次数不刷新"
            : "玩家 " + currentPlayer + (gameMode === "ai" && currentPlayer === aiPlayer ? " · AI" : ""),
        });
      } catch (e) { /* 表现层失败不影响回合 */ }
      // 转场期间短暂锁输入（0.45s，远短于演出本身，不会卡住操作）
      inputLockUntil = Math.max(inputLockUntil, Date.now() + 450);
    } else if (window.BFX && turnFxSuppress) {
      // 自动跳过：只更新回合提示，不播完整转场
      window.BFX.banner("玩家 " + currentPlayer + " 的回合", "");
    }
  }
  turnFxExtra = false;
}

/* 结束当前玩家回合并交给对手（含行军令额外回合）。不含“自动跳过无行动玩家”。 */
function endTurnOnce() {
  // 毒雾：当前玩家位于毒雾格的英雄各受 0.5（在回合结束、离开判定后结算）
  applyMistPoison(currentPlayer);
  if (checkVictory()) return;
  // 临时石柱：每完成一个完整回合结束衰减一次（生成当回合不扣）
  tickPillars();
  for (const u of unitsOf(currentPlayer)) if (u.frozen > 0) u.frozen -= 1;
  tickStatuses(currentPlayer); // 负面状态（如抓取）在本回合结束时递减/结算
  // 雷电之主：强化按“自身回合”计算，本回合若为强化回合则递减；归零时清除护盾
  if (empowerTurnActive) {
    for (const u of unitsOf(currentPlayer)) {
      if (u.heroId === "thunder" && (u.empowerTurns || 0) > 0) {
        u.empowerTurns -= 1;
        if (u.empowerTurns <= 0) {
          u.shield = 0;
          addLog("⚡ 雷电之主的强化状态结束（剩余护盾清除）。");
          if (window.SFX) {
            window.SFX.play("buffDown", { hero: "thunder" });
            window.SFX.stopLoop("empower");
          }
          if (window.BFX) {
            const pp = findPos(u);
            if (pp) window.BFX.cast({ type: "passive", heroId: "thunder", caster: { r: pp.r, c: pp.c } });
          }
        }
      }
    }
  }
  empowerTurnActive = false;
  // 行军令：若本回合附加了「额外回合」，则不交给对方，而是让当前玩家再获得一个完整回合
  const samePlayer = extraTurnPending;
  extraTurnPending = false;
  // 渡鸦：潜行时长只在真实回合交接时推进（行军令额外回合不缩短）；双动机会在回合结束时作废
  tickRavenTurn(currentPlayer, !samePlayer);
  // 金元素·金属狂潮：按自己的行动回合计时（本回合使用后跨 3 个自身回合）
  tickMetalTurn(currentPlayer);
  // 毒雾：只在真实回合交接时衰减（额外回合不缩短），生成当回合不扣
  if (!samePlayer) tickMists();
  if (!samePlayer) currentPlayer = currentPlayer === 1 ? 2 : 1;
  turnFxExtra = samePlayer;
  // 阶段 A：当前回合收束（短促低频；与技能音效分离）
  if (!turnFxSuppress && window.SFX) window.SFX.play("turnEnd", {});
  beginTurn();
  if (samePlayer) addLog("🐎 行军令：玩家" + currentPlayer + " 获得一个额外回合（行动已刷新）。");
  render();
  // 回合交接后触发 AI（此前 AI 依赖“行动时自动结束回合”的棋盘点击回调，改为手动结束后必须在这里补上）
  aiKick();
}

/* 统一结束回合：结束当前玩家回合；若接手的一方没有任何合法行动（全被冰封 / 被抓取等），
 * 自动继续推进（带上限防止双方连续无行动时死循环）。联机由服务端权威处理，客户端只在单机 / AI 执行。 */
function endTurn() {
  endTurnOnce();
  settleStuckTurns();
}
function settleStuckTurns() {
  if (gameMode === "online") return;
  let guard = 0;
  while (guard++ < 4 && phase === "battle" && !hasAnyAction(currentPlayer)) {
    addLog("⏭ 玩家" + currentPlayer + " 没有可执行的行动（被冰封 / 抓取等），自动结束回合。");
    // 自动跳过时抑制完整转场，避免双方连续无行动时动画连播
    const prevSuppress = turnFxSuppress;
    turnFxSuppress = true;
    endTurnOnce();
    turnFxSuppress = prevSuppress;
  }
}

/* 一次行动后的收尾。
 * 回合不再自动结束：行动完成后仍停留在当前回合，玩家可继续使用锦囊 /
 * 「不耗步」技能 / 行军令的额外移动，最后手动点「结束回合」交给对方。
 * - isFree=true（不耗步技能）不消耗行动机会；
 * - 普通行动消耗 1 次行动机会（雷电之主强化回合为 2 次）。 */
function afterAction(actor, isFree, keepOpen) {
  inputLockUntil = Date.now() + 160; // 表现层：极短输入锁，防止连点造成重复行动（规则本身也会校验）
  clearSelection();
  if (checkVictory()) return;
  if (!isFree) {
    turnActionsLeft -= 1;
    turnActionUsed = turnActionsLeft <= 0;
  }
  render();
}

function checkVictory() {
  if (phase !== "battle") return false;
  const p1 = aliveCount(1);
  const p2 = aliveCount(2);
  if (p1 === 0 || p2 === 0) {
    phase = "over";
    winner = p1 === 0 ? 2 : 1;
    // 对局结束：清理临时地形与潜行相关状态
    mists = {};
    for (const u of unitsOf(1).concat(unitsOf(2))) clearRavenStealth(u);
    // 对局结束：清理临时石柱及其计时状态
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isPillar(board[r][c])) board[r][c] = null;
    if (!matchStats.endedAt) matchStats.endedAt = Date.now();
    if (!matchStats.startedAt) matchStats.startedAt = matchStats.endedAt;
    addLog("玩家" + winner + " 获胜！");
    clearSelection();
    render();
    startVictorySequence();
    return true;
  }
  return false;
}

/* ============================ 胜负结算演出 ============================ */
/* 本地视角的结果类型：胜利 / 失败 / 平局（本地双人视为“胜利方展示”） */
function resultKind() {
  if (winner === 0) return "draw";
  if (gameMode === "ai") return winner === aiPlayer ? "lose" : "win";
  if (gameMode === "online" && window.NET && window.NET.myPlayer) return winner === window.NET.myPlayer ? "win" : "lose";
  return "win";
}
function clearVictoryTimers() {
  for (const t of victorySeq.timers) clearTimeout(t);
  victorySeq.timers = [];
}
/* 结算主角：优先“最后击杀者”，否则胜利方存活英雄 */
function victoryHeroPick() {
  const side = winner === 1 ? 1 : 2;
  let heroId = "";
  if (matchStats.lastKiller && matchStats.lastKiller.player === side) heroId = matchStats.lastKiller.heroId;
  let cell = null;
  if (heroId) {
    for (const u of unitsOf(side)) {
      if (u.heroId === heroId) { cell = findPos(u); break; }
    }
  }
  if (!cell) {
    const alive = unitsOf(side);
    if (alive.length) { heroId = alive[0].heroId; cell = findPos(alive[0]); }
  }
  return { heroId, cell };
}
/* 结算演出：最后一击余韵 → 胜负氛围 → 标题 → 结算面板；可跳过 */
function startVictorySequence(opts) {
  opts = opts || {};
  if (victorySeq.played) { showResultPanel(); return; }
  victorySeq.played = true;
  victorySeq.active = true;
  victorySeq.resultShown = false;
  clearVictoryTimers();

  const kind = resultKind();
  const fast = !!(window.BFX && window.BFX.options.reduce);
  const tBurst = fast ? 60 : 620;
  const tTitle = fast ? 220 : 1250;
  const tPanel = fast ? 560 : 2350;
  const pick = victoryHeroPick();
  const side = winner === 2 ? 2 : 1;

  const skip = document.getElementById("victory-skip");
  if (skip) skip.classList.toggle("hidden", !!opts.noSkip);

  // 第一阶段：最后一击的余韵（只有真实击杀才停顿/轻闪）
  if (matchStats.lastKiller && window.BFX && !fast) {
    window.BFX.hitstop(140);
    window.BFX.shake(3);
    window.BFX.flash(kind === "lose" ? "#7f1d1d" : "#fde68a", 0.1);
  }

  // 第二阶段：胜负氛围 + 主角专属姿态
  victorySeq.timers.push(setTimeout(() => {
    if (window.BFX) window.BFX.victoryBurst({ kind, side, heroId: pick.heroId, cell: pick.cell });
    if (window.SFX) {
      window.SFX.stopAll();
      window.SFX.play(kind === "win" ? "win" : kind === "lose" ? "lose" : "draw", { hero: pick.heroId });
    }
  }, tBurst));

  // 第三阶段：标题
  victorySeq.timers.push(setTimeout(() => {
    const title = kind === "win" ? "胜利！" : kind === "lose" ? "失败" : "平局";
    const sub = kind === "win"
      ? (gameMode === "local" ? "玩家 " + winner + " 获胜 · 剩余英雄 " + aliveCount(winner) + " 名" : "本场对决，你赢了！")
      : kind === "lose" ? "再接再厉，下一局赢回来" : "势均力敌";
    if (window.BFX) window.BFX.victoryTitle({ kind, title, sub });
  }, tTitle));

  // 第四阶段：结算面板
  victorySeq.timers.push(setTimeout(showResultPanel, tPanel));
}
/* 跳过 / 演出结束：直接展示结算面板（不影响服务端已判定的结果） */
function showResultPanel() {
  clearVictoryTimers();
  victorySeq.active = false;
  victorySeq.resultShown = true;
  const skip = document.getElementById("victory-skip");
  if (skip) skip.classList.add("hidden");
  if (window.BFX) window.BFX.victoryHide();
  updatePanel();
}
/* 重连 / 已结束对局：直接显示面板，不重播整段动画 */
function showResultPanelImmediate() {
  victorySeq.played = true;
  showResultPanel();
}

function computeTargets() {
  moveTargets = [];
  attackTargets = [];
  if (!selected) return;
  const u = board[selected.r][selected.c];
  if (!u || u.sword) return;
  if (isDisabled(u)) return; // 被抓取 / 眩晕：不能移动或攻击
  const canMove = !isRooted(u); // 定身：不能移动，但仍可攻击
  for (const [dr, dc] of DIRS) {
    const nr = selected.r + dr;
    const nc = selected.c + dc;
    if (!inBounds(nr, nc)) continue;
    const t = board[nr][nc];
    if (!t) { if (canMove) moveTargets.push([nr, nc]); }
    else if (t.sword) {
      if (u.heroId === "asura" && canMove) moveTargets.push([nr, nc]); // 阿修罗可进入并回收剑
    } else if (isPillar(t)) {
      // 石柱：阻挡移动，也不能被普通攻击
    } else if (t.player !== u.player) {
      attackTargets.push([nr, nc]);
    }
  }
  // 游侠：普通攻击可打到距离 2 的敌人，且无视中间阻挡
  if (u.heroId === "ranger") {
    for (const [rr, cc] of cellsWithin(selected.r, selected.c, 2, false)) {
      if (Math.abs(rr - selected.r) + Math.abs(cc - selected.c) !== 2) continue;
      const t = unitAt(rr, cc);
      if (t && t.player !== u.player) attackTargets.push([rr, cc]);
    }
  }
}

/* 游侠技能范围：前后左右 range 格（同一行/列）+ 以自身为中心的九宫格 */
function rangerSkillRangeOk(dr, dc, range) {
  if (!dr && !dc) return false;
  if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) return true; // 九宫格（含四个斜角）
  return (dr === 0 || dc === 0) && Math.abs(dr) + Math.abs(dc) <= (range || 4);
}

/* 曼哈顿距离内的所有格子（includeSelf 决定是否含自身格） */
function cellsWithin(r, c, range, includeSelf) {
  const res = [];
  for (let rr = 0; rr < SIZE; rr++)
    for (let cc = 0; cc < SIZE; cc++) {
      const d = Math.abs(rr - r) + Math.abs(cc - c);
      if (d === 0) {
        if (includeSelf) res.push([rr, cc]);
        continue;
      }
      if (d <= range) res.push([rr, cc]);
    }
  return res;
}

/* 阿修罗·剑圣：计算某个方向的突进结果
 * 规则：向前最多 3 格；空格/剑可落点；我方英雄与墙壁阻挡；敌人沿途受伤但不停顿。
 * 返回 { dir, dest, hits }；dest 为空表示该方向不可突进（不合法）。 */
function computeDash(u, r, c, dr, dc) {
  // 与沧共用统一突进路径（可穿过友军，不伤害友军）
  return computeDashPath(u, r, c, dr, dc, 3);
}

/* 依据技能类型计算可选目标格 */
function computeSkillTargets() {
  skillTargets = [];
  dashOptions = [];
  if (!selected) return;
  const u = board[selected.r][selected.c];
  if (!u || u.sword) return;
  const s = activeSkillOf(u);
  const { r, c } = selected;

  switch (s.type) {
    case "damage_single":
    case "freeze":
      for (const [rr, cc] of cellsWithin(r, c, s.range, false)) {
        const t = unitAt(rr, cc);
        if (t && !t.sword && t.player !== u.player) skillTargets.push([rr, cc]);
      }
      break;

    case "heal":
      for (const [rr, cc] of cellsWithin(r, c, s.range, true)) {
        const t = unitAt(rr, cc);
        if (t && !t.sword && t.player === u.player && t.hp < t.maxHp) skillTargets.push([rr, cc]);
      }
      break;

    case "damage_adjacent_all":
      for (const [dr, dc] of DIRS) {
        const t = unitAt(r + dr, c + dc);
        if (t && !t.sword && t.player !== u.player) skillTargets.push([r + dr, c + dc]);
      }
      break;

    case "damage_line":
      // 游侠：前后左右 4 格 + 以自身为中心的九宫格内指定敌人；无视中间阻挡
      for (let rr = 0; rr < SIZE; rr++) {
        for (let cc = 0; cc < SIZE; cc++) {
          if (!rangerSkillRangeOk(rr - r, cc - c, s.range)) continue;
          const t = unitAt(rr, cc);
          if (t && t.player !== u.player) skillTargets.push([rr, cc]);
        }
      }
      break;

    case "shield_self":
      skillTargets.push([r, c]);
      break;

    case "blink":
      for (const [rr, cc] of cellsWithin(r, c, s.range, false)) {
        if (!unitAt(rr, cc)) skillTargets.push([rr, cc]);
      }
      break;

    case "dash":
      for (const [dr, dc] of DIRS) {
        const opt = computeDash(u, r, c, dr, dc);
        // 有落点则点落点；整条路都是敌人（无落点）时，只要命中了敌人也允许发动
        const target = opt.dest || (opt.hits.length ? opt.hits[0] : null);
        if (target) {
          opt.target = target;
          skillTargets.push([target.r, target.c]);
          dashOptions.push(opt);
        }
      }
      break;

    case "duanlang":
      // 向四个方向前进一格的合法落点（只能落在空格）
      for (const [dr, dc] of DIRS) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        if (!board[rr][cc]) skillTargets.push([rr, cc]);
      }
      break;

    case "shuidiao":
      if ((u.sdStage || 0) === 1) {
        // 第二段：向前突进 2 格
        for (const [dr, dc] of DIRS) {
          const opt = computeDashPath(u, r, c, dr, dc, 2);
          const tgt = opt.dest || (opt.hits.length ? opt.hits[0] : null);
          if (tgt) {
            opt.target = tgt;
            opt.stage = 2;
            skillTargets.push([tgt.r, tgt.c]);
            dashOptions.push(opt);
          }
        }
      } else if (skillSub && skillSub.kind === "sd1-dash") {
        // 第一段第 2 步：位移后向前突进 3 格
        for (const [dr, dc] of DIRS) {
          const opt = computeDashPath(u, r, c, dr, dc, 3);
          const tgt = opt.dest || (opt.hits.length ? opt.hits[0] : null);
          if (tgt) {
            opt.target = tgt;
            opt.stage = 1;
            skillTargets.push([tgt.r, tgt.c]);
            dashOptions.push(opt);
          }
        }
      } else {
        // 第一段第 1 步：九宫格内的位移落点（空格，含自身格）
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (!inBounds(rr, cc)) continue;
            if (dr === 0 && dc === 0) {
              skillTargets.push([rr, cc]);
            } else if (!board[rr][cc]) {
              skillTargets.push([rr, cc]);
            }
          }
        }
      }
      break;

    case "dragonbreath": {
      // 4 个方向的 3×2 区域并集（点击区域内任意格发动）
      const seen = new Set();
      for (const [dr, dc] of DIRS) {
        for (const [rr, cc] of dragonBreathArea(u, r, c, dr, dc)) {
          const key = rr + "_" + cc;
          if (seen.has(key)) continue;
          seen.add(key);
          skillTargets.push([rr, cc]);
        }
      }
      break;
    }

    case "thunder": {
      // 目标：自身九宫格（不含自身格） + 四方向第 2 格；须为空格或敌方格
      const cand = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          cand.push([r + dr, c + dc]);
        }
      }
      for (const [dr, dc] of DIRS) cand.push([r + dr * 2, c + dc * 2]);
      const seen = new Set();
      for (const [rr, cc] of cand) {
        if (!inBounds(rr, cc)) continue;
        const key = rr + "_" + cc;
        if (seen.has(key)) continue;
        seen.add(key);
        const t = board[rr][cc];
        if (t && (t.sword || t.player === u.player)) continue; // 剑刃/友军不可
        skillTargets.push([rr, cc]);
      }
      break;
    }

    case "shield_ally": {
      // 全地图：所有己方存活英雄
      for (const v of unitsOf(u.player)) {
        const p = findPos(v);
        if (p) skillTargets.push([p.r, p.c]);
      }
      break;
    }

    case "chase": {
      if ((u.chaseStage || 0) === 1) {
        // 第二段：高亮所有被自己标记的存活敌方英雄
        for (const v of chaseTargetsOf(u)) {
          const p = findPos(v);
          if (p) skillTargets.push([p.r, p.c]);
        }
      } else {
        // 第一段：四个方向的整条线（贯穿到棋盘边界，穿过一切）
        for (const [dr, dc] of DIRS) {
          const opt = computeChaseLine(u, r, c, dr, dc);
          if (!opt.path.length) continue;
          opt.kind = "chase-line";
          opt.target = opt.path[opt.path.length - 1];
          for (const [rr, cc] of opt.path) skillTargets.push([rr, cc]);
          dashOptions.push(opt);
        }
      }
      break;
    }

    case "bloodburst": {
      // 以自身为中心的九宫格：高亮范围内的敌方英雄；没有敌人时也可释放（点击自身格）
      skillTargets.push([r, c]);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const t = unitAt(r + dr, c + dc);
          if (t && !t.sword && t.player !== u.player) skillTargets.push([r + dr, c + dc]);
        }
      }
      break;
    }

    case "ziwei": {
      // 与雷霆万钧同范围：九宫格 8 格 + 四方向第 2 格；落点必须完全为空
      const cand = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        cand.push([r + dr, c + dc]);
      }
      for (const [dr, dc] of DIRS) cand.push([r + dr * 2, c + dc * 2]);
      const seenZ = new Set();
      for (const [rr, cc] of cand) {
        if (!inBounds(rr, cc)) continue;
        const key = rr + "_" + cc;
        if (seenZ.has(key)) continue;
        seenZ.add(key);
        if (board[rr][cc]) continue; // 落点必须为空（任何英雄/剑刃）
        skillTargets.push([rr, cc]);
      }
      break;
    }

    case "exile": {
      if (skillSub && skillSub.kind === "exile-target") {
        // 第 2 步：可选的墙角（四宫格全空的墙角）
        for (const cn of BOARD_CORNERS) {
          if (cornerExileOk(cn)) skillTargets.push([cn.corner.r, cn.corner.c]);
        }
      } else {
        // 第 1 步：全图存活敌方英雄
        for (const v of unitsOf(u.player === 1 ? 2 : 1)) {
          const p = findPos(v);
          if (p) skillTargets.push([p.r, p.c]);
        }
      }
      break;
    }

    case "tianwei": {
      // 全图任意空格落点
      for (let rr = 0; rr < SIZE; rr++) for (let cc = 0; cc < SIZE; cc++) {
        if (!board[rr][cc]) skillTargets.push([rr, cc]);
      }
      break;
    }

    case "shenluo": {
      // 九宫格内敌人；没有敌人时也可释放（点击自身格）
      for (const d of DIRS) {
        const t = unitAt(r + d[0], c + d[1]);
        if (t && !t.sword && t.player !== u.player) skillTargets.push([r + d[0], c + d[1]]);
      }
      skillTargets.push([r, c]);
      break;
    }

    case "wxt": {
      const stage = u.wxtStage || 0;
      if (stage === 2) {
        // 第三段：普通攻击范围（相邻）内的敌人
        for (const [rr, cc] of wxtStageTargets(u, r, c, 0, 0, 2)) skillTargets.push([rr, cc]);
      } else if (!(skillSub && skillSub.kind === "wxt-dir-set")) {
        // 第 0 步：选择方向（高亮上下左右四格）
        for (const d of DIRS) {
          const rr = r + d[0], cc = c + d[1];
          if (!inBounds(rr, cc)) continue;
          skillTargets.push([rr, cc]);
          dashOptions.push({ kind: "wxt-dir", dir: [d[0], d[1]], dest: { r: rr, c: cc }, path: [[rr, cc]] });
        }
      } else {
        const [dr, dc] = skillSub.dir;
        for (const [rr, cc] of wxtStageTargets(u, r, c, dr, dc, stage)) skillTargets.push([rr, cc]);
        // 预览落点（第一段=正前方两格；第二段=正前方一格）
        const lr = stage === 0 ? r + dr * 2 : r + dr;
        const lc = stage === 0 ? c + dc * 2 : c + dc;
        if (inBounds(lr, lc) && !board[lr][lc]) dashOptions.push({ kind: "wxt-landing", path: [[lr, lc]] });
      }
      break;
    }

    case "metalpierce": {
      for (const [dr, dc] of DIRS) {
        if (metalPierceInfo(u, r, c, dr, dc).length) {
          skillTargets.push([r + dr, c + dc]);
        }
      }
      break;
    }

    case "metalarmor":
    case "metaltide":
      skillTargets.push([r, c]);
      break;

    case "stealth": {
      // 雷霆万钧范围：3×3 + 上下左右 2 格；空格或原地
      for (let rr = 0; rr < SIZE; rr++) {
        for (let cc = 0; cc < SIZE; cc++) {
          if (!stealthRangeOk(rr - r, cc - c)) continue;
          if (rr === r && cc === c) { skillTargets.push([rr, cc]); continue; }
          if (!board[rr][cc]) skillTargets.push([rr, cc]);
        }
      }
      break;
    }

    case "mistdash": {
      for (const [dr, dc] of DIRS) {
        const o = mistDashPath(u, r, c, dr, dc, s.range || 3);
        if (!o.dest) continue;
        skillTargets.push([r + dr, c + dc]); // 点击相邻方向格
        dashOptions.push({ kind: "mistdash", dir: [dr, dc], path: o.path, dest: o.dest });
      }
      break;
    }

    case "shadowfang": {
      for (const [dr, dc] of DIRS) {
        const t = unitAt(r + dr, c + dc);
        if (t && t.player !== u.player) skillTargets.push([r + dr, c + dc]);
      }
      break;
    }

    case "push": {
      // 目标：正前方 2 格内的第一个敌人；方向由点击的敌人位置推导
      for (const [dr, dc] of DIRS) {
        const info = pushDirInfo(u, r, c, dr, dc);
        if (!info) continue;
        skillTargets.push([info.r, info.c]);
        const line = [[info.r, info.c]];
        const destR = r + dr * 2, destC = c + dc * 2;
        if (inBounds(destR, destC)) line.push([destR, destC]);
        dashOptions.push({ kind: "push-line", path: line });
      }
      break;
    }

    case "charge": {
      // 目标：普通攻击范围（相邻）内的敌方英雄；冲锋/击退方向 = 由自身指向目标
      for (const [rr, cc] of chargeTargets(u, r, c)) {
        skillTargets.push([rr, cc]);
        // 预览：目标身后最多两格（预计击退方向）
        const dr = rr - r, dc = cc - c;
        const path = [];
        for (let st = 1; st <= 2; st++) {
          const nr = rr + dr * st, nc = cc + dc * st;
          if (!inBounds(nr, nc)) break;
          path.push([nr, nc]);
        }
        if (path.length) dashOptions.push({ kind: "charge-preview", path });
      }
      break;
    }
  }
}

/* ============================ 行动执行 ============================ */
function moveHero(r, c) {
  if (gameMode === "online") {
    onlineForward({ type: "move", from: { r: selected.r, c: selected.c }, to: { r, c } });
    return;
  }
  const { r: fr, c: fc } = selected;
  const u = board[fr][fc];
  if (isDisabled(u)) {
    addLog(label(u) + " 处于【" + actionBlockReason(u) + "】状态，无法移动。");
    clearSelection();
    render();
    return;
  }
  if (isRooted(u)) {
    addLog(label(u) + " 处于【定身】状态，无法移动（仍可攻击或使用非位移技能）。");
    clearSelection();
    render();
    return;
  }
  const isExtra = !canActNow(u);             // 本回合行动已用尽 → 需消耗一次“额外移动”
  if (isExtra && extraMoves <= 0) {
    addLog("本回合已经行动过了（不耗步技能 / 行军令除外）。");
    clearSelection();
    render();
    return;
  }
  // 渡鸦·潜行双动：隐身期间第一次「走」不消耗行动，之后还可再走一次或普通攻击
  const isDoubleFirst = !isExtra && !turnActionUsed && isStealthed(u) && u.ravenDouble && !u.ravenDoubleUsed;
  const isDoubleSecond = !isExtra && !turnActionUsed && u.ravenDoubleUsed;
  const picked = collectSwordAt(r, c, u); // 阿修罗进入剑格：回收
  if (window.BFX) {
    window.BFX.move({
      from: { r: fr, c: fc }, to: { r, c },
      color: window.BFX.heroColor(u.heroId),
      dash: u.heroId === "asura",
    });
  }
  board[r][c] = u;
  board[fr][fc] = null;
  if (picked) {
    addLog("⚔ " + label(u) + " 回收了一把剑（携带 " + u.swords + " 把）。");
    if (window.SFX) window.SFX.play("swordPickup", { hero: "asura" });
  }
  addLog(label(u) + " 移动到 (" + (r + 1) + "," + (c + 1) + ")。");
  if (isDoubleFirst) {
    u.ravenDoubleUsed = true;
    addLog("🌑 潜行双动：移动完成，还可再进行一次移动或普通攻击。");
    clearSelection();
    render();
    return;
  }
  if (isDoubleSecond) {
    u.ravenDouble = false;
    u.ravenDoubleUsed = false;
    addLog("🌑 潜行双动：第二次移动完成。");
  }
  if (isExtra) {
    extraMoves -= 1;
    addLog("🐎 行军令：额外移动一次（剩余 " + extraMoves + " 次）。");
    clearSelection();
    if (checkVictory()) return;
    render(); // 不自动结束回合：仍可继续用锦囊/不耗步技能，或手动结束
    return;
  }
  turnActionUsed = true;
  afterAction(u);
}

/* 单位阵亡统一处理（伤害 / 生命代价共用）：记录、移除、音画、锻剑、击杀刷新、战绩 */
function handleUnitDeath(target, source, pos) {
  if (!target || !pos) return;
  // 追猎标记清理：目标阵亡 → 清除其标记；若阵亡者是刺客本人 → 清除其遗留的全部标记
  target.chaseMark = 0;
  if (target.heroId === "assassin") clearChaseMarks(target.uid);
  // 记录阵亡（供还魂令），必须在生成剑刃之前、清空棋盘之前
  graveyard.push({
    player: target.player,
    heroId: target.heroId,
    name: heroDef(target.heroId).name,
    r: pos.r,
    c: pos.c,
    usesLeft: target.usesLeft || 0,
    usesArr: target.usesArr ? target.usesArr.slice() : null,
    swords: target.swords || 0,
    lockUsed: !!target.lockUsed,
    guixiongUsed: !!target.guixiongUsed,
    snapshot: JSON.parse(JSON.stringify(target)), // 复活时原样恢复阵亡瞬间的全部状态
  });
  board[pos.r][pos.c] = null;
  addLog(label(target) + " 阵亡！");
  if (window.SFX) window.SFX.play("death", { hero: target.heroId });
  if (window.SFX && target.heroId === "thunder") window.SFX.stopLoop("empower");
  if (window.BFX) window.BFX.death({ r: pos.r, c: pos.c, color: window.BFX.heroColor(target.heroId) });
  // 阿修罗·锻剑：阿修罗存活时，阵亡位置留下一把剑
  if (spawnSword(pos.r, pos.c)) {
    addLog("⚔ 锻剑：" + label(target) + " 的阵亡处留下了一把剑。");
    if (window.SFX) window.SFX.play("swordSpawn", { hero: "asura" });
  }
  // 击杀刷新：刺客·追猎 / 吸血鬼·血崩（同一次击杀只刷新一次）
  if (source && !source.sword && source.player !== target.player && findPos(source)) {
    refreshSkillOnKill(source);
  }
  // 真实战绩：击杀数 + 最后击杀者（用于结算演出主角与面板）
  if (source && !source.sword && source.player !== target.player) {
    matchStats.kills[source.player] = (matchStats.kills[source.player] || 0) + 1;
    matchStats.lastKiller = { player: source.player, heroId: source.heroId };
  }
}

/* 金元素：主动支付生命值（不吃护盾/闪避/减伤），归零立即按正常阵亡流程处理 */
function payHpCost(u, amount, reason) {
  if (!u) return false;
  // 金属狂潮期间：技能的生命代价同样减半
  const cost = u.metalTide > 0 ? amount * 0.5 : amount;
  u.hp -= cost;
  addLog("💢 " + label(u) + " 失去 " + cost + " 点生命值（" + (reason || "技能代价") + (cost !== amount ? "·金属狂潮减半" : "") + "）。");
  if (window.SFX) window.SFX.play("cost", { hero: u.heroId });
  const p = findPos(u);
  if (p && window.BFX) window.BFX.cast({ type: "metalCost", heroId: u.heroId, caster: p, amount: cost });
  if (u.hp <= 0 && p) {
    handleUnitDeath(u, null, p);
    return false;
  }
  return true;
}

/* 伤害应用：先扣护盾，再扣生命；生命归零立即从棋盘移除 */
function applyDamage(target, amount, kind, source) {
  const pos = findPos(target);
  let dmg = amount;

  // 坚守令：己方英雄受到的每次伤害 -1（最低 0）
  if (guardOn(target.player) && dmg > 0) {
    dmg = Math.max(0, dmg - 1);
    addLog("🛡 坚守令为 " + label(target) + " 减免 1 点伤害。");
  }

  // 金属狂潮：受到的伤害减半（只在此处结算一次；之后仍可被护盾/闪避等正常处理）
  if (dmg > 0 && target.metalTide > 0) {
    const beforeHalf = dmg;
    dmg = dmg * 0.5;
    addLog("🛡 金属狂潮：" + label(target) + " 受到的伤害减半（" + beforeHalf + " → " + dmg + "）。");
    if (pos) fx.push({ r: pos.r, c: pos.c, text: "减伤50%", kind: "shield" });
    if (window.SFX) window.SFX.play("metalGuard", { hero: "metal" });
  }

  const shieldBefore = target.shield;
  let absorbedTotal = 0;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
    absorbedTotal += absorbed;
    if (absorbed > 0) addLog(label(target) + " 的护盾抵挡了 " + absorbed + " 点伤害。");
  }
  // 孤胆侠·霸体：首次致命伤害 → 锁血到 1（每局一次，规则层判定，非致命伤害不消耗）
  if (dmg > 0 && target.hp - dmg <= 0 && target.heroId === "lone" && hasSuperArmor(target) && !target.lockUsed) {
    target.lockUsed = true;
    dmg = Math.max(0, target.hp - 1);
    addLog("🛡 孤胆侠·霸体：抵挡本次致命伤害，生命锁定为 1 点（本局一次）。");
    if (window.SFX) window.SFX.play("buffUp", { hero: "lone" });
    if (pos) fx.push({ r: pos.r, c: pos.c, text: "锁血!", kind: "shield" });
  }
  // 龙魂：龙人受到实际伤害前有 1/2（50%）概率闪避（护盾等前置减伤处理之后；完全抵消则不触发）
  // 每次伤害事件只判定一次；闪避成功则获得 1 次龙胆额外移动次数
  let dodged = false;
  if (dmg > 0 && target.heroId === "longren" && dragonDodged()) {
    dodged = true;
    dmg = 0;
    addLog("🐉 龙魂：龙人闪避了本次伤害（0 点）。");
    grantDragonMove(target);
  }
  // 西楚霸王·鬼雄：首次致命伤害 → 锁血到 1（每局一次），随后反击九宫格内敌人并进入绝境强化
  let guixiongTriggered = false;
  if (dmg > 0 && target.hp - dmg <= 0 && target.heroId === "xiangyu" && !target.guixiongUsed) {
    target.guixiongUsed = true;
    guixiongTriggered = true;
    dmg = Math.max(0, target.hp - 1);
    addLog("👹 西楚霸王·鬼雄：锁定生命为 1 点，免于阵亡（本局一次）！");
    if (window.SFX) window.SFX.play("buffUp", { hero: "xiangyu" });
    if (pos) fx.push({ r: pos.r, c: pos.c, text: "鬼雄!", kind: "skill" });
  }
  if (dmg > 0) target.hp -= dmg;

  // 鬼雄的反击在「锁血生效之后」执行：对九宫格内所有敌人各 2 点（走统一结算）
  if (guixiongTriggered && findPos(target)) {
    const hit = guixiongCounter(target);
    addLog("👹 鬼雄反击：对九宫格内 " + hit + " 名敌人各造成 2 点伤害。");
    addLog("👹 西楚霸王进入【绝境】：此后普通攻击伤害 +1（持续到本局结束）。");
  }

  if (pos) fx.push({ r: pos.r, c: pos.c, text: dodged ? "闪避" : (dmg > 0 ? "-" + dmg : "格挡"), kind: kind || "normal" });

  // 命中音效：只在真实结果上播放（闪避 / 护盾 / 命中 / 重击各有独立配方）
  if (window.SFX) {
    const atkHero = (source && !source.sword) ? source.heroId : target.heroId;
    if (dodged) {
      window.SFX.play("dodge", { hero: target.heroId });
    } else if (absorbedTotal > 0) {
      if (shieldBefore > 0 && target.shield <= 0) window.SFX.play("shieldBreak", { hero: target.heroId });
      else window.SFX.play("shieldHit", { hero: target.heroId });
    } else if (dmg > 0) {
      window.SFX.play(kind === "skill" ? "skillHit" : "hit", {
        hero: atkHero, amount: dmg, heavy: dmg >= 3 || kind === "flank",
      });
      if (dmg >= 3) window.SFX.play("hurt", { hero: target.heroId });
    }
  }

  // 表现层：护盾吸收 / 闪避 / 命中（纯视觉，不影响结算）
  if (pos && window.BFX) {
    const hcol = window.BFX.heroColor(target.heroId);
    if (dodged) {
      window.BFX.dodge({ r: pos.r, c: pos.c, heroId: target.heroId, uid: target.uid });
    } else {
      if (absorbedTotal > 0) window.BFX.shieldAbsorb({ r: pos.r, c: pos.c, amount: absorbedTotal, uid: target.uid });
      if (dmg > 0) window.BFX.hit({
        r: pos.r, c: pos.c, amount: dmg, kind: kind || "normal",
        color: hcol, heroId: (source && !source.sword) ? source.heroId : target.heroId,
        uid: target.uid,
      });
    }
    if (dmg >= 3 || kind === "flank") window.BFX.hitstop(60);
  }

  if (target.hp <= 0 && pos) handleUnitDeath(target, source, pos);
  // 真实战绩：实际造成的生命伤害（护盾/闪避/减伤后的净值）
  if (dmg > 0 && source && !source.sword && source.player !== target.player) {
    matchStats.damage[source.player] = (matchStats.damage[source.player] || 0) + dmg;
  }
  return dmg;
}

function normalAttack(attacker, target) {
  if (gameMode === "online") {
    const a = attacker ? findPos(attacker) : null;
    const t = target ? findPos(target) : null;
    if (a && t) onlineForward({ type: "attack", from: a, to: t });
    return;
  }
  if (!attacker || !target) {
    clearSelection();
    render();
    return;
  }
  if (!canActNow(attacker)) {
    addLog("本回合已经行动过了（不耗步技能除外）。");
    clearSelection();
    render();
    return;
  }
  if (isDisabled(attacker)) {
    addLog(label(attacker) + " 处于【" + actionBlockReason(attacker) + "】状态，无法攻击。");
    clearSelection();
    render();
    return;
  }
  // 记录攻击前的位置：普通攻击若最终击杀目标，攻击者需占据目标原先所在的格子
  const atkBefore = findPos(attacker);
  const tgtBefore = findPos(target);
  const res = resolveNormalAttack(attacker, target);
  const aBonus = attackerBonus(attacker); // 猛攻令 +1 / 孤胆 +1
  const ravenBuff = attacker.ravenBuff ? 1 : 0; // 渡鸦·影袭强化 +1
  const metalBuff = attacker.metalBuff ? 1 : 0; // 金元素·金属强化 +1
  const total = res.damage + aBonus + ravenBuff + metalBuff;

  if (res.flank) {
    addLog("【夹击×" + res.count + "】" + label(attacker) + " 攻击 " + label(target) + "，额外伤害 +" + res.bonus +
      (res.assassin ? "，刺客·暗杀 +1" : "") + (res.guixiong ? "，鬼雄·绝境 +1" : "") + (aBonus ? "，猛攻令 +1" : "") + (ravenBuff ? "，影袭 +1" : "") + (metalBuff ? "，金属强化 +1" : "") + "（共 " + total + " 点）。");
    if (res.assassin) addLog("🗡 刺客·暗杀触发：本次夹击额外 +1 点伤害。");
  } else if (res.base && res.protected) {
    addLog("【队友保护，夹击无效】" + label(attacker) + " 攻击 " + label(target) + "，造成 " + total + " 点伤害" + (res.guixiong ? "（鬼雄·绝境 +1）" : "") + (aBonus ? "（猛攻令 +1）" : "") + (ravenBuff ? "（影袭 +1）" : "") + (metalBuff ? "（金属强化 +1）" : "") + "。");
  } else {
    addLog(label(attacker) + " 攻击 " + label(target) + "，造成 " + total + " 点伤害" + (res.guixiong ? "（鬼雄·绝境 +1）" : "") + (aBonus ? "（猛攻令 +1）" : "") + (ravenBuff ? "（影袭 +1）" : "") + (metalBuff ? "（金属强化 +1）" : "") + "。");
  }

  if (window.SFX) {
    const _heavy = /^(berserker|xiangyu|guardian|knight|jade|lone)$/.test(attacker.heroId);
    window.SFX.play("attack", { hero: attacker.heroId, heavy: _heavy });
  }
  if (res.flank && window.SFX) window.SFX.play("flank", { hero: attacker.heroId });
  // 表现层：突进 + 挥击轨迹（近战手感；不改变结算）
  if (window.BFX && atkBefore && tgtBefore) {
    window.BFX.attack({
      from: atkBefore, to: tgtBefore, flank: !!res.flank,
      color: window.BFX.heroColor(attacker.heroId), heroId: attacker.heroId,
    });
  }
  applyDamage(target, total, res.flank ? "flank" : "normal", attacker);
  // 渡鸦：主动攻击成功执行 → 立刻破隐并消耗影袭强化
  if (attacker.heroId === "raven" || attacker.ravenBuff || attacker.stealth) consumeRavenAttackState(attacker);
  // 金元素·金属强化：伤害 +1 已计入；成功执行后消耗，目标存活则定身 1 回合
  if (metalBuff) {
    attacker.metalBuff = false;
    addLog("🛡 金元素的强化攻击造成额外 1 点伤害。");
    if (findPos(target) && target.hp > 0) {
      const rt = applyNegativeStatus(target, "root", { damage: 0, turns: 1, label: "定身", silent: true });
      if (rt.applied) {
        addLog("⛓ " + label(target) + " 被定身 1 回合！");
        const rp = findPos(target);
        if (rp && window.BFX) window.BFX.cast({ type: "root", heroId: "metal", caster: rp });
        if (window.SFX) window.SFX.play("root", { hero: target.heroId });
      }
    }
  }
  // 普通攻击击杀 → 攻击者占据目标原先所在的格子（仅限相邻攻击；远程游侠不位移）
  // 仅在「伤害 / 护盾 / 闪避 / 锁血 / 死亡」全部结算完成后判定；夹击击杀同样生效
  const atkAdjacent = !!atkBefore && !!tgtBefore && (Math.abs(atkBefore.r - tgtBefore.r) + Math.abs(atkBefore.c - tgtBefore.c) === 1);
  if (atkAdjacent && target.hp <= 0 && !findPos(target) && !board[tgtBefore.r][tgtBefore.c]) {
    const ap = findPos(attacker);
    if (ap && ap.r === atkBefore.r && ap.c === atkBefore.c) {
      board[ap.r][ap.c] = null;
      board[tgtBefore.r][tgtBefore.c] = attacker;
      addLog("➡ " + label(attacker) + " 击败目标后占据 (" + (tgtBefore.r + 1) + "," + (tgtBefore.c + 1) + ")。");
      if (window.BFX) {
        window.BFX.move({ from: atkBefore, to: tgtBefore, dash: true, color: window.BFX.heroColor(attacker.heroId) });
        window.BFX.mark("sword", tgtBefore.r, tgtBefore.c, window.BFX.heroColor(attacker.heroId), 12000);
        window.BFX.hitstop(90);
      }
    }
  }
  turnActionUsed = true;
  afterAction(attacker);
}

/* 技能伤害结算：技能【不享受】夹击加成；但享受「猛攻令」/「孤胆」+1 */
function resolveSkillDamage(attacker, target, skill) {
  const ab = attackerBonus(attacker);
  return { damage: skill.damage + ab, assault: ab };
}

/* 多段技能的阶段文案（仅用于战斗表现层，不影响规则） */
function skillStageLabel(a, s) {
  if (!s) return "";
  if (s.type === "shuidiao") return (a.sdStage || 0) === 1 ? "第二段" : "第一段 → 第二段";
  if (s.type === "wxt") return ["第一段 → 第二段", "第二段 → 第三段", "第三段"][a.wxtStage || 0] || "";
  if (s.type === "chase") return (a.chaseStage || 0) === 1 ? "第二段·闪身" : "第一段 → 第二段";
  return "";
}

/* ============================ 花木兰·所向披靡 ============================ */
/* 所向披靡：目标必须是花木兰「普通攻击范围（相邻）」内的敌方英雄 */
function chargeTargets(u, r, c) {
  const out = [];
  for (const [dr, dc] of DIRS) {
    const t = unitAt(r + dr, c + dc);
    if (t && !t.sword && t.player !== u.player) out.push([r + dr, c + dc]);
  }
  return out;
}
/* 击退最多 2 格；路径上的英雄向侧方推开。
 * 返回 { moved, pushed, stun }：纯棋盘结算，伤害/眩晕/表现由调用方按实际事件处理。 */
function chargeKnockback(tgt, dr, dc) {
  const pushed = [];
  let moved = 0;
  for (let step = 0; step < 2; step++) {
    const p = findPos(tgt);
    if (!p) break;
    const nr = p.r + dr, nc = p.c + dc;
    if (!inBounds(nr, nc)) break;              // 棋盘边界 = 墙
    const cell = board[nr][nc];
    if (!cell) {
      board[nr][nc] = tgt; board[p.r][p.c] = null; moved++;
      continue;
    }
    if (cell.sword || isPillar(cell)) break;                   // 剑刃 / 石柱阻挡
    // 垂直于击退方向的两侧（左/右相对冲锋方向）
    const perp = [[-dc, dr], [dc, -dr]];
    const opts = [];
    for (const [pr, pc] of perp) {
      const sr = nr + pr, sc = nc + pc;
      if (inBounds(sr, sc) && !board[sr][sc]) opts.push({ r: sr, c: sc });
    }
    if (!opts.length) break;                   // 两侧都无法推开 → 直线被阻挡
    const dest = opts[Math.floor(Math.random() * opts.length)];
    board[dest.r][dest.c] = cell;
    board[nr][nc] = null;
    pushed.push({ unit: cell, from: { r: nr, c: nc }, to: dest });
    const p2 = findPos(tgt);
    if (!p2) break;
    board[nr][nc] = tgt; board[p2.r][p2.c] = null; moved++;
  }
  return { moved, pushed, stun: moved < 2 };
}
/* AI 预估（只读棋盘）：最多 2 格击退的落点、侧推数量、是否撞墙 */
function chargePreview(u, tr, tc, dr, dc) {
  let moved = 0, sidePush = 0;
  let r = tr, c = tc;
  for (let step = 0; step < 2; step++) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) break;
    const cell = board[nr][nc];
    if (!cell) { r = nr; c = nc; moved++; continue; }
    if (cell.sword || isPillar(cell)) break;
    const perp = [[-dc, dr], [dc, -dr]];
    let ok = false;
    for (const [pr, pc] of perp) {
      const sr = nr + pr, sc = nc + pc;
      if (inBounds(sr, sc) && !board[sr][sc]) { ok = true; break; }
    }
    if (!ok) break;
    if (cell.player !== u.player) sidePush++;
    r = nr; c = nc; moved++;
  }
  return { moved, sidePush, stun: moved < 2 };
}

/* ============================ 山丘之王·推山 / 石柱 ============================ */
const PILLAR_TURNS = 3; // 生成当回合结束不扣；之后每个完整回合结束 -1（对齐需求示例）

/* 该方向上“第一个”可推击的敌方英雄（第一格为友军/障碍时被阻挡，不能越过） */
function pushDirInfo(u, r, c, dr, dc) {
  const r1 = r + dr, c1 = c + dc;
  if (!inBounds(r1, c1)) return null;
  const a = board[r1][c1];
  if (a) {
    if (!isUnit(a)) return null;                 // 剑刃 / 石柱 / 障碍
    if (a.player === u.player) return null;      // 友军挡路
    return { r: r1, c: c1, unit: a, dist: 1 };
  }
  const r2 = r + dr * 2, c2 = c + dc * 2;
  if (!inBounds(r2, c2)) return null;
  const b = board[r2][c2];
  if (isUnit(b) && b.player !== u.player) return { r: r2, c: c2, unit: b, dist: 2 };
  return null;
}
/* 向前推最多 steps 格；遇英雄 / 剑刃 / 石柱 / 边界立刻停下 */
function pushUnitForward(tgt, dr, dc, steps) {
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    const p = findPos(tgt);
    if (!p) break;
    const nr = p.r + dr, nc = p.c + dc;
    if (!inBounds(nr, nc)) break;
    if (board[nr][nc]) break;
    board[nr][nc] = tgt; board[p.r][p.c] = null; moved++;
  }
  return moved;
}
/* 强制挤开：占据石柱格的英雄被沿“远离目标”的方向推开；无解则移到最近空格（与天威一致） */
function squeezeOutOfCell(unit, cr, cc, nr, nc) {
  const p = findPos(unit);
  if (!p) return null;
  const ok = (r, c) => inBounds(r, c) && !board[r][c] && !(r === cr && c === cc);
  const dr = Math.sign(nr - cr), dc = Math.sign(nc - cc);
  const dirs = [[dr, dc]].concat(DIRS.filter((d) => !(d[0] === dr && d[1] === dc)));
  for (const [rr, cc2] of dirs) {
    const tr = p.r + rr, tc = p.c + cc2;
    if (!ok(tr, tc)) continue;
    board[tr][tc] = unit; board[p.r][p.c] = null;
    if (window.BFX) window.BFX.knockback({ from: p, to: { r: tr, c: tc }, color: window.BFX.heroColor(unit.heroId) });
    if (window.SFX) window.SFX.play("knockback", { hero: unit.heroId });
    return { r: tr, c: tc };
  }
  let best = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!ok(r, c)) continue;
      const d = Math.abs(r - p.r) + Math.abs(c - p.c);
      if (!best || d < best.d || (d === best.d && (r < best.r || (r === best.r && c < best.c)))) best = { r, c, d };
    }
  }
  if (!best) return null;
  board[best.r][best.c] = unit; board[p.r][p.c] = null;
  if (window.BFX) window.BFX.knockback({ from: p, to: { r: best.r, c: best.c }, color: window.BFX.heroColor(unit.heroId) });
  if (window.SFX) window.SFX.play("knockback", { hero: unit.heroId });
  return { r: best.r, c: best.c };
}
/* 目标四周（上下左右）升起石柱；相邻格有英雄时强制挤开，只跳过剑刃/已有石柱/越界 */
function createPillarsAround(r, c, owner) {
  const cells = [];
  const squeezed = [];
  for (const [dr, dc] of DIRS) {
    const rr = r + dr, cc = c + dc;
    if (!inBounds(rr, cc)) continue;
    const cell = board[rr][cc];
    if (cell) {
      if (!isUnit(cell)) continue;                 // 剑刃 / 已有石柱：不挤、不生成
      const dest = squeezeOutOfCell(cell, r, c, rr, cc);
      if (!dest) continue;                         // 无处可去：该格不生成
      squeezed.push({ unit: cell, to: dest });
    }
    if (board[rr][cc]) continue;
    board[rr][cc] = { pillar: true, uid: unitSeq++, owner, turns: PILLAR_TURNS, fresh: true };
    cells.push([rr, cc]);
  }
  return { cells, squeezed };
}
/* 每个完整回合结束：先跳过“生成当回合”，之后 -1，归零碎裂 */
function tickPillars() {
  const broken = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!isPillar(p)) continue;
      if (p.fresh) { p.fresh = false; continue; }
      p.turns = (p.turns || 0) - 1;
      if (p.turns <= 0) { board[r][c] = null; broken.push([r, c]); }
    }
  }
  if (broken.length) {
    addLog("🪨 临时石柱已经消失（" + broken.length + " 根）。");
    if (window.BFX) window.BFX.pillars(broken, "break");
    if (window.SFX) window.SFX.play("pillarBreak");
  }
}

/* ============================ 渡鸦：潜行 / 雾冲 / 影牙 / 毒雾 ============================ */
const RAVEN_STEALTH_TURNS = 3;
const MIST_TURNS = 3;

function isStealthed(u) {
  return !!(u && u.stealth && (u.stealth.turns || 0) > 0);
}
/* 对 viewer 是否不可见（隐身只对敌方隐藏） */
function hiddenFrom(u, viewer) {
  return !!(u && viewer !== u.player && isStealthed(u));
}
/* 潜行落点：以自身为中心 3×3 + 上下左右各 2 格（复用雷霆万钧范围） */
function stealthRangeOk(dr, dc) {
  if (!dr && !dc) return true; // 原地潜行
  const box3 = Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
  const line2 = (dr === 0 || dc === 0) && Math.abs(dr) + Math.abs(dc) <= 2;
  return box3 || line2;
}
/* 雾冲：沿方向突进最多 maxSteps 格，返回实际路径（不含起点）与落点 */
function mistDashPath(u, r, c, dr, dc, maxSteps) {
  const path = [];
  let dest = null;
  for (let k = 1; k <= (maxSteps || 3); k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inBounds(rr, cc)) break;
    const cell = board[rr][cc];
    if (isPillar(cell)) break;              // 石柱阻挡
    path.push([rr, cc]);                    // 经过的格（英雄/剑刃可穿过）
    if (!cell) dest = { r: rr, c: cc };     // 最远合法空落点
  }
  if (!dest) return { path: [], dest: null, dir: [dr, dc] };
  const steps = Math.abs(dest.r - r) + Math.abs(dest.c - c);
  return { path: path.slice(0, steps), dest, dir: [dr, dc] };
}
function mistKey(r, c) { return r + "_" + c; }
function mistAt(r, c) { return mists[mistKey(r, c)] || null; }
function addMistAt(r, c, owner) {
  const key = mistKey(r, c);
  if (mists[key]) return false;             // 已有毒雾：不叠加、不延长
  mists[key] = { turns: MIST_TURNS, fresh: true, owner };
  return true;
}
/* 每个真实回合结束衰减一次（额外回合不缩短），生成当回合不扣 */
function tickMists() {
  const gone = [];
  for (const key of Object.keys(mists)) {
    const m = mists[key];
    if (m.fresh) { m.fresh = false; continue; }
    m.turns -= 1;
    if (m.turns <= 0) {
      delete mists[key];
      const q = key.split("_");
      gone.push([Number(q[0]), Number(q[1])]);
    }
  }
  if (gone.length) {
    addLog("🌫 毒雾消散（" + gone.length + " 格）。");
    if (window.BFX) window.BFX.mist(gone, "fade");
  }
}
/* 回合结束：当前玩家位于毒雾格的英雄各受 0.5 点伤害（每格只结算一次；己方毒雾不伤己方） */
function applyMistPoison(player) {
  for (const u of unitsOf(player).slice()) {
    const p = findPos(u);
    if (!p) continue;
    const m = mistAt(p.r, p.c);
    if (!m) continue;
    if (m.owner === u.player) continue; // 己方施放的毒雾不会伤害己方单位
    const dealt = applyDamage(u, 0.5, "poison", null);
    if (dealt > 0) addLog("☠ 毒雾： " + label(u) + " 受到 0.5 点伤害（余 " + u.hp + "）。");
    if (findPos(u) && window.SFX) window.SFX.play("poison", { hero: u.heroId });
  }
}
/* 毒雾刚生成：立即对站在雾格上的敌方单位结算一次 0.5（每个单位一次，己方免疫） */
function mistBurst(cells, owner) {
  const seen = new Set();
  for (const [r, c] of cells) {
    const u = unitAt(r, c);
    if (!u || u.player === owner || seen.has(u.uid)) continue;
    seen.add(u.uid);
    const dealt = applyDamage(u, 0.5, "poison", null);
    if (dealt > 0) addLog("☠ 毒雾瞬间侵蚀： " + label(u) + " 受到 0.5 点伤害（余 " + u.hp + "）。");
  }
}
function clearRavenStealth(u) {
  if (!u) return;
  u.stealth = null;
  u.ravenBuff = false;
  u.ravenDouble = false;
  u.ravenDoubleUsed = false;
}
/* 主动攻击成功执行：立即破隐并消耗影袭强化 */
function consumeRavenAttackState(u) {
  if (!u) return;
  const wasStealth = isStealthed(u);
  if (wasStealth) {
    u.stealthLog = { reason: "主动攻击", broken: true, at: Date.now() };
    addLog("🌑 " + label(u) + " 出手攻击，隐身在瞬间破除。");
    const p = findPos(u);
    if (p && window.BFX) window.BFX.cast({ type: "stealthBreak", heroId: "raven", caster: p });
    if (window.SFX) window.SFX.play("stealthEnd", { hero: "raven" });
  }
  u.ravenBuff = false;
  u.ravenDouble = false;
  u.ravenDoubleUsed = false;
  u.stealth = null;
}
/* 渡鸦自己的回合结束：潜行与双动计时（额外回合不缩短隐身） */
function tickRavenTurn(player, countDuration) {
  if (countDuration) {
    for (const u of unitsOf(player)) {
      if (!u.stealth) continue;
      if (u.stealth.fresh) { u.stealth.fresh = false; continue; }
      u.stealth.turns -= 1;
      if (u.stealth.turns <= 0) {
        addLog("🌑 " + label(u) + " 的潜行结束（持续时间结束）。");
        if (window.BFX) { const p = findPos(u); if (p) window.BFX.cast({ type: "stealthBreak", heroId: "raven", caster: p }); }
        clearRavenStealth(u);
      }
    }
  }
  for (const u of unitsOf(player)) {
    // 回合结束仍未完成的双动机会作废（本次潜行只给一次）
    if (u.ravenDoubleUsed) { u.ravenDouble = false; u.ravenDoubleUsed = false; }
  }
}

/* ============================ 金元素：金属穿刺 / 装甲 / 狂潮 ============================ */
/* 金属穿刺：正前方 1–2 格；敌人逐格命中，友军 / 石柱 / 剑刃 / 边界阻挡后续格 */
function metalPierceInfo(u, r, c, dr, dc) {
  const out = [];
  for (let k = 1; k <= 2; k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inBounds(rr, cc)) break;
    const cell = board[rr][cc];
    if (isPillar(cell) || isSword(cell)) break;     // 障碍阻挡
    if (!cell) continue;
    if (cell.player === u.player) break;            // 友军阻挡（不伤害、不可越过）
    out.push({ r: rr, c: cc, unit: cell });
  }
  return out;
}
/* 金属狂潮：按“自己的行动回合”计时（本回合、下回合、下下回合；额外回合也按真实回合计） */
function tickMetalTurn(player) {
  for (const u of unitsOf(player)) {
    if (!u.metalTide || u.metalTide <= 0) continue;
    u.metalTide -= 1;
    if (u.metalTide <= 0) {
      u.metalTide = 0;
      addLog("🛡 " + label(u) + " 的【金属狂潮】结束，受到的伤害恢复正常。");
    }
  }
}

function useSkill(tr, tc) {
  const { r, c } = selected;
  const a = board[r][c];
  if (!a) { clearSelection(); render(); return; }
  const s = activeSkillOf(a);
  if (!s) { clearSelection(); render(); return; }

  // 沧·水调歌头 第一段：第 1 步先选“位移落点”（本地选择，不消耗行动）
  if (s.type === "shuidiao" && (a.sdStage || 0) === 0 && !(skillSub && skillSub.kind === "sd1-dash")) {
    if (Math.abs(tr - r) > 1 || Math.abs(tc - c) > 1) {
      addLog("位移落点必须在九宫格内。");
      render();
      return;
    }
    if (!(tr === r && tc === c) && board[tr][tc]) {
      addLog("该格已被占用，无法位移。");
      render();
      return;
    }
    skillSub = { kind: "sd1-dash", r: tr, c: tc };
    skillTargets = [];
    dashOptions = [];
    for (const [dr, dc] of DIRS) {
      const o = computeDashPath(a, tr, tc, dr, dc, 3);
      const tgt = o.dest || (o.hits.length ? o.hits[0] : null);
      if (tgt) {
        o.target = tgt;
        o.stage = 1;
        o.reposition = { r: tr, c: tc };
        skillTargets.push([tgt.r, tgt.c]);
        dashOptions.push(o);
      }
    }
    if (skillTargets.length === 0) {
      addLog("位移后没有可突进的方向。");
      skillSub = null;
      clearSelection();
      render();
      return;
    }
    render();
    addLog("🌊 已选择位移落点，请选择水调歌头·第一段的突进方向。");
    return; // 尚未消耗行动，等待突进方向
  }

  // 刺客·追猎 第二段：第 1 步先选“带标记的目标”（本地选择，不消耗行动）
  if (s.type === "chase" && (a.chaseStage || 0) === 1 && !(skillSub && skillSub.kind === "chase-blink")) {
    const ct = unitAt(tr, tc);
    if (!ct || ct.sword || ct.player === a.player || ct.chaseMark !== a.uid) {
      addLog("追猎·第二段只能选择带【追猎标记】的存活敌人。");
      render();
      return;
    }
    const dests = chaseBlinkCells(tr, tc);
    if (!dests.length) {
      addLog("追猎·闪身：" + label(ct) + " 四周没有合法落点，无法闪身（不消耗任何行动机会）。");
      render();
      return; // 保持第二段待释放状态，可改选其它目标
    }
    skillSub = { kind: "chase-blink", tUid: ct.uid, tR: tr, tC: tc };
    skillTargets = dests.slice();
    dashOptions = dests.map(([rr, cc]) => ({ kind: "chase-blink", dest: { r: rr, c: cc } }));
    render();
    addLog("🗡 已锁定 " + label(ct) + "，请选择闪身落点（第二段不消耗普通行动机会）。");
    return; // 尚未结算，等待落点
  }

  // 玉皇大帝·放逐：第 1 步先选“被放逐的敌人”（本地选择，不消耗行动）
  if (s.type === "exile" && !(skillSub && skillSub.kind === "exile-target")) {
    const et = unitAt(tr, tc);
    if (!et || et.sword || et.player === a.player) {
      addLog("放逐：请选择一名存活的敌方英雄。");
      render();
      return;
    }
    const legal = BOARD_CORNERS.filter(cornerExileOk);
    if (!legal.length) {
      addLog("放逐：四个墙角对应的四宫格内都已有英雄，无法释放（不消耗次数）。");
      render();
      return;
    }
    skillSub = { kind: "exile-target", tUid: et.uid, tR: tr, tC: tc };
    skillTargets = legal.map((cn) => [cn.corner.r, cn.corner.c]);
    render();
    addLog("👑 已锁定 " + label(et) + "，请选择放逐的墙角（高亮为四宫格全空的墙角；不消耗行动）。");
    return; // 尚未结算，等待墙角
  }

  // 天道超·万象天引：第一/二段先选方向（本地选择，不消耗行动）
  if (s.type === "wxt" && (a.wxtStage || 0) < 2 && !(skillSub && skillSub.kind === "wxt-dir-set")) {
    const fd = DIRS.find((d) => r + d[0] === tr && c + d[1] === tc);
    if (!fd) {
      addLog("万象天引：请先点击上/下/左/右选择一个【前方】方向。");
      render();
      return;
    }
    const stageNow = a.wxtStage || 0;
    if (!wxtStageTargets(a, r, c, fd[0], fd[1], stageNow).length) {
      addLog("万象天引：该方向没有可牵引的敌方英雄，请换一个方向。");
      render();
      return;
    }
    skillSub = { kind: "wxt-dir-set", dir: [fd[0], fd[1]] };
    computeSkillTargets();
    render();
    addLog("🌀 已选择方向，请点击目标释放【" + s.name + "·" + (stageNow === 0 ? "第一段" : "第二段") + "】。");
    return; // 尚未结算，等待目标
  }

  // 花木兰·所向披靡：直接选择普通攻击范围内的相邻敌人（方向由目标位置决定）
  if (gameMode === "online") {
    onlineForward({
      type: "skill",
      from: { r, c },
      to: { r: tr, c: tc },
      idx: activeSkillIdx,
      reposition: s.type === "shuidiao" && skillSub ? { r: skillSub.r, c: skillSub.c } : undefined,
      chaseTarget: s.type === "chase" && skillSub && skillSub.kind === "chase-blink" ? { r: skillSub.tR, c: skillSub.tC } : undefined,
      exileTarget: s.type === "exile" && skillSub && skillSub.kind === "exile-target" ? { r: skillSub.tR, c: skillSub.tC } : undefined,
      wxtDir: s.type === "wxt" && skillSub && skillSub.kind === "wxt-dir-set" ? { dr: skillSub.dir[0], dc: skillSub.dir[1] } : undefined,
    });
    return;
  }

  if (isPassiveSkill(s)) {
    clearSelection();
    render();
    return;
  }
  if (skillBlockedByStatus(a)) {
    addLog(label(a) + " 处于【" + actionBlockReason(a) + "】状态，无法使用技能。");
    clearSelection();
    render();
    return;
  }
  if (!skillFreeFor(a, s) && !canActNow(a)) {
    addLog("本回合已经行动过了（不耗步技能除外）。");
    clearSelection();
    render();
    return;
  }
  if (!canPaySwords(a, s)) {
    addLog("没有剑可用，【" + s.name + "】无法发动。");
    clearSelection();
    render();
    return;
  }
  const target = unitAt(tr, tc);
  // 技能音效在“结算成功后”统一播放（失败/取消会提前 return，不会误播）
  const sfxStage = s.type === "shuidiao" ? (a.sdStage || 0)
    : s.type === "wxt" ? (a.wxtStage || 0)
      : s.type === "chase" ? (a.chaseStage || 0) : 0;
  const sfxType = s.type;
  const sfxHero = a.heroId;
  const sd2 = s.type === "shuidiao" && (a.sdStage || 0) === 1; // 水调歌头第二段（同一套的延续）
  const chase2 = s.type === "chase" && (a.chaseStage || 0) === 1; // 追猎第二段（不消耗次数、不消耗行动）
  const wxtCombo = s.type === "wxt" && (a.wxtStage || 0) >= 1; // 万象天引第二/三段（只消耗行动，不重复消耗整套次数）
  // 是否消耗行动机会必须在结算前判定：追猎结算会改动 chaseStage，若放到最后判定会翻转结果
  const freeAction = skillFreeFor(a, s);
  let consumedHere = false; // 追猎第一段在分支内「先扣次数再结算」，避免击杀刷新被尾部扣次数覆盖

  // 表现层：技能发动横幅 + 阶段提示（仅在校验通过后播放，失败/取消不会触发）
  if (window.BFX) {
    window.BFX.banner(heroDef(a.heroId).name, s.name, skillStageLabel(a, s));
  }

  switch (s.type) {
    case "damage_single": {
      const rd = resolveSkillDamage(a, target, s);
      addLog(label(a) + " 释放【" + s.name + "】，对 " + label(target) + " 造成 " + rd.damage + " 点伤害" + (rd.assault ? "（猛攻令 +1）" : "") + "。");
      if (window.BFX) window.BFX.cast({ type: "damage_single", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      applyDamage(target, rd.damage, "skill", a);
      break;
    }

    case "freeze": {
      const rd = resolveSkillDamage(a, target, s);
      addLog(label(a) + " 释放【" + s.name + "】，对 " + label(target) + " 造成 " + rd.damage + " 点伤害" + (rd.assault ? "（猛攻令 +1）" : "") + "。");
      if (window.BFX) window.BFX.cast({ type: "freeze", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      applyDamage(target, rd.damage, "skill", a);
      if (findPos(target)) {
        if (hasSuperArmor(target)) {
          // 孤胆侠·霸体：抵抗冰封（伤害仍已正常结算）
          addLog("🛡 霸体：" + label(target) + " 抵抗了【冰封】（伤害仍已结算）。");
          fx.push({ r: tr, c: tc, text: "霸体", kind: "shield" });
        } else {
          target.frozen = Math.max(target.frozen, s.freeze || 1);
          addLog("❄ " + label(target) + " 被冰封，将跳过其下一个回合。");
        }
      }
      break;
    }

    case "heal": {
      const healed = Math.max(0, Math.min(s.heal, target.maxHp - target.hp));
      target.hp += healed;
      addLog("✨ " + label(a) + " 释放【" + s.name + "】，为 " + label(target) + " 恢复 " + healed + " 点生命（" + target.hp + "/" + target.maxHp + "）。");
      if (window.BFX) window.BFX.cast({ type: "heal", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc }, amount: healed });
      fx.push({ r: tr, c: tc, text: "+" + healed, kind: "heal" });
      break;
    }

    case "damage_adjacent_all": {
      let hit = 0;
      let assault = 0;
      if (window.BFX) window.BFX.cast({ type: "damage_adjacent_all", heroId: a.heroId, caster: { r, c } });
      for (const [dr, dc] of DIRS) {
        const t = unitAt(r + dr, c + dc);
        if (t && !t.sword && t.player !== a.player) {
          const rd = resolveSkillDamage(a, t, s);
          if (rd.assault) assault = rd.assault;
          applyDamage(t, rd.damage, "skill", a);
          hit++;
        }
      }
      addLog(label(a) + " 释放【" + s.name + "】，横扫相邻敌人，命中 " + hit + " 名" + (assault ? "（猛攻令 +1）" : "") + "。");
      break;
    }

    case "damage_line": {
      if (!target || target.player === a.player || !rangerSkillRangeOk(tr - r, tc - c, s.range)) {
        addLog("穿透射击：目标必须在正前/后/左/右 4 格或自身九宫格内。");
        clearSelection();
        render();
        return;
      }
      const rd = resolveSkillDamage(a, target, s);
      addLog(label(a) + " 释放【" + s.name + "】，射击 " + label(target) + "，造成 " + rd.damage + " 点伤害" + (rd.assault ? "（猛攻令 +1）" : "") + "。");
      if (window.BFX) window.BFX.cast({ type: "damage_line", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      applyDamage(target, rd.damage, "skill", a);
      break;
    }

    case "shield_self":
      a.shield += s.shield;
      addLog("🛡 " + label(a) + " 释放【" + s.name + "】，获得 " + s.shield + " 点护盾。");
      if (window.BFX) window.BFX.cast({ type: "shield_self", heroId: a.heroId, caster: { r, c }, amount: s.shield });
      fx.push({ r, c, text: "+" + s.shield, kind: "shield" });
      break;

    case "blink":
      if (window.BFX) window.BFX.cast({ type: "blink", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      board[tr][tc] = a;
      board[r][c] = null;
      addLog(label(a) + " 释放【" + s.name + "】，瞬移到 (" + (tr + 1) + "," + (tc + 1) + ")。");
      break;

    case "dash": {
      const opt = dashOptions.find((o) => o.target && o.target.r === tr && o.target.c === tc);
      if (!opt) {
        // 目标选择错误 / 路径不合法：不消耗次数
        addLog("突进方向无效。");
        clearSelection();
        render();
        return;
      }
      const dashDmg = s.damage + attackerBonus(a); // 剑圣伤害 + 猛攻令/孤胆
      const fr = computeDashPath(a, r, c, opt.dir[0], opt.dir[1], 3); // 按实际路径重新判定
      if (window.BFX) window.BFX.cast({ type: "dash", heroId: a.heroId, caster: { r, c }, from: { r, c }, to: fr.dest || { r, c } });
      let hitCount = 0;
      for (const h of fr.hits) {
        const t = board[h.r][h.c];
        if (t && !t.sword && t.player !== a.player) {
          applyDamage(t, dashDmg, "skill", a); // 阿修罗·剑圣的伤害（技能，不吃夹击加成）
          hitCount++;
        }
      }
      let pickedCount = 0;
      let moved = 0;
      if (fr.dest) {
        // 有落点：移动到最远可落点，并回收沿途剑刃
        const dest = fr.dest;
        moved = Math.abs(dest.r - r) + Math.abs(dest.c - c);
        const [ddr, ddc] = opt.dir;
        for (let k = 1; k <= moved; k++) {
          const rr = r + ddr * k;
          const cc = c + ddc * k;
          if (isSword(board[rr][cc]) && a.heroId === "asura") {
            a.swords = (a.swords || 0) + 1;
            board[rr][cc] = null;
            pickedCount++;
          }
        }
        board[dest.r][dest.c] = a;
        board[r][c] = null;
      }
      // 无落点（前方全是敌人）时，阿修罗原地发动，仅造成沿途伤害
      addLog(
        "🔱 " + label(a) + " 释放【" + s.name + "】，向" + dirName(opt.dir) +
        (moved ? "突进 " + moved + " 格" : "原地斩击") + "，剑刃命中 " + hitCount + " 次" +
        (pickedCount ? "，并回收了 " + pickedCount + " 把剑（携带 " + a.swords + " 把）" : "") + "。"
      );
      if (pickedCount && window.SFX) window.SFX.play("swordPickup", { hero: "asura" });
      break;
    }

    case "duanlang": {
      // 断浪：向指定方向前进一格，然后对九宫格范围内敌人各造成 1 点伤害
      if (Math.abs(tr - r) + Math.abs(tc - c) !== 1 || board[tr][tc]) {
        addLog("断浪的方向无效。");
        clearSelection();
        render();
        return;
      }
      const ddest = { r: tr, c: tc };
      if (window.BFX) window.BFX.cast({ type: "duanlang", heroId: a.heroId, caster: { r, c }, target: ddest });
      board[ddest.r][ddest.c] = a;
      board[r][c] = null;
      let dhit = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const t = unitAt(ddest.r + dr, ddest.c + dc);
          if (t && !t.sword && t.player !== a.player) {
            applyDamage(t, s.damage + attackerBonus(a), "skill", a);
            dhit++;
          }
        }
      }
      addLog("🌊 " + label(a) + " 释放【" + s.name + "】，前进到 (" + (ddest.r + 1) + "," + (ddest.c + 1) + ")，九宫格命中 " + dhit + " 名敌人。");
      break;
    }

    case "metalpierce": {
      const fd = DIRS.find((d) => r + d[0] === tr && c + d[1] === tc);
      if (!fd) {
        addLog("金属穿刺：请点击上/下/左/右选择一个方向。");
        clearSelection();
        render();
        return;
      }
      const targets = metalPierceInfo(a, r, c, fd[0], fd[1]);
      if (!targets.length) {
        addLog("金属穿刺：该方向没有可命中的敌人（友军 / 障碍会阻挡）。");
        clearSelection();
        render();
        return;
      }
      addLog("⚙ " + label(a) + " 发动【金属穿刺】！");
      if (!payHpCost(a, s.costHp || 1, "金属穿刺")) {
        addLog("💥 金元素因生命代价倒下，金属穿刺中止，未造成伤害。");
        break;
      }
      if (window.BFX) window.BFX.cast({ type: "metalpierce", heroId: a.heroId, caster: { r, c }, dir: [fd[0], fd[1]], cells: targets.map((t) => [t.r, t.c]) });
      let hit = 0;
      for (const t of targets) {
        if (!findPos(t.unit)) continue;
        applyDamage(t.unit, s.damage, "skill", a);
        hit++;
      }
      addLog("⚙ 金属穿刺命中 " + hit + " 名敌方英雄，各造成 " + s.damage + " 点伤害。");
      break;
    }

    case "metalarmor": {
      addLog("⚙ " + label(a) + " 发动【金属装甲】！");
      if (!payHpCost(a, s.costHp || 1, "金属装甲")) {
        addLog("💥 金元素因生命代价倒下，金属装甲中止，未获得强化。");
        break;
      }
      a.metalBuff = true;
      addLog("🛡 金元素的下一次普通攻击已强化（伤害 +1，命中后定身目标 1 回合）。");
      if (window.BFX) window.BFX.cast({ type: "metalarmor", heroId: a.heroId, caster: { r, c } });
      break;
    }

    case "metaltide": {
      a.metalTide = 3;
      addLog("🛡 " + label(a) + " 发动【金属狂潮】：本回合及之后两个自身行动回合，受到的伤害减半。");
      if (window.BFX) window.BFX.cast({ type: "metaltide", heroId: a.heroId, caster: { r, c } });
      if (window.SFX) window.SFX.play("metalTide", { hero: "metal" });
      break;
    }

    case "stealth": {
      if (!stealthRangeOk(tr - r, tc - c)) {
        addLog("潜行：落点必须在自身九宫格或上下左右 2 格内。");
        clearSelection();
        render();
        return;
      }
      if (!(tr === r && tc === c) && board[tr][tc]) {
        addLog("潜行：落点必须是空格。");
        clearSelection();
        render();
        return;
      }
      if (!(tr === r && tc === c)) {
        if (window.BFX) window.BFX.cast({ type: "stealth", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc }, from: { r, c } });
        board[tr][tc] = a;
        board[r][c] = null;
      } else if (window.BFX) {
        window.BFX.cast({ type: "stealth", heroId: a.heroId, caster: { r, c }, target: { r, c } });
      }
      a.stealth = { turns: RAVEN_STEALTH_TURNS, fresh: true, startTurn: turnSerial, reason: "", broken: false };
      a.ravenBuff = true;
      a.ravenDouble = true;
      a.ravenDoubleUsed = false;
      addLog("🌑 " + label(a) + " 使用【潜行】，进入隐身（" + RAVEN_STEALTH_TURNS + " 个完整回合），并获得【影袭强化】与一次【潜行双动】。");
      if (window.SFX) window.SFX.play("stealthEnter", { hero: "raven" });
      break;
    }

    case "mistdash": {
      const fd = DIRS.find((d) => r + d[0] === tr && c + d[1] === tc);
      if (!fd) {
        addLog("雾冲：请点击上/下/左/右选择一个突进方向。");
        clearSelection();
        render();
        return;
      }
      const o = mistDashPath(a, r, c, fd[0], fd[1], s.range || 3);
      if (!o.dest) {
        addLog("雾冲：该方向无法突进（第一格被石柱/边界阻挡）。");
        clearSelection();
        render();
        return;
      }
      if (window.BFX) window.BFX.cast({ type: "mistdash", heroId: a.heroId, caster: { r, c }, from: { r, c }, to: o.dest, path: o.path, dir: [fd[0], fd[1]] });
      // 路径伤害：每个敌人最多一次 0.5
      const seen = new Set();
      let hit = 0;
      for (const [rr, cc] of o.path) {
        const t = unitAt(rr, cc);
        if (!t || t.player === a.player || seen.has(t.uid)) continue;
        seen.add(t.uid);
        const dealt = applyDamage(t, s.damage + attackerBonus(a), "skill", a);
        if (dealt > 0) hit++;
      }
      // 位移到最远合法空格
      board[o.dest.r][o.dest.c] = a;
      board[r][c] = null;
      // 实际经过的路径格生成毒雾（持续 3 回合）
      const mistCells = [];
      for (const [rr, cc] of o.path) if (addMistAt(rr, cc, a.player)) mistCells.push([rr, cc]);
      if (window.BFX && mistCells.length) window.BFX.mist(mistCells, "rise");
      if (window.SFX) window.SFX.play("mist", { hero: "raven" });
      // 毒雾生成瞬间：站在雾格上的敌人立即受到 0.5（己方单位免疫）
      if (mistCells.length) mistBurst(mistCells, a.player);
      addLog("🌫 " + label(a) + " 使用【雾冲】，突进到 (" + (o.dest.r + 1) + "," + (o.dest.c + 1) + ")，路径命中 " + hit + " 名敌人，留下 " + o.path.length + " 格毒雾。");
      break;
    }

    case "shadowfang": {
      const tgt = unitAt(tr, tc);
      if (!tgt || tgt.sword || tgt.player === a.player) {
        addLog("影牙：请选择普通攻击范围内的敌方英雄。");
        clearSelection();
        render();
        return;
      }
      if (Math.abs(tr - r) + Math.abs(tc - c) !== 1) {
        addLog("影牙：只能对相邻敌人发动。");
        clearSelection();
        render();
        return;
      }
      const buff = a.ravenBuff ? 1 : 0;
      const dmg = s.damage + attackerBonus(a) + buff;
      addLog("🖤 " + label(a) + " 发动【影牙】！" + (buff ? "（影袭强化 +1）" : ""));
      // 先扣次数：确保击杀刷新不被尾部扣次数覆盖
      consumedHere = true;
      {
        const cur = skillUsesLeft(a, activeSkillIdx);
        if (cur !== Infinity) setSkillUsesLeft(a, activeSkillIdx, cur - 1);
      }
      if (window.BFX) window.BFX.cast({ type: "shadowfang", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      applyDamage(tgt, dmg, "skill", a);
      if (!findPos(tgt)) {
        if (skillUsesLeft(a, activeSkillIdx) < 1) setSkillUsesLeft(a, activeSkillIdx, 1);
        addLog("🗡 影牙击败目标，技能次数已刷新！");
        if (window.BFX) window.BFX.cast({ type: "refresh", heroId: a.heroId, caster: { r, c } });
        if (window.SFX) window.SFX.play("refresh", { hero: "raven" });
      }
      consumeRavenAttackState(a);
      break;
    }

    case "push": {
      const tgt = unitAt(tr, tc);
      if (!tgt || tgt.sword || tgt.player === a.player) {
        addLog("推山：请选择正前方 2 格内的敌方英雄。");
        render();
        return;
      }
      const dr = Math.sign(tr - r), dc = Math.sign(tc - c);
      const dist = Math.abs(tr - r) + Math.abs(tc - c);
      if ((dr !== 0 && dc !== 0) || dist < 1 || dist > 2) {
        addLog("推山：目标必须在正前方 1–2 格内。");
        render();
        return;
      }
      const info = pushDirInfo(a, r, c, dr, dc);
      if (!info || info.unit !== tgt) {
        addLog("推山：只能推击正前方 2 格内的第一个敌人（友军或障碍会挡住路径）。");
        render();
        return;
      }
      addLog("⛰ " + label(a) + " 发动【推山】，向" + dirName([dr, dc]) + "推击 " + label(tgt) + "。");
      if (window.BFX) {
        window.BFX.cast({ type: "push", heroId: a.heroId, caster: { r, c }, target: { r: info.r, c: info.c }, dir: [dr, dc] });
      }
      const pushDmg = s.damage + attackerBonus(a);
      applyDamage(tgt, pushDmg, "skill", a);
      if (!findPos(tgt)) {
        addLog("💥 " + label(tgt) + " 被推山击倒，未发生推动与石柱。");
        break;
      }
      const pushed = Math.max(0, 2 - info.dist); // 目标最终停在离自己 2 格处
      const moved = pushUnitForward(tgt, dr, dc, pushed);
      const np = findPos(tgt);
      if (moved > 0 && np) {
        if (window.BFX) window.BFX.move({ from: { r: info.r, c: info.c }, to: { r: np.r, c: np.c }, color: window.BFX.heroColor(tgt.heroId) });
        addLog("➡ " + label(tgt) + " 被推击到 (" + (np.r + 1) + "," + (np.c + 1) + ")，距山丘之王 2 格。");
      } else if (info.dist === 2) {
        addLog("⛰ " + label(tgt) + " 已在正前方第二格，未再推动。");
      } else {
        addLog("⛰ " + label(tgt) + " 前方受阻，停留在原地。");
      }
      if (np) {
        const made = createPillarsAround(np.r, np.c, a.player);
        for (const sq of made.squeezed) {
          addLog("↔ 石柱将 " + label(sq.unit) + " 挤开到 (" + (sq.to.r + 1) + "," + (sq.to.c + 1) + ")。");
        }
        if (made.cells.length) {
          addLog("🪨 石柱升起，封锁了 " + label(tgt) + " 四周（" + made.cells.length + " 根）。");
          if (window.BFX) window.BFX.pillars(made.cells, "rise");
          if (window.SFX) window.SFX.play("pillarRise");
        }
      }
      break;
    }

    case "charge": {
      const tgt = unitAt(tr, tc);
      if (!tgt || tgt.sword || tgt.player === a.player) {
        addLog("所向披靡：请选择普通攻击范围内的敌方目标。");
        render();
        return;
      }
      const dr = tr - r, dc = tc - c;
      if (Math.abs(dr) + Math.abs(dc) !== 1) {
        addLog("所向披靡：只能对相邻（普通攻击范围）的敌人释放。");
        render();
        return;
      }
      const dirTxt = dr === -1 ? "上" : dr === 1 ? "下" : dc === -1 ? "左" : "右";
      addLog("🌺 " + label(a) + " 发动【" + s.name + "】，向" + dirTxt + "冲锋，目标 " + label(tgt) + "。");
      if (window.BFX) {
        window.BFX.cast({
          type: "charge", heroId: a.heroId,
          caster: { r, c }, target: { r: tr, c: tc }, dir: [dr, dc],
          distance: Math.max(0, Math.abs(tr - r) + Math.abs(tc - c)),
        });
      }
      const before = findPos(tgt);
      const cdmg = s.damage + attackerBonus(a);
      applyDamage(tgt, cdmg, "skill", a); // 统一伤害结算（护盾 / 闪避 / 锁血 / 阵亡）
      if (!findPos(tgt)) {
        addLog("💥 " + label(tgt) + " 被冲锋击倒，未发生击退与眩晕。");
        break;
      }
      const res = chargeKnockback(tgt, dr, dc);
      // 路径上的英雄被侧向推开：先移动，再按实际位置结算伤害
      for (const p of res.pushed) {
        if (window.BFX) window.BFX.knockback({ from: p.from, to: p.to, color: window.BFX.heroColor(p.unit.heroId) });
        if (window.SFX) window.SFX.play("knockback", { hero: p.unit.heroId });
        addLog("↔ " + label(p.unit) + " 被向侧方推开到 (" + (p.to.r + 1) + "," + (p.to.c + 1) + ")，受到 " + cdmg + " 点伤害。");
        applyDamage(p.unit, cdmg, "skill", a);
      }
      const np = findPos(tgt);
      if (res.moved > 0 && np) {
        addLog("➡ " + label(tgt) + " 被击退 " + res.moved + " 格到 (" + (np.r + 1) + "," + (np.c + 1) + ")。");
        if (window.BFX && before) window.BFX.knockback({ from: before, to: np, color: window.BFX.heroColor(tgt.heroId) });
      }
      if (res.stun && findPos(tgt)) {
        const st = applyNegativeStatus(tgt, "stun", { damage: 0, turns: 2, label: "眩晕", silent: true });
        if (st.applied) {
          if (window.BFX) window.BFX.cast({ type: "stun", heroId: a.heroId, caster: np || { r: tr, c: tc }, target: np || { r: tr, c: tc } });
          if (window.SFX) window.SFX.play("stun", { hero: a.heroId });
          addLog("💫 " + label(tgt) + " 撞上阻挡，被眩晕 2 个自身行动回合。");
        } else {
          addLog("🛡 " + label(tgt) + " 抵抗了眩晕。");
        }
      }
      break;
    }

    case "shuidiao": {
      if ((a.sdStage || 0) === 1) {
        // 第二段：突进 2 格，擒拿沿途第一个敌人（按实际路径重新判定）
        const opt2 = dashOptions.find((o) => o.stage === 2 && o.target && o.target.r === tr && o.target.c === tc);
        if (!opt2) { addLog("突进方向无效。"); clearSelection(); render(); return; }
        const fr = computeDashPath(a, r, c, opt2.dir[0], opt2.dir[1], 2);
        if (window.BFX) window.BFX.cast({ type: "shuidiao", heroId: a.heroId, caster: { r, c }, from: { r, c }, to: fr.dest || { r, c }, stage: 1 });
        let grabbed = null;
        for (const h of fr.hits) {
          const t = board[h.r][h.c];
          if (t && !t.sword && t.player !== a.player) { grabbed = t; break; }
        }
        if (fr.dest) { board[fr.dest.r][fr.dest.c] = a; board[r][c] = null; }
        if (grabbed) {
          const gres = applyNegativeStatus(grabbed, "grab", { damage: 0, turns: 1, endDamage: s.grabDamage || 2, label: "擒拿", source: "水调歌头", from: { r, c } });
          addLog("🌊 " + label(a) + " 水调歌头·第二段：擒拿 " + label(grabbed) +
            (gres.applied ? "（其下回合不能使用技能；结束时受 " + (s.grabDamage || 2) + " 点伤害）" : "——被霸体抵抗") + "。");
        } else {
          addLog("🌊 " + label(a) + " 水调歌头·第二段：路径上没有敌人，未擒拿。");
        }
        a.sdStage = 0; // 组合结束
        break;
      } else {
        // 第一段第 2 步：先位移到 skillSub 记录的落点，再突进 3 格（按实际路径重新判定）
        const opt1 = dashOptions.find((o) => o.stage === 1 && o.target && o.target.r === tr && o.target.c === tc);
        if (!opt1) { addLog("突进方向无效。"); skillSub = null; clearSelection(); render(); return; }
        const rp = opt1.reposition || { r, c };
        if (!(rp.r === r && rp.c === c)) {
          board[rp.r][rp.c] = a;
          board[r][c] = null;
        }
        const fr = computeDashPath(a, rp.r, rp.c, opt1.dir[0], opt1.dir[1], 3);
        if (window.BFX) window.BFX.cast({ type: "shuidiao", heroId: a.heroId, caster: { r: rp.r, c: rp.c }, from: { r: rp.r, c: rp.c }, to: fr.dest || { r: rp.r, c: rp.c }, stage: 0 });
        let hit1 = 0;
        for (const h of fr.hits) {
          const t = board[h.r][h.c];
          if (t && !t.sword && t.player !== a.player) { applyDamage(t, s.damage + attackerBonus(a), "skill", a); hit1++; }
        }
        const dist1 = fr.dest ? Math.abs(fr.dest.r - rp.r) + Math.abs(fr.dest.c - rp.c) : 0;
        if (fr.dest) { board[fr.dest.r][fr.dest.c] = a; board[rp.r][rp.c] = null; }
        a.sdStage = 1; // 第二段待释放（可跨回合保留）
        skillSub = null;
        addLog("🌊 " + label(a) + " 水调歌头·第一段：位移到 (" + (rp.r + 1) + "," + (rp.c + 1) + ") 后突进 " + dist1 + " 格，命中 " + hit1 + " 名（第二段待释放，可跨回合保留）。");
        break;
      }
    }

    case "dragonbreath": {
      // 确定方向（包含点击格的方向）
      let brDir = null;
      for (const [dr, dc] of DIRS) {
        if (dragonBreathArea(a, r, c, dr, dc).some(([rr, cc]) => rr === tr && cc === tc)) { brDir = [dr, dc]; break; }
      }
      if (!brDir) { addLog("龙息方向无效。"); clearSelection(); render(); return; }
      if (window.BFX) {
        const _seen = new Set(); const _cells = [];
        for (const [rr, cc] of dragonBreathArea(a, r, c, brDir[0], brDir[1])) {
          const k = rr + "_" + cc;
          if (!_seen.has(k)) { _seen.add(k); _cells.push([rr, cc]); }
        }
        window.BFX.cast({ type: "dragonbreath", heroId: a.heroId, caster: { r, c }, cells: _cells, dir: brDir });
      }
      let bhit = 0;
      const seen = new Set();
      for (const [rr, cc] of dragonBreathArea(a, r, c, brDir[0], brDir[1])) {
        const key = rr + "_" + cc;
        if (seen.has(key)) continue;
        seen.add(key);
        const t = unitAt(rr, cc);
        if (t && !t.sword && t.player !== a.player) { applyDamage(t, s.damage + attackerBonus(a), "skill", a); bhit++; }
      }
      addLog("🐉 " + label(a) + " 释放【" + s.name + "】，向" + dirName(brDir) + "喷吐 3×2 区域，命中 " + bhit + " 名敌人。");
      break;
    }

    case "thunder": {
      // 目标合法性：九宫格内(不含自身) 或 四方向第 2 格
      const inRange = (Math.abs(tr - r) <= 1 && Math.abs(tc - c) <= 1 && !(tr === r && tc === c)) ||
        (Math.abs(tr - r) + Math.abs(tc - c) === 2 && (tr === r || tc === c));
      if (!inRange || !inBounds(tr, tc)) {
        addLog("雷霆万钧目标不合法。");
        clearSelection();
        render();
        return;
      }
      const tt = unitAt(tr, tc);
      if (tt && (tt.sword || tt.player === a.player)) {
        addLog("目标格不可选（有友军或剑刃）。");
        clearSelection();
        render();
        return;
      }
      if (window.BFX) window.BFX.cast({ type: "thunder", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc }, moved: false });
      if (tt && !tt.sword && tt.player !== a.player) {
        // 敌人：先造成伤害
        applyDamage(tt, s.damage + attackerBonus(a), "skill", a);
        if (findPos(tt)) {
          // 未阵亡 → 随机击退
          const kb = randomKnockback(tt);
          if (kb) addLog("⚡ 击退 " + label(tt) + " 到 (" + (kb.r + 1) + "," + (kb.c + 1) + ")。");
          else addLog("⚡ " + label(tt) + " 四周没有合法位置，未被击退。");
        }
      }
      // 目标格空出后，雷电之主位移进去
      let moved = false;
      if (!board[tr][tc]) {
        board[tr][tc] = a;
        board[r][c] = null;
        moved = true;
      }
      addLog("⚡ " + label(a) + " 释放【" + s.name + "】" +
        (moved ? "，位移到 (" + (tr + 1) + "," + (tc + 1) + ")" : "（目标格未空出，原地发动）") + "。");
      // 进入强化（已在强化时不叠加）
      if ((a.empowerTurns || 0) <= 0) {
        a.empowerTurns = s.empowerTurns || 3;
        a.shield += s.empowerShield || 2;
        addLog("⚡ 雷电之主进入【强化】：获得 " + (s.empowerShield || 2) + " 点护盾，持续 " + (s.empowerTurns || 3) + " 个自身回合（每回合 2 次行动）。");
        if (window.SFX) {
          window.SFX.play("buffUp", { hero: "thunder" });
          window.SFX.startLoop("empower");
        }
      } else {
        addLog("⚡ 雷电之主已处于强化状态，刷新无效（不叠加护盾/时间）。");
      }
      break;
    }

    case "shield_ally": {
      const ally = unitAt(tr, tc);
      if (!ally || ally.sword || ally.player !== a.player) {
        addLog("目标不合法（需选择一名己方存活英雄）。");
        clearSelection();
        render();
        return;
      }
      ally.shield += s.shield; // 进入现有护盾系统，可与已有护盾叠加
      addLog("🛡 " + label(a) + " 释放【" + s.name + "】，为 " + label(ally) + " 增加 " + s.shield + " 点护盾（当前护盾 " + ally.shield + "）。");
      if (window.BFX) window.BFX.cast({ type: "shield_ally", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc }, amount: s.shield });
      fx.push({ r: tr, c: tc, text: "+" + s.shield, kind: "shield" });
      break;
    }

    case "chase": {
      if (chase2) {
        // ============ 第二段：闪身追击（第 1 步「选择目标」已在前面本地处理） ============
        const opt = skillSub && skillSub.kind === "chase-blink"
          ? dashOptions.find((o) => o.kind === "chase-blink" && o.dest && o.dest.r === tr && o.dest.c === tc)
          : null;
        const tgt = skillSub ? unitAt(skillSub.tR, skillSub.tC) : null;
        if (!opt || !tgt || tgt.chaseMark !== a.uid) {
          addLog("闪身落点或目标已失效，请重新选择。");
          skillSub = null;
          render();
          return;
        }
        board[tr][tc] = a;
        board[r][c] = null;
        if (window.BFX) window.BFX.cast({ type: "chase", heroId: a.heroId, caster: { r, c }, from: { r, c }, to: { r: tr, c: tc }, target: { r: skillSub.tR, c: skillSub.tC }, stage: 1 });
        fx.push({ r: tr, c: tc, text: "闪身", kind: "skill" });
        addLog("🗡 " + label(a) + " 追猎·闪身到 (" + (tr + 1) + "," + (tc + 1) + ")，对 " + label(tgt) + " 造成 " + (s.damage + attackerBonus(a)) + " 点伤害。");
        applyDamage(tgt, s.damage + attackerBonus(a), "skill", a); // 统一伤害结算（击杀 → 触发追猎刷新）
        endChase(a); // 结束连招并清除本次产生的全部标记
        break;
      }

      // ============ 第一段：飞镖贯穿 ============
      const opt = dashOptions.find((o) => o.kind === "chase-line" && (o.path || []).some((p) => p[0] === tr && p[1] === tc));
      if (!opt) {
        addLog("追猎方向无效。");
        clearSelection();
        render();
        return;
      }
      const hitUnits = [];
      if (window.BFX) window.BFX.cast({ type: "chase", heroId: a.heroId, caster: { r, c }, path: opt.path || [], stage: 0 });
      for (const h of opt.hits) {
        const t = board[h.r][h.c];
        if (!t || t.sword || t.player === a.player) continue;
        t.chaseMark = a.uid; // 先附加追猎标记（真实状态）
        hitUnits.push(t);
      }
      // 先扣除本次释放次数，再做伤害结算：确保「击杀刷新追猎」不会被尾部的次数扣除覆盖
      consumedHere = true;
      {
        const curU = skillUsesLeft(a, activeSkillIdx);
        if (curU !== Infinity) setSkillUsesLeft(a, activeSkillIdx, curU - 1);
      }
      for (const t of hitUnits) applyDamage(t, s.damage + attackerBonus(a), "skill", a); // 全部结算（逐个判定，不只命中第一个）
      const marked = hitUnits.filter((t) => findPos(t)).length;
      a.chaseStage = 1; // 进入第二段待释放状态
      if (window.SFX && marked > 0) window.SFX.play("mark", { hero: a.heroId });
      addLog("🗡 " + label(a) + " 释放【" + s.name + "】，向" + dirName(opt.dir) + "投出飞镖，贯穿 " + opt.path.length + " 格，命中 " + hitUnits.length + " 名敌人" + (marked ? "（" + marked + " 个【追猎标记】）" : "（无标记）") + "。");
      break;
    }

    case "bloodburst": {
      // 先扣次数再做伤害结算：确保「击杀刷新血崩」不被尾部的次数扣除覆盖
      consumedHere = true;
      {
        const curU = skillUsesLeft(a, activeSkillIdx);
        if (curU !== Infinity) setSkillUsesLeft(a, activeSkillIdx, curU - 1);
      }
      // 以自身为中心九宫格内的所有敌方英雄
      const victims = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const t = unitAt(r + dr, c + dc);
          if (t && !t.sword && t.player !== a.player) victims.push(t);
        }
      }
      let totalDealt = 0;
      let kills = 0;
      if (window.BFX) window.BFX.cast({ type: "bloodburst", heroId: a.heroId, caster: { r, c } });
      for (const t of victims) {
        const aliveBefore = !!findPos(t);
        // 统一伤害结算：护盾吸收 / 减伤 / 闪避 / 阵亡都在 applyDamage 内完成；
        // 返回值 = 实际扣掉的生命值（被护盾完全吸收或闪避时为 0）
        const dealt = applyDamage(t, s.damage + attackerBonus(a), "skill", a);
        if (dealt > 0) totalDealt += dealt;
        if (window.BFX && dealt > 0) {
          const vp = findPos(t);
          if (vp) window.BFX.drain({ from: vp, to: { r, c }, color: "#e11d48" });
        }
        if (aliveBefore && !findPos(t)) kills++;
      }
      fx.push({ r, c, text: "血崩", kind: "skill" });
      if (totalDealt > 0) {
        // 吸血鬼专属：按实际总伤害回血，且【不】受 maxHp 限制（可超过 5 点）
        a.hp += totalDealt;
        addLog("🩸 " + label(a) + " 释放【" + s.name + "】，命中 " + victims.length + " 名敌人，实际造成 " + totalDealt +
          " 点伤害，汲取 " + totalDealt + " 点生命（当前生命 " + a.hp + "/" + a.maxHp + "）。");
        fx.push({ r, c, text: "+" + totalDealt, kind: "heal" });
      } else {
        addLog("🩸 " + label(a) + " 释放【" + s.name + "】，命中 " + victims.length + " 名敌人，但没有造成实际伤害，未回血。");
      }
      if (kills > 0) {
        // 只有“血崩自身击杀”才刷新（普攻击杀不刷新）
        const refreshed = refreshSkillOnSkillKill(a, activeSkillIdx);
        const nowUses = skillUsesLeft(a, activeSkillIdx);
        if (refreshed) addLog("🩸 " + label(a) + " 使用【" + s.name + "】击杀 " + kills + " 名敌人，使用次数已刷新（当前 " + nowUses + " 次）。");
      }
      break;
    }

    case "ziwei": {
      // 范围：九宫格 或 四方向第 2 格（与雷霆万钧一致）；落点必须完全为空
      const okPos = (Math.abs(tr - r) <= 1 && Math.abs(tc - c) <= 1 && !(tr === r && tc === c)) ||
        (Math.abs(tr - r) + Math.abs(tc - c) === 2 && (tr === r || tc === c));
      if (!inBounds(tr, tc) || board[tr][tc] || !okPos) {
        addLog("紫薇神步：落点不合法（必须为空且在九宫格 / 四方向第 2 格内）。");
        clearSelection();
        render();
        return;
      }
      if (window.BFX) window.BFX.cast({ type: "ziwei", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      const beforeU = enemiesInBox3(r, c, a.player);   // 位移前的九宫格
      board[tr][tc] = a;
      board[r][c] = null;
      const afterU = enemiesInBox3(tr, tc, a.player);  // 位移后的九宫格
      let zHit = 0;
      for (const t of beforeU) { if (!findPos(t)) continue; applyDamage(t, s.damage + attackerBonus(a), "skill", a); zHit++; }
      for (const t of afterU) { if (!findPos(t)) continue; applyDamage(t, s.damage + attackerBonus(a), "skill", a); zHit++; } // 重叠区域再结算一次
      addLog("👑 " + label(a) + " 释放【" + s.name + "】，瞬移到 (" + (tr + 1) + "," + (tc + 1) + ")，位移前后共结算 " + zHit + " 次伤害（重叠区域分别计算）。");
      fx.push({ r: tr, c: tc, text: "神步", kind: "skill" });
      break;
    }

    case "exile": {
      const sub = skillSub && skillSub.kind === "exile-target" ? skillSub : null;
      const tgt = sub ? unitAt(sub.tR, sub.tC) : null;
      if (!sub || !tgt || tgt.sword || tgt.uid !== sub.tUid || !findPos(tgt)) {
        addLog("放逐：目标已失效，请重新选择。");
        skillSub = null;
        clearSelection();
        render();
        return;
      }
      const cn = BOARD_CORNERS.find((x) => x.corner.r === tr && x.corner.c === tc);
      if (!cn || !cornerExileOk(cn)) {
        addLog("放逐：该墙角当前不可选（其 2×2 四宫格内已有英雄）。");
        render();
        return;
      }
      const from = findPos(tgt);
      if (window.BFX) window.BFX.cast({ type: "exile", heroId: a.heroId, caster: { r, c }, target: { r: from.r, c: from.c }, from: { r: from.r, c: from.c }, to: { r: cn.corner.r, c: cn.corner.c } });
      board[cn.corner.r][cn.corner.c] = tgt;
      board[from.r][from.c] = null;
      skillSub = null;
      addLog("👑 " + label(a) + " 释放【" + s.name + "】，将 " + label(tgt) + " 放逐到墙角 (" + (cn.corner.r + 1) + "," + (cn.corner.c + 1) + ")。");
      fx.push({ r: cn.corner.r, c: cn.corner.c, text: "放逐", kind: "skill" });
      break;
    }

    case "tianwei": {
      if (!inBounds(tr, tc) || board[tr][tc]) {
        addLog("天威：落点必须是空格。");
        clearSelection();
        render();
        return;
      }
      if (window.BFX) window.BFX.cast({ type: "tianwei", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc } });
      board[tr][tc] = a;
      board[r][c] = null;
      // 落点九宫格内的敌人：按位置排序，逐个「1 伤 + 尝试击飞出九宫格」
      const victims = enemiesInBox3(tr, tc, a.player).slice().sort((x, y) => {
        const px = findPos(x), py = findPos(y);
        if (!px) return 1;
        if (!py) return -1;
        return (px.r - py.r) || (px.c - py.c);
      });
      let tHit = 0, tKnock = 0;
      for (const t of victims) {
        if (!findPos(t)) continue;
        applyDamage(t, s.damage + attackerBonus(a), "skill", a); // 每名敌人最多结算一次
        tHit++;
        if (findPos(t) && knockOutOfBox3(t, tr, tc)) tKnock++;
      }
      addLog("👑 " + label(a) + " 释放【" + s.name + "】，降临 (" + (tr + 1) + "," + (tc + 1) + ")，命中 " + tHit + " 名敌人，击飞 " + tKnock + " 名。");
      fx.push({ r: tr, c: tc, text: "天威", kind: "skill" });
      break;
    }

    case "shenluo": {
      const victims = sortUnitsByPos(enemiesInBox3(r, c, a.player));
      if (window.BFX) window.BFX.cast({ type: "shenluo", heroId: a.heroId, caster: { r, c } });
      let sHit = 0, sPushed = 0;
      for (const t of victims) {
        if (!findPos(t)) continue;
        applyDamage(t, s.damage + attackerBonus(a), "skill", a);              // 先伤害
        sHit++;
        if (findPos(t) && knockOutBoxAway(t, r, c, r, c)) sPushed++; // 再尝试击退出九宫格
      }
      fx.push({ r, c, text: "神罗", kind: "skill" });
      addLog("🌀 " + label(a) + " 释放【" + s.name + "】，命中 " + sHit + " 名敌人，击退 " + sPushed + " 名。");
      break;
    }

    case "wxt": {
      const stage = a.wxtStage || 0;
      const wt = unitAt(tr, tc);
      if (!wt || wt.sword || wt.player === a.player) {
        addLog("万象天引：请选择一名存活的敌方英雄。");
        render();
        return;
      }
      if (stage === 2) {
        // 第三段·引力弹射：普攻范围（相邻），1 伤 + 远离方向击退 1 格
        if (Math.abs(tr - r) + Math.abs(tc - c) !== 1) {
          addLog("万象天引·第三段：只能选择相邻的敌方英雄。");
          render();
          return;
        }
        if (window.BFX) window.BFX.cast({ type: "wxt", heroId: a.heroId, caster: { r, c }, target: { r: tr, c: tc }, stage: 2 });
        applyDamage(wt, s.damage + attackerBonus(a), "skill", a);
        let pushed = false;
        if (findPos(wt)) pushed = !!pushAwayOne(wt, r, c);
        a.wxtStage = 0; // 连招结束
        fx.push({ r: tr, c: tc, text: "弹射", kind: "skill" });
        addLog("🌀 " + label(a) + " 释放【" + s.name + "·第三段·引力弹射】，对 " + label(wt) + " 造成 " + (s.damage + attackerBonus(a)) +
          " 点伤害" + (pushed ? "并沿远离方向击退 1 格" : "（无合法击退位置，仅受伤）") + "，连招结束。");
        break;
      }
      const sub = skillSub && skillSub.kind === "wxt-dir-set" ? skillSub : null;
      if (!sub) {
        addLog("万象天引：请先选择方向。");
        render();
        return;
      }
      const [dr, dc] = sub.dir;
      const inRange = wxtStageTargets(a, r, c, dr, dc, stage).some((p) => p[0] === tr && p[1] === tc);
      if (!inRange) {
        addLog("万象天引：目标不在该段的合法范围内。");
        render();
        return;
      }
      if (stage === 0) {
        // 第一段·引力汇聚：拉到【正前方两格】
        const lr = r + dr * 2, lc = c + dc * 2;
        if (!inBounds(lr, lc) || (board[lr][lc] && board[lr][lc] !== wt)) {
          addLog("万象天引·第一段：正前方两格被占据或越界，无法执行（不消耗行动/次数）。");
          render();
          return;
        }
        const from = findPos(wt);
        if (window.BFX) window.BFX.cast({ type: "wxt", heroId: a.heroId, caster: { r, c }, target: { r: lr, c: lc }, stage: 0 });
        if (from.r !== lr || from.c !== lc) {
          board[lr][lc] = wt;
          board[from.r][from.c] = null;
        }
        applyDamage(wt, s.damage + attackerBonus(a), "skill", a);
        a.wxtStage = 1; // 进入第二段
        fx.push({ r: lr, c: lc, text: "引力", kind: "skill" });
        addLog("🌀 " + label(a) + " 释放【" + s.name + "·第一段·引力汇聚】，将 " + label(wt) + " 拉到正前方两格 (" +
          (lr + 1) + "," + (lc + 1) + ") 并造成 " + (s.damage + attackerBonus(a)) + " 点伤害（第二段待执行，可跨回合）。");
      } else {
        // 第二段·万象引渡：抓到【正前方一格】+ 抓取 1 回合
        const lr = r + dr, lc = c + dc;
        if (!inBounds(lr, lc) || (board[lr][lc] && board[lr][lc] !== wt)) {
          addLog("万象天引·第二段：正前方格被占据或越界，无法执行（不消耗行动/次数）。");
          render();
          return;
        }
        const from = findPos(wt);
        if (window.BFX) window.BFX.cast({ type: "wxt", heroId: a.heroId, caster: { r, c }, target: { r: lr, c: lc }, stage: 1 });
        if (from.r !== lr || from.c !== lc) {
          board[lr][lc] = wt;
          board[from.r][from.c] = null;
        }
        applyDamage(wt, s.damage + attackerBonus(a), "skill", a);
        let grabbed = false;
        if (findPos(wt)) {
          applyNegativeStatus(wt, "grab", { damage: 0, turns: 1, label: "万象天引·抓取", from: { r, c } });
          grabbed = true;
        }
        a.wxtStage = 2; // 进入第三段
        fx.push({ r: lr, c: lc, text: "引渡", kind: "skill" });
        addLog("🌀 " + label(a) + " 释放【" + s.name + "·第二段·万象引渡】，将 " + label(wt) + " 抓到正前方一格 (" +
          (lr + 1) + "," + (lc + 1) + ") 并造成 " + (s.damage + attackerBonus(a)) + " 点伤害" + (grabbed ? "，施加【抓取 1 回合】" : "（目标已阵亡，不施加抓取）") + "（第三段待执行，可跨回合）。");
      }
      break;
    }
  }

  // 消耗一次释放次数（无限次技能不减少；水调歌头 / 追猎第二段不额外消耗；追猎第一段已在分支内提前扣除）
  if (!sd2 && !chase2 && !wxtCombo && !consumedHere) {
    const curUses = skillUsesLeft(a, activeSkillIdx);
    if (curUses !== Infinity) setSkillUsesLeft(a, activeSkillIdx, curUses - 1);
  }
  if (s.costSwords) {
    a.swords = Math.max(0, (a.swords || 0) - s.costSwords);
    addLog("⚔ " + label(a) + " 消耗 " + s.costSwords + " 把剑（剩余 " + a.swords + " 把）。");
  }
  const isFree = freeAction;                  // 不消耗行动机会的技能（剑圣 / 骑士横扫 / 守卫铁壁 / 追猎第二段）
  const keepOpen = !!(s.free && !s.perTurn);  // free 型技能使用后不结束回合
  if (!isFree) turnActionUsed = true;
  clearSelection();
  // 技能音效：只有在真正结算完成（未提前 return）后才播放，失败/取消不会误播
  if (window.SFX && window.SFX.playSkill) {
    window.SFX.playSkill(sfxType, { hero: sfxHero, stage: sfxStage });
  }
  afterAction(a, isFree, keepOpen);
}

function activateSkill(idx) {
  if (phase !== "battle" || !selected) return;
  const u = board[selected.r][selected.c];
  if (!u || u.player !== currentPlayer) return;
  const skills = heroSkills(heroDef(u.heroId));
  const s = skills[idx] || skills[0];
  if (!s) return;

  // 已在选择目标：先取消当前选择
  if (skillMode) {
    const same = activeSkillIdx === idx;
    skillMode = false;
    skillTargets = [];
    dashOptions = [];
    skillSub = null;
    computeTargets();
    if (same) {
      render();
      return;
    }
  }

  activeSkillIdx = idx;
  if (isPassiveSkill(s)) {
    addLog("【" + s.name + "】是被动技能，无需释放。");
    render();
    return;
  }
  // 渡鸦·潜行双动进行中：第二次行动只能是「移动」或「普通攻击」
  if (isStealthed(u) && u.ravenDoubleUsed && !turnActionUsed) {
    addLog("🌑 潜行双动：第一次移动后只能再进行一次移动或普通攻击。");
    render();
    return;
  }
  if (skillBlockedByStatus(u)) {
    addLog(label(u) + " 处于【" + actionBlockReason(u) + "】状态，无法使用技能。");
    render();
    return;
  }
  if (isRooted(u) && isSelfMoveSkill(u, s)) {
    addLog(label(u) + " 处于【定身】状态，无法使用位移技能（普通攻击与非位移技能仍可用）。");
    render();
    return;
  }
  if (!skillFreeFor(u, s) && !canActNow(u)) {
    addLog("本回合已经行动过了（不耗步技能除外）。");
    render();
    return;
  }
  // 追猎：若处于「第二段待释放」但已无有效标记目标（目标阵亡/标记已清）→ 结束连招，回到第一段
  if (s.type === "chase" && (u.chaseStage || 0) === 1 && chaseTargetsOf(u).length === 0) {
    endChase(u);
    addLog("🗡 追猎：已无可用的标记目标，连招结束（回到第一段）。");
  }
  const isSd2 = s.type === "shuidiao" && (u.sdStage || 0) === 1; // 第二段同属一套，不额外占次数
  const isChase2 = s.type === "chase" && (u.chaseStage || 0) === 1; // 追猎第二段不额外占次数
  const isWxtCombo = s.type === "wxt" && (u.wxtStage || 0) >= 1; // 万象天引第二/三段不重复占整套次数
  const sl = skillUsesLeft(u, idx);
  if (!isSd2 && !isChase2 && !isWxtCombo && sl !== Infinity && sl <= 0) {
    addLog("【" + s.name + "】释放次数已用尽。");
    render();
    return;
  }
  if (!canPaySwords(u, s)) {
    addLog("没有剑可用，【" + s.name + "】无法发动。");
    render();
    return;
  }

  skillSub = null;
  computeSkillTargets();
  if (skillTargets.length === 0) {
    addLog("【" + s.name + "】当前没有可用目标。");
    render();
    return;
  }
  skillMode = true;
  moveTargets = [];
  attackTargets = [];
  render();
}

/* ============================ 锦囊：使用 ============================ */
function startTalismanUse(id) {
  if (gameMode === "ai" && currentPlayer === aiPlayer) return; // AI 由 AI 逻辑使用
  if (phase !== "battle") {
    addLog("锦囊只能在联机 / 对战阶段使用。");
    render();
    return;
  }
  const tid = id || talisman[currentPlayer];
  if (!tid) return;
  if (talismanUsed[currentPlayer]) {
    addLog("本局锦囊已经使用过了。");
    render();
    return;
  }
  const t = getTalismanById(tid);
  if (!t) return;

  if (talismanMode === tid) { // 再次点击 → 取消
    clearSelection();
    render();
    return;
  }

  if (t.target === "none") {
    if (gameMode === "online") { onlineForward({ type: "talisman", id: tid }); return; }
    useTalismanEffect(tid, null, null);
    return;
  }

  // 需要选择目标
  const targets = talismanTargetsFor(tid, currentPlayer);
  if (targets.length === 0) {
    addLog("【" + t.name + "】没有合法目标" +
      (t.target === "deadAlly" ? "（没有可复活的阵亡英雄，或其位置已被占用）。" : "（没有生命未满的己方英雄）。"));
    render();
    return;
  }
  talismanMode = tid;
  talismanTargets = targets;
  skillMode = false;
  skillTargets = [];
  moveTargets = [];
  attackTargets = [];
  render();
  addLog("🎴 请选择【" + t.name + "】的目标（点击高亮格子；再次点按钮可取消）。");
}

function handleTalismanClick(r, c) {
  const tid = talismanMode;
  if (!tid) {
    clearSelection();
    render();
    return;
  }
  if (!isTarget(talismanTargets, r, c)) {
    addLog("该目标不合法，请重新选择。");
    render();
    return; // 保持选择状态，允许重新选择
  }
  if (gameMode === "online") {
    onlineForward({ type: "talisman", id: tid, to: { r, c } });
    return;
  }
  useTalismanEffect(tid, r, c);
}

/* 执行锦囊效果。tr/tc 为目标格（可空）。非法目标不消耗锦囊。 */
function useTalismanEffect(id, tr, tc) {
  const t = getTalismanById(id);
  if (!t) return false;
  const player = currentPlayer;
  let ok = true;
  switch (t.effect) {
    case "assault":
      talismanBuff.assaultPlayer = player;
      addLog("🔥 玩家" + player + " 使用【猛攻令】：本回合己方造成的伤害 +1（普攻 / 技能 / 剑圣）。");
      break;
    case "march":
      extraTurnPending = true;
      addLog("🐎 玩家" + player + " 使用【行军令】：本回合结束后获得一个【额外回合】（完整行动，结束后才轮到对手）。");
      break;
    case "refresh": {
      const u = tr != null ? board[tr][tc] : null;
      if (!u || u.sword || u.player !== player) {
        addLog("请选择一名己方存活英雄。");
        ok = false;
        break;
      }
      let n = 0;
      heroSkills(heroDef(u.heroId)).forEach((sk, i) => {
        if (isPassiveSkill(sk) || sk.uses == null) return; // 不处理被动 / 无限次技能
        const max = sk.perTurn ? sk.perTurn : sk.uses;
        if (skillUsesLeft(u, i) !== max) {
          setSkillUsesLeft(u, i, max);
          n++;
        }
      });
      if (n === 0) {
        addLog("【" + label(u) + "】没有可刷新的技能次数。");
        ok = false;
        break;
      }
      addLog("♻️ 玩家" + player + " 使用【技能重整令】：仅刷新 " + label(u) + " 的技能次数（" + n + " 项）。");
      break;
    }
    case "guard":
      talismanBuff.guardPlayer = player;
      addLog("🛡 玩家" + player + " 使用【坚守令】：己方英雄在对手的下一个回合受到的伤害 -1。");
      break;
    case "heal": {
      const u = tr != null ? board[tr][tc] : null;
      if (!u || u.sword || u.player !== player || u.hp >= u.maxHp) {
        addLog("目标不合法，【战地急救令】未消耗。");
        ok = false;
        break;
      }
      const healed = Math.max(0, Math.min(t.heal || 2, u.maxHp - u.hp));
      u.hp += healed;
      if (window.SFX) window.SFX.play("heal", { hero: u.heroId });
      if (window.BFX) window.BFX.heal({ r: tr, c: tc, amount: healed });
      fx.push({ r: tr, c: tc, text: "+" + healed, kind: "heal" });
      addLog("➕ 玩家" + player + " 使用【战地急救令】：" + label(u) + " 恢复 " + healed + " 点生命（" + u.hp + "/" + u.maxHp + "）。");
      break;
    }
    case "revive": {
      // 落点：原位置优先；若被占据（例如击杀者已占据目标格），使用最近的空格
      let rec = null;
      let recAtOrigin = false;
      for (const g of graveyard) {
        if (g.player !== player) continue;
        const cell = reviveCellFor(g);
        if (cell && cell.r === tr && cell.c === tc) {
          rec = g;
          recAtOrigin = (g.r === tr && g.c === tc);
          break;
        }
      }
      if (!rec) { addLog("该位置没有可复活的己方阵亡英雄。"); ok = false; break; }
      if (!inBounds(tr, tc) || board[tr][tc]) { addLog("该位置已被占用，无法复活。"); ok = false; break; }
      const def = heroDef(rec.heroId);
      // 复活 = 恢复阵亡瞬间的全部状态，仅生命值变为 3
      const snap = rec.snapshot ? JSON.parse(JSON.stringify(rec.snapshot)) : null;
      const revived = snap ? Object.assign({}, snap, { uid: unitSeq++, heroId: def.id, player, hp: Math.min(3, def.hp), maxHp: def.hp }) : {
        uid: unitSeq++,
        heroId: def.id,
        player,
        hp: Math.min(3, def.hp),
        maxHp: def.hp,
        shield: 0,
        frozen: 0,
        swords: rec.swords || 0,
        usesLeft: rec.usesLeft || 0,
        usesArr: rec.usesArr && rec.usesArr.length ? rec.usesArr.slice() : undefined,
        statuses: {},
        lockUsed: !!rec.lockUsed,
        guixiongUsed: !!rec.guixiongUsed,
        wxtStage: 0,
        sdStage: 0,
        dragonMoves: 0,
        empowerTurns: 0,
        chaseStage: 0,
        chaseMark: 0,
        stealth: null,
        ravenBuff: false,
        ravenDouble: false,
        ravenDoubleUsed: false,
        metalBuff: false,
        metalTide: 0,
      };
      if (!revived.statuses) revived.statuses = {};
      board[tr][tc] = revived;
      graveyard = graveyard.filter((g) => g !== rec);
      if (window.SFX) window.SFX.play("revive", { hero: def.id });
      if (window.BFX) window.BFX.revive({ r: tr, c: tc });
      fx.push({ r: tr, c: tc, text: "复活", kind: "heal" });
      addLog("💫 玩家" + player + " 使用【还魂令】：" + def.name + " 在 (" + (tr + 1) + "," + (tc + 1) + ") 复活" +
        (recAtOrigin ? "" : "（原位置已被占据，改在最近的空格）") +
        "，恢复至 3 点生命（保留阵亡时的技能次数 / 护盾 / 状态 / 强化阶段）。");
      break;
    }
    default:
      ok = false;
  }
  if (!ok) { render(); return false; }            // 非法：不消耗锦囊
  talismanUsed[player] = true;                     // 使用后消耗
  // 锦囊演出：卡牌飞向目标 → 展开 → 专属效果（纯视觉，状态已在上面结算完成）
  let tzPlayed = false;
  try {
    if (window.BFX && window.BFX.talismanCast) {
      tzPlayed = window.BFX.talismanCast({
        id: t.id,
        name: t.name,
        icon: t.icon,
        target: (tr != null && tc != null) ? { r: tr, c: tc } : null,
        caster: player,
      });
    }
  } catch (e) { tzPlayed = false; }
  if (!tzPlayed && window.SFX && window.SFX.playTalisman) window.SFX.playTalisman(t.id, {});
  // 动画期间限制重复点击（0.62s，短于整套演出，不会卡住操作）
  inputLockUntil = Math.max(inputLockUntil, Date.now() + 620);
  clearSelection();
  if (checkVictory()) return true;
  render();
  return true;
}

/* ============================ 点击入口 ============================ */
function handleBattle(r, c) {
  // 技能选择模式
  if (skillMode) {
    if (isTarget(skillTargets, r, c)) {
      useSkill(r, c);
      return;
    }
    // 点击非目标 → 取消技能
    skillMode = false;
    computeTargets();
    render();
    return;
  }

  const clicked = board[r][c];

  // 点击己方英雄 → 选中 / 取消选中（判断是否被冰封）
  if (clicked && clicked.player === currentPlayer) {
    if (clicked.frozen > 0) {
      addLog(label(clicked) + " 处于冰封状态，无法行动。");
      render();
      return;
    }
    if (isDisabled(clicked)) {
      addLog(label(clicked) + " 处于【" + actionBlockReason(clicked) + "】状态，本回合无法行动。");
      render();
      return;
    }
    if (selected && selected.r === r && selected.c === c) {
      clearSelection();
      render();
      return;
    }
    selected = { r, c };
    activeSkillIdx = 0;
    skillSub = null;
    computeTargets();
    render();
    return;
  }

  // 已有选中单位 → 执行移动 / 普通攻击
  if (selected) {
    if (isTarget(moveTargets, r, c)) {
      moveHero(r, c);
      return;
    }
    if (isTarget(attackTargets, r, c)) {
      normalAttack(board[selected.r][selected.c], clicked);
      return;
    }
  }

  clearSelection();
  render();
}

/* ============================ 龙胆：额外移动 ============================ */
function canControlForDragonMove(u) {
  if (gameMode === "ai") return u.player !== aiPlayer;
  if (gameMode === "online") return !window.NET || !window.NET.myPlayer || u.player === window.NET.myPlayer;
  return true;
}
/* 龙胆：只能由「己方玩家」在「自己的回合」通过按钮使用 */
function canUseDragonMoveNow(u) {
  if (!u || u.sword) return false;
  if (phase !== "battle") return false;
  if (u.player !== currentPlayer) return false; // 只能自己回合
  return canControlForDragonMove(u);            // 只能控制自己的单位
}
function selectDragonMove(u, r, c) {
  dragonMoveUnit = u;
  selected = { r, c };
  dragonMoveTargets = [];
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    if (!board[nr][nc]) dragonMoveTargets.push([nr, nc]);
  }
  skillMode = false;
  skillTargets = [];
  moveTargets = [];
  attackTargets = [];
  render();
  addLog("🐉 龙胆：" + label(u) + " 有 " + (u.dragonMoves || 0) + " 次额外移动机会，请选择移动方向。");
}
/* 龙胆（主动）：点击按钮进入额外移动选格；再次点击取消。
 * 规则：只能在自己的回合、通过按钮释放（不再支持回合外点击棋子触发）。 */
function activateDragonMove(u) {
  if (!u || u.sword) return;
  if (dragonMoveUnit === u) { // 取消（任何时候都允许）
    dragonMoveUnit = null;
    dragonMoveTargets = [];
    clearSelection();
    render();
    return;
  }
  if (!canUseDragonMoveNow(u)) {
    addLog("🐉【龙胆】只能在自己回合通过按钮使用（对手回合闪避积累的次数保留到你的下个回合）。");
    render();
    return;
  }
  if ((u.dragonMoves || 0) <= 0) {
    addLog("🐉 龙胆：尚未积累额外移动次数（需【龙魂】成功闪避）。");
    render();
    return;
  }
  const p = findPos(u);
  if (!p) return;
  selectDragonMove(u, p.r, p.c);
}
function performDragonMove(r, c) {
  const u = dragonMoveUnit;
  if (!u || !findPos(u)) { dragonMoveUnit = null; dragonMoveTargets = []; render(); return; }
  if (!isTarget(dragonMoveTargets, r, c)) { addLog("该方向不能额外移动。"); render(); return; }
  const from = findPos(u);
  if (gameMode === "online") {
    onlineForward({ type: "dragonmove", from: { r: from.r, c: from.c }, to: { r, c } });
    dragonMoveUnit = null;
    dragonMoveTargets = [];
    return;
  }
  board[r][c] = u;
  board[from.r][from.c] = null;
  u.dragonMoves = Math.max(0, (u.dragonMoves || 0) - 1);
  addLog("🐉 龙胆：" + label(u) + " 额外移动到 (" + (r + 1) + "," + (c + 1) + ")（剩余 " + u.dragonMoves + " 次）。");
  dragonMoveUnit = null;
  dragonMoveTargets = [];
  selected = null;
  if (window.SFX) window.SFX.play("swordPickup", { hero: u.heroId });
  if (checkVictory()) return;
  render();
}

/* 雷电之主：将目标随机击退到其四周一个合法格（棋盘内、非墙、无单位） */
function randomKnockback(t) {
  const p = findPos(t);
  if (!p) return null;
  const opts = [];
  for (const [dr, dc] of DIRS) {
    const nr = p.r + dr;
    const nc = p.c + dc;
    if (!inBounds(nr, nc)) continue;
    if (board[nr][nc]) continue;
    opts.push({ r: nr, c: nc });
  }
  if (!opts.length) return null;
  const pick = opts[Math.floor(Math.random() * opts.length)];
  board[pick.r][pick.c] = t;
  board[p.r][p.c] = null;
  if (window.BFX) window.BFX.knockback({ from: p, to: pick, color: window.BFX.heroColor(t.heroId) });
  if (window.SFX) window.SFX.play("knockback", { hero: t.heroId });
  return pick;
}

function onCellClick(r, c) {
  // 表现层保护：刚完成一次行动后的极短输入锁，防止连续点击重复施法/重复攻击（不影响规则与 AI）
  if (Date.now() < inputLockUntil) return;
  // 龙胆选点中：只处理选点（该模式只能由己方回合的按钮开启）
  if (dragonMoveUnit) {
    performDragonMove(r, c);
    return;
  }
  // AI 模式下：轮到电脑行动时忽略人类点击
  if (gameMode === "ai" && currentPlayer === aiPlayer && phase !== "over") return;
  // 联机模式下：非本方回合忽略点击
  if (onlineBlocked()) return;
  // 锦囊选择目标：拦截点击，避免误触移动/攻击
  if (talismanMode) {
    handleTalismanClick(r, c);
    return;
  }
  // 点击英雄 → 显示技能详情（不影响选中/移动/攻击/回合流程）
  const clickedUnit = isUnit(board[r][c]) ? board[r][c] : null;
  if (clickedUnit) showUnitDetail(clickedUnit);
  if (phase === "placement") handlePlacement(r, c);
  else if (phase === "battle") handleBattle(r, c);
  aiKick();
}

/* ============================ 渲染 ============================ */
function buildUnit(u) {
  const def = heroDef(u.heroId);
  const el = document.createElement("div");
  el.className = "unit p" + u.player;
  el.dataset.uid = u.uid;
  el.title =
    def.name +
    " · 生命 " +
    u.hp +
    "/" +
    u.maxHp +
    (u.shield ? " · 护盾 " + u.shield : "") +
    (u.frozen ? " · 冰封 " + u.frozen : "");

  const icon = document.createElement("div");
  icon.className = "unit-icon";
  icon.textContent = def.icon;
  el.appendChild(icon);

  const name = document.createElement("div");
  name.className = "unit-name";
  name.textContent = def.name;
  el.appendChild(name);

  const hp = document.createElement("span");
  hp.className = "unit-hp";
  hp.textContent = u.hp;
  el.appendChild(hp);

  const bar = document.createElement("div");
  bar.className = "hp-bar";
  const fill = document.createElement("div");
  fill.className = "hp-fill";
  // 吸血鬼·血崩可让生命值超过 maxHp：进度条最多铺满，数字显示真实值
  fill.style.width = Math.min(100, Math.max(0, (u.hp / u.maxHp) * 100)) + "%";
  bar.appendChild(fill);
  el.appendChild(bar);

  if (u.shield > 0) {
    const b = document.createElement("span");
    b.className = "badge shield";
    b.textContent = "🛡" + u.shield;
    el.appendChild(b);
  }
  if (u.frozen > 0) {
    const b = document.createElement("span");
    b.className = "badge frozen";
    b.textContent = "❄";
    el.appendChild(b);
  }
  if (u.hp > u.maxHp) {
    // 吸血鬼·血崩可突破生命上限：显示超出的部分
    const b = document.createElement("span");
    b.className = "badge overheal";
    b.title = "超出生命上限 " + (u.hp - u.maxHp);
    b.textContent = "+" + (u.hp - u.maxHp);
    el.appendChild(b);
  }
  if (u.chaseMark) {
    const b = document.createElement("span");
    b.className = "badge chase";
    b.title = "追猎标记";
    b.textContent = "🎯";
    el.appendChild(b);
  }
  if (u.guixiongUsed) {
    const b = document.createElement("span");
    b.className = "badge guixiong";
    b.title = "鬼雄已触发：生命锁定 1 · 普通攻击伤害 +1（绝境）";
    b.textContent = "👹";
    el.appendChild(b);
  }
  if (isStunned(u)) {
    const b = document.createElement("span");
    b.className = "badge stun";
    b.title = "眩晕：无法移动 / 攻击 / 使用技能（剩余 " + (u.statuses.stun.turns || 1) + " 个自身回合）";
    b.textContent = "💫";
    el.appendChild(b);
  }
  return el;
}

function buildSwordObj() {
  const el = document.createElement("div");
  el.className = "sword-obj";
  el.title = "地上的剑刃（阿修罗踩上可回收）";
  el.textContent = "🗡";
  return el;
}

/* 渡鸦·毒雾：地面层（不阻挡移动），显示剩余回合 */
function buildMistObj(m) {
  const el = document.createElement("div");
  el.className = "mist-obj";
  const t = document.createElement("span");
  t.className = "mist-turns";
  t.textContent = String(Math.max(0, m.turns || 0));
  el.appendChild(t);
  el.title = "毒雾：位于此格的英雄在其回合结束时受到 0.5 点伤害（剩余 " + Math.max(0, m.turns || 0) + " 回合）";
  return el;
}

/* 山丘之王·石柱：独立临时地形，显示剩余回合；阻挡移动 / 突进 / 传送 / 推击 */
function buildPillarObj(p) {
  const el = document.createElement("div");
  el.className = "pillar-obj";
  const rock = document.createElement("div");
  rock.className = "pillar-rock";
  rock.textContent = "⛰";
  el.appendChild(rock);
  const turns = document.createElement("span");
  turns.className = "pillar-turns";
  turns.textContent = String(Math.max(0, p.turns || 0));
  el.appendChild(turns);
  el.title = "临时石柱：阻挡移动 / 突进 / 传送 / 推击，剩余 " + Math.max(0, p.turns || 0) + " 个完整回合";
  return el;
}

function render() {
  const info = computeFlankInfo();
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--cols", SIZE);

  // 阿修罗·剑圣：预计算待突进的路径格与命中格（用于高亮）
  const dashPaths = new Set();
  const dashHits = new Set();
  if (skillMode && dashOptions.length) {
    for (const o of dashOptions) {
      if (Array.isArray(o.path)) {
        // 追猎第一段：高亮整条飞镖路径（贯穿到边界）
        for (const [rr, cc] of o.path) dashPaths.add(rr + "_" + cc);
      } else if (o.dir && selected) {
        const [dr, dc] = o.dir;
        for (let k = 1; k <= 3; k++) {
          const rr = selected.r + dr * k;
          const cc = selected.c + dc * k;
          if (!inBounds(rr, cc)) break;
          dashPaths.add(rr + "_" + cc);
          if (o.dest && rr === o.dest.r && cc === o.dest.c) break;
        }
      }
      for (const h of (o.hits || [])) dashHits.add(h.r + "_" + h.c);
    }
  }

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "cell territory-p" + territoryOf(c);

      if (phase === "placement" && territoryOf(c) === mySide() && !board[r][c]) {
        cell.classList.add("selectable");
      }
      if (selected && selected.r === r && selected.c === c) cell.classList.add("selected");

      const isMove = isTarget(moveTargets, r, c);
      const isAtk = isTarget(attackTargets, r, c);
      const isSkill = skillMode && isTarget(skillTargets, r, c);
      if (isMove) cell.classList.add("move-target");
      if (isAtk) cell.classList.add("attack-target");
      if (isSkill) cell.classList.add("skill-target");
      if (dashPaths.has(r + "_" + c)) cell.classList.add("dash-path");
      if (dashHits.has(r + "_" + c)) cell.classList.add("dash-hit");
      if (talismanMode && isTarget(talismanTargets, r, c)) cell.classList.add("tz-target");
      if (dragonMoveUnit && isTarget(dragonMoveTargets, r, c)) cell.classList.add("move-target");

      const u = board[r][c];
      // 毒雾是地面层（不阻挡棋子，先绘制，棋子在其上方）
      const mm = mistAt(r, c);
      if (mm) {
        cell.classList.add("mist-cell");
        cell.appendChild(buildMistObj(mm));
      }
      if (isSword(u)) {
        cell.classList.add("sword-cell");
        cell.appendChild(buildSwordObj());
      } else if (isPillar(u)) {
        cell.classList.add("pillar-cell");
        cell.appendChild(buildPillarObj(u));
      } else if (u) {
        if (phase === "battle" && u.player === currentPlayer && u.frozen <= 0) {
          cell.classList.add("selectable");
        }
        const d = info.get(u.uid);
        if (d && d.flanked) cell.classList.add("flanked");
        else if (d && d.base && d.protected) cell.classList.add("protected-unit");
        if (hasSuperArmor(u)) cell.classList.add("superarmor");
        if (u.chaseMark) cell.classList.add("chase-marked");
        if (isStealthed(u)) cell.classList.add("stealth-unit");
        if (u.ravenBuff) cell.classList.add("raven-buffed");
        if (u.metalBuff) cell.classList.add("metal-buffed");
        if (u.metalTide > 0) cell.classList.add("metal-tide");
        if (isRooted(u)) cell.classList.add("rooted");

        cell.appendChild(buildUnit(u));

        // 夹击 / 保护 徽标
        if (d && d.flanked) {
          const b = document.createElement("span");
          b.className = "badge-cell flank";
          b.textContent = "夹击×" + d.count;
          cell.appendChild(b);
        } else if (d && d.base && d.protected) {
          const b = document.createElement("span");
          b.className = "badge-cell guarded";
          b.textContent = "护";
          cell.appendChild(b);
        }
        if ((u.dragonMoves || 0) > 0) {
          const b = document.createElement("span");
          b.className = "badge-cell dragon";
          b.textContent = "龙胆" + u.dragonMoves;
          cell.appendChild(b);
        }
        if ((u.empowerTurns || 0) > 0) {
          const b = document.createElement("span");
          b.className = "badge-cell empower";
          b.textContent = "强化" + u.empowerTurns;
          cell.appendChild(b);
        }
      }

      // 目标高亮覆盖层（盖在单位之上，保证可见）
      if (isMove || isAtk || isSkill) {
        const ov = document.createElement("div");
        ov.className = "target-overlay " + (isSkill ? "ov-skill" : isAtk ? "ov-atk" : "ov-move");
        if (!u) ov.classList.add("ov-empty");
        cell.appendChild(ov);
      }

      // 普通攻击预览：显示本次攻击的伤害与是否夹击
      if (isAtk && u) {
        const d = info.get(u.uid);
        const prev = document.createElement("span");
        prev.className = "atk-preview";
        if (d && d.flanked) {
          prev.classList.add("flank");
          prev.textContent = "夹击×" + d.count + " -" + (BASE_ATTACK + d.bonus);
        } else if (d && d.base && d.protected) {
          prev.classList.add("guard");
          prev.textContent = "护 -" + BASE_ATTACK;
        } else {
          prev.textContent = "-" + BASE_ATTACK;
        }
        cell.appendChild(prev);
      }

      // 飘字特效
      const f = fx.find((item) => item.r === r && item.c === c);
      if (f) {
        const fe = document.createElement("span");
        fe.className = "fx " + f.kind;
        fe.textContent = f.text;
        cell.appendChild(fe);
      }

      cell.addEventListener("click", () => onCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }

  fx = []; // 飘字为一次性特效，渲染后清空
  updatePanel(info);
  // 表现层：棋盘重建后校正画布尺寸/坐标（仅尺寸变化时才真正重置，不会打断正在播放的特效）
  if (window.BFX) {
    window.BFX.sync();
    // 正在选目标 / 显示可操作范围时，让战场印记进一步变淡，避免盖住高亮
    window.BFX.setTargeting(!!(selected && (skillMode || talismanMode ||
      moveTargets.length || attackTargets.length || skillTargets.length)));
  }
}

function updateRoster() {
  if (phase !== "placement") {
    heroRosterEl.classList.add("hidden");
    return;
  }
  heroRosterEl.classList.remove("hidden");
  // 联机随机选将：只显示本人候选池中的英雄（服务端下发，客户端无法指定）
  const online = gameMode === "online";
  const pool = online && onlinePool && onlinePool.length ? onlinePool : null;
  const me = mySide();
  const titleEl = heroRosterEl.querySelector(".roster-title");
  if (titleEl) {
    titleEl.textContent = online
      ? "你的候选英雄（本局由服务器随机抽取，仅你可部署）"
      : "选择要放置的英雄（每方不可重复）";
  }
  rosterListEl.innerHTML = "";
  const used = placedIds[me] || [];
  const list = pool ? pool.map((id) => heroDef(id)).filter(Boolean) : HEROES;
  for (const h of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "hero-option";
    const isUsed = used.includes(h.id);
    if (isUsed) card.classList.add("used");
    if (pendingHero === h.id) card.classList.add("active");
    card.disabled = isUsed;
    card.title = h.name + "｜" + h.tag + "\n技能【" + h.skill.name + "】：" + h.skill.desc;
    card.innerHTML =
      '<span class="ho-icon">' + h.icon + "</span>" +
      '<span class="ho-name">' + h.name + "</span>" +
      '<span class="ho-hp">♥ ' + h.hp + "</span>";
    card.addEventListener("click", () => {
      pendingHero = h.id;
      render();
    });
    rosterListEl.appendChild(card);
  }
}

function updateHeroCard() {
  const u = selected ? board[selected.r][selected.c] : null;
  if (!u) {
    heroCardEl.className = "hero-card empty";
    heroCardEl.innerHTML = '<div class="muted">点击己方英雄查看属性与技能</div>';
    return;
  }
  const def = heroDef(u.heroId);
  heroCardEl.className = "hero-card p" + u.player;
  const skillHtml = heroSkills(def).map((sk, i) => {
    const isP = isPassiveSkill(sk);
    const sl = skillUsesLeft(u, i);
    const cd = isP ? "被动" : (sl === Infinity ? "∞" : (sl > 0 ? "剩 " + sl : "已用尽"));
    const meta = isP
      ? "被动（常驻）"
      : (sk.perTurn
          ? "每回合 " + sk.perTurn + " 次（本回合剩 " + (sl === Infinity ? "∞" : sl) + "）"
          : "本局剩余 " + (sl === Infinity ? "∞" : sl + " / " + sk.uses) + " 次") +
        (sk.free ? " · 不消耗行动" : "") +
        (sk.costSwords ? " · 消耗剑 " + sk.costSwords : "") + " · 释放条件：" + (sk.condition || "无");
    return '<div class="hc-skill">' +
      '<div class="hc-skill-name">【' + sk.name + '】 <span class="hc-cd ' + (isP || sl === Infinity || sl > 0 ? "ready" : "cool") + '">' + cd + "</span></div>" +
      '<div class="hc-skill-desc">' + sk.desc + "</div>" +
      '<div class="hc-skill-meta">' + meta + "</div></div>";
  }).join("");
  const chips = [];
  if (u.heroId === "lone") {
    chips.push(isLoneActive(u)
      ? '<span class="chip lone">🐺 孤胆生效：伤害 +1 · 霸体 · 免疫夹击</span>'
      : '<span class="chip">🐺 孤胆未生效（九宫格内有友军）</span>');
    chips.push('<span class="chip ' + (u.lockUsed ? "" : "lone") + '">' + (u.lockUsed ? "锁血：已使用" : "锁血：可用") + "</span>");
  }
  if (u.heroId === "xiangyu") {
    chips.push(u.guixiongUsed
      ? '<span class="chip guixiong">👹 鬼雄已触发：生命锁定 1 · 普通攻击伤害 +1（绝境）</span>'
      : '<span class="chip">👹 鬼雄：未触发（首次致命伤锁血为 1，并反击九宫格 2 点）</span>');
  }
  if (u.heroId === "tiandao") {
    const wst = u.wxtStage || 0;
    chips.push('<span class="chip' + (wst ? " guixiong" : "") + '">🌀 万象天引：' +
      (wst === 0 ? "第一段待执行" : wst === 1 ? "第二段待执行（已引力汇聚）" : "第三段待执行（已万象引渡）") + "</span>");
  }
  if (u.statuses) {
    for (const k of Object.keys(u.statuses)) {
      chips.push('<span class="chip frozen">⛓ ' + (u.statuses[k].label || k) + (u.statuses[k].turns != null ? " 剩 " + u.statuses[k].turns : "") + "</span>");
    }
  }
  if (u.heroId === "asura") chips.push('<span class="chip blade">🗡 携带剑 ' + (u.swords || 0) + " 把</span>");
  if (u.shield > 0) chips.push('<span class="chip shield">🛡 护盾 ' + u.shield + "</span>");
  if (u.frozen > 0) chips.push('<span class="chip frozen">❄ 冰封 ' + u.frozen + "</span>");
  const passiveHtml = heroPassives(def).map((p) =>
    '<div class="hc-skill hc-passive">' +
      '<div class="hc-skill-name">【' + p.name + '】 <span class="hc-cd ready">被动</span></div>' +
      '<div class="hc-skill-desc">' + p.desc + "</div>" +
    "</div>").join("");
  heroCardEl.innerHTML =
    '<div class="hc-head">' +
      '<span class="hc-icon">' + def.icon + "</span>" +
      '<div class="hc-title">' +
        '<div class="hc-name">' + def.name + "</div>" +
        '<div class="hc-tag">' + def.tag + "</div>" +
      "</div>" +
      '<div class="hc-hp">' + u.hp + "/" + u.maxHp + "</div>" +
    "</div>" +
    '<div class="hc-desc">' + def.desc + "</div>" +
    '<div class="hc-row"><b>普通攻击</b> ' + BASE_ATTACK + " 点；夹击时额外 =（夹击方向数 − 1）。技能不受夹击加成。</div>" +
    skillHtml +
    passiveHtml +
    (chips.length ? '<div class="hc-chips">' + chips.join("") + "</div>" : "");
}

function updateSkillBar() {
  if (!skillBarEl) return;
  skillBarEl.innerHTML = "";
  const u = selected ? board[selected.r][selected.c] : null;
  if (phase !== "battle" || !u || u.player !== currentPlayer) {
    const b = document.createElement("button");
    b.className = "skill-btn";
    b.disabled = true;
    b.textContent = "释放技能";
    skillBarEl.appendChild(b);
    return;
  }
  const skills = heroSkills(heroDef(u.heroId));
  skills.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "skill-btn";
    let label = "【" + s.name + "】";
    let disabled = false;
    if (isPassiveSkill(s)) {
      disabled = true;
      label = "被动：" + s.name;
    } else if (skillBlockedByStatus(u)) {
      disabled = true;
      label += " 被【抓取】";
    } else if (turnActionUsed && !skillFreeFor(u, s)) {
      disabled = true;
      label += " 本回合已行动";
    } else {
      const isSd2 = s.type === "shuidiao" && (u.sdStage || 0) === 1;
      const isChase2 = s.type === "chase" && (u.chaseStage || 0) === 1;
      const isWxtCombo = s.type === "wxt" && (u.wxtStage || 0) >= 1;
      const sl = skillUsesLeft(u, i);
      if (!isSd2 && !isChase2 && !isWxtCombo && sl !== Infinity && sl <= 0) {
        disabled = true;
        label += " 已用尽";
      } else if (!canPaySwords(u, s)) {
        disabled = true;
        label += " 无剑可用";
      } else {
        if (s.type === "shuidiao") label += (u.sdStage || 0) === 1 ? "·第二段待释放" : "·第一段";
        if (s.type === "duanlang") label += "·前进1格+九宫格";
        if (s.type === "wxt") {
          const wst = u.wxtStage || 0;
          label += wst === 0 ? "·第一段待执行" : wst === 1 ? "·第二段待执行" : "·第三段待执行";
        }
        if (s.type === "chase") {
          // 追猎状态：可用 / 选择方向 / 选择标记目标 / 选择闪身位置
          let st;
          if (isChase2) st = (skillSub && skillSub.kind === "chase-blink") ? "选择闪身位置" : "选择标记目标";
          else st = (skillMode && activeSkillIdx === i) ? "选择方向" : "可用";
          label += "·" + st + (isChase2 ? "（不耗行动）" : "");
        }
        if (!isChase2 && !isWxtCombo && sl !== Infinity) label += "（剩 " + sl + "）";
        if (skillMode && activeSkillIdx === i) {
          label = (skillSub && (skillSub.kind === "chase-blink" || skillSub.kind === "wxt-dir-set") ? "✖ 取消选点 " : "✖ 取消 ") + label;
        }
      }
    }
    b.disabled = disabled;
    b.textContent = label;
    if (skillMode && activeSkillIdx === i) b.classList.add("active");
    b.addEventListener("click", () => activateSkill(i));
    skillBarEl.appendChild(b);
  });

  // 龙人·龙胆：主动「额外移动」按钮（仅在“自己的回合”可用）
  if (u.heroId === "longren") {
    const b = document.createElement("button");
    b.className = "skill-btn dragon-btn";
    const dm = u.dragonMoves || 0;
    const canNow = canUseDragonMoveNow(u);
    b.disabled = dm <= 0 || (!canNow && dragonMoveUnit !== u);
    b.textContent = dragonMoveUnit === u
      ? "✖ 取消 【龙胆】选择移动方向"
      : "【龙胆】额外移动 ×" + dm +
        (dm > 0 ? (canNow ? "" : "（仅自己回合可用）") : "（无次数）");
    if (dragonMoveUnit === u) b.classList.add("active");
    b.addEventListener("click", () => activateDragonMove(u));
    skillBarEl.appendChild(b);
  }
}

/* ---------------- 英雄详情面板（点击英雄查看技能介绍） ---------------- */
function showUnitDetail(u) {
  if (!u || u.sword) return;
  detailUnit = u;
  renderDetailCard();
}
function hideUnitDetail() {
  detailUnit = null;
  if (detailCardEl) detailCardEl.classList.add("hidden");
}
function renderDetailCard() {
  if (!detailCardEl) return;
  if (!detailUnit || !findPos(detailUnit)) {
    detailCardEl.classList.add("hidden");
    return;
  }
  const u = detailUnit;
  const def = heroDef(u.heroId);
  const s = def.skill;
  detailCardEl.classList.remove("hidden");
  dcIconEl.textContent = def.icon;
  dcNameEl.textContent = def.name + "（玩家" + u.player + "）";
  dcHpEl.textContent = "生命 " + u.hp + "/" + u.maxHp + (u.shield ? " · 护盾 " + u.shield : "") +
    (u.heroId === "asura" ? " · 携带剑 " + (u.swords || 0) : "");
  let html = "";
  heroSkills(def).forEach((sk, i) => {
    const isP = isPassiveSkill(sk);
    const sl = skillUsesLeft(u, i);
    html += '<div class="dc-skill"><b>' + (isP ? "被动 · " : "主动 · ") + sk.name + "</b><div>" + sk.desc + "</div>" +
      (isP ? "" : '<div class="dc-meta">' + (sk.perTurn ? "每回合 " + sk.perTurn + " 次" : "剩余次数 " + (sl === Infinity ? "∞" : sl + " / " + sk.uses)) +
        (sk.costSwords ? " · 每次消耗剑 " + sk.costSwords : "") + " · 释放条件：" + (sk.condition || "无") + "</div>") +
      "</div>";
  });
  heroPassives(def).forEach((p) => {
    html += '<div class="dc-skill"><b>被动 · ' + p.name + "</b><div>" + p.desc + "</div></div>";
  });
  if (u.heroId === "cang") {
    html += '<div class="dc-meta">水调歌头：' + ((u.sdStage || 0) === 1 ? "第二段待释放（可跨回合保留）" : "未进入第二段") + "</div>";
  }
  dcSkillsEl.innerHTML = html;
  const st = [];
  if (u.heroId === "lone") {
    st.push(isLoneActive(u) ? "孤胆生效（伤害 +1、霸体、免疫夹击）" : "孤胆未生效（九宫格内有友军）");
    st.push(u.lockUsed ? "锁血：已使用" : "锁血：可用");
  }
  if (hasSuperArmor(u)) st.push("霸体：免疫抓取等负面效果");
  if (u.heroId === "xiangyu") {
    st.push(u.guixiongUsed ? "鬼雄已触发：生命锁定 1，普通攻击伤害 +1（绝境）" : "鬼雄：未触发（首次致命伤锁血为 1 并反击九宫格 2 点）");
  }
  if (u.heroId === "tiandao") {
    const wst = u.wxtStage || 0;
    st.push("万象天引：" + (wst === 0 ? "第一段待执行" : wst === 1 ? "第二段待执行（已引力汇聚）" : "第三段待执行（已万象引渡）"));
  }
  if (u.heroId === "ranger") st.push("普攻射程 2 格（可越过中间单位与石柱）");
  if (u.heroId === "raven") {
    if (isStealthed(u)) st.push("隐身：剩余 " + u.stealth.turns + " 回合");
    if (u.ravenBuff) st.push("影袭强化：下一次普通攻击 / 影牙 +1");
    if (u.ravenDouble) st.push(u.ravenDoubleUsed ? "潜行双动：已走一步，还可移动或普通攻击" : "潜行双动：可用（走+普攻 / 走+走）");
  }
  if (u.heroId === "metal") {
    if (u.metalTide > 0) st.push("金属狂潮：剩余 " + u.metalTide + " 个自身行动回合（受到伤害减半）");
    if (u.metalBuff) st.push("金属强化：下一次普通攻击 +1 并定身目标 1 回合");
  }
  if (flankImmune(u)) st.push("免疫夹击加成");
  if (u.frozen > 0) st.push("冰封：跳过 " + u.frozen + " 个回合");
  if (u.statuses) for (const k of Object.keys(u.statuses)) st.push((u.statuses[k].label || k) + "（剩 " + (u.statuses[k].turns != null ? u.statuses[k].turns : 1) + "）");
  dcStatusEl.textContent = st.length ? "当前状态：" + st.join(" · ") : "当前状态：无";
}

function updateTalismanUI() {
  if (!talismanCardEl) return;
  // 联机：面板始终显示【本人】的锦囊（对手玩家的锦囊对本人不可见，服务端也不会下发）
  const cardSide = gameMode === "online" ? mySide() : currentPlayer;
  const id = talisman[cardSide];
  const t = id ? getTalismanById(id) : null;
  const isAI = gameMode === "ai" && currentPlayer === aiPlayer;
  const CAT = { assault: "atk", revive: "life", march: "march", refresh: "arcane", guard: "guard", heal: "life" };
  const CAT_NAME = { atk: "攻击强化", life: "生命", march: "额外回合", arcane: "技能", guard: "防御" };
  const used = talismanUsed[cardSide];
  const cat = t ? (CAT[t.effect] || "atk") : "";
  // 卡面分类（颜色 + 图案 + 已使用印章）；整串重设，避免残留旧分类
  talismanCardEl.className = "talisman-card" + (cat ? " cat-" + cat : "") +
    (used ? " used" : "") + (talismanMode === id && !used ? " active" : "");
  const catEl = document.getElementById("tz-cat");
  if (catEl) catEl.textContent = t ? (CAT_NAME[cat] || "") : "";
  tzIconEl.textContent = t ? t.icon : "🎴";
  tzNameEl.textContent = t ? t.name : (gameMode === "online" && cardSide !== currentPlayer ? "（对手的锦囊：不可见）" : "（无）");
  tzDescEl.textContent = t ? t.desc : (gameMode === "online" && cardSide !== currentPlayer ? "对手的锦囊信息在开局前与对方回合中均不可见。" : "本局没有锦囊。");
  if (!t) {
    talismanBtn.disabled = true;
    talismanBtn.textContent = "无锦囊";
    return;
  }
  if (used) {
    talismanBtn.disabled = true;
    talismanBtn.textContent = "已使用";
    return;
  }
  if (gameMode === "online" && currentPlayer !== cardSide) {
    talismanBtn.disabled = true;
    talismanBtn.textContent = "轮到你时才能使用";
    return;
  }
  if (phase !== "battle") {
    talismanBtn.disabled = true;
    talismanBtn.textContent = "开局后可使用的锦囊";
    return;
  }
  if (isAI) {
    talismanBtn.disabled = true;
    talismanBtn.textContent = "（AI 的锦囊）";
    return;
  }
  if (talismanMode === id) {
    talismanBtn.disabled = false;
    talismanBtn.textContent = "✖ 取消选择目标";
    return;
  }
  talismanBtn.disabled = false;
  talismanBtn.textContent = t.target === "none"
    ? "使用【" + t.name + "】"
    : "使用【" + t.name + "】（选择目标）";
}

function updatePanel() {
  turnPlayerEl.className = "turn-player p" + currentPlayer;
  turnPlayerEl.textContent = "玩家 " + currentPlayer + (gameMode === "ai" && currentPlayer === aiPlayer ? "（AI）" : "");

  p1CountEl.textContent = aliveCount(1);
  p2CountEl.textContent = aliveCount(2);

  if (phase === "placement") {
    if (gameMode === "online") {
      const me = mySide();
      const opp = me === 1 ? 2 : 1;
      const mine = (placedIds[me] || []).length;
      turnPlayerEl.textContent = "你的部署";
      turnPlayerEl.className = "turn-player p" + me;
      turnHintEl.textContent = "请从你的候选英雄中部署 " + Math.max(0, 3 - mine) + " 名　·　对手：" +
        (onlinePlacementDone[opp] ? "已准备" : "部署中") + "（对手阵容保密）";
    } else {
      const side = currentPlayer === 1 ? "左" : "右";
      turnHintEl.textContent = "请在" + side + "侧放置英雄（还剩 " + toPlace + " 名）";
    }
  } else if (phase === "battle") {
    const actInfo = turnActionsMax > 1 ? "　【强化】剩余行动 " + turnActionsLeft + "/" + turnActionsMax : "";
    if (skillMode) {
      turnHintEl.textContent = "点击高亮的技能目标释放技能，再次点击按钮可取消" + actInfo;
    } else if (selected) {
      turnHintEl.textContent = "蓝圈：移动　橙圈：普通攻击　或使用下方技能" + actInfo;
    } else {
      const list = unitsOf(currentPlayer);
      const allFrozen = list.length > 0 && list.every((u) => u.frozen > 0);
      if (allFrozen) turnHintEl.textContent = "己方英雄全部被冰封，请结束回合";
      else if (turnActionsLeft < turnActionsMax) turnHintEl.textContent = "本回合已行动；还可用锦囊 / 不耗步技能 / 额外移动，完成后点『结束回合』" + actInfo;
      else turnHintEl.textContent = "点击己方英雄行动（行动后点『结束回合』结束本回合）" + actInfo;
    }
  } else {
    turnHintEl.textContent = "对局结束";
  }

  updateRoster();
  updateHeroCard();
  updateTalismanUI();
  renderDetailCard();
  updateSkillBar();
  skipBtn.classList.toggle("hidden", phase !== "battle");
  const mustAct = phase === "battle" && turnActionsLeft === turnActionsMax && hasAnyAction(currentPlayer) && hasAnyMove(currentPlayer);
  skipBtn.disabled = mustAct;
  const acted = phase === "battle" && turnActionsLeft < turnActionsMax;
  skipBtn.textContent = mustAct ? "结束回合（请先行动）" : acted ? "结束回合 ▶" : "结束回合";
  skipBtn.classList.toggle("ready", acted && !mustAct);

  // 战斗日志
  logEl.innerHTML = "";
  for (const line of logs.slice(-30)) {
    const div = document.createElement("div");
    div.className = "log-line";
    if (line.indexOf("夹击") >= 0) div.classList.add("log-flank");
    else if (line.indexOf("阵亡") >= 0) div.classList.add("log-death");
    else if (line.indexOf("释放") >= 0) div.classList.add("log-skill");
    div.textContent = line;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;

  if (phase === "over") {
    // 结算面板只在演出结束（或被跳过）后出现；演出期间保持隐藏
    if (!victorySeq.resultShown) {
      overlayEl.classList.add("hidden");
    } else {
      const kind = resultKind();
      let title = "玩家 " + winner + " 获胜！";
      let color = winner === 1 ? "var(--p1)" : "var(--p2)";
      let sub = "剩余英雄 " + aliveCount(winner) + " 名";
      if (kind === "win" && gameMode !== "local") { title = "胜利！"; color = "#fbbf24"; sub = "本场对决，你赢了！"; }
      else if (kind === "lose") { title = "失败"; color = "#94a3b8"; sub = "再接再厉，下一局赢回来"; }
      else if (kind === "draw") { title = "平局"; color = "#cbd5e1"; sub = "势均力敌"; }
      overlayTitleEl.textContent = title;
      overlayTitleEl.style.color = color;
      overlaySubEl.textContent = sub;
      if (overlayStatsEl) {
        const rows = [];
        const dur = matchStats.startedAt && matchStats.endedAt
          ? Math.max(0, Math.round((matchStats.endedAt - matchStats.startedAt) / 1000)) : 0;
        if (dur > 0) {
          rows.push('<div class="os-row"><span>对局时长</span><b>' + Math.floor(dur / 60) + ":" + String(dur % 60).padStart(2, "0") + "</b></div>");
        }
        const d1 = matchStats.damage[1] || 0, d2 = matchStats.damage[2] || 0;
        if (d1 + d2 > 0) rows.push('<div class="os-row"><span>总伤害 玩家1 / 玩家2</span><b>' + d1 + " / " + d2 + "</b></div>");
        const k1 = matchStats.kills[1] || 0, k2 = matchStats.kills[2] || 0;
        if (k1 + k2 > 0) rows.push('<div class="os-row"><span>击败英雄 玩家1 / 玩家2</span><b>' + k1 + " / " + k2 + "</b></div>");
        overlayStatsEl.innerHTML = rows.length ? '<div class="os-head">本局战绩</div>' + rows.join("") : "";
      }
      if (overlayMenuBtn) overlayMenuBtn.textContent = gameMode === "online" ? "退出对局" : "返回主菜单";
      overlayEl.classList.remove("hidden");
    }
  } else {
    overlayEl.classList.add("hidden");
  }
}

/* ============================ 游戏模式 / 主菜单 ============================ */
function showMenu(panel) {
  menuEl.classList.remove("hidden");
  menuHome.classList.toggle("hidden", !!panel);
  menuAi.classList.toggle("hidden", panel !== "ai");
  menuOnline.classList.toggle("hidden", panel !== "online");
  menuSettings.classList.toggle("hidden", panel !== "settings");
  syncSettingsUI();
  syncServerInput();
}
function hideMenu() {
  menuEl.classList.add("hidden");
}
function updateModeBadge() {
  modeBadge.classList.remove("hidden");
  modeBadge.textContent =
    gameMode === "ai"
      ? "AI 对战 · " + ({ easy: "简单", normal: "普通", hard: "困难" }[aiDifficulty] || "普通") + " · 电脑=玩家" + aiPlayer
      : gameMode === "online"
      ? "在线对战"
      : "本地双人";
}
function startLocal() {
  gameMode = "local";
  hideMenu();
  updateModeBadge();
  init();
}
function startAI() {
  const diffEl = document.querySelector('input[name="ai-diff"]:checked');
  const sideEl = document.querySelector('input[name="ai-side"]:checked');
  aiDifficulty = (diffEl && diffEl.value) || "normal";
  const side = parseInt((sideEl && sideEl.value) || "1", 10);
  gameMode = "ai";
  aiPlayer = side === 1 ? 2 : 1;
  hideMenu();
  updateModeBadge();
  init();
  aiKick();
}
function syncSettingsUI() {
  // 统一的音效设置同步（避免与旧字段 volume 冲突）
  if (typeof syncSfxUI === "function") { syncSfxUI(); return; }
  if (!window.SFX) return;
  const st = SFX.getSettings();
  const cb = document.getElementById("set-sfx");
  const vol = document.getElementById("set-vol");
  if (cb) cb.checked = st.enabled;
  if (vol) vol.value = Math.round((st.sfx == null ? 0.7 : st.sfx) * 100);
}
function syncServerInput() {
  if (!window.NET) return;
  let saved = "";
  try { saved = localStorage.getItem("herochess.net.url") || ""; } catch (e) {}
  if (serverInputEl) serverInputEl.value = saved;
  if (serverHintEl) {
    serverHintEl.textContent = "当前：" + window.NET.serverUrl + (window.NET.connected ? "（已连接）" : "（未连接）");
  }
}
/* 可作为分享主机的候选地址：本页主机（非 localhost 时最可靠）+ 服务器探测到的局域网地址 */
let shareHostChoice = ""; // "" = 自动
function shareHostOptions() {
  const hn = location.hostname;
  const isLocal = hn === "localhost" || hn === "127.0.0.1";
  const list = [];
  const push = (h) => { if (h && list.indexOf(h) < 0) list.push(h); };
  if (!isLocal) push(hn);
  const addrs = (window.NET && window.NET.addresses) || [];
  for (const a of addrs) push(a);
  return list;
}
function pickShareHost() {
  const opts = shareHostOptions();
  if (shareHostChoice && opts.indexOf(shareHostChoice) >= 0) return shareHostChoice;
  const hn = location.hostname;
  if (hn && hn !== "localhost" && hn !== "127.0.0.1") return hn; // 本页主机优先
  return opts[0] || "";
}
/* 生成分享链接（始终带上 room 与 server，好友点开即可连上并进房） */
function buildShareLink(code) {
  const params = new URLSearchParams();
  params.set("room", code);
  const host = pickShareHost();
  const wsProto = location.protocol === "https:" ? "wss://" : "ws://";
  let saved = "";
  try { saved = localStorage.getItem("herochess.net.url") || ""; } catch (e) {}
  // 优先使用「当前实际连接的服务器地址」（包含默认 CLOUD_SERVER），其次自定义地址，最后才回退到 本页主机:3000
  let server = (window.NET && window.NET.serverUrl) || saved || "";
  // 服务器地址里若含 localhost，换成可被好友访问的主机名
  if (server && host && (server.indexOf("localhost") >= 0 || server.indexOf("127.0.0.1") >= 0)) {
    server = server.split("localhost").join(host).split("127.0.0.1").join(host);
  }
  if (!server) server = wsProto + (host || location.hostname) + ":3000";
  params.set("server", server);
  // 网页地址：本机用 localhost 打开时，换成好友能访问到的地址
  const webHost = host || location.hostname;
  const origin = location.protocol + "//" + webHost + (location.port ? ":" + location.port : "");
  return origin + location.pathname + "?" + params.toString();
}
function updateShareLink() {
  if (!shareRowEl) return;
  const show = !!window.NET && !!window.NET.code && window.NET.myPlayer === 1;
  shareRowEl.classList.toggle("hidden", !show);
  if (!show) {
    if (phoneRowEl) phoneRowEl.classList.add("hidden");
    if (phoneHintEl) phoneHintEl.classList.add("hidden");
  }

  // 分享地址选择器（局域网 IP / Radmin IP 等）
  const opts = shareHostOptions();
  if (shareHostRowEl) {
    shareHostRowEl.classList.toggle("hidden", !show || opts.length === 0);
    if (show && shareHostSelEl && opts.length) {
      shareHostSelEl.innerHTML = "";
      const oAuto = document.createElement("option");
      oAuto.value = "";
      oAuto.textContent = "自动（" + (pickShareHost() || "未知") + "）";
      shareHostSelEl.appendChild(oAuto);
      for (const a of opts) {
        const o = document.createElement("option");
        o.value = a;
        o.textContent = a + (a === location.hostname ? "（本页地址）" : "");
        if (a === shareHostChoice) o.selected = true;
        shareHostSelEl.appendChild(o);
      }
    }
  }

  if (show && shareInputEl) {
    const link = buildShareLink(window.NET.code);
    shareInputEl.value = link;
    const bad = /:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(link);
    if (shareHintEl) {
      shareHintEl.classList.toggle("hidden", !bad);
      if (bad) {
        shareHintEl.innerHTML = "⚠ 没能检测到可供好友访问的地址，链接仍是本机地址。请改用主机的<b>局域网 IP</b>打开游戏" +
          "（例如 <code>http://192.168.x.x:8765/index.html</code>）后再创建房间并分享；或在上方选择正确的「分享地址」。";
      }
    }
    // 手机/平板：需要连同一个 Wi-Fi，用这条链接直接打开即可
    if (phoneRowEl && phoneInputEl) {
      phoneRowEl.classList.toggle("hidden", false);
      phoneInputEl.value = link;
    }
    if (phoneHintEl) {
      const host = pickShareHost() || location.hostname;
      const isVpn = /^26\./.test(host); // Radmin VPN 网段
      phoneHintEl.classList.remove("hidden");
      phoneHintEl.innerHTML =
        "📱 <b>手机 / 平板加入</b>：让好友的手机连上<b>和电脑同一个 Wi‑Fi</b>，用手机浏览器直接打开上面的链接即可（不用装 App）。" +
        "<br>· 手机用<b>移动流量</b>或连别的 Wi‑Fi 都无法访问这个地址；" +
        "· <b>Radmin VPN 只有 Windows 版，手机用不了</b> —— 手机只能走同一 Wi‑Fi；" +
        (isVpn ? "<br>· ⚠ 当前分享地址像是 <b>Radmin/VPN</b> 网段，手机通常连不上，请在「分享地址」里改选 Wi‑Fi 的局域网 IP。" : "") +
        "<br>· 若同一个 Wi‑Fi 也打不开：多半是路由器开了「<b>AP 隔离 / 客户端隔离</b>」（校园网、公共 Wi‑Fi 常见），" +
        "或需要在电脑上放行 <b>8765 / 3000</b> 端口；这种情况建议改用内网穿透（cloudflared / ngrok）让手机走公网访问。";
    }
  }
}
/* 打开带 ?room=xxx 的分享链接时：自动设置服务器并加入房间 */
function handleUrlParams() {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  const room = (params.get("room") || "").toUpperCase();
  const server = params.get("server") || "";
  const wsProto = location.protocol === "https:" ? "wss://" : "ws://";
  // 服务器地址：优先用链接里带的；没带就用「打开本页的主机名」推导（好友从主机地址打开本页 → 必然可达）
  const want = server || (wsProto + location.hostname + ":3000");
  if (room || server) {
    if (window.NET && want && want !== window.NET.serverUrl) window.NET.setUrl(want);
    else if (window.NET) window.NET.connect();
  }
  if (room) {
    autoJoinRoom = room;
    showMenu("online");
    if (onlineStatus) onlineStatus.innerHTML = "正在连接服务器 <code>" + want + "</code> 并加入房间 " + room + " …";
    const started = Date.now();
    const iv = setInterval(() => {
      if (window.NET && window.NET.connected) {
        clearInterval(iv);
        window.NET.joinRoom(autoJoinRoom);
        autoJoinRoom = "";
        if (onlineStatus) onlineStatus.textContent = "已连接服务器，正在加入房间 " + room + " …";
      } else if (Date.now() - started > 8000) {
        clearInterval(iv);
        if (onlineStatus) {
          onlineStatus.innerHTML = "❌ 连不上服务器 <code>" + want + "</code>。<br>请检查：" +
            "① 你和主机在<b>同一个网络</b>（同一局域网，或都已加入同一个 Radmin / 内网穿透）；" +
            "② 主机已放行 <b>8765</b> 与 <b>3000</b> 端口（Windows 防火墙弹窗要选“允许”）；" +
            "③ 若都不行，让主机把「在线真人对战」里显示的服务器地址（<code>ws://…:3000</code>）直接发给你，粘到上方「服务器」框后点“连接”。";
        }
      }
    }, 200);
  }
}

/* ============================ AI 人机对战 ============================ */
const AI_DIFF = {
  easy: { noise: 8, dmgW: 8, killW: 55, flankW: 4, riskW: 3, healW: 5, swordW: 6, skillW: 0.7, distW: 2 },
  normal: { noise: 2, dmgW: 10, killW: 90, flankW: 8, riskW: 8, healW: 8, swordW: 10, skillW: 1.0, distW: 3 },
  hard: { noise: 0, dmgW: 12, killW: 130, flankW: 12, riskW: 10, healW: 11, swordW: 14, skillW: 1.2, distW: 4 },
};

function nearestEnemyDist(r, c, player) {
  let best = 99;
  for (let rr = 0; rr < SIZE; rr++)
    for (let cc = 0; cc < SIZE; cc++) {
      const u = board[rr][cc];
      if (isUnit(u) && u.player !== player && !hiddenFrom(u, player)) best = Math.min(best, Math.abs(rr - r) + Math.abs(cc - c));
    }
  return best;
}
function flankHypo(r, c, player) {
  let enemy = 0;
  let wall = 0;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) { wall++; continue; }
    const t = board[nr][nc];
    if (isUnit(t) && t.player !== player && !hiddenFrom(t, player)) enemy++;
  }
  return { enemy, wall, total: enemy + wall };
}
function dangerAt(r, c, u) {
  const f = flankHypo(r, c, u.player);
  let danger = f.enemy * 3;
  if (f.enemy >= 1 && f.total >= 2) danger += 6; // 会被夹击
  for (const [dr, dc] of DIRS) {
    const t = unitAt(r + dr, c + dc);
    if (t && !t.sword && t.player !== u.player) {
      if (resolveNormalAttack(t, u).damage >= u.hp) danger += 20; // 可能被秒
    }
  }
  return danger;
}
function aiSkillScore(u, s, pos, rr, cc, w) {
  const t = unitAt(rr, cc);
  if (t && hiddenFrom(t, u.player) && (s.type === "damage_single" || s.type === "freeze" || s.type === "damage_line")) return null;
  switch (s.type) {
    case "damage_single":
    case "damage_line": {
      if (!t || t.sword) return null;
      const kill = t.hp <= s.damage;
      return w.dmgW * s.damage + (kill ? w.killW : 0);
    }
    case "freeze": {
      if (!t || t.sword) return null;
      const kill = t.hp <= s.damage;
      return w.dmgW * s.damage + (kill ? w.killW : 0) + 14; // 控制价值
    }
    case "damage_adjacent_all": {
      let sc = 0;
      let n = 0;
      for (const [dr, dc] of DIRS) {
        const e = unitAt(pos.r + dr, pos.c + dc);
        if (e && !e.sword && e.player !== u.player) {
          sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0);
          n++;
        }
      }
      return n ? sc : null;
    }
    case "heal": {
      if (!t || t.sword || t.player !== u.player) return null;
      const healed = Math.min(s.heal, t.maxHp - t.hp);
      if (healed <= 0) return null;
      return w.healW * healed + (t.hp <= 2 ? 12 : 0);
    }
    case "shield_self":
      return 10;
    case "ziwei": {
      // 位移前后两个九宫格分别计分（重叠区域按两次）
      const zb = enemiesInBox3(pos.r, pos.c, u.player);
      const za = enemiesInBox3(rr, cc, u.player);
      let sc = 0;
      for (const e of zb) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0);
      for (const e of za) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0);
      const zb0 = nearestEnemyDist(pos.r, pos.c, u.player);
      const za0 = nearestEnemyDist(rr, cc, u.player);
      sc += (zb0 - za0) * (w.distW / 2);
      return sc > 0 ? sc : 2; // 没命中也能位移走位
    }
    case "tianwei": {
      // 落点九宫格内的敌人（天威消耗行动，故只在能打到人时才使用）
      const es = enemiesInBox3(rr, cc, u.player);
      let sc = 0;
      for (const e of es) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
      return sc > 0 ? sc : null;
    }
    case "shenluo": {
      // 神罗天征：以自身为中心九宫格内敌人（无敌人则不空放，省次数）
      const es = enemiesInBox3(pos.r, pos.c, u.player);
      let sc = 0;
      for (const e of es) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
      return sc > 0 ? sc : null;
    }
    case "bloodburst": {
      // 以自身为中心九宫格：按命中的敌人数量与是否击杀打分；范围内没敌人就不使用
      let sc = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const e = unitAt(pos.r + dr, pos.c + dc);
          if (e && !e.sword && e.player !== u.player) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 4;
        }
      if (sc <= 0) return null; // 没有敌人：释放也是空放，不用
      if (u.hp < u.maxHp) sc += 4; // 残血时更有价值（吸血）
      return sc;
    }
    case "blink": {
      const before = nearestEnemyDist(pos.r, pos.c, u.player);
      const after = nearestEnemyDist(rr, cc, u.player);
      let sc = (before - after) * w.distW - dangerAt(rr, cc, u) * (w.riskW / 10);
      if (u.hp <= 2) sc += (after - before) * w.distW;
      return sc;
    }
    case "dash": {
      const opt = dashOptions.find((o) => o.dest && o.dest.r === rr && o.dest.c === cc);
      if (!opt) return null;
      let sc = 0;
      for (const h of opt.hits) {
        const e = unitAt(h.r, h.c);
        if (e && !e.sword && e.player !== u.player) {
          sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0);
        }
      }
      const dist = Math.abs(opt.dest.r - pos.r) + Math.abs(opt.dest.c - pos.c);
      for (let k = 1; k <= dist; k++) {
        if (isSword(board[pos.r + opt.dir[0] * k][pos.c + opt.dir[1] * k])) sc += w.swordW;
      }
      sc -= dangerAt(opt.dest.r, opt.dest.c, u) * (w.riskW / 10);
      const before = nearestEnemyDist(pos.r, pos.c, u.player);
      const after = nearestEnemyDist(opt.dest.r, opt.dest.c, u.player);
      sc += (before - after) * (w.distW / 2);
      return sc;
    }
    case "duanlang": {
      // 目标 = 前进一格后的落点；统计其九宫格内敌人
      let sc = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const e = unitAt(rr + dr, cc + dc);
        if (e && !e.sword && e.player !== u.player) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0);
      }
      return sc > 0 ? sc : 2; // 没有命中也能推进走位
    }
    case "shuidiao": {
      if ((u.sdStage || 0) !== 1) return null; // 第一段为两段式，AI 暂不使用
      const opt = dashOptions.find((o) => o.stage === 2 && o.target && o.target.r === rr && o.target.c === cc);
      if (!opt) return null;
      let sc = 0;
      for (const h of opt.hits) {
        const e = unitAt(h.r, h.c);
        if (e && !e.sword && e.player !== u.player) {
          sc += 14 + (e.hp <= (s.grabDamage || 2) ? w.killW : 0); // 擒拿控制 + 结束时伤害
          break; // 只抓第一个
        }
      }
      return sc > 0 ? sc : 1;
    }
    case "dragonbreath": {
      let sc = null;
      for (const [dr, dc] of DIRS) {
        const area = dragonBreathArea(u, pos.r, pos.c, dr, dc);
        if (!area.some(([ar, ac]) => ar === rr && ac === cc)) continue;
        let s2 = 0;
        for (const [ar, ac] of area) {
          const e = unitAt(ar, ac);
          if (e && !e.sword && e.player !== u.player) s2 += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0);
        }
        sc = s2;
        break;
      }
      return sc;
    }
    case "thunder": {
      const e = unitAt(rr, cc);
      if (e && !e.sword && e.player !== u.player) {
        const kill = e.hp <= s.damage;
        return w.dmgW * s.damage + (kill ? w.killW : 0) + 8; // 伤害 + 击退扰动 + 进入强化
      }
      return 4; // 空格：位移走位
    }
    default:
      return null;
  }
}
/* AI 消耗龙人的额外移动机会（龙胆） */
function aiUseDragonMoves() {
  for (const u of unitsOf(aiPlayer)) {
    if (u.heroId !== "longren") continue;
    let guard = 0;
    while ((u.dragonMoves || 0) > 0 && guard++ < 8) {
      const pos = findPos(u);
      if (!pos) break;
      let best = null;
      for (const [dr, dc] of DIRS) {
        const nr = pos.r + dr;
        const nc = pos.c + dc;
        if (!inBounds(nr, nc) || board[nr][nc]) continue;
        const dist = nearestEnemyDist(nr, nc, aiPlayer);
        if (!best || dist < best.d) best = { r: nr, c: nc, d: dist };
      }
      if (!best) { u.dragonMoves = 0; break; }
      board[best.r][best.c] = u;
      board[pos.r][pos.c] = null;
      u.dragonMoves -= 1;
      addLog("🤖 龙人使用龙胆额外移动到 (" + (best.r + 1) + "," + (best.c + 1) + ")。");
    }
  }
}

/* AI 判断是否使用自己的锦囊（返回是否使用） */
function aiUseTalisman() {
  if (talismanUsed[aiPlayer] || !talisman[aiPlayer]) return false;
  const id = talisman[aiPlayer];
  const t = getTalismanById(id);
  if (!t) return false;
  if (t.effect === "revive") {
    const targets = talismanTargetsFor(id, aiPlayer);
    if (targets.length > 0) { useTalismanEffect(id, targets[0][0], targets[0][1]); return true; }
    return false;
  }
  if (t.effect === "heal") {
    let best = null;
    for (const u of unitsOf(aiPlayer)) {
      if (u.hp <= u.maxHp - 2) {
        const p = findPos(u);
        if (p && (!best || u.hp < best.hp)) best = { hp: u.hp, r: p.r, c: p.c };
      }
    }
    if (best) { useTalismanEffect(id, best.r, best.c); return true; }
    return false;
  }
  if (t.effect === "assault") {
    if (aiEnumerate().some((a) => a.type === "attack" || a.type === "skill")) { useTalismanEffect(id, null, null); return true; }
    return false;
  }
  if (t.effect === "refresh") {
    const need = unitsOf(aiPlayer).some((u) => {
      const s = heroDef(u.heroId).skill;
      const max = s && s.perTurn ? s.perTurn : (s ? s.uses : 0);
      return u.usesLeft < max;
    });
    if (need) { useTalismanEffect(id, null, null); return true; }
    return false;
  }
  if (t.effect === "guard") {
    if (unitsOf(aiPlayer).some((u) => u.hp < u.maxHp)) { useTalismanEffect(id, null, null); return true; }
    return false;
  }
  if (t.effect === "march") {
    if (!aiEnumerate().some((a) => a.type === "attack")) { useTalismanEffect(id, null, null); return true; }
    return false;
  }
  return false;
}

/* 枚举 AI 所有合法行动（只使用与真人相同的规则接口） */
function aiEnumerate() {
  const acts = [];
  const w = AI_DIFF[aiDifficulty] || AI_DIFF.normal;
  for (const u of unitsOf(aiPlayer)) {
    if (u.frozen > 0) continue;
    if (isDisabled(u)) continue; // 被抓取 / 眩晕：本回合无法行动
    if (turnActorUid && u.uid !== turnActorUid) continue; // 强化回合：只能由同一英雄行动
    const pos = findPos(u);
    if (!pos) continue;
    const rooted = isRooted(u);

    // 普通攻击（本回合若已行动则不可）
    if (!turnActionUsed) {
      for (const [dr, dc] of DIRS) {
        const t = unitAt(pos.r + dr, pos.c + dc);
        if (t && !t.sword && t.player !== u.player && !hiddenFrom(t, u.player)) {
          const res = resolveNormalAttack(u, t);
          const dmg = res.damage + (u.ravenBuff ? 1 : 0);
          const kill = t.hp <= dmg;
          acts.push({
            type: "attack", u, pos, target: { r: pos.r + dr, c: pos.c + dc },
            score: w.dmgW * dmg + (kill ? w.killW : 0) + (res.flank ? w.flankW : 0) + 6,
          });
        }
      }
      // 游侠：2 格内敌人也能普攻（无视中间阻挡）
      if (u.heroId === "ranger") {
        for (const [rr, cc] of cellsWithin(pos.r, pos.c, 2, false)) {
          if (Math.abs(rr - pos.r) + Math.abs(cc - pos.c) !== 2) continue;
          const t = unitAt(rr, cc);
          if (!t || t.player === u.player || hiddenFrom(t, u.player)) continue;
          const res = resolveNormalAttack(u, t);
          const kill = t.hp <= res.damage;
          acts.push({
            type: "attack", u, pos, target: { r: rr, c: cc },
            score: w.dmgW * res.damage + (kill ? w.killW : 0) + (res.flank ? w.flankW : 0) + 6,
          });
        }
      }
    }

    // 技能（支持多技能；“不耗步”技能本回合已行动也能用；消耗剑的技能需有剑）
    const skills = heroSkills(heroDef(u.heroId));
    skills.forEach((s, si) => {
      if (isPassiveSkill(s)) return;
      const isSd2 = s.type === "shuidiao" && (u.sdStage || 0) === 1;
      const isChase2 = s.type === "chase" && (u.chaseStage || 0) === 1;
      const sl = skillUsesLeft(u, si);
      if (!isSd2 && !isChase2 && sl !== Infinity && sl <= 0) return;
      if (!canPaySwords(u, s)) return;
      if (turnActionUsed && !skillFreeFor(u, s)) return;
      if (rooted && isSelfMoveSkill(u, s)) return; // 定身：不能用主动位移技能

      // 刺客·追猎：两段式，需特殊枚举（第二段还要再选一个闪身落点）
      if (s.type === "chase") {
        if (isChase2) {
          for (const v of chaseTargetsOf(u)) {
            const tp = findPos(v);
            if (!tp) continue;
            for (const [lr, lc] of chaseBlinkCells(tp.r, tp.c)) {
              let sc = w.dmgW * s.damage + (v.hp <= s.damage ? w.killW : 0);
              sc -= dangerAt(lr, lc, u) * (w.riskW / 10);
              const before = nearestEnemyDist(pos.r, pos.c, u.player);
              const after = nearestEnemyDist(lr, lc, u.player);
              sc += (before - after) * (w.distW / 2);
              acts.push({ type: "skill", u, pos, target: { r: tp.r, c: tp.c }, landing: { r: lr, c: lc }, skillIdx: si, score: sc * w.skillW });
            }
          }
        } else {
          for (const [dr, dc] of DIRS) {
            const line = computeChaseLine(u, pos.r, pos.c, dr, dc);
            if (!line.path.length) continue;
            let sc = 0;
            for (const h of line.hits) {
              const e = board[h.r][h.c];
              if (e && !e.sword && e.player !== u.player && !hiddenFrom(e, u.player)) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
            }
            const tgt = line.path[line.path.length - 1];
            acts.push({ type: "skill", u, pos, target: { r: tgt[0], c: tgt[1] }, skillIdx: si, score: (sc > 0 ? sc : 1) * w.skillW });
          }
        }
        return;
      }

      // 玉皇大帝·放逐：两步选择（先选敌人、再选墙角），此处直接枚举「敌人 × 合法墙角」组合
      if (s.type === "exile") {
        const legal = BOARD_CORNERS.filter(cornerExileOk);
        if (!legal.length) return;
        for (const v of unitsOf(aiPlayer === 1 ? 2 : 1)) {
          const vp = findPos(v);
          if (!vp || hiddenFrom(v, aiPlayer)) continue;
          for (const cn of legal) {
            // 打分：控制价值 + 残血目标优先（放逐本身不造成伤害）
            let sc = 10 + (v.hp <= 2 ? 14 : 0);
            acts.push({ type: "skill", u, pos, target: { r: vp.r, c: vp.c }, corner: { r: cn.corner.r, c: cn.corner.c }, skillIdx: si, score: sc * w.skillW });
          }
        }
        return;
      }

      // 天道超·万象天引：三阶段连招（第一/二段需先选方向；落点必须合法）
      if (s.type === "wxt") {
        const wstage = u.wxtStage || 0;
        if (wstage === 0 && sl !== Infinity && sl <= 0) return; // 整套次数已用尽
        const dirs = wstage === 2 ? [[0, 0]] : DIRS;
        for (const [dr, dc] of dirs) {
          let landOk = true;
          if (wstage === 0) { const lr = pos.r + dr * 2, lc = pos.c + dc * 2; landOk = inBounds(lr, lc) && !board[lr][lc]; }
          else if (wstage === 1) { const lr = pos.r + dr, lc = pos.c + dc; landOk = inBounds(lr, lc) && !board[lr][lc]; }
          if (!landOk) continue;
          for (const [rr, cc] of wxtStageTargets(u, pos.r, pos.c, dr, dc, wstage)) {
            const e = board[rr][cc];
            if (!e || e.sword || e.player === u.player || hiddenFrom(e, u.player)) continue;
            let sc = w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
            if (wstage === 1) sc += 8; // 抓取控制
            acts.push({ type: "skill", u, pos, target: { r: rr, c: cc }, wxtDir: wstage === 2 ? undefined : { dr, dc }, skillIdx: si, score: sc * w.skillW });
          }
        }
        return;
      }

      // 花木兰·所向披靡：只对相邻敌人释放；评估击退落点、撞墙眩晕与侧推收益
      if (s.type === "charge") {
        for (const [dr, dc] of DIRS) {
          const rr = pos.r + dr, cc = pos.c + dc;
          const e = inBounds(rr, cc) ? board[rr][cc] : null;
          if (!e || e.sword || e.player === u.player || hiddenFrom(e, u.player)) continue;
          const pv = chargePreview(u, e, rr, cc, dr, dc);
          let sc = w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
          sc += pv.moved * (w.distW / 3);
          sc += pv.sidePush * (w.dmgW * s.damage);
          if (pv.stun) sc += 10; // 眩晕控制价值
          acts.push({ type: "skill", u, pos, target: { r: rr, c: cc }, skillIdx: si, score: sc * w.skillW });
        }
        return;
      }

      // 山丘之王·推山：只对正前方 2 格内第一个敌人释放；评估推击落点与石柱封锁价值
      if (s.type === "push") {
        for (const [dr, dc] of DIRS) {
          const info = pushDirInfo(u, pos.r, pos.c, dr, dc);
          if (!info || hiddenFrom(info.unit, u.player)) continue;
          const e = info.unit;
          let sc = w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
          const from = findPos(e);
          if (from) {
            const maxSteps = Math.max(0, 2 - info.dist);
            let nr = from.r, nc = from.c, steps = 0;
            for (let k = 0; k < maxSteps; k++) {
              const tr = nr + dr, tc = nc + dc;
              if (!inBounds(tr, tc) || board[tr][tc]) break;
              nr = tr; nc = tc; steps++;
            }
            if (steps > 0) sc += 6 + steps * 2;
            let pillars = 0;
            for (const [ar, ac] of DIRS) {
              const rr = nr + ar, cc = nc + ac;
              if (inBounds(rr, cc) && !board[rr][cc]) pillars++;
            }
            sc += pillars * 2; // 石柱越多，越能限制敌方走位
            if (steps === maxSteps) sc += 2; // 完整推到距自己 2 格
          }
          acts.push({ type: "skill", u, pos, target: { r: info.r, c: info.c }, skillIdx: si, score: sc * w.skillW });
        }
        return;
      }

      // 金元素·金属穿刺：前方两格敌人 ×1 伤害，扣除 1 HP
      if (s.type === "metalpierce") {
        if (u.hp <= 1) return; // 支付代价会自灭且技能中止
        for (const [dr, dc] of DIRS) {
          const targets = metalPierceInfo(u, pos.r, pos.c, dr, dc);
          if (!targets.length) continue;
          let sc = 0;
          for (const t of targets) sc += w.dmgW * s.damage + (t.unit.hp <= s.damage ? w.killW : 0);
          sc -= 8; // 生命代价
          acts.push({ type: "skill", u, pos, target: { r: pos.r + dr, c: pos.c + dc }, skillIdx: si, score: sc * w.skillW });
        }
        return;
      }

      // 金元素·金属装甲：有相邻敌人且自身 HP > 1 时才强化
      if (s.type === "metalarmor") {
        if (u.hp <= 1 || u.metalBuff) return;
        let best = 0;
        for (const [dr, dc] of DIRS) {
          const e = unitAt(pos.r + dr, pos.c + dc);
          if (e && e.player !== u.player && !hiddenFrom(e, u.player)) {
            best = Math.max(best, w.dmgW + 10 + (e.hp <= w.dmgW + 1 ? w.killW : 0));
          }
        }
        if (best > 0) acts.push({ type: "skill", u, pos, target: { r: pos.r, c: pos.c }, skillIdx: si, score: best * w.skillW });
        return;
      }

      // 金元素·金属狂潮：血量偏低或处于危险位置时开启
      if (s.type === "metaltide") {
        if (u.metalTide > 0) return;
        if (u.hp <= 4 || dangerAt(pos.r, pos.c, u) >= 6) {
          acts.push({ type: "skill", u, pos, target: { r: pos.r, c: pos.c }, skillIdx: si, score: 30 * w.skillW });
        }
        return;
      }

      // 渡鸦·潜行：评估落点安全性 + 隐身 / 强化 / 双动价值
      if (s.type === "stealth") {
        for (let rr = 0; rr < SIZE; rr++) {
          for (let cc = 0; cc < SIZE; cc++) {
            if (!stealthRangeOk(rr - pos.r, cc - pos.c)) continue;
            if (!(rr === pos.r && cc === pos.c) && board[rr][cc]) continue;
            let sc = 26;
            sc -= dangerAt(rr, cc, u) * (w.riskW / 10);
            const before = nearestEnemyDist(pos.r, pos.c, u.player);
            const after = nearestEnemyDist(rr, cc, u.player);
            sc += (before - after) * (w.distW / 2);
            acts.push({ type: "skill", u, pos, target: { r: rr, c: cc }, skillIdx: si, score: sc * w.skillW });
          }
        }
        return;
      }

      // 渡鸦·雾冲：路径伤害 + 毒雾覆盖 + 落点安全性
      if (s.type === "mistdash") {
        for (const [dr, dc] of DIRS) {
          const o = mistDashPath(u, pos.r, pos.c, dr, dc, s.range || 3);
          if (!o.dest) continue;
          let sc = 0;
          const seen = new Set();
          for (const [rr, cc] of o.path) {
            const e = unitAt(rr, cc);
            if (!e || e.player === u.player || hiddenFrom(e, u.player) || seen.has(e.uid)) continue;
            seen.add(e.uid);
            sc += w.dmgW * (s.damage + attackerBonus(u)) + (e.hp <= s.damage + attackerBonus(u) ? w.killW : 0);
          }
          sc += o.path.length * 1.5; // 毒雾封锁
          sc -= dangerAt(o.dest.r, o.dest.c, u) * (w.riskW / 10);
          acts.push({ type: "skill", u, pos, target: { r: pos.r + dr, c: pos.c + dc }, skillIdx: si, score: (sc > 0 ? sc : 1) * w.skillW });
        }
        return;
      }

      // 渡鸦·影牙：优先击杀（刷新次数）
      if (s.type === "shadowfang") {
        const dmg = s.damage + attackerBonus(u) + (u.ravenBuff ? 1 : 0);
        for (const [dr, dc] of DIRS) {
          const e = unitAt(pos.r + dr, pos.c + dc);
          if (!e || e.player === u.player || hiddenFrom(e, u.player)) continue;
          const kill = e.hp <= dmg;
          let sc = w.dmgW * dmg + (kill ? w.killW + 14 : 0) + 6;
          acts.push({ type: "skill", u, pos, target: { r: pos.r + dr, c: pos.c + dc }, skillIdx: si, score: sc * w.skillW });
        }
        return;
      }

      activeSkillIdx = si;
      selected = { r: pos.r, c: pos.c };
      computeSkillTargets();
      const tg = skillTargets.slice();
      for (const [rr, cc] of tg) {
        const sc = aiSkillScore(u, s, pos, rr, cc, w);
        if (sc != null) acts.push({ type: "skill", u, pos, target: { r: rr, c: cc }, skillIdx: si, score: sc * w.skillW });
      }
    });

    // 移动（本回合若已行动则不可；行军令的额外移动次数可用；定身不能移动）
    if (!rooted && (!turnActionUsed || extraMoves > 0)) {
      for (const [dr, dc] of DIRS) {
        const nr = pos.r + dr;
        const nc = pos.c + dc;
        if (!inBounds(nr, nc)) continue;
        const t = board[nr][nc];
        const canEnter = !t || (t.sword && u.heroId === "asura");
        if (!canEnter) continue;
        const before = nearestEnemyDist(pos.r, pos.c, u.player);
        const after = nearestEnemyDist(nr, nc, u.player);
        let sc = (before - after) * w.distW - dangerAt(nr, nc, u) * (w.riskW / 10);
        const collect = !!t && t.sword;
        if (collect && u.heroId === "asura") sc += w.swordW;
        if (u.hp <= 2) sc -= dangerAt(nr, nc, u) * (w.riskW / 10);
        if (u._lastKey === nr + "_" + nc) sc -= 18; // 反来回踱步
        acts.push({ type: "move", u, pos, target: { r: nr, c: nc }, collect, score: sc });
      }
    }
  }
  return acts;
}
/* 执行一个 AI 行动（复用真人使用的行动函数，保证规则一致） */
function aiApplyAction(act) {
  const pos = act.pos;
  const mover = board[pos.r][pos.c];
  if (mover) mover._lastKey = pos.r + "_" + pos.c; // 记录行动前位置，用于反踱步
  selected = { r: pos.r, c: pos.c };
  if (act.type === "attack") {
    normalAttack(board[pos.r][pos.c], board[act.target.r][act.target.c]);
  } else if (act.type === "move") {
    moveHero(act.target.r, act.target.c);
  } else {
    activeSkillIdx = act.skillIdx || 0;
    skillSub = act.wxtDir ? { kind: "wxt-dir-set", dir: [act.wxtDir.dr, act.wxtDir.dc] } : null;
    computeSkillTargets();
    useSkill(act.target.r, act.target.c);
    // 刺客·追猎第二段：第 2 步选择闪身落点
    if (act.landing) useSkill(act.landing.r, act.landing.c);
    // 玉皇大帝·放逐：第 2 步选择墙角
    if (act.corner) useSkill(act.corner.r, act.corner.c);
  }
}
/* AI 完成一次回合（可能包含多次「不结束回合」的剑圣突进） */
function aiTakeTurn() {
  if (gameMode !== "ai" || phase !== "battle" || currentPlayer !== aiPlayer) return;
  aiUseTalisman(); // 先考虑使用锦囊（不占用行动）
  aiUseDragonMoves(); // 龙胆：先消耗额外移动机会
  const w = AI_DIFF[aiDifficulty] || AI_DIFF.normal;
  let guard = 0;
  while (gameMode === "ai" && phase === "battle" && currentPlayer === aiPlayer && guard++ < 8) {
    // 与真人一致：本回合的「正常行动」尚未使用前，不能直接跳过回合
    const mustAct = turnActionsLeft === turnActionsMax;
    const acts = aiEnumerate();
    if (!acts.length) break; // 确实没有任何合法行动（如全员被冰封 / 被围死）→ 允许结束（防死锁）
    let best = null;
    for (const a of acts) {
      const sc = a.score + Math.random() * w.noise;
      if (!best || sc > best._sc) {
        a._sc = sc;
        best = a;
      }
    }
    // 必须行动时，即使没有「正收益」行动，也要执行一个合法行动（不能直接跳过回合）
    if (!(best && (best._sc > 0 || mustAct))) break;
    addLog("🤖 电脑（玩家" + aiPlayer + "）行动。");
    aiApplyAction(best); // 剑圣不结束回合，会继续循环
  }
  if (phase === "battle" && currentPlayer === aiPlayer) {
    addLog("🤖 电脑（玩家" + aiPlayer + "）结束回合。");
    endTurn();
  }
}
function aiSchedule() {
  if (gameMode !== "ai" || aiThinking) return;
  if (phase === "battle" && currentPlayer === aiPlayer) {
    aiThinking = true;
    setTimeout(() => {
      aiThinking = false;
      try { aiTakeTurn(); } catch (e) { /* 保护游戏不中断 */ }
    }, 600);
  }
}
function aiPlaceOne() {
  const used = placedIds[aiPlayer];
  const choices = HEROES.filter((h) => !used.includes(h.id));
  if (!choices.length) return false;
  pendingHero = choices[Math.floor(Math.random() * choices.length)].id;
  const cols = aiPlayer === 1 ? [0, 1, 2] : [3, 4, 5];
  const rows = [2, 3, 1, 4, 0, 5];
  for (const r of rows) {
    for (const c of cols) {
      if (!board[r][c]) {
        handlePlacement(r, c);
        return true;
      }
    }
  }
  return false;
}
function aiPlaceAll() {
  let guard = 0;
  while (gameMode === "ai" && phase === "placement" && currentPlayer === aiPlayer && guard++ < 12) {
    if (!aiPlaceOne()) break;
  }
}
function aiKick() {
  if (gameMode !== "ai") return;
  if (phase === "placement" && currentPlayer === aiPlayer) aiPlaceAll();
  else if (phase === "battle" && currentPlayer === aiPlayer) aiSchedule();
}

/* ============================ 在线联机（客户端钩子） ============================ */
/* 联机时：本地只做选择/预览，真正的行动提交给服务器；收到权威状态后整体替换。 */
function onlineForward(action) {
  if (gameMode !== "online") return false;
  if (window.NET) window.NET.sendAction(action);
  clearSelection();
  render();
  return true;
}
function onlineBlocked() {
  // 布阵阶段双方同时进行，不受 currentPlayer 限制
  return gameMode === "online" && window.NET && window.NET.myPlayer && phase !== "placement" && currentPlayer !== window.NET.myPlayer;
}
/* 当前“我方”是哪个玩家：联机取 NET.myPlayer，本地/AI 取 currentPlayer */
function mySide() {
  if (gameMode === "online" && window.NET && window.NET.myPlayer) return window.NET.myPlayer;
  return currentPlayer;
}
/* 联机：合并服务端权威日志（按 id 去重；重连 / 重复广播不会重复显示） */
function mergeServerLog(state) {
  if (!state || !state.log || !state.log.length) return;
  let added = false;
  for (const e of state.log) {
    if (e && typeof e.id === "number" && e.id > onlineLogSeq) {
      logs.push(e.text);
      onlineLogSeq = e.id;
      added = true;
    }
  }
  if (logs.length > 300) logs = logs.slice(-200);
  return added;
}
/* 联机表现层：把权威棋盘压成可比较的快照 */
function bfxSnapshot(st) {
  const m = new Map();
  if (!st || !st.board) return m;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const u = st.board[r][c];
      if (!u || u.sword || u.pillar) continue;
      m.set(u.uid, {
        r, c, hp: u.hp, shield: u.shield || 0, frozen: u.frozen || 0,
        heroId: u.heroId, player: u.player,
        grab: !!(u.statuses && u.statuses.grab && u.statuses.grab.turns > 0),
        empower: (u.empowerTurns || 0) > 0,
        uses: (u.usesLeft == null ? "" : u.usesLeft) + "|" + (u.usesArr ? u.usesArr.join(",") : ""),
      });
    }
  }
  return m;
}
/* 联机表现层：由“服务端确认后的状态差异”派生战斗事件；只播放，不结算、不改状态 */
function skillTypeByName(name) {
  for (const h of HEROES) {
    for (const sk of heroSkills(h)) {
      if (sk && sk.name === name) return sk.type;
    }
  }
  return "";
}
function bfxOnlineDerive(prev, next, st, ctx) {
  if (!st || st.phase !== "battle") return;
  // 先粗扫一遍差异，供锦囊动画定位目标（复活 / 治疗 / 刷新）
  let newCell = null, healCell = null, refreshCell = null;
  for (const [uid, n] of next) {
    const p = prev.get(uid);
    if (!p) { newCell = newCell || { r: n.r, c: n.c }; continue; }
    if (n.hp > p.hp) healCell = { r: n.r, c: n.c };
    if (n.uses !== p.uses) refreshCell = { r: n.r, c: n.c };
  }
  if (st.log) {
    for (const e of st.log) {
      if (typeof e.id !== "number" || e.id <= bfxOnlineLogSeq) continue;
      bfxOnlineLogSeq = e.id;
      const text = e.text || "";
      // 锦囊成功使用：双方都播放卡牌演出（服务端确认后才会有该日志）
      const mt = /使用了【(.+?)】/.exec(text);
      if (mt) {
        const tz = TALISMANS.find((x) => x.name === mt[1]);
        if (tz && window.BFX && window.BFX.talismanCast) {
          const target = tz.effect === "revive" ? newCell
            : tz.effect === "heal" ? healCell
              : tz.effect === "refresh" ? refreshCell : null;
          window.BFX.talismanCast({ id: tz.id, name: tz.name, icon: tz.icon, target });
          inputLockUntil = Math.max(inputLockUntil, Date.now() + 620);
        } else if (tz && window.SFX && window.SFX.playTalisman) {
          window.SFX.playTalisman(tz.id, {});
        }
        continue;
      }
      const m = /^(.+?) 释放【(.+?)】/.exec(text);
      if (m) {
        const heroName = m[1].replace(/^玩家\d+·/, "");
        const skName = m[2].split("·")[0];
        const hero = HEROES.find((h) => h.name === heroName);
        if (window.BFX) window.BFX.banner(heroName, m[2], "");
        if (window.SFX && window.SFX.playSkill) {
          window.SFX.playSkill(skillTypeByName(skName) || "passive", { hero: hero ? hero.id : "", stage: 0 });
        }
      }
    }
  }
  for (const [uid, n] of next) {
    const p = prev.get(uid);
    if (!p) {
      if (window.BFX) window.BFX.revive({ r: n.r, c: n.c });
      if (window.SFX) window.SFX.play("revive", { hero: n.heroId });
      continue;
    }
    const hpDrop = Math.max(0, p.hp - n.hp);
    const shDrop = Math.max(0, p.shield - n.shield);
    if (p.r !== n.r || p.c !== n.c) {
      if (window.BFX) window.BFX.move({
        from: { r: p.r, c: p.c }, to: { r: n.r, c: n.c },
        blink: Math.abs(p.r - n.r) + Math.abs(p.c - n.c) > 1,
        color: window.BFX.heroColor(n.heroId),
      });
    }
    if (shDrop > 0 && hpDrop === 0) {
      if (window.BFX) window.BFX.shieldAbsorb({ r: n.r, c: n.c, amount: shDrop });
      if (window.SFX) window.SFX.play("shieldHit", { hero: n.heroId });
    }
    if (hpDrop > 0) {
      if (window.BFX) window.BFX.hit({ r: n.r, c: n.c, amount: hpDrop, kind: "skill", color: window.BFX.heroColor(n.heroId), uid: uid });
      if (window.SFX) window.SFX.play("hit", { hero: n.heroId, amount: hpDrop, heavy: hpDrop >= 3 });
    }
    if (!p.grab && n.grab) {
      if (window.BFX) window.BFX.grab({ from: { r: n.r, c: n.c }, to: { r: n.r, c: n.c }, color: "#38bdf8" });
      if (window.SFX) window.SFX.play("grab", { hero: n.heroId });
    }
    if (!p.empower && n.empower) {
      if (window.BFX) window.BFX.cast({ type: "thunder", heroId: "thunder", caster: { r: n.r, c: n.c }, target: { r: n.r, c: n.c } });
      if (window.SFX) { window.SFX.play("buffUp", { hero: "thunder" }); window.SFX.startLoop("empower"); }
    } else if (p.empower && !n.empower) {
      if (window.SFX) { window.SFX.play("buffDown", { hero: "thunder" }); window.SFX.stopLoop("empower"); }
    }
    if (n.hp > p.hp) {
      if (window.BFX) window.BFX.heal({ r: n.r, c: n.c, amount: n.hp - p.hp });
      if (window.SFX) window.SFX.play("heal", { hero: n.heroId });
    }
  }
  for (const [uid, p] of prev) {
    if (!next.has(uid)) {
      if (st.hiddenUids && st.hiddenUids.indexOf(uid) >= 0) continue; // 隐身：不播死亡表现（避免误导/泄位）
      if (window.BFX) window.BFX.death({ r: p.r, c: p.c, color: window.BFX.heroColor(p.heroId) });
      if (window.SFX) window.SFX.play("death", { hero: p.heroId });
    }
  }

  // 回合切换演出（联机）：以服务端 currentPlayer / extraTurnPending 为准
  if (ctx && ctx.prevPhase === "battle" && window.BFX) {
    const my = window.NET && window.NET.myPlayer;
    if (st.currentPlayer !== ctx.prevTurn) {
      window.BFX.turnTransition({
        player: st.currentPlayer,
        extra: false,
        title: my ? (st.currentPlayer === my ? "你的回合" : "对手回合") : ("玩家 " + st.currentPlayer + " 的回合"),
        sub: "玩家 " + st.currentPlayer,
      });
      inputLockUntil = Math.max(inputLockUntil, Date.now() + 450);
    } else if (ctx.prevPending && !st.extraTurnPending) {
      window.BFX.turnTransition({
        player: st.currentPlayer,
        extra: true,
        title: my ? (st.currentPlayer === my ? "你的回合 · 额外" : "对手回合 · 额外") : ("玩家 " + st.currentPlayer + " 的额外回合"),
        sub: "额外回合",
      });
      inputLockUntil = Math.max(inputLockUntil, Date.now() + 450);
    }
  }
}

/* 用服务器权威状态替换本地棋盘 */
function applyRemoteState(state) {
  if (!state) return;
  mergeServerLog(state);
  const prevSnap = bfxPrevSnap;      // 上一份快照（首个状态 / 重连后为 null → 不重播历史）
  const prevTurn = currentPlayer;
  const prevPending = extraTurnPending;
  const prevPhase = phase;
  board = state.board.map((row) => row.map((cell) => (cell ? Object.assign({}, cell) : null)));
  mists = state.mists ? JSON.parse(JSON.stringify(state.mists)) : {};
  phase = state.phase;
  currentPlayer = state.currentPlayer;
  winner = state.winner || 0;
  unitSeq = state.unitSeq || unitSeq;
  if (state.toPlace != null) toPlace = state.toPlace;
  if (state.placed) placedIds = { 1: state.placed[1].slice(), 2: state.placed[2].slice() };
  // 联机随机选将：候选池与双方部署完成状态（对手候选池不会下发）
  onlinePool = state.pools && state.pools[mySide()] ? state.pools[mySide()].slice() : (gameMode === "online" ? onlinePool : null);
  if (state.placementDone) onlinePlacementDone = { 1: !!state.placementDone[1], 2: !!state.placementDone[2] };
  // 锦囊状态同步（对手的锦囊为 null=不可见）
  if (state.talisman) talisman = { 1: state.talisman[1], 2: state.talisman[2] };
  if (state.talismanUsed) talismanUsed = { 1: !!state.talismanUsed[1], 2: !!state.talismanUsed[2] };
  if (state.graveyard) graveyard = state.graveyard.slice();
  if (state.assaultPlayer != null || state.guardPlayer != null) {
    talismanBuff = { assaultPlayer: state.assaultPlayer || 0, guardPlayer: state.guardPlayer || 0 };
  }
  if (state.extraMoves != null) extraMoves = state.extraMoves;
  if (state.extraTurnPending != null) extraTurnPending = !!state.extraTurnPending;
  if (state.turnActionUsed != null) turnActionUsed = state.turnActionUsed;
  // 联机：同步行动预算（否则“行动后不自动结束”时无法判断能否结束回合）
  if (state.turnActionsLeft != null) turnActionsLeft = state.turnActionsLeft;
  if (state.turnActionsMax != null) turnActionsMax = state.turnActionsMax;
  talismanMode = null;
  talismanTargets = [];
  if (phase === "placement") pendingHero = firstAvailableHero(mySide()); // 布阵时自动选下一个“本人候选池内”的可用英雄
  if (gameMode !== "online") { gameMode = "online"; updateModeBadge(); }
  // 真实战绩（服务端权威）
  if (state.stats) {
    const st = state.stats;
    const dmg = st.damage || {}, kills = st.kills || {};
    matchStats = {
      damage: { 1: dmg[1] || 0, 2: dmg[2] || 0 },
      kills: { 1: kills[1] || 0, 2: kills[2] || 0 },
      startedAt: st.startedAt || 0,
      endedAt: st.endedAt || 0,
      lastKiller: st.lastKiller || null,
    };
  }
  clearSelection();
  // 联机表现层：根据“服务端确认后的状态变化”播放动画（纯视觉，不重复结算）
  bfxPrevSnap = bfxSnapshot(state);
  if (prevSnap) {
    try { bfxOnlineDerive(prevSnap, bfxPrevSnap, state, { prevTurn, prevPending, prevPhase }); }
    catch (e) { /* 表现层失败不影响权威状态渲染 */ }
  }
  render();
  // 石柱变化（联机表现）：新增 → 升起；消失 → 碎裂
  try {
    const nowP = new Map();
    const stBoard = state.board || [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = stBoard[r] && stBoard[r][c];
        if (cell && cell.pillar) nowP.set(r + "_" + c, cell.turns || 0);
      }
    }
    if (bfxPillarSnap) {
      const risen = [], broken = [];
      for (const k of nowP.keys()) if (!bfxPillarSnap.has(k)) { const q = k.split("_"); risen.push([Number(q[0]), Number(q[1])]); }
      for (const k of bfxPillarSnap.keys()) if (!nowP.has(k)) { const q = k.split("_"); broken.push([Number(q[0]), Number(q[1])]); }
      if (risen.length && window.BFX) window.BFX.pillars(risen, "rise");
      if (risen.length && window.SFX) window.SFX.play("pillarRise");
      if (broken.length && window.BFX) window.BFX.pillars(broken, "break");
      if (broken.length && window.SFX) window.SFX.play("pillarBreak");
    }
    bfxPillarSnap = nowP;
  } catch (e) { /* 表现层失败不影响权威状态 */ }
  // 结算演出（联机）：服务端判定 over 后双方进入；重连直接显示面板，不重播
  if (phase === "over") {
    if (victorySeq.resultShown) {
      /* 已显示 */
    } else if (victorySeq.active) {
      /* 演出进行中 */
    } else if (!prevSnap) {
      showResultPanelImmediate();
    } else if (prevPhase === "battle") {
      startVictorySequence();
    } else {
      showResultPanel();
    }
  }
}
window.onNetState = applyRemoteState;
/* 新房间 / 断线重连：清空本地日志并重置去重游标；随后 onNetState 会按服务端权威 log 重建（不重复刷屏） */
window.onNetJoined = () => {
  logs = [];
  onlineLogSeq = 0;
  bfxPrevSnap = null;      // 重连/新房间：不重播历史动画
  bfxPillarSnap = null;
  bfxOnlineLogSeq = 0;
};
window.onNetStart = () => {
  hideMenu();
  readyRow.classList.remove("hidden");
  updateModeBadge();
};
window.onNetStatus = (NET) => {
  netState.connected = NET.connected;
  netState.room = NET.code;
  netState.role = NET.myPlayer;
  connBadge.classList.remove("hidden");
  if (NET.code) {
    connBadge.textContent = "房间 " + NET.code + " · 你是玩家" + NET.myPlayer + " · " + (NET.connected ? "已连接" : "断开") + " · " + (NET.players || 1) + "/2";
    connBadge.className = "conn-badge " + (NET.connected ? "ok" : "bad");
  } else {
    connBadge.textContent = NET.connected ? "已连接服务器" : "未连接服务器";
    connBadge.className = "conn-badge " + (NET.connected ? "ok" : "bad");
  }
  const rd = NET.ready || { 1: false, 2: false };
  readyP1.textContent = "玩家1 " + (rd[1] ? "已准备" : "未准备");
  readyP2.textContent = "玩家2 " + (rd[2] ? "已准备" : "未准备");
  readyP1.classList.toggle("ok", !!rd[1]);
  readyP2.classList.toggle("ok", !!rd[2]);
  readyRow.classList.toggle("hidden", !NET.code);
  const rb = document.getElementById("ready-btn");
  if (rb) rb.classList.toggle("hidden", !NET.code);
  syncServerInput();
  updateShareLink();
};
window.onNetError = (m) => {
  if (onlineStatus) onlineStatus.textContent = "服务器：" + m;
};
window.onNetNotice = (m) => {
  // 中立提示（例如“对手使用了一张锦囊”），不泄露具体名称
  if (m) addLog("📣 " + m);
  render();
};

/* ============================ 事件绑定 ============================ */
restartBtn.addEventListener("click", init);
overlayBtn.addEventListener("click", init);
// 技能按钮由 updateSkillBar() 动态生成，无需静态绑定
talismanBtn.addEventListener("click", () => {
  if (talismanBtn.disabled) return;
  if (talismanMode) {
    clearSelection();
    render();
    return;
  }
  startTalismanUse(talisman[currentPlayer]);
});
if (detailCloseEl) detailCloseEl.addEventListener("click", () => hideUnitDetail());
skipBtn.addEventListener("click", () => {
  if (phase === "battle") {
    if (gameMode === "online") {
      onlineForward({ type: "end" });
      return;
    }
    if (skipBtn.disabled) return; // 不能直接跳过回合
    addLog("玩家" + currentPlayer + " 结束回合。");
    endTurn();
  }
});

/* 背景音乐开关：
   1) 若游戏目录存在 bgm.mp3，优先播放该文件（例如你自备的曲子）；
   2) 否则播放 bgm.js 中的原创合成音乐（100% 原创，无版权问题）。
   浏览器要求先由用户点击才能播放音频。 */
function setBgmBtn(playing) {
  bgmBtn.classList.toggle("playing", playing);
  bgmBtn.textContent = playing ? "⏸ 音乐" : "🎵 音乐";
}
function bgmIsPlaying() {
  return (window.BGM && window.BGM.playing) || (!bgmEl.paused && bgmEl.currentTime > 0);
}
function startSynthBgm() {
  if (window.BGM) {
    window.BGM.start();
    setBgmBtn(true);
  } else {
    setBgmBtn(false);
    addLog("当前浏览器不支持内置背景音乐。");
    render();
  }
}
bgmBtn.addEventListener("click", () => {
  if (bgmIsPlaying()) {
    if (window.BGM) window.BGM.stop();
    bgmEl.pause();
    setBgmBtn(false);
    return;
  }
  let p = null;
  try {
    p = bgmEl.play();
  } catch (e) {
    p = null;
  }
  if (p && typeof p.then === "function") {
    p.then(() => setBgmBtn(true)).catch(() => startSynthBgm());
  } else {
    startSynthBgm();
  }
});

/* ---------------- 主菜单 / 设置 / 联机 事件 ---------------- */
menuBtn.addEventListener("click", () => showMenu());
/* 关闭菜单：返回棋盘继续对局 */
if (menuCloseEl) menuCloseEl.addEventListener("click", () => hideMenu());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuEl && !menuEl.classList.contains("hidden")) hideMenu();
});
overlayMenuBtn.addEventListener("click", () => {
  overlayEl.classList.add("hidden");
  showMenu();
});
/* 跳过结算演出：立即显示最终面板（服务端结果已判定，不影响对局状态） */
const victorySkipBtn = document.getElementById("victory-skip");
if (victorySkipBtn) {
  victorySkipBtn.addEventListener("click", () => {
    if (victorySeq.active) showResultPanel();
  });
}
document.querySelector('.menu-btn[data-mode="local"]').addEventListener("click", startLocal);
document.getElementById("menu-ai-open").addEventListener("click", () => showMenu("ai"));
document.getElementById("menu-online-open").addEventListener("click", () => showMenu("online"));
document.getElementById("menu-settings-open").addEventListener("click", () => showMenu("settings"));
document.querySelectorAll(".menu-back").forEach((b) => b.addEventListener("click", () => showMenu()));
document.getElementById("ai-start").addEventListener("click", startAI);
/* 分享地址选择（局域网 IP / Radmin IP …） */
if (shareHostSelEl) {
  shareHostSelEl.addEventListener("change", () => {
    shareHostChoice = shareHostSelEl.value || "";
    updateShareLink();
  });
}
/* 复制「手机打开」地址 */
function copyText(val, done) {
  if (!val) return;
  const ok = () => { if (onlineStatus) onlineStatus.textContent = "已复制：" + val + "（手机连同一个 Wi‑Fi 后用浏览器打开）"; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(ok).catch(() => { if (phoneInputEl) { phoneInputEl.select(); document.execCommand("copy"); ok(); } });
  } else if (phoneInputEl) {
    phoneInputEl.select();
    document.execCommand("copy");
    ok();
  }
}
if (document.getElementById("phone-copy")) {
  document.getElementById("phone-copy").addEventListener("click", () => copyText(phoneInputEl ? phoneInputEl.value : "", null));
}

/* ===== 战斗表现层：初始化 + 设置（自动保存；只影响画面，不影响判定） ===== */
(function initBattleFX() {
  if (!window.BFX) return;
  const wrapEl = document.querySelector(".board-wrap");
  const boardDom = document.getElementById("board");
  window.BFX.init({ wrap: wrapEl, board: boardDom });
  // 痕迹避让：有单位的格子只画在边缘，绝不压住棋子图标 / 血条
  window.BFX.setOccupancy((r, c) => {
    const row = board && board[r];
    const u = row && row[c];
    return !!(u && !u.sword);
  });
  const o = window.BFX.options;
  const bind = (id, key, isCheck) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isCheck) el.checked = !!o[key]; else el.value = String(o[key]);
    el.addEventListener("change", () => {
      const patch = {};
      patch[key] = isCheck ? !!el.checked : parseFloat(el.value);
      window.BFX.setOptions(patch);
    });
  };
  bind("set-fx", "enabled", true);
  bind("set-fx-traces", "traces", true);
  bind("set-fx-shake", "shake", true);
  bind("set-fx-reduce", "reduce", true);
  bind("set-fx-speed", "speed", false);
  // 字体/布局稳定后校正一次画布几何
  setTimeout(() => { if (window.BFX) window.BFX.sync(); }, 80);
})();

/* 设置：音效开关 / 音量 / 技能音效（自动保存到 localStorage） */
function syncSfxUI() {
  if (!window.SFX) return;
  const s = SFX.getSettings();
  const c1 = document.getElementById("set-sfx");
  const c2 = document.getElementById("set-skill-sfx");
  const v1 = document.getElementById("set-vol");
  const v2 = document.getElementById("set-master");
  const st = document.getElementById("sfx-state");
  if (c1) c1.checked = !!s.enabled;
  if (c2) { c2.checked = !!s.skills; c2.disabled = !s.enabled; }
  if (v1) v1.value = String(Math.round(s.sfx * 100));
  if (v2) v2.value = String(Math.round(s.master * 100));
  if (st) {
    st.textContent = s.enabled
      ? "音效开启 · 战斗 " + Math.round(s.sfx * 100) + "% · 主音量 " + Math.round(s.master * 100) + "%" + (s.skills ? "" : " · 技能音效已关")
      : "已静音（战斗音效关闭）";
  }
}
document.getElementById("set-sfx").addEventListener("change", (e) => {
  if (window.SFX) SFX.setEnabled(e.target.checked);
  syncSfxUI();
});
document.getElementById("set-vol").addEventListener("input", (e) => {
  if (window.SFX) {
    SFX.setVolume(parseInt(e.target.value, 10) / 100);
    if (!SFX.isEnabled()) SFX.setEnabled(true); // 拖动音量即视为想听
  }
  syncSfxUI();
});
document.getElementById("set-master").addEventListener("input", (e) => {
  if (window.SFX) {
    SFX.setMaster(parseInt(e.target.value, 10) / 100);
    if (!SFX.isEnabled()) SFX.setEnabled(true);
  }
  syncSfxUI();
});
document.getElementById("set-skill-sfx").addEventListener("change", (e) => {
  if (window.SFX) SFX.setSettings({ skills: e.target.checked });
  syncSfxUI();
});
document.getElementById("set-sfx-reset").addEventListener("click", () => {
  if (window.SFX) SFX.resetDefaults();
  syncSfxUI();
});
document.getElementById("set-sfx-test").addEventListener("click", () => {
  if (!window.SFX) return;
  SFX.unlock();
  SFX.testDemo();
});
syncSfxUI();

/* 在线联机入口（需要先启动 server/ 下的 Node 服务器） */
document.getElementById("create-room").addEventListener("click", () => {
  if (window.NET && window.NET.available) {
    hideMenu();
    window.NET.createRoom();
  } else {
    onlineStatus.innerHTML = "未连接到服务器。请先运行 <code>node server/server.js</code>，再刷新本页。";
  }
});
document.getElementById("join-room").addEventListener("click", () => {
  const code = (document.getElementById("room-input").value || "").trim().toUpperCase();
  if (!code) return;
  if (window.NET && window.NET.available) {
    hideMenu();
    window.NET.joinRoom(code);
  } else {
    onlineStatus.innerHTML = "未连接到服务器。请先运行 <code>node server/server.js</code>，再刷新本页。";
  }
});
document.getElementById("ready-btn").addEventListener("click", () => {
  if (window.NET) window.NET.markReady();
});
serverConnectEl.addEventListener("click", () => {
  if (!window.NET) return;
  window.NET.setUrl(serverInputEl ? serverInputEl.value : "");
  if (onlineStatus) onlineStatus.textContent = "正在连接 " + window.NET.serverUrl + " ...";
  setTimeout(syncServerInput, 600);
});
document.getElementById("share-copy").addEventListener("click", () => {
  const val = shareInputEl ? shareInputEl.value : "";
  if (!val) return;
  const done = () => { if (onlineStatus) onlineStatus.textContent = "链接已复制，发给好友点开即可加入。"; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(done).catch(() => { if (shareInputEl) { shareInputEl.select(); document.execCommand("copy"); done(); } });
  } else if (shareInputEl) {
    shareInputEl.select();
    document.execCommand("copy");
    done();
  }
});

init();
showMenu();
handleUrlParams();

/* =========================================================================
 * 自动化测试钩子（不影响正常游戏，仅用于在浏览器控制台 / 自动化中验证规则）
 * ========================================================================= */
window.GameAPI = {
  SIZE,
  BASE_ATTACK,
  FLANK_BONUS,
  HEROES,
  get board() {
    return board;
  },
  get phase() {
    return phase;
  },
  get currentPlayer() {
    return currentPlayer;
  },
  setCurrentPlayer(p) {
    currentPlayer = p;
  },
  setPhase(p) {
    phase = p;
  },
  setMode(mode, opts) {
    gameMode = mode;
    if (opts) {
      if (opts.aiPlayer) aiPlayer = opts.aiPlayer;
      if (opts.aiDifficulty) aiDifficulty = opts.aiDifficulty;
    }
    updateModeBadge();
  },
  get gameMode() { return gameMode; },
  get aiPlayer() { return aiPlayer; },
  get aiDifficulty() { return aiDifficulty; },
  get netState() { return Object.assign({}, netState); },
  setNetState(s) { Object.assign(netState, s); },
  aiTakeTurn,
  aiEnumerate,
  aiKick,
  startLocal,
  startAI,
  getLog() {
    return logs.slice();
  },
  getSkillTargets() {
    return skillTargets.slice();
  },
  get skillMode() {
    return skillMode;
  },
  /* ---- 锦囊测试钩子 ---- */
  TALISMANS,
  getTalisman(p) { return talisman[p]; },
  getMists() { return JSON.parse(JSON.stringify(mists)); },
  setTalisman(p, id) { talisman[p] = id; talismanUsed[p] = false; },
  getTalismanUsed() { return Object.assign({}, talismanUsed); },
  setTalismanUsed(p, v) { talismanUsed[p] = !!v; },
  get talismanMode() { return talismanMode; },
  getTalismanBuff() { return Object.assign({}, talismanBuff); },
  getGraveyard() { return graveyard.slice(); },
  getExtraMoves() { return extraMoves; },
  getExtraTurnPending() { return extraTurnPending; },
  activateDragonMove,
  talismanTargetsFor,
  startTalismanUse,
  useTalismanEffect,
  /* ---- 孤胆侠 / 霸体 / 负面状态 测试钩子 ---- */
  hasSuperArmor,
  isLoneActive,
  alliesIn3x3,
  attackerBonus,
  applyNegativeStatus,
  tickStatuses,
  showUnitDetail,
  hideUnitDetail,
  get detailUnit() { return detailUnit; },
  computeFlankInfo,
  baseFlankedAt,
  flankCountAt,
  resolveNormalAttack,
  assassinInFlank,
  isGuixiongActive,
  guixiongCounter,
  wxtStageTargets,
  knockOutBoxAway,
  pushAwayOne,
  computeChaseLine,
  chaseTargetsOf,
  chaseBlinkCells,
  refreshChase,
  refreshSkillOnKill,
  endChase,
  skillFreeFor,
  computeSkillTargets,
  computeDash,
  spawnSword,
  isSword,
  isUnit,
  hasAsuraAlive,
  getDashOptions() {
    return dashOptions.slice();
  },
  applyDamage,
  normalAttack,
  moveHero,
  useSkill,
  activateSkill,
  get activeSkillIdx() { return activeSkillIdx; },
  get skillSub() { return skillSub; },
  heroSkills,
  heroPassives,
  grantDragonMove,
  dragonBreathArea,
  selectDragonMove,
  performDragonMove,
  get dragonMoveUnit() { return dragonMoveUnit; },
  setDodgeRoller(fn) { dodgeRoller = fn || Math.random; },
  get dodgeRoller() { return dodgeRoller; },
  /* ---- 雷电之主 / 行动预算 测试钩子 ---- */
  get turnActionsLeft() { return turnActionsLeft; },
  get turnActionsMax() { return turnActionsMax; },
  get empowerTurnActive() { return empowerTurnActive; },
  canActNow,
  randomKnockback,
  endTurn,
  beginTurn,
  clearSelection,
  render,
  flush: render,
  /* 用紧凑规格快速摆盘：units = [{r,c,player,heroId,hp?,shield?,frozen?,cd?}] */
  setup(units, activePlayer) {
    board = [];
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) row.push(null);
      board.push(row);
    }
    phase = "battle";
    currentPlayer = activePlayer || 1;
    winner = 0;
    unitSeq = 1;
    logs = [];
    if (window.BFX) window.BFX.clear(); // 新开一局：清空战场痕迹
    if (window.SFX) window.SFX.stopAll();
    inputLockUntil = 0;
    fx = [];
    turnActionUsed = false;
    talismanMode = null;
    talismanTargets = [];
    talismanBuff = { assaultPlayer: 0, guardPlayer: 0 };
    extraMoves = 0;
    graveyard = [];
    reviveOptions = [];
    mists = {};
    // 对局统计 & 结算演出：重置（测试/新局共用）
    matchStats = { damage: { 1: 0, 2: 0 }, kills: { 1: 0, 2: 0 }, startedAt: Date.now(), endedAt: 0, lastKiller: null };
    clearVictoryTimers();
    victorySeq = { active: false, played: false, resultShown: false, timers: [] };
    if (window.BFX) window.BFX.victoryHide();
    const _skip1 = document.getElementById("victory-skip");
    if (_skip1) _skip1.classList.add("hidden");
    if (overlayStatsEl) overlayStatsEl.innerHTML = "";
    overlayEl.classList.add("hidden");
    clearSelection();
    for (const spec of units) {
      const def = heroDef(spec.heroId);
      const unit = {
        uid: unitSeq++,
        heroId: def.id,
        player: spec.player,
        hp: spec.hp != null ? spec.hp : def.hp,
        maxHp: def.hp,
        shield: spec.shield || 0,
        frozen: spec.frozen || 0,
        swords: spec.swords != null ? spec.swords : (def.blades || 0),
        statuses: spec.statuses || {},
        lockUsed: !!spec.lockUsed,
        sdStage: spec.sdStage || 0,
        dragonMoves: spec.dragonMoves || 0,
        empowerTurns: spec.empowerTurns || 0,
        chaseStage: spec.chaseStage || 0,
        chaseMark: spec.chaseMark || 0,
        guixiongUsed: !!spec.guixiongUsed,
        wxtStage: spec.wxtStage || 0,
        stealth: spec.stealth ? JSON.parse(JSON.stringify(spec.stealth)) : null,
        ravenBuff: !!spec.ravenBuff,
        ravenDouble: !!spec.ravenDouble,
        ravenDoubleUsed: !!spec.ravenDoubleUsed,
        metalBuff: !!spec.metalBuff,
        metalTide: spec.metalTide || 0,
      };
      initUnitUses(unit, def);
      if (spec.uses != null) unit.usesLeft = spec.uses;
      if (spec.usesArr) unit.usesArr = spec.usesArr.slice();
      board[spec.r][spec.c] = unit;
    }
    return board;
  },
  /* 选中某格并计算目标（用于测试技能目标） */
  select(r, c) {
    selected = { r, c };
    computeTargets();
    return { moveTargets: moveTargets.slice(), attackTargets: attackTargets.slice() };
  },
};
