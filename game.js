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
let phase = "placement";           // placement(布阵) / battle(对战) / over(结束)
let currentPlayer = 1;
let toPlace = SOLDIERS_PER_PLAYER;
let placedIds = { 1: [], 2: [] };  // 每方已选英雄 id（防重复）
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
  return inBounds(r, c) ? board[r][c] : null;
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
function isUnit(cell) {
  return !!cell && !cell.sword;
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
    if (cell && !cell.sword && cell.player !== u.player) hits.push({ r: rr, c: cc });
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
/* 单位击杀任意敌人 → 刷新其标记了 refreshOnKill 的技能（刺客·追猎 / 吸血鬼·血崩）。
 * 同一次击杀只刷新一次（技能次数已满时不再重复触发）。返回是否真的刷新。 */
function refreshSkillOnKill(a) {
  if (!a || a.sword) return false;
  const skills = heroSkills(heroDef(a.heroId));
  let refreshed = false;
  let name = "";
  for (let i = 0; i < skills.length; i++) {
    const sk = skills[i];
    if (!sk || !sk.refreshOnKill) continue;
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
  }
  return refreshed;
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
/* 技能是否被负面状态禁止（如被抓取） */
function skillBlockedByStatus(u) {
  return !!(u && u.statuses && u.statuses.grab && u.statuses.grab.turns > 0);
}
/* 被抓取：该单位在其回合内不能做任何动作（移动 / 普攻 / 技能） */
function isGrabbed(u) {
  return skillBlockedByStatus(u);
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
    return { applied: false, immune: true, damage: dmg };
  }
  target.statuses = target.statuses || {};
  target.statuses[kind] = Object.assign({ kind, label: opts.label || kind }, opts);
  addLog(label(target) + " 被施加【" + (opts.label || kind) + "】（持续 " + (opts.turns != null ? opts.turns : 1) + " 个其回合）。");
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
      if (inBounds(g.r, g.c) && !board[g.r][g.c]) res.push([g.r, g.c]);
    }
  }
  return res;
}
/* 当前玩家是否还有任何可执行的行动（用于“不能直接跳过回合”的兜底） */
function hasAnyAction(player) {
  for (const u of unitsOf(player)) {
    if (u.frozen > 0) continue;
    if (isGrabbed(u)) continue; // 被抓取：本回合无法行动
    const pos = findPos(u);
    if (!pos) continue;
    const s = heroDef(u.heroId).skill;
    if (!turnActionUsed && s && u.usesLeft > 0) return true; // 仍可用普通技能
    for (const [dr, dc] of DIRS) {
      const nr = pos.r + dr;
      const nc = pos.c + dc;
      if (!inBounds(nr, nc)) continue;
      const t = board[nr][nc];
      if (!t) { if (!turnActionUsed) return true; continue; }
      if (t.sword) { if (u.heroId === "asura" && !turnActionUsed) return true; continue; }
      if (t.player !== player && !turnActionUsed) return true;
    }
    if (heroHasFreeUses(u)) return true; // 剑圣仍可使用
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

/* 普通攻击伤害结算（纯计算，不产生副作用，便于测试）：
 * 基础伤害 1；若目标被夹击，额外 =（夹击方向数 − 1）。
 * 例：2 个方向 +1（共 2 点）、3 个方向 +2（共 3 点）、4 个方向 +3（共 4 点）。
 * 【刺客·暗杀】：刺客参与本次夹击时，夹击额外 +1（同一次夹击最多 +1）。 */
function resolveNormalAttack(attacker, target) {
  const info = computeFlankInfo();
  const d = info.get(target.uid) || { base: false, protected: false, flanked: false, count: 0, bonus: 0 };
  const assassin = d.flanked && assassinInFlank(attacker, target) ? 1 : 0;
  return {
    base: d.base,
    protected: d.protected,
    count: d.count,
    flank: d.flanked,
    bonus: d.bonus,
    assassin,
    damage: BASE_ATTACK + d.bonus + assassin,
  };
}

/* ============================ 初始化 / 布阵 ============================ */
function firstAvailableHero(player) {
  const used = placedIds[player];
  const h = HEROES.find((x) => !used.includes(x.id));
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
  overlayEl.classList.add("hidden");
  addLog("对局开始：双方各自选择并放置 3 名英雄。");
  addLog("🎴 双方各抽取了一张锦囊（见右侧「我的锦囊」）。");
  render();
  aiKick();
}

function handlePlacement(r, c) {
  if (gameMode === "online") {
    if (pendingHero) onlineForward({ type: "place", heroId: pendingHero, r, c });
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
}

/* 一方的回合开始：恢复“每回合型”技能次数（如阿修罗·剑圣），并清空选中 */
function beginTurn() {
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
}

/* 结束当前玩家回合：先结算其冰封回合数，再交给对方 */
function endTurn() {
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
        }
      }
    }
  }
  empowerTurnActive = false;
  // 行军令：若本回合附加了「额外回合」，则不交给对方，而是让当前玩家再获得一个完整回合
  const samePlayer = extraTurnPending;
  extraTurnPending = false;
  if (!samePlayer) currentPlayer = currentPlayer === 1 ? 2 : 1;
  beginTurn();
  if (samePlayer) addLog("🐎 行军令：玩家" + currentPlayer + " 获得一个额外回合（行动已刷新）。");
  render();
  // 回合交接后触发 AI（此前 AI 依赖“行动时自动结束回合”的棋盘点击回调，改为手动结束后必须在这里补上）
  aiKick();
}

