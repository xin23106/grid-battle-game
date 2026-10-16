/* =========================================================================
 * server/rules.js —— 服务器端权威规则引擎
 * -------------------------------------------------------------------------
 * 服务器用它与前端【同一套规则】校验并执行行动，客户端不能直接提交结果。
 * 覆盖：移动、普通攻击与夹击、队友保护、技能、阿修罗·剑圣突进、锻剑、胜负。
 * ========================================================================= */
const HEROES = require("./heroes");
const TALISMANS = require("./talismans");

const SIZE = 6, SIDE_COLS = 3, PER_PLAYER = 3, BASE_ATTACK = 1;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const inB = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const heroDef = (id) => HEROES.find((h) => h.id === id) || null;
const talDef = (id) => TALISMANS.find((t) => t.id === id) || null;
const drawTalismanId = () => TALISMANS[Math.floor(Math.random() * TALISMANS.length)].id;
/* 英雄全部技能（含 extraSkills） */
function heroSkills(def) {
  if (!def) return [];
  return [def.skill, ...(def.extraSkills || [])].filter(Boolean);
}
/* 多技能：每个技能各自的剩余次数（uses==null 用 9999 表示无限） */
function skillUsesLeft(s, u, idx) {
  const skills = heroSkills(heroDef(u.heroId));
  const sk = skills[idx];
  if (!sk || sk.uses == null) return 9999;
  if (skills.length === 1) return u.usesLeft;
  return u.usesArr && u.usesArr[idx] != null ? u.usesArr[idx] : sk.uses;
}
function setSkillUses(s, u, idx, v) {
  const skills = heroSkills(heroDef(u.heroId));
  if (skills.length === 1) { u.usesLeft = v; return; }
  u.usesArr = u.usesArr || [];
  u.usesArr[idx] = v;
  if (idx === 0) u.usesLeft = v; // 兼容：主技能次数镜像
}
/* 被抓取：不能做任何动作 */
function isGrabbed(u) {
  return !!(u && u.statuses && u.statuses.grab && u.statuses.grab.turns > 0);
}
/* 雷电之主：本方的强化英雄 */
function empoweredActorFor(s, player) {
  for (const u of unitsOf(s, player)) {
    if (u.heroId === "thunder" && (u.empowerTurns || 0) > 0) return u;
  }
  return null;
}
/* 本回合该单位是否还能行动（强化回合限定同一英雄） */
function canActNow(s, u) {
  if (s.turnActionUsed) return false;
  if (s.turnActionsLeft < s.turnActionsMax && s.turnActorUid && u && u.uid !== s.turnActorUid) return false;
  return true;
}
/* 雷电之主：随机击退到四周一个合法格 */
function randomKnockback(s, t) {
  const p = findPos(s, t);
  if (!p) return null;
  const opts = [];
  for (const [dr, dc] of DIRS) {
    const nr = p.r + dr, nc = p.c + dc;
    if (!inB(nr, nc) || s.board[nr][nc]) continue;
    opts.push({ r: nr, c: nc });
  }
  if (!opts.length) return null;
  const pick = opts[Math.floor(Math.random() * opts.length)];
  s.board[pick.r][pick.c] = t;
  s.board[p.r][p.c] = null;
  return pick;
}
/* 孤胆 / 霸体 / 伤害加成 */
function alliesIn3x3(s, u) {
  const p = findPos(s, u);
  if (!p) return 0;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const v = inB(p.r + dr, p.c + dc) ? s.board[p.r + dr][p.c + dc] : null;
    if (v && !v.sword && v.player === u.player) n++;
  }
  return n;
}
const isLoneActive = (s, u) => !!(u && !u.sword && u.heroId === "lone" && alliesIn3x3(s, u) === 0);
const hasSuperArmor = (s, u) => isLoneActive(s, u);
const attackerBonus = (s, u) => (s.assaultPlayer === u.player ? 1 : 0) + (isLoneActive(s, u) ? 1 : 0);
/* 负面状态：伤害先结算，负面效果受霸体免疫 */
function applyNegativeStatus(s, target, kind, opts) {
  opts = opts || {};
  let dmg = 0;
  if (opts.damage) dmg = applyDamage(s, target, opts.damage);
  if (!findPos(s, target)) return { applied: false, immune: false, damage: dmg, dead: true };
  if (hasSuperArmor(s, target)) {
    slog(s, "🛡 霸体：" + uname(s, target) + " 抵抗了【" + (opts.label || kind) + "】");
    return { applied: false, immune: true, damage: dmg };
  }
  target.statuses = target.statuses || {};
  target.statuses[kind] = Object.assign({ kind, label: opts.label || kind }, opts);
  slog(s, "⛓ " + uname(s, target) + " 被施加【" + (opts.label || kind) + "】（" + (opts.turns != null ? opts.turns : 1) + " 回合内无法行动）");
  return { applied: true, immune: false, damage: dmg };
}
function tickStatuses(s, player) {
  for (const u of unitsOf(s, player)) {
    if (!u.statuses) continue;
    for (const k of Object.keys(u.statuses)) {
      const st = u.statuses[k];
      if (st.turns == null) continue;
      st.turns -= 1;
      if (st.turns <= 0) {
        if (st.endDamage) applyDamage(s, u, st.endDamage);
        delete u.statuses[k];
      }
    }
  }
}
const isSword = (cell) => !!cell && cell.sword === true;
const isUnit = (cell) => !!cell && !cell.sword;