/* 一次行动后的收尾。
 * 回合不再自动结束：行动完成后仍停留在当前回合，玩家可继续使用锦囊 /
 * 「不耗步」技能 / 行军令的额外移动，最后手动点「结束回合」交给对方。
 * - isFree=true（不耗步技能）不消耗行动机会；
 * - 普通行动消耗 1 次行动机会（雷电之主强化回合为 2 次）。 */
function afterAction(actor, isFree, keepOpen) {
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
    addLog("玩家" + winner + " 获胜！");
    clearSelection();
    render();
    return true;
  }
  return false;
}

function computeTargets() {
  moveTargets = [];
  attackTargets = [];
  if (!selected) return;
  const u = board[selected.r][selected.c];
  if (!u || u.sword) return;
  if (isGrabbed(u)) return; // 被抓取：不能移动或攻击
  for (const [dr, dc] of DIRS) {
    const nr = selected.r + dr;
    const nc = selected.c + dc;
    if (!inBounds(nr, nc)) continue;
    const t = board[nr][nc];
    if (!t) moveTargets.push([nr, nc]);
    else if (t.sword) {
      if (u.heroId === "asura") moveTargets.push([nr, nc]); // 阿修罗可进入并回收剑
    } else if (t.player !== u.player) {
      attackTargets.push([nr, nc]);
    }
  }
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
      for (const [dr, dc] of DIRS) {
        for (let st = 1; st <= s.range; st++) {
          const rr = r + dr * st;
          const cc = c + dc * st;
          if (!inBounds(rr, cc)) break;
          const t = board[rr][cc];
          if (t) {
            if (!t.sword && t.player !== u.player) skillTargets.push([rr, cc]);
            break; // 第一个物体即阻挡，射线终止
          }
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
  if (isGrabbed(u)) {
    addLog(label(u) + " 处于【抓取】状态，无法移动。");
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
  const picked = collectSwordAt(r, c, u); // 阿修罗进入剑格：回收
  board[r][c] = u;
  board[fr][fc] = null;
  if (picked) {
    addLog("⚔ " + label(u) + " 回收了一把剑（携带 " + u.swords + " 把）。");
    if (window.SFX) window.SFX.play("swordPickup", { sfx: "blade" });
  }
  addLog(label(u) + " 移动到 (" + (r + 1) + "," + (c + 1) + ")。");
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

/* 伤害应用：先扣护盾，再扣生命；生命归零立即从棋盘移除 */
function applyDamage(target, amount, kind, source) {
  const pos = findPos(target);
  let dmg = amount;

  // 坚守令：己方英雄受到的每次伤害 -1（最低 0）
  if (guardOn(target.player) && dmg > 0) {
    dmg = Math.max(0, dmg - 1);
    addLog("🛡 坚守令为 " + label(target) + " 减免 1 点伤害。");
  }

  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
    if (absorbed > 0) addLog(label(target) + " 的护盾抵挡了 " + absorbed + " 点伤害。");
  }
  // 孤胆侠·霸体：首次致命伤害 → 锁血到 1（每局一次，规则层判定，非致命伤害不消耗）
  if (dmg > 0 && target.hp - dmg <= 0 && target.heroId === "lone" && hasSuperArmor(target) && !target.lockUsed) {
    target.lockUsed = true;
    dmg = Math.max(0, target.hp - 1);
    addLog("🛡 孤胆侠·霸体：抵挡本次致命伤害，生命锁定为 1 点（本局一次）。");
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
  if (dmg > 0) target.hp -= dmg;

  if (pos) fx.push({ r: pos.r, c: pos.c, text: dodged ? "闪避" : (dmg > 0 ? "-" + dmg : "格挡"), kind: kind || "normal" });

  // 命中 / 技能命中音效（仅在真正造成伤害时播放，避免“落空”仍发声）
  if (dmg > 0 && window.SFX) {
    window.SFX.play(kind === "skill" ? "skillHit" : "hit", { sfx: sfxOf(target) });
  }

  if (target.hp <= 0 && pos) {
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
      swords: target.swords || 0,
      lockUsed: !!target.lockUsed,
    });
    board[pos.r][pos.c] = null;
    addLog(label(target) + " 阵亡！");
    if (window.SFX) window.SFX.play("death", { sfx: sfxOf(target) });
    // 阿修罗·锻剑：阿修罗存活时，阵亡位置留下一把剑
    if (spawnSword(pos.r, pos.c)) {
      addLog("⚔ 锻剑：" + label(target) + " 的阵亡处留下了一把剑。");
      if (window.SFX) window.SFX.play("swordSpawn", { sfx: "blade" });
    }
    // 击杀刷新：刺客·追猎 / 吸血鬼·血崩（同一次击杀只刷新一次）
    if (source && !source.sword && source.player !== target.player && findPos(source)) {
      refreshSkillOnKill(source);
    }
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
  if (isGrabbed(attacker)) {
    addLog(label(attacker) + " 处于【抓取】状态，无法攻击。");
    clearSelection();
    render();
    return;
  }
  const res = resolveNormalAttack(attacker, target);
  const aBonus = attackerBonus(attacker); // 猛攻令 +1 / 孤胆 +1
  const total = res.damage + aBonus;

  if (res.flank) {
    addLog("【夹击×" + res.count + "】" + label(attacker) + " 攻击 " + label(target) + "，额外伤害 +" + res.bonus +
      (res.assassin ? "，刺客·暗杀 +1" : "") + (aBonus ? "，猛攻令 +1" : "") + "（共 " + total + " 点）。");
    if (res.assassin) addLog("🗡 刺客·暗杀触发：本次夹击额外 +1 点伤害。");
  } else if (res.base && res.protected) {
    addLog("【队友保护，夹击无效】" + label(attacker) + " 攻击 " + label(target) + "，造成 " + (BASE_ATTACK + aBonus) + " 点伤害" + (aBonus ? "（猛攻令 +1）" : "") + "。");
  } else {
    addLog(label(attacker) + " 攻击 " + label(target) + "，造成 " + (BASE_ATTACK + aBonus) + " 点伤害" + (aBonus ? "（猛攻令 +1）" : "") + "。");
  }

  if (window.SFX) window.SFX.play("attack", { sfx: sfxOf(attacker) });
  if (res.flank && window.SFX) window.SFX.play("flank", { sfx: sfxOf(attacker) });
  applyDamage(target, total, res.flank ? "flank" : "normal", attacker);
  turnActionUsed = true;
  afterAction(attacker);
}

/* 技能伤害结算：技能【不享受】夹击加成；但享受「猛攻令」/「孤胆」+1 */
function resolveSkillDamage(attacker, target, skill) {
  const ab = attackerBonus(attacker);
  return { damage: skill.damage + ab, assault: ab };
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

  if (gameMode === "online") {
    onlineForward({
      type: "skill",
      from: { r, c },
      to: { r: tr, c: tc },
      idx: activeSkillIdx,
      reposition: s.type === "shuidiao" && skillSub ? { r: skillSub.r, c: skillSub.c } : undefined,
      chaseTarget: s.type === "chase" && skillSub && skillSub.kind === "chase-blink" ? { r: skillSub.tR, c: skillSub.tC } : undefined,
    });
    return;
  }

  if (isPassiveSkill(s)) {
    clearSelection();
    render();
    return;
  }
  if (skillBlockedByStatus(a)) {
    addLog(label(a) + " 处于【抓取】状态，无法使用技能。");
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
  if (window.SFX) window.SFX.play("skill", { sfx: sfxOf(a) });
  const sd2 = s.type === "shuidiao" && (a.sdStage || 0) === 1; // 水调歌头第二段（同一套的延续）
  const chase2 = s.type === "chase" && (a.chaseStage || 0) === 1; // 追猎第二段（不消耗次数、不消耗行动）
  // 是否消耗行动机会必须在结算前判定：追猎结算会改动 chaseStage，若放到最后判定会翻转结果
  const freeAction = skillFreeFor(a, s);
  let consumedHere = false; // 追猎第一段在分支内「先扣次数再结算」，避免击杀刷新被尾部扣次数覆盖

  switch (s.type) {
    case "damage_single": {
      const rd = resolveSkillDamage(a, target, s);
      addLog(label(a) + " 释放【" + s.name + "】，对 " + label(target) + " 造成 " + rd.damage + " 点伤害" + (rd.assault ? "（猛攻令 +1）" : "") + "。");
      applyDamage(target, rd.damage, "skill");
      break;
    }

    case "freeze": {
      const rd = resolveSkillDamage(a, target, s);
      addLog(label(a) + " 释放【" + s.name + "】，对 " + label(target) + " 造成 " + rd.damage + " 点伤害" + (rd.assault ? "（猛攻令 +1）" : "") + "。");
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
      fx.push({ r: tr, c: tc, text: "+" + healed, kind: "heal" });
      break;
    }

    case "damage_adjacent_all": {
      let hit = 0;
      let assault = 0;
      for (const [dr, dc] of DIRS) {
        const t = unitAt(r + dr, c + dc);
        if (t && !t.sword && t.player !== a.player) {
          const rd = resolveSkillDamage(a, t, s);
          if (rd.assault) assault = rd.assault;
          applyDamage(t, rd.damage, "skill");
          hit++;
        }
      }
      addLog(label(a) + " 释放【" + s.name + "】，横扫相邻敌人，命中 " + hit + " 名" + (assault ? "（猛攻令 +1）" : "") + "。");
      break;
    }

    case "damage_line": {
      const rd = resolveSkillDamage(a, target, s);
      addLog(label(a) + " 释放【" + s.name + "】，穿透 " + label(target) + "，造成 " + rd.damage + " 点伤害" + (rd.assault ? "（猛攻令 +1）" : "") + "。");
      applyDamage(target, rd.damage, "skill");
      break;
    }

    case "shield_self":
      a.shield += s.shield;
      addLog("🛡 " + label(a) + " 释放【" + s.name + "】，获得 " + s.shield + " 点护盾。");
      fx.push({ r, c, text: "+" + s.shield, kind: "shield" });
      break;

    case "blink":
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
      if (window.SFX) window.SFX.play("dash", { sfx: sfxOf(a) });
      const dashDmg = s.damage + attackerBonus(a); // 剑圣伤害 + 猛攻令/孤胆
      const fr = computeDashPath(a, r, c, opt.dir[0], opt.dir[1], 3); // 按实际路径重新判定
      let hitCount = 0;
      for (const h of fr.hits) {
        const t = board[h.r][h.c];
        if (t && !t.sword && t.player !== a.player) {
          applyDamage(t, dashDmg, "skill"); // 阿修罗·剑圣的伤害（技能，不吃夹击加成）
          if (window.SFX) window.SFX.play("dashHit", { sfx: "blade" });
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
      if (pickedCount && window.SFX) window.SFX.play("swordPickup", { sfx: "blade" });
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
      board[ddest.r][ddest.c] = a;
      board[r][c] = null;
      let dhit = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const t = unitAt(ddest.r + dr, ddest.c + dc);
          if (t && !t.sword && t.player !== a.player) {
            applyDamage(t, s.damage + attackerBonus(a), "skill");
            dhit++;
          }
        }
      }
      addLog("🌊 " + label(a) + " 释放【" + s.name + "】，前进到 (" + (ddest.r + 1) + "," + (ddest.c + 1) + ")，九宫格命中 " + dhit + " 名敌人。");
      break;
    }

    case "shuidiao": {
      if ((a.sdStage || 0) === 1) {
        // 第二段：突进 2 格，擒拿沿途第一个敌人（按实际路径重新判定）
        const opt2 = dashOptions.find((o) => o.stage === 2 && o.target && o.target.r === tr && o.target.c === tc);
        if (!opt2) { addLog("突进方向无效。"); clearSelection(); render(); return; }
        if (window.SFX) window.SFX.play("dash", { sfx: sfxOf(a) });
        const fr = computeDashPath(a, r, c, opt2.dir[0], opt2.dir[1], 2);
        let grabbed = null;
        for (const h of fr.hits) {
          const t = board[h.r][h.c];
          if (t && !t.sword && t.player !== a.player) { grabbed = t; break; }
        }
        if (fr.dest) { board[fr.dest.r][fr.dest.c] = a; board[r][c] = null; }
        if (grabbed) {
          const gres = applyNegativeStatus(grabbed, "grab", { damage: 0, turns: 1, endDamage: s.grabDamage || 2, label: "擒拿", source: "水调歌头" });
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
        if (window.SFX) window.SFX.play("dash", { sfx: sfxOf(a) });
        const rp = opt1.reposition || { r, c };
        if (!(rp.r === r && rp.c === c)) {
          board[rp.r][rp.c] = a;
          board[r][c] = null;
        }
        const fr = computeDashPath(a, rp.r, rp.c, opt1.dir[0], opt1.dir[1], 3);
        let hit1 = 0;
        for (const h of fr.hits) {
          const t = board[h.r][h.c];
          if (t && !t.sword && t.player !== a.player) { applyDamage(t, s.damage + attackerBonus(a), "skill"); hit1++; }
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
      let bhit = 0;
      const seen = new Set();
      for (const [rr, cc] of dragonBreathArea(a, r, c, brDir[0], brDir[1])) {
        const key = rr + "_" + cc;
        if (seen.has(key)) continue;
        seen.add(key);
        const t = unitAt(rr, cc);
        if (t && !t.sword && t.player !== a.player) { applyDamage(t, s.damage + attackerBonus(a), "skill"); bhit++; }
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
      if (tt && !tt.sword && tt.player !== a.player) {
        // 敌人：先造成伤害
        applyDamage(tt, s.damage + attackerBonus(a), "skill");
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
        fx.push({ r: tr, c: tc, text: "闪身", kind: "skill" });
        addLog("🗡 " + label(a) + " 追猎·闪身到 (" + (tr + 1) + "," + (tc + 1) + ")，对 " + label(tgt) + " 造成 " + s.damage + " 点伤害。");
        applyDamage(tgt, s.damage, "skill", a); // 统一伤害结算（击杀 → 触发追猎刷新）
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
      for (const t of hitUnits) applyDamage(t, s.damage, "skill", a); // 全部结算（逐个判定，不只命中第一个）
      const marked = hitUnits.filter((t) => findPos(t)).length;
      a.chaseStage = 1; // 进入第二段待释放状态
      if (window.SFX) window.SFX.play("dash", { sfx: sfxOf(a) });
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
      for (const t of victims) {
        const aliveBefore = !!findPos(t);
        // 统一伤害结算：护盾吸收 / 减伤 / 闪避 / 阵亡都在 applyDamage 内完成；
        // 返回值 = 实际扣掉的生命值（被护盾完全吸收或闪避时为 0）
        const dealt = applyDamage(t, s.damage, "skill", a);
        if (dealt > 0) totalDealt += dealt;
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
      if (kills > 0) addLog("🩸 血崩击杀 " + kills + " 名敌人，【" + s.name + "】使用次数已刷新。");
      break;
    }
  }

  // 消耗一次释放次数（无限次技能不减少；水调歌头 / 追猎第二段不额外消耗；追猎第一段已在分支内提前扣除）
  if (!sd2 && !chase2 && !consumedHere) {
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
  if (skillBlockedByStatus(u)) {
    addLog(label(u) + " 处于【抓取】状态，无法使用技能。");
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
  const sl = skillUsesLeft(u, idx);
  if (!isSd2 && !isChase2 && sl !== Infinity && sl <= 0) {
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
      fx.push({ r: tr, c: tc, text: "+" + healed, kind: "heal" });
      addLog("➕ 玩家" + player + " 使用【战地急救令】：" + label(u) + " 恢复 " + healed + " 点生命（" + u.hp + "/" + u.maxHp + "）。");
      break;
    }
    case "revive": {
      const rec = graveyard.find((g) => g.player === player && g.r === tr && g.c === tc);
      if (!rec) { addLog("该位置没有可复活的己方阵亡英雄。"); ok = false; break; }
      if (!inBounds(tr, tc) || board[tr][tc]) { addLog("原位置已被占用，无法复活。"); ok = false; break; }
      const def = heroDef(rec.heroId);
      board[tr][tc] = {
        uid: unitSeq++,
        heroId: def.id,
        player,
        hp: Math.min(3, def.hp),  // 复活恢复至 3 点生命
        maxHp: def.hp,
        shield: 0,
        frozen: 0,
        swords: rec.swords || 0,          // 保留携带剑数
        usesLeft: rec.usesLeft || 0,      // 不重置技能次数
        statuses: {},
        lockUsed: !!rec.lockUsed,         // 锁血状态保留（每局一次）
        sdStage: 0,
        dragonMoves: 0,
        empowerTurns: 0,
        chaseStage: 0,
        chaseMark: 0,
      };
      graveyard = graveyard.filter((g) => g !== rec);
      fx.push({ r: tr, c: tc, text: "复活", kind: "heal" });
      addLog("💫 玩家" + player + " 使用【还魂令】：" + def.name + " 在 (" + (tr + 1) + "," + (tc + 1) + ") 复活，恢复至 3 点生命（技能剩余 " + (rec.usesLeft || 0) + " 次，携带剑 " + (rec.swords || 0) + "）。");
      break;
    }
    default:
      ok = false;
  }
  if (!ok) { render(); return false; }            // 非法：不消耗锦囊
  if (window.SFX) window.SFX.play("skill", { sfx: "holy" });
  talismanUsed[player] = true;                     // 使用后消耗
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
    if (isGrabbed(clicked)) {
      addLog(label(clicked) + " 处于【抓取】状态，本回合无法行动。");
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
/* 龙胆（主动）：点击按钮进入额外移动选格；再次点击取消 */
function activateDragonMove(u) {
  if (!u || u.sword) return;
  if (dragonMoveUnit === u) { // 取消
    dragonMoveUnit = null;
    dragonMoveTargets = [];
    clearSelection();
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
  if (window.SFX) window.SFX.play("swordPickup", { sfx: sfxOf(u) });
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
  return pick;
}

function onCellClick(r, c) {
  // 龙胆额外移动优先处理（即使当前是对方回合也可用）
  if (dragonMoveUnit) {
    performDragonMove(r, c);
    return;
  }
  const cu0 = isUnit(board[r][c]) ? board[r][c] : null;
  if (
    cu0 && cu0.heroId === "longren" && (cu0.dragonMoves || 0) > 0 &&
    canControlForDragonMove(cu0) &&
    (cu0.player !== currentPlayer || turnActionUsed)
  ) {
    selectDragonMove(cu0, r, c);
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
  return el;
}

function buildSwordObj() {
  const el = document.createElement("div");
  el.className = "sword-obj";
  el.title = "地上的剑刃（阿修罗踩上可回收）";
  el.textContent = "🗡";
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

      if (phase === "placement" && territoryOf(c) === currentPlayer && !board[r][c]) {
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
      if (isSword(u)) {
        cell.classList.add("sword-cell");
        cell.appendChild(buildSwordObj());
      } else if (u) {
        if (phase === "battle" && u.player === currentPlayer && u.frozen <= 0) {
          cell.classList.add("selectable");
        }
        const d = info.get(u.uid);
        if (d && d.flanked) cell.classList.add("flanked");
        else if (d && d.base && d.protected) cell.classList.add("protected-unit");
        if (hasSuperArmor(u)) cell.classList.add("superarmor");
        if (u.chaseMark) cell.classList.add("chase-marked");

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
}

function updateRoster() {
  if (phase !== "placement") {
    heroRosterEl.classList.add("hidden");
    return;
  }
  heroRosterEl.classList.remove("hidden");
  rosterListEl.innerHTML = "";
  const used = placedIds[currentPlayer];
  for (const h of HEROES) {
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
      const sl = skillUsesLeft(u, i);
      if (!isSd2 && !isChase2 && sl !== Infinity && sl <= 0) {
        disabled = true;
        label += " 已用尽";
      } else if (!canPaySwords(u, s)) {
        disabled = true;
        label += " 无剑可用";
      } else {
        if (s.type === "shuidiao") label += (u.sdStage || 0) === 1 ? "·第二段待释放" : "·第一段";
        if (s.type === "duanlang") label += "·前进1格+九宫格";
        if (s.type === "chase") {
          // 追猎状态：可用 / 选择方向 / 选择标记目标 / 选择闪身位置
          let st;
          if (isChase2) st = (skillSub && skillSub.kind === "chase-blink") ? "选择闪身位置" : "选择标记目标";
          else st = (skillMode && activeSkillIdx === i) ? "选择方向" : "可用";
          label += "·" + st + (isChase2 ? "（不耗行动）" : "");
        }
        if (!isChase2 && sl !== Infinity) label += "（剩 " + sl + "）";
        if (skillMode && activeSkillIdx === i) {
          label = (skillSub && skillSub.kind === "chase-blink" ? "✖ 取消选点 " : "✖ 取消 ") + label;
        }
      }
    }
    b.disabled = disabled;
    b.textContent = label;
    if (skillMode && activeSkillIdx === i) b.classList.add("active");
    b.addEventListener("click", () => activateSkill(i));
    skillBarEl.appendChild(b);
  });

  // 龙人·龙胆：主动「额外移动」按钮（消耗由龙魂成功闪避积累的次数）
  if (u.heroId === "longren") {
    const b = document.createElement("button");
    b.className = "skill-btn dragon-btn";
    const dm = u.dragonMoves || 0;
    b.disabled = dm <= 0;
    b.textContent = dragonMoveUnit === u
      ? "✖ 取消 【龙胆】选择移动方向"
      : "【龙胆】额外移动 ×" + dm + (dm > 0 ? "" : "（无次数）");
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
  if (flankImmune(u)) st.push("免疫夹击加成");
  if (u.frozen > 0) st.push("冰封：跳过 " + u.frozen + " 个回合");
  if (u.statuses) for (const k of Object.keys(u.statuses)) st.push((u.statuses[k].label || k) + "（剩 " + (u.statuses[k].turns != null ? u.statuses[k].turns : 1) + "）");
  dcStatusEl.textContent = st.length ? "当前状态：" + st.join(" · ") : "当前状态：无";
}

function updateTalismanUI() {
  if (!talismanCardEl) return;
  const id = talisman[currentPlayer];
  const t = id ? getTalismanById(id) : null;
  const isAI = gameMode === "ai" && currentPlayer === aiPlayer;
  tzIconEl.textContent = t ? t.icon : "🎴";
  tzNameEl.textContent = t ? t.name : "（无）";
  tzDescEl.textContent = t ? t.desc : "本局没有锦囊。";
  const used = talismanUsed[currentPlayer];
  talismanCardEl.classList.toggle("used", used);
  talismanCardEl.classList.toggle("active", talismanMode === id && !used);
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
    const side = currentPlayer === 1 ? "左" : "右";
    turnHintEl.textContent = "请在" + side + "侧放置英雄（还剩 " + toPlace + " 名）";
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
  const mustAct = phase === "battle" && turnActionsLeft === turnActionsMax && hasAnyAction(currentPlayer);
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
    overlayTitleEl.textContent = "玩家 " + winner + " 获胜！";
    overlayTitleEl.style.color = winner === 1 ? "var(--p1)" : "var(--p2)";
    overlaySubEl.textContent = "剩余英雄 " + aliveCount(winner) + " 名";
    overlayEl.classList.remove("hidden");
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
  if (!window.SFX) return;
  const st = SFX.getSettings();
  const cb = document.getElementById("set-sfx");
  const vol = document.getElementById("set-vol");
  if (cb) cb.checked = st.enabled;
  if (vol) vol.value = Math.round(st.volume * 100);
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
      if (u && !u.sword && u.player !== player) best = Math.min(best, Math.abs(rr - r) + Math.abs(cc - c));
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
    if (t && !t.sword && t.player !== player) enemy++;
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
    if (isGrabbed(u)) continue; // 被抓取：本回合无法行动
    if (turnActorUid && u.uid !== turnActorUid) continue; // 强化回合：只能由同一英雄行动
    const pos = findPos(u);
    if (!pos) continue;

    // 普通攻击（本回合若已行动则不可）
    if (!turnActionUsed) {
      for (const [dr, dc] of DIRS) {
        const t = unitAt(pos.r + dr, pos.c + dc);
        if (t && !t.sword && t.player !== u.player) {
          const res = resolveNormalAttack(u, t);
          const kill = t.hp <= res.damage;
          acts.push({
            type: "attack", u, pos, target: { r: pos.r + dr, c: pos.c + dc },
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
              if (e && !e.sword && e.player !== u.player) sc += w.dmgW * s.damage + (e.hp <= s.damage ? w.killW : 0) + 6;
            }
            const tgt = line.path[line.path.length - 1];
            acts.push({ type: "skill", u, pos, target: { r: tgt[0], c: tgt[1] }, skillIdx: si, score: (sc > 0 ? sc : 1) * w.skillW });
          }
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

    // 移动（本回合若已行动则不可；行军令的额外移动次数可用）
    if (!turnActionUsed || extraMoves > 0) {
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
    skillSub = null;
    computeSkillTargets();
    useSkill(act.target.r, act.target.c);
    // 刺客·追猎第二段：第 2 步选择闪身落点
    if (act.landing) useSkill(act.landing.r, act.landing.c);
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
  return gameMode === "online" && window.NET && window.NET.myPlayer && currentPlayer !== window.NET.myPlayer;
}
/* 用服务器权威状态替换本地棋盘 */
function applyRemoteState(state) {
  if (!state) return;
  board = state.board.map((row) => row.map((cell) => (cell ? Object.assign({}, cell) : null)));
  phase = state.phase;
  currentPlayer = state.currentPlayer;
  winner = state.winner || 0;
  unitSeq = state.unitSeq || unitSeq;
  if (state.toPlace != null) toPlace = state.toPlace;
  if (state.placed) placedIds = { 1: state.placed[1].slice(), 2: state.placed[2].slice() };
  // 锦囊状态同步
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
  if (phase === "placement") pendingHero = firstAvailableHero(currentPlayer); // 布阵时自动选下一个可用英雄
  if (gameMode !== "online") { gameMode = "online"; updateModeBadge(); }
  clearSelection();
  render();
}
window.onNetState = applyRemoteState;
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

/* 设置：音效开关 / 音量（自动保存到 localStorage） */
document.getElementById("set-sfx").addEventListener("change", (e) => {
  if (window.SFX) SFX.setEnabled(e.target.checked);
});
document.getElementById("set-vol").addEventListener("input", (e) => {
  const v = parseInt(e.target.value, 10) / 100;
  if (window.SFX) {
    SFX.setVolume(v);
    if (!SFX.isEnabled()) SFX.setEnabled(true);
  }
  const cb = document.getElementById("set-sfx");
  if (cb) cb.checked = true;
});
document.getElementById("set-sfx-test").addEventListener("click", () => {
  if (!window.SFX) return;
  SFX.unlock();
  SFX.play("attack", { sfx: "sword" });
  setTimeout(() => SFX.play("hit", { sfx: "blade" }), 90);
});

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
    fx = [];
    turnActionUsed = false;
    talismanMode = null;
    talismanTargets = [];
    talismanBuff = { assaultPlayer: 0, guardPlayer: 0 };
    extraMoves = 0;
    graveyard = [];
    reviveOptions = [];
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