/* 联机随机选将：双方各抽 3 名不重复英雄（英雄足够时双方池不重复） */
function drawPools() {
  const ids = HEROES.map((h) => h.id);
  const shuffled = ids.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }
  const pool1 = shuffled.slice(0, PER_PLAYER);
  const pool2 = shuffled.slice(PER_PLAYER, PER_PLAYER * 2);
  // 英雄总数不足时允许跨玩家重复，但各自池内仍不重复
  while (pool2.length < PER_PLAYER && shuffled.length) pool2.push(shuffled[pool2.length % shuffled.length]);
  return { 1: pool1, 2: pool2 };
}
/* 对战日志：由权威服务端在事件成功结算后写入；每条带唯一 id，供客户端去重 */
function slog(s, text) {
  if (!s.log) { s.log = []; s.logSeq = 0; }
  s.logSeq = (s.logSeq || 0) + 1;
  s.log.push({ id: s.logSeq, text });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  return s.logSeq;
}
function uname(s, u) {
  if (!u) return "？";
  const d = heroDef(u.heroId);
  return "玩家" + u.player + "·" + ((d && d.name) || u.heroId);
}
function createState() {
  const board = [];
  for (let r = 0; r < SIZE; r++) board.push(new Array(SIZE).fill(null));
  return { board, phase: "placement", currentPlayer: 1, winner: 0, unitSeq: 1,
           toPlace: PER_PLAYER, placed: { 1: [], 2: [] }, pools: drawPools(), turnActionUsed: false,
           turnActionsMax: 1, turnActionsLeft: 1, turnActorUid: 0, empowerTurnActive: false,
           talisman: { 1: drawTalismanId(), 2: drawTalismanId() }, talismanUsed: { 1: false, 2: false },
           assaultPlayer: 0, guardPlayer: 0, extraMoves: 0, extraTurnPending: false, graveyard: [],
           log: [], logSeq: 0 };
}
const clone = (s) => JSON.parse(JSON.stringify(s));
const findPos = (s, u) => {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (s.board[r][c] === u) return { r, c };
  return null;
};
const unitsOf = (s, p) => {
  const list = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (u && !u.sword && u.player === p) list.push(u);
  }
  return list;
};
function hasAsuraAlive(s) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (u && !u.sword && u.heroId === "asura") return true;
  }
  return false;
}
function flankCountAt(s, r, c) {
  const u = s.board[r][c];
  if (!u || u.sword) return { enemy: 0, wall: 0, total: 0 };
  let enemy = 0, wall = 0;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (!inB(nr, nc)) { wall++; continue; }
    const t = s.board[nr][nc];
    if (t && !t.sword && t.player !== u.player) enemy++;
  }
  return { enemy, wall, total: enemy + wall };
}
/* 夹击信息：Map<uid, {base, protected, flanked, bonus, count}> */
function flankInfo(s) {
  const info = new Map();
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (!u || u.sword) continue;
    const fc = flankCountAt(s, r, c);
    info.set(u.uid, { count: fc.total, base: fc.enemy >= 1 && fc.total >= 2, protected: false, flanked: false, bonus: 0 });
  }
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (!u || u.sword) continue;
    const d = info.get(u.uid);
    if (!d.base) continue;
    for (const [dr, dc] of DIRS) {
      const v = inB(r + dr, c + dc) ? s.board[r + dr][c + dc] : null;
      if (v && !v.sword && v.player === u.player && !info.get(v.uid).base) { d.protected = true; break; }
    }
  }
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (!u || u.sword) continue;
    const d = info.get(u.uid);
    if (!d) continue;
    d.immune = isLoneActive(s, u);                       // 孤胆侠·孤胆激活 → 免疫夹击加成
    d.flanked = d.base && !d.protected && !d.immune;
    d.bonus = d.flanked ? d.count - 1 : 0;
  }
  return info;
}
/* 刺客·暗杀：刺客是否参与针对 target 的夹击（攻击者是刺客，或目标相邻有同为攻击方阵营的刺客） */
function assassinInFlank(s, attacker, target) {
  if (!attacker || attacker.sword) return false;
  const p = findPos(s, target);
  if (!p) return false;
  for (const [dr, dc] of DIRS) {
    const v = inB(p.r + dr, p.c + dc) ? s.board[p.r + dr][p.c + dc] : null;
    if (v && !v.sword && v.player === attacker.player && v.heroId === "assassin") return true;
  }
  return false;
}
/* 西楚霸王·鬼雄是否已触发（绝境：普通攻击 +1） */
function isGuixiongActive(s, u) {
  return !!(u && !u.sword && u.heroId === "xiangyu" && u.guixiongUsed);
}
function normalDamage(s, attacker, target) {
  const d = flankInfo(s).get(target.uid);
  const assassin = d && d.flanked && assassinInFlank(s, attacker, target) ? 1 : 0;
  const guixiong = isGuixiongActive(s, attacker) ? 1 : 0; // 绝境：普攻 +1
  return BASE_ATTACK + (d ? d.bonus : 0) + assassin + guixiong + attackerBonus(s, attacker);
}
/* 鬼雄触发时的九宫格反击：对周围 8 格内敌人各 2 点（走统一结算） */
function guixiongCounter(s, u) {
  const p = findPos(s, u);
  if (!p) return 0;
  const victims = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const t = inB(p.r + dr, p.c + dc) ? s.board[p.r + dr][p.c + dc] : null;
      if (isUnit(t) && t.player !== u.player) victims.push(t);
    }
  }
  let hit = 0;
  for (const t of victims) {
    if (!findPos(s, t)) continue;
    applyDamage(s, t, 2, u);
    hit++;
  }
  return hit;
}
/* ---------------- 刺客·追猎 ---------------- */
function computeChaseLine(s, u, r, c, dr, dc) {
  const path = [];
  const hits = [];
  let rr = r + dr, cc = c + dc;
  while (inB(rr, cc)) {
    path.push([rr, cc]);
    const cell = s.board[rr][cc];
    if (cell && !cell.sword && cell.player !== u.player) hits.push({ r: rr, c: cc });
    rr += dr; cc += dc;
  }
  return { dir: [dr, dc], path, hits };
}
function chaseTargetsOf(s, a) {
  if (!a || a.sword) return [];
  const out = [];
  for (const v of unitsOf(s, a.player === 1 ? 2 : 1)) if (v.chaseMark === a.uid) out.push(v);
  return out;
}
function clearChaseMarks(s, uid) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const v = s.board[r][c];
    if (v && !v.sword && v.chaseMark === uid) v.chaseMark = 0;
  }
}
function endChase(s, a) {
  if (!a) return;
  clearChaseMarks(s, a.uid);
  a.chaseStage = 0;
}
/* 单位击杀任意敌人 → 刷新其标记了 refreshOnKill 的技能（刺客·追猎 / 吸血鬼·血崩）。
 * 同一次击杀只刷新一次（技能次数已满时不再重复触发）。返回是否真的刷新。 */
function refreshSkillOnKill(s, a) {
  if (!a || a.sword) return false;
  const skills = heroSkills(heroDef(a.heroId));
  let refreshed = false;
  for (let i = 0; i < skills.length; i++) {
    const skk = skills[i];
    if (!skk || !skk.refreshOnKill) continue;
    const max = skk.uses == null ? Infinity : skk.uses;
    const cur = skillUsesLeft(s, a, i);
    if (cur === Infinity || cur >= max) continue; // 已满 → 不重复触发刷新事件
    setSkillUses(s, a, i, max);
    refreshed = true;
  }
  if (refreshed) s.chaseRefreshSeq = (s.chaseRefreshSeq || 0) + 1; // 供“先结算后扣次数”的流程校正
  return refreshed;
}
/* 兼容旧名（刺客·追猎） */
function refreshChase(s, a) { return refreshSkillOnKill(s, a); }
function chaseBlinkCells(s, tr, tc) {
  const out = [];
  for (const [dr, dc] of DIRS) {
    const nr = tr + dr, nc = tc + dc;
    if (!inB(nr, nc)) continue;
    if (s.board[nr][nc]) continue;
    out.push([nr, nc]);
  }
  return out;
}
/* 「不耗步」判定（含英雄上下文）：追猎第二段不消耗行动机会，第一段正常消耗 */
function skillFreeForS(u, sk) {
  if (!sk) return false;
  if (sk.type === "chase") return !!(u && (u.chaseStage || 0) === 1);
  return isFreeSkillS(sk);
}
function spawnSword(s, r, c) {
  if (!hasAsuraAlive(s) || !inB(r, c) || s.board[r][c]) return false;
  s.board[r][c] = { sword: true, uid: s.unitSeq++ };
  return true;
}
function applyDamage(s, target, amount, source) {
  const pos = findPos(s, target);
  let dmg = amount;
  if (s.guardPlayer === target.player && dmg > 0) { const before = dmg; dmg = Math.max(0, dmg - 1); if (before > dmg) slog(s, "🛡 坚守令为 " + uname(s, target) + " 减免 1 点伤害"); }
  if (target.shield > 0) { const a = Math.min(target.shield, dmg); target.shield -= a; dmg -= a; if (a > 0) slog(s, uname(s, target) + " 的护盾抵挡了 " + a + " 点伤害"); }
  // 龙魂：龙人 1/2 概率闪避（护盾等前置处理之后、完全抵消则不触发）
  if (dmg > 0 && target.heroId === "longren" && Math.random() < 1 / 2) {
    dmg = 0;
    target.dragonMoves = (target.dragonMoves || 0) + 1;
    slog(s, "🐉 龙魂：" + uname(s, target) + " 闪避了本次伤害（并积累 1 次龙胆）");
  }
  // 孤胆侠·霸体：首次致命伤害锁血到 1
  if (dmg > 0 && target.hp - dmg <= 0 && target.heroId === "lone" && hasSuperArmor(s, target) && !target.lockUsed) {
    target.lockUsed = true;
    dmg = Math.max(0, target.hp - 1);
    slog(s, "🛡 霸体：" + uname(s, target) + " 抵挡致命伤害，生命锁定为 1（本局一次）");
  }
  // 西楚霸王·鬼雄：首次致命伤害锁血到 1（每局一次），随后反击九宫格并进入绝境
  let guixiongTriggered = false;
  if (dmg > 0 && target.hp - dmg <= 0 && target.heroId === "xiangyu" && !target.guixiongUsed) {
    target.guixiongUsed = true;
    guixiongTriggered = true;
    dmg = Math.max(0, target.hp - 1);
    slog(s, "👹 鬼雄：" + uname(s, target) + " 生命锁定为 1，并对九宫格内敌人反击 2 点");
  }
  if (dmg > 0) { target.hp -= dmg; slog(s, uname(s, target) + " 受到 " + dmg + " 点伤害（余 " + target.hp + "）"); }
  if (guixiongTriggered && findPos(s, target)) guixiongCounter(s, target);
  if (target.hp <= 0 && pos) {
    // 追猎标记清理：目标阵亡 → 清自身标记；刺客阵亡 → 清其遗留标记
    target.chaseMark = 0;
    if (target.heroId === "assassin") clearChaseMarks(s, target.uid);
    // 记录阵亡（供还魂令），先于清空棋盘 / 生成剑刃
    s.graveyard.push({ player: target.player, heroId: target.heroId, r: pos.r, c: pos.c, usesLeft: target.usesLeft || 0, swords: target.swords || 0, lockUsed: !!target.lockUsed, guixiongUsed: !!target.guixiongUsed });
    s.board[pos.r][pos.c] = null;
    slog(s, "☠ " + uname(s, target) + " 阵亡！");
    spawnSword(s, pos.r, pos.c);
    // 击杀刷新：刺客·追猎 / 吸血鬼·血崩（同一次击杀只刷新一次）
    if (source && !source.sword && source.player !== target.player && findPos(s, source)) {
      refreshSkillOnKill(s, source);
    }
  }
  return dmg;
}
/* 龙息区域：沿方向 2 格 × 垂直方向 3 格 */
function dragonBreathArea(u, r, c, dr, dc) {
  const out = [];
  for (let k = 1; k <= 2; k++) {
    for (const o of [-1, 0, 1]) {
      const rr = r + dr * k + (dr === 0 ? o : 0);
      const cc = c + dc * k + (dc === 0 ? o : 0);
      if (inB(rr, cc)) out.push([rr, cc]);
    }
  }
  return out;
}
/* ---------------- 玉皇大帝：紫薇神步 / 放逐 / 天威 ---------------- */
/* 某格九宫格（3×3）内的敌方英雄（不含剑刃/友军） */
function box3Enemies(s, r, c, player) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      const v = inB(rr, cc) ? s.board[rr][cc] : null;
      if (isUnit(v) && v.player !== player) out.push(v);
    }
  }
  return out;
}
/* 四个墙角及其 2×2 四宫格（含墙角格本身） */
const CORNERS = [
  { corner: { r: 0, c: 0 }, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { corner: { r: 0, c: 5 }, cells: [[0, 4], [0, 5], [1, 4], [1, 5]] },
  { corner: { r: 5, c: 0 }, cells: [[4, 0], [4, 1], [5, 0], [5, 1]] },
  { corner: { r: 5, c: 5 }, cells: [[4, 4], [4, 5], [5, 4], [5, 5]] },
];
/* 该墙角是否可用于放逐：四宫格内没有任何英雄，且墙角格本身为空 */
function cornerOk(s, cn) {
  if (!cn) return false;
  if (!cn.cells.every(([r, c]) => !isUnit(inB(r, c) ? s.board[r][c] : null))) return false;
  const cr = cn.corner.r, cc = cn.corner.c;
  return inB(cr, cc) && !s.board[cr][cc];
}
/* 将单位击飞出 (boxR,boxC) 九宫格：移到九宫格以外的最近合法空格；无解返回 null */
function knockOutBox3(s, v, boxR, boxC) {
  const p = findPos(s, v);
  if (!p) return null;
  const inBox = (r, c) => Math.abs(r - boxR) <= 1 && Math.abs(c - boxC) <= 1;
  const cand = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (inBox(r, c) || s.board[r][c]) continue;
      cand.push({ r, c, d: Math.abs(r - p.r) + Math.abs(c - p.c) });
    }
  }
  if (!cand.length) return null;
  cand.sort((A, B) => A.d - B.d || A.r - B.r || A.c - B.c);
  const dest = cand[0];
  s.board[dest.r][dest.c] = v;
  s.board[p.r][p.c] = null;
  return dest;
}
/* ---------------- 天道超：神罗天征 / 万象天引 ---------------- */
function sortUnitsByPosS(s, list) {
  return list.slice().sort((x, y) => {
    const px = findPos(s, x), py = findPos(s, y);
    if (!px) return 1;
    if (!py) return -1;
    return (px.r - py.r) || (px.c - py.c);
  });
}
/* 神罗天征：击退出 (boxR,boxC) 九宫格，优先远离 (fromR,fromC) */
function knockOutBoxAwayS(s, t, boxR, boxC, fromR, fromC) {
  const p = findPos(s, t);
  if (!p) return null;
  const inBox = (r, c) => Math.abs(r - boxR) <= 1 && Math.abs(c - boxC) <= 1;
  const ok = (r, c) => inB(r, c) && !s.board[r][c] && !inBox(r, c) && !(r === fromR && c === fromC);
  const dirs = [];
  const sx = p.r === fromR ? 0 : (p.r > fromR ? 1 : -1);
  const sy = p.c === fromC ? 0 : (p.c > fromC ? 1 : -1);
  if (sx || sy) dirs.push([sx, sy]);
  for (const d of DIRS) if (!dirs.some((q) => q[0] === d[0] && q[1] === d[1])) dirs.push(d);
  for (const d of dirs) {
    const nr = p.r + d[0], nc = p.c + d[1];
    if (!ok(nr, nc)) continue;
    s.board[nr][nc] = t; s.board[p.r][p.c] = null;
    return { r: nr, c: nc };
  }
  const far = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (ok(r, c)) far.push({ r, c, d: Math.abs(r - p.r) + Math.abs(c - p.c) });
  if (!far.length) return null;
  far.sort((A, B) => A.d - B.d || A.r - B.r || A.c - B.c);
  const dest = far[0];
  s.board[dest.r][dest.c] = t; s.board[p.r][p.c] = null;
  return dest;
}
/* 万象天引第三段：沿远离 (fromR,fromC) 的方向击退 1 格 */
function pushAwayOneS(s, t, fromR, fromC) {
  const p = findPos(s, t);
  if (!p) return null;
  const ok = (r, c) => inB(r, c) && !s.board[r][c] && !(r === fromR && c === fromC);
  const dirs = [];
  const sx = p.r === fromR ? 0 : (p.r > fromR ? 1 : -1);
  const sy = p.c === fromC ? 0 : (p.c > fromC ? 1 : -1);
  if (sx || sy) dirs.push([sx, sy]);
  for (const d of DIRS) if (!dirs.some((q) => q[0] === d[0] && q[1] === d[1])) dirs.push(d);
  for (const d of dirs) {
    const nr = p.r + d[0], nc = p.c + d[1];
    if (!ok(nr, nc)) continue;
    s.board[nr][nc] = t; s.board[p.r][p.c] = null;
    return { r: nr, c: nc };
  }
  return null;
}
/* 万象天引某阶段的合法目标格（stage 0=前方九宫格 / 1=龙息范围 / 2=普攻相邻） */
function wxtTargetsS(s, u, r, c, dr, dc, stage, player) {
  const out = [];
  if (stage === 2) {
    for (const d of DIRS) {
      const t = inB(r + d[0], c + d[1]) ? s.board[r + d[0]][c + d[1]] : null;
      if (isUnit(t) && t.player !== player) out.push([r + d[0], c + d[1]]);
    }
    return out;
  }
  if (stage === 0) {
    const cr = r + dr, cc = c + dc;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t = inB(cr + i, cc + j) ? s.board[cr + i][cc + j] : null;
      if (isUnit(t) && t.player !== player) out.push([cr + i, cc + j]);
    }
    return out;
  }
  for (const [rr, cc] of dragonBreathArea(u, r, c, dr, dc)) {
    const t = inB(rr, cc) ? s.board[rr][cc] : null;
    if (isUnit(t) && t.player !== player) out.push([rr, cc]);
  }
  return out;
}
function computeDash(s, u, r, c, dr, dc, maxSteps) {  const steps = maxSteps || 3;
  const hits = []; let dest = null;
  for (let k = 1; k <= steps; k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inB(rr, cc)) break;
    const cell = s.board[rr][cc];
    if (!cell) { dest = { r: rr, c: cc }; continue; }
    if (cell.sword) { dest = { r: rr, c: cc }; continue; }
    if (cell.player === u.player) continue; // 统一突进：友军可穿过，不挡不伤
    hits.push({ r: rr, c: cc });
  }
  return { dir: [dr, dc], dest, hits };
}
function beginTurn(s) {
  for (const u of unitsOf(s, s.currentPlayer)) {
    heroSkills(heroDef(u.heroId)).forEach((sk, i) => {
      if (sk && sk.perTurn) setSkillUses(s, u, i, sk.perTurn);
    });
  }
  s.turnActionUsed = false;
  s.extraMoves = 0;
  // 雷电之主：强化回合 → 2 次行动（仅限该英雄）
  const emp = empoweredActorFor(s, s.currentPlayer);
  s.empowerTurnActive = !!emp;
  const tsk = heroDef("thunder").skill;
  s.turnActionsMax = emp ? ((tsk && tsk.empowerActions) || 2) : 1;
  s.turnActionsLeft = s.turnActionsMax;
  s.turnActorUid = emp ? emp.uid : 0;
  if (s.assaultPlayer && s.assaultPlayer !== s.currentPlayer) s.assaultPlayer = 0;
  if (s.guardPlayer === s.currentPlayer) s.guardPlayer = 0;
  if (s.phase === "battle") slog(s, "—— 轮到 玩家" + s.currentPlayer + " ——");
}
/* 「不耗步」技能：perTurn / free / dash 不占用行动机会 */
function isFreeSkillS(sk) {
  return !!(sk && (sk.perTurn || sk.free || sk.type === "dash"));
}
/* 仅“每回合型”技能会让回合在行动后保持开放 */
function heroHasFreeUses(s, u) {
  const skills = heroSkills(heroDef(u.heroId));
  return skills.some((sk, i) => sk.perTurn && skillUsesLeft(s, u, i) > 0);
}
/* 是否还有可执行行动（用于“不能直接跳过回合”与“无行动自动跳过”）
 * 被抓取 / 冰封的单位不能行动，因此不计入 */
function hasAnyActionState(s, player) {
  for (const u of unitsOf(s, player)) {
    if (u.frozen > 0) continue;
    if (isGrabbed(u)) continue; // 抓取：本回合无法移动/攻击/用技能
    const pos = findPos(s, u);
    if (!pos) continue;
    const sk = heroDef(u.heroId).skill;
    if (!s.turnActionUsed && sk && u.usesLeft > 0) return true;
    for (const [dr, dc] of DIRS) {
      const nr = pos.r + dr, nc = pos.c + dc;
      if (!inB(nr, nc)) continue;
      const t = s.board[nr][nc];
      if (!t) { if (!s.turnActionUsed) return true; continue; }
      if (isSword(t)) { if (u.heroId === "asura" && !s.turnActionUsed) return true; continue; }
      if (isUnit(t) && t.player !== player && !s.turnActionUsed) return true;
    }
    if (heroHasFreeUses(s, u)) return true;
  }
  return false;
}
/* 行动收尾：不自动结束回合。
 * 行动完成后仍停留在当前回合，玩家可继续使用锦囊 / 不耗步技能 / 行军令额外移动，
 * 最后手动提交 {type:"end"} 结束回合（仍禁止尚未行动就直接跳过）。 */
function finish(s, u, isFree, keepOpen) {
  if (checkVictory(s)) return;
  if (isFree) return; // 「不耗步」技能：不占行动机会、不结束回合
  s.turnActionsLeft -= 1;
  s.turnActionUsed = s.turnActionsLeft <= 0;
}
function endTurnOnce(s) {
  const ended = s.currentPlayer;
  for (const u of unitsOf(s, s.currentPlayer)) if (u.frozen > 0) u.frozen--;
  tickStatuses(s, s.currentPlayer);
  // 雷电之主：强化按自身回合递减，归零清除护盾
  if (s.empowerTurnActive) {
    for (const u of unitsOf(s, s.currentPlayer)) {
      if (u.heroId === "thunder" && (u.empowerTurns || 0) > 0) {
        u.empowerTurns -= 1;
        if (u.empowerTurns <= 0) u.shield = 0;
      }
    }
  }
  s.empowerTurnActive = false;
  // 行军令：若存在「额外回合」，则当前玩家再获得一个完整回合，结束后才交给对手
  const samePlayer = !!s.extraTurnPending;
  s.extraTurnPending = false;
  if (!samePlayer) s.currentPlayer = s.currentPlayer === 1 ? 2 : 1;
  slog(s, "玩家" + ended + " 结束回合");
  beginTurn(s);
}
/* 统一结束回合：结束当前玩家回合并交给对手；
 * 若接手的一方没有任何合法行动（全被冰封 / 被抓取等），自动继续推进（带上限防死循环）。 */
function endTurn(s) {
  endTurnOnce(s);
  settleStuckTurns(s);
}
function settleStuckTurns(s) {
  let guard = 0;
  while (guard++ < 4 && s.phase === "battle" && !hasAnyActionState(s, s.currentPlayer)) {
    slog(s, "⏭ 玩家" + s.currentPlayer + " 没有可执行的行动（被冰封/抓取等），自动结束回合");
    endTurnOnce(s);
  }
}
function checkVictory(s) {
  const p1 = unitsOf(s, 1).length, p2 = unitsOf(s, 2).length;
  if (p1 === 0 || p2 === 0) {
    s.phase = "over"; s.winner = p1 === 0 ? 2 : 1;
    slog(s, "🏆 玩家" + s.winner + " 获胜，对局结束！");
    return true;
  }
  return false;
}

/* ---------------- 行动校验与执行（服务器权威） ---------------- */
function applyAction(state, player, action) {
  const s = clone(state);
  const err = (m) => ({ ok: false, error: m, state });

  if (s.phase === "over") return err("对局已结束");

  // 龙胆：额外移动（即使不是自己的回合，只要该龙人有额外移动机会即可）
  if (action.type === "dragonmove") {
    const from = action.from || {};
    const u = inB(from.r, from.c) ? s.board[from.r][from.c] : null;
    if (!isUnit(u) || u.player !== player) return err("无效的单位");
    if (u.heroId !== "longren" || (u.dragonMoves || 0) <= 0) return err("没有额外移动机会");
    const { r, c } = action.to || {};
    if (!inB(r, c) || Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("只能额外移动一格");
    if (s.board[r][c]) return err("目标格被占用");
    s.board[r][c] = u; s.board[from.r][from.c] = null;
    u.dragonMoves -= 1;
    checkVictory(s);
    return { ok: true, state: s };
  }

  // 布阵阶段双方同时进行（隐藏式部署），因此不检查 currentPlayer
  if (player !== s.currentPlayer && s.phase !== "placement") return err("不是你的回合");

  if (s.phase === "placement") {
    if (action.type !== "place") return err("布阵阶段只能放置英雄");
    // 隐藏式部署：双方同时进行，因此不限制 currentPlayer，只校验半场与候选池
    const { r, c, heroId } = action;
    if (!inB(r, c) || (c < SIDE_COLS ? 1 : 2) !== player) return err("只能放在自己的半场");
    if (s.board[r][c]) return err("该格已被占用");
    if (s.placed[player].length >= PER_PLAYER) return err("你已经完成部署");
    if (s.pools && s.pools[player] && s.pools[player].indexOf(heroId) < 0) return err("该英雄不在你的候选池中（本局由服务器随机抽取）");
    if (s.placed[player].includes(heroId)) return err("同阵营不可重复英雄");
    const def = heroDef(heroId);
    if (!def) return err("未知英雄");
    s.board[r][c] = { uid: s.unitSeq++, heroId, player, hp: def.hp, maxHp: def.hp,
                      shield: 0, frozen: 0, swords: def.blades || 0,
                      usesLeft: def.skill.uses == null ? 9999 : def.skill.uses,
                      statuses: {}, lockUsed: false, sdStage: 0, dragonMoves: 0, empowerTurns: 0,
                      chaseStage: 0, chaseMark: 0, guixiongUsed: false, wxtStage: 0,
                      usesArr: heroSkills(def).map((sk) => (sk.uses == null ? 9999 : sk.uses)) };
    s.placed[player].push(heroId);
    s.toPlace = Math.max(0, PER_PLAYER - s.placed[player].length);
    slog(s, "玩家" + player + " 完成一次部署（" + s.placed[player].length + "/" + PER_PLAYER + "）");
    // 双方都完成部署后才正式开战
    if (s.placed[1].length >= PER_PLAYER && s.placed[2].length >= PER_PLAYER) {
      s.phase = "battle";
      s.currentPlayer = 1;
      beginTurn(s);
    }
    return { ok: true, state: s };
  }

  // 对战阶段
  const act = action.type;
  if (act === "end") {
    if (s.turnActionsLeft === s.turnActionsMax && hasAnyActionState(s, player)) return err("必须先行动，不能直接跳过回合");
    endTurn(s);
    return { ok: true, state: s };
  }

  if (act === "talisman") {
    if (s.talismanUsed[player] || !s.talisman[player]) return err("没有可用的锦囊");
    const t = talDef(s.talisman[player]);
    if (!t) return err("未知锦囊");
    const to = action.to || {};
    const hasTo = to.r != null && to.c != null;
    switch (t.effect) {
      case "assault": s.assaultPlayer = player; slog(s, "🔥 本回合玩家" + player + " 造成的伤害 +1"); break;
      case "march": s.extraTurnPending = true; slog(s, "🐎 玩家" + player + " 本回合结束后获得一个额外回合"); break;
      case "guard": s.guardPlayer = player; slog(s, "🛡 玩家" + player + " 的英雄在下个对手回合受到的伤害 -1"); break;
      case "refresh": {
        const u = hasTo && inB(to.r, to.c) ? s.board[to.r][to.c] : null;
        if (!isUnit(u) || u.player !== player) return err("请选择一名己方存活英雄");
        let n = 0;
        heroSkills(heroDef(u.heroId)).forEach((sk, i) => {
          if (!sk || sk.type === "passive" || sk.uses == null) return;
          const max = sk.perTurn ? sk.perTurn : sk.uses;
          if (skillUsesLeft(s, u, i) !== max) { setSkillUses(s, u, i, max); n++; }
        });
        if (n === 0) return err("该英雄没有可刷新的技能次数");
        slog(s, "♻️ 刷新了 " + uname(s, u) + " 的技能次数至上限");
        break;
      }
      case "heal": {
        const u = hasTo && inB(to.r, to.c) ? s.board[to.r][to.c] : null;
        if (!isUnit(u) || u.player !== player || u.hp >= u.maxHp) return err("目标不合法");
        const healed = Math.max(0, Math.min(t.heal || 2, u.maxHp - u.hp));
        u.hp += healed;
        slog(s, "➕ " + uname(s, u) + " 恢复 " + healed + " 点生命（余 " + u.hp + "）");
        break;
      }
      case "revive": {
        const idx = hasTo ? s.graveyard.findIndex((g) => g.player === player && g.r === to.r && g.c === to.c) : -1;
        if (idx < 0) return err("该位置没有可复活的己方英雄");
        if (!inB(to.r, to.c) || s.board[to.r][to.c]) return err("原位置已被占用，无法复活");
        const rec = s.graveyard[idx];
        const def = heroDef(rec.heroId);
        s.board[to.r][to.c] = { uid: s.unitSeq++, heroId: def.id, player, hp: Math.min(3, def.hp), maxHp: def.hp,
                                shield: 0, frozen: 0, swords: rec.swords || 0, usesLeft: rec.usesLeft || 0,
                                statuses: {}, lockUsed: !!rec.lockUsed, sdStage: 0, dragonMoves: 0, empowerTurns: 0, chaseStage: 0, chaseMark: 0, guixiongUsed: !!rec.guixiongUsed, wxtStage: 0 };
        s.graveyard.splice(idx, 1);
        slog(s, "💫 " + uname(s, s.board[to.r][to.c]) + " 在原位置复活（3 点生命）");
        break;
      }
      default: return err("未知锦囊");
    }
    s.talismanUsed[player] = true;
    // 锦囊成功使用：向双方公开“本次使用的具体名称”（未使用的锦囊与部署阶段仍保密）
    slog(s, "🎴 玩家" + player + " 使用了【" + t.name + "】");
    return { ok: true, state: s }; // 锦囊不结束回合，也不消耗行动
  }

  const from = action.from || {};
  const u = inB(from.r, from.c) ? s.board[from.r][from.c] : null;
  if (!isUnit(u) || u.player !== player) return err("无效的单位");
  if (u.frozen > 0) return err("该英雄被冰封");

  if (act === "move") {
    if (isGrabbed(u)) return err("该英雄处于【抓取】状态，无法行动");
    const isExtra = !canActNow(s, u);
    if (isExtra && (s.extraMoves || 0) <= 0) return err("本回合已经行动过了");
    const { r, c } = action.to || {};
    if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("只能移动一格");
    const t = inB(r, c) ? s.board[r][c] : null;
    if (isUnit(t)) return err("目标格被占用");
    if (isSword(t) && u.heroId !== "asura") return err("剑刃阻挡");
    if (isSword(t) && u.heroId === "asura") { u.swords = (u.swords || 0) + 1; }
    s.board[r][c] = u; s.board[from.r][from.c] = null;
    slog(s, uname(s, u) + (isExtra ? " 额外移动" : " 移动") + "到 (" + (r + 1) + "," + (c + 1) + ")");
    if (isExtra) {
      s.extraMoves -= 1; // 行军令额外移动：不消耗行动机会、不自动结束回合
      checkVictory(s);
      return { ok: true, state: s };
    }
    finish(s, u, false);
    return { ok: true, state: s };
  }

  if (act === "attack") {
    if (isGrabbed(u)) return err("该英雄处于【抓取】状态，无法行动");
    if (!canActNow(s, u)) return err("本回合已经行动过了");
    const { r, c } = action.to || {};
    const t = inB(r, c) ? s.board[r][c] : null;
    if (!isUnit(t) || t.player === player) return err("无效的攻击目标");
    if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("只能攻击相邻目标");
    const fi = flankInfo(s).get(t.uid);
    slog(s, uname(s, u) + " 攻击 " + uname(s, t) + (fi && fi.flanked ? "（触发夹击×" + fi.count + "）" : ""));
    applyDamage(s, t, normalDamage(s, u, t), u);
    finish(s, u, false);
    return { ok: true, state: s };
  }

  if (act === "skill") {
    if (isGrabbed(u)) return err("该英雄处于【抓取】状态，无法行动");
    const idx = action.idx || 0;
    const sk = heroSkills(heroDef(u.heroId))[idx] || heroDef(u.heroId).skill;
    if (!sk) return err("未知技能");
    // 追猎：第二段待释放但已无有效标记目标 → 结束连招，回到第一段
    if (sk.type === "chase" && (u.chaseStage || 0) === 1 && chaseTargetsOf(s, u).length === 0) endChase(s, u);
    const isSd2 = sk.type === "shuidiao" && (u.sdStage || 0) === 1; // 第二段同属一套，不额外占次数
    const isChase2 = sk.type === "chase" && (u.chaseStage || 0) === 1; // 追猎第二段不额外占次数
    const isWxtCombo = sk.type === "wxt" && (u.wxtStage || 0) >= 1; // 万象天引第二/三段不重复占整套次数
    if (!isSd2 && !isChase2 && !isWxtCombo && skillUsesLeft(s, u, idx) <= 0) return err("技能次数不足");
    if (sk.costSwords && (u.swords || 0) < sk.costSwords) return err("没有剑，无法发动剑圣");
    if (!skillFreeForS(u, sk) && !canActNow(s, u)) return err("本回合已经行动过了");
    slog(s, uname(s, u) + " 释放【" + sk.name + "】");
    const freeAction = skillFreeForS(u, sk); // 结算前判定：追猎会改动 chaseStage，放到最后会翻转结果
    let consumedHere = false; // 追猎第一段在分支内「先扣次数再结算」
    const { r, c } = action.to || {};
    const t = inB(r, c) ? s.board[r][c] : null;
    const dist = Math.abs(r - from.r) + Math.abs(c - from.c);
    const av = attackerBonus(s, u); // 猛攻令 / 孤胆：技能伤害 +1

    if (sk.type === "damage_single") {
      if (!isUnit(t) || t.player === player || dist > sk.range) return err("技能目标不合法");
      applyDamage(s, t, sk.damage + av);
    } else if (sk.type === "freeze") {
      if (!isUnit(t) || t.player === player || dist > sk.range) return err("技能目标不合法");
      applyDamage(s, t, sk.damage + av, u);
      // 孤胆侠·霸体：抵抗冰封（伤害仍已正常结算）
      if (findPos(s, t) && !hasSuperArmor(s, t)) t.frozen = Math.max(t.frozen, sk.freeze || 1);
    } else if (sk.type === "heal") {
      if (!isUnit(t) || t.player !== player || dist > sk.range || t.hp >= t.maxHp) return err("治疗目标不合法");
      t.hp += Math.max(0, Math.min(sk.heal, t.maxHp - t.hp));
    } else if (sk.type === "damage_adjacent_all") {
      let any = false;
      for (const [dr, dc] of DIRS) {
        const e = inB(from.r + dr, from.c + dc) ? s.board[from.r + dr][from.c + dc] : null;
        if (isUnit(e) && e.player !== player) { applyDamage(s, e, sk.damage + av); any = true; }
      }
      if (!any) return err("相邻没有敌人");
    } else if (sk.type === "damage_line") {
      let found = false;
      for (const [dr, dc] of DIRS) {
        for (let st = 1; st <= sk.range; st++) {
          const rr = from.r + dr * st, cc = from.c + dc * st;
          if (!inB(rr, cc)) break;
          const e = s.board[rr][cc];
          if (e) { if (isUnit(e) && e.player !== player && rr === r && cc === c) found = true; break; }
        }
      }
      if (!found) return err("射线目标不合法");
      applyDamage(s, t, sk.damage + av);
    } else if (sk.type === "shield_self") {
      u.shield += sk.shield;
    } else if (sk.type === "blink") {
      if (!inB(r, c) || s.board[r][c] || dist > sk.range || dist === 0) return err("瞬移目标不合法");
      s.board[r][c] = u; s.board[from.r][from.c] = null;
    } else if (sk.type === "dash") {
      const opt = DIRS.map(([dr, dc]) => computeDash(s, u, from.r, from.c, dr, dc))
                      .find((o) => o.dest && o.dest.r === r && o.dest.c === c);
      if (!opt) return err("突进方向不合法");
      for (const h of opt.hits) {
        const e = s.board[h.r][h.c];
        if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av);
      }
      const d = Math.abs(opt.dest.r - from.r) + Math.abs(opt.dest.c - from.c);
      for (let k = 1; k <= d; k++) {
        const rr = from.r + opt.dir[0] * k, cc = from.c + opt.dir[1] * k;
        if (isSword(s.board[rr][cc])) { u.swords = (u.swords || 0) + 1; s.board[rr][cc] = null; }
      }
      s.board[opt.dest.r][opt.dest.c] = u; s.board[from.r][from.c] = null;
    } else if (sk.type === "duanlang") {
      if (dist !== 1 || !inB(r, c)) return err("断浪只能前进一格");
      if (t) return err("目标格被占用");
      s.board[r][c] = u; s.board[from.r][from.c] = null;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const e = inB(r + dr, c + dc) ? s.board[r + dr][c + dc] : null;
        if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av);
      }
    } else if (sk.type === "shuidiao") {
      const findOpt = (steps, base) => DIRS.map(([dr, dc]) => computeDash(s, u, base.r, base.c, dr, dc, steps))
        .find((o) => (o.dest && o.dest.r === r && o.dest.c === c) || (o.hits[0] && o.hits[0].r === r && o.hits[0].c === c));
      if ((u.sdStage || 0) === 1) {
        const opt = findOpt(2, { r: from.r, c: from.c });
        if (!opt) return err("突进方向不合法");
        let grabbed = null;
        for (const h of opt.hits) { const e = s.board[h.r][h.c]; if (isUnit(e) && e.player !== player) { grabbed = e; break; } }
        if (opt.dest) { s.board[opt.dest.r][opt.dest.c] = u; s.board[from.r][from.c] = null; }
        if (grabbed) applyNegativeStatus(s, grabbed, "grab", { damage: 0, turns: 1, endDamage: sk.grabDamage || 2, source: "水调歌头" });
        u.sdStage = 0;
      } else {
        const rp = action.reposition && action.reposition.r != null ? action.reposition : { r: from.r, c: from.c };
        if (Math.abs(rp.r - from.r) > 1 || Math.abs(rp.c - from.c) > 1 || !inB(rp.r, rp.c)) return err("位移落点不合法");
        if (!(rp.r === from.r && rp.c === from.c) && s.board[rp.r][rp.c]) return err("位移落点被占用");
        if (!(rp.r === from.r && rp.c === from.c)) { s.board[rp.r][rp.c] = u; s.board[from.r][from.c] = null; }
        const opt = findOpt(3, rp);
        if (!opt) return err("突进方向不合法");
        for (const h of opt.hits) { const e = s.board[h.r][h.c]; if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av); }
        if (opt.dest) { s.board[opt.dest.r][opt.dest.c] = u; s.board[rp.r][rp.c] = null; }
        u.sdStage = 1;
      }
    } else if (sk.type === "dragonbreath") {
      let brDir = null;
      for (const [ddr, ddc] of DIRS) {
        if (dragonBreathArea(u, from.r, from.c, ddr, ddc).some(([ar, ac]) => ar === r && ac === c)) { brDir = [ddr, ddc]; break; }
      }
      if (!brDir) return err("龙息方向不合法");
      const seen = new Set();
      for (const [ar, ac] of dragonBreathArea(u, from.r, from.c, brDir[0], brDir[1])) {
        const key = ar + "_" + ac;
        if (seen.has(key)) continue;
        seen.add(key);
        const e = s.board[ar][ac];
        if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av);
      }
    } else if (sk.type === "thunder") {
      const inRange = (Math.abs(r - from.r) <= 1 && Math.abs(c - from.c) <= 1 && !(r === from.r && c === from.c)) ||
        (Math.abs(r - from.r) + Math.abs(c - from.c) === 2 && (r === from.r || c === from.c));
      if (!inRange || !inB(r, c)) return err("雷霆万钧目标不合法");
      if (t && (t.sword || t.player === player)) return err("目标格不可选");
      if (t && !t.sword && t.player !== player) {
        applyDamage(s, t, sk.damage + av);
        if (findPos(s, t)) randomKnockback(s, t); // 未阵亡才击退
      }
      if (!s.board[r][c]) { s.board[r][c] = u; s.board[from.r][from.c] = null; } // 目标格空出则位移进去
      if ((u.empowerTurns || 0) <= 0) {
        u.empowerTurns = sk.empowerTurns || 3;
        u.shield += sk.empowerShield || 2;
      }
    } else if (sk.type === "bloodburst") {
      // 以自身为中心九宫格内的所有敌方英雄；先扣次数再结算，确保击杀刷新不被覆盖
      consumedHere = true;
      setSkillUses(s, u, idx, Math.max(0, skillUsesLeft(s, u, idx) - 1));
      const victims = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const e = inB(r + dr, c + dc) ? s.board[r + dr][c + dc] : null;
        if (isUnit(e) && e.player !== player) victims.push(e);
      }
      let totalDealt = 0;
      for (const e of victims) totalDealt += applyDamage(s, e, sk.damage, u); // 返回值=实际扣掉的生命
      if (totalDealt > 0) u.hp += totalDealt; // 吸血鬼：按实际总伤害回血（不受 maxHp 限制）
    } else if (sk.type === "shield_ally") {
      const ally = inB(r, c) ? s.board[r][c] : null;
      if (!isUnit(ally) || ally.player !== player) return err("目标不合法（需选择一名己方存活英雄）");
      ally.shield += sk.shield;
    } else if (sk.type === "chase") {
      if (isChase2) {
        // 第二段：客户端已选好目标(action.chaseTarget)与闪身落点(to)
        const ct = action.chaseTarget && action.chaseTarget.r != null ? action.chaseTarget : null;
        const target2 = ct && inB(ct.r, ct.c) ? s.board[ct.r][ct.c] : null;
        if (!isUnit(target2) || target2.player === player || target2.chaseMark !== u.uid) return err("追猎·第二段目标不合法（需带标记的存活敌人）");
        if (!inB(r, c) || s.board[r][c]) return err("闪身落点不合法");
        if (Math.abs(r - ct.r) + Math.abs(c - ct.c) !== 1) return err("闪身必须落在目标相邻格");
        s.board[r][c] = u;
        s.board[from.r][from.c] = null;
        applyDamage(s, target2, sk.damage, u); // 统一伤害结算（击杀 → 刷新追猎）
        endChase(s, u);
      } else {
        // 第一段：按方向贯穿整条直线直到边界
        const opt = DIRS.map(([dr, dc]) => computeChaseLine(s, u, from.r, from.c, dr, dc))
          .find((o) => o.path.some((p) => p[0] === r && p[1] === c));
        if (!opt) return err("追猎方向不合法");
        const hitUnits = [];
        for (const h of opt.hits) {
          const e = s.board[h.r][h.c];
          if (isUnit(e) && e.player !== player) { e.chaseMark = u.uid; hitUnits.push(e); }
        }
        // 先扣次数再结算：确保击杀刷新不被尾部扣次数覆盖
        consumedHere = true;
        setSkillUses(s, u, idx, Math.max(0, skillUsesLeft(s, u, idx) - 1));
        for (const e of hitUnits) applyDamage(s, e, sk.damage, u);
        u.chaseStage = 1;
      }
    } else if (sk.type === "ziwei") {
      // 范围与雷霆万钧一致；落点必须为空
      const okPos = (Math.abs(r - from.r) <= 1 && Math.abs(c - from.c) <= 1 && !(r === from.r && c === from.c)) ||
        (Math.abs(r - from.r) + Math.abs(c - from.c) === 2 && (r === from.r || c === from.c));
      if (!inB(r, c) || s.board[r][c] || !okPos) return err("紫薇神步落点不合法（需为空且在同范围格内）");
      const zBefore = box3Enemies(s, from.r, from.c, player);
      s.board[r][c] = u;
      s.board[from.r][from.c] = null;
      const zAfter = box3Enemies(s, r, c, player);
      for (const e of zBefore) { if (findPos(s, e)) applyDamage(s, e, sk.damage, u); }
      for (const e of zAfter) { if (findPos(s, e)) applyDamage(s, e, sk.damage, u); } // 重叠区域再结算一次
    } else if (sk.type === "exile") {
      const et = action.exileTarget && action.exileTarget.r != null ? action.exileTarget : null;
      const target = et && inB(et.r, et.c) ? s.board[et.r][et.c] : null;
      if (!isUnit(target) || target.player === player) return err("放逐目标不合法（需存活敌人）");
      const cn = CORNERS.find((x) => x.corner.r === r && x.corner.c === c);
      if (!cn || !cornerOk(s, cn)) return err("该墙角不可选（其四宫格内已有英雄）");
      const tp = findPos(s, target);
      s.board[cn.corner.r][cn.corner.c] = target;
      s.board[tp.r][tp.c] = null;
    } else if (sk.type === "tianwei") {
      if (!inB(r, c) || s.board[r][c]) return err("天威落点必须是空格");
      s.board[r][c] = u;
      s.board[from.r][from.c] = null;
      const victims = box3Enemies(s, r, c, player).sort((x, y) => {
        const px = findPos(s, x), py = findPos(s, y);
        if (!px) return 1;
        if (!py) return -1;
        return (px.r - py.r) || (px.c - py.c);
      });
      for (const e of victims) {
        if (!findPos(s, e)) continue;
        applyDamage(s, e, sk.damage, u); // 每名敌人最多一次
        if (findPos(s, e)) knockOutBox3(s, e, r, c);
      }
    } else if (sk.type === "shenluo") {
      // 神罗天征：九宫格内敌人各 1 伤并击退出九宫格
      const victims = sortUnitsByPosS(s, box3Enemies(s, from.r, from.c, player));
      for (const e of victims) {
        if (!findPos(s, e)) continue;
        applyDamage(s, e, sk.damage, u);
        if (findPos(s, e)) knockOutBoxAwayS(s, e, from.r, from.c, from.r, from.c);
      }
    } else if (sk.type === "wxt") {
      // 万象天引：三阶段连招
      const stage = u.wxtStage || 0;
      const wt = isUnit(t) ? t : null;
      if (!wt || wt.player === player) return err("万象天引：请选择一名存活的敌方英雄");
      if (stage === 2) {
        if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("万象天引·第三段：只能选择相邻敌人");
        applyDamage(s, wt, sk.damage, u);
        if (findPos(s, wt)) pushAwayOneS(s, wt, from.r, from.c);
        u.wxtStage = 0; // 连招结束
      } else {
        const wd = action.wxtDir && action.wxtDir.dr != null ? action.wxtDir : null;
        if (!wd) return err("万象天引：请先选择方向");
        const dr = Number(wd.dr), dc = Number(wd.dc);
        if (!((dr === 0 && (dc === 1 || dc === -1)) || (dc === 0 && (dr === 1 || dr === -1)))) return err("万象天引：方向不合法");
        if (!wxtTargetsS(s, u, from.r, from.c, dr, dc, stage, player).some((p) => p[0] === r && p[1] === c)) return err("万象天引：目标不在该段范围内");
        if (stage === 0) {
          const lr = from.r + dr * 2, lc = from.c + dc * 2; // 正前方两格
          if (!inB(lr, lc) || (s.board[lr][lc] && s.board[lr][lc] !== wt)) return err("万象天引·第一段：正前方两格被占据或越界");
          const tp = findPos(s, wt);
          if (tp.r !== lr || tp.c !== lc) { s.board[lr][lc] = wt; s.board[tp.r][tp.c] = null; }
          applyDamage(s, wt, sk.damage, u);
          u.wxtStage = 1;
        } else {
          const lr = from.r + dr, lc = from.c + dc;        // 正前方一格
          if (!inB(lr, lc) || (s.board[lr][lc] && s.board[lr][lc] !== wt)) return err("万象天引·第二段：正前方格被占据或越界");
          const tp = findPos(s, wt);
          if (tp.r !== lr || tp.c !== lc) { s.board[lr][lc] = wt; s.board[tp.r][tp.c] = null; }
          applyDamage(s, wt, sk.damage, u);
          if (findPos(s, wt)) applyNegativeStatus(s, wt, "grab", { damage: 0, turns: 1, label: "万象天引·抓取" });
          u.wxtStage = 2;
        }
      }
    } else return err("未知技能");

    if (!isSd2 && !isChase2 && !isWxtCombo && !consumedHere) setSkillUses(s, u, idx, Math.max(0, skillUsesLeft(s, u, idx) - 1));
    if (sk.costSwords) u.swords = Math.max(0, (u.swords || 0) - sk.costSwords);
    const isFree = freeAction;
    finish(s, u, isFree, !!(sk.free && !sk.perTurn));
    return { ok: true, state: s };
  }

  return err("未知行动");
}

module.exports = { createState, applyAction, applyNegativeStatus, hasSuperArmor, isLoneActive, applyDamage, SIZE, PER_PLAYER,
  normalDamage, assassinInFlank, computeChaseLine, chaseTargetsOf, chaseBlinkCells, refreshChase, endChase, skillFreeForS, refreshSkillOnKill,
  isGuixiongActive, guixiongCounter, box3Enemies, CORNERS, cornerOk, knockOutBox3 };
