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
const SUMMON_DEFS = {
  minion: { id: "minion", name: "小亡灵", icon: "💀", hp: 2, tag: "亡灵召唤物", sfx: "undead", skill: null },
};
const heroDef = (id) => HEROES.find((h) => h.id === id) || SUMMON_DEFS[id] || null;
const talDef = (id) => TALISMANS.find((t) => t.id === id) || null;
const drawTalismanId = () => TALISMANS[Math.floor(Math.random() * TALISMANS.length)].id;
function ordinaryTalismansS() {
  return TALISMANS.filter((t) => t && t.id !== "omni" && t.effect !== "omni");
}
function talismanCanRefreshUnitS(u) {
  if (!u || u.sword) return false;
  return unitSkills(u).some((sk, i) => {
    if (!sk || isPassiveSkillS(sk) || sk.uses == null) return false;
    const max = sk.perTurn ? sk.perTurn : sk.uses;
    return skillUsesLeft(null, u, i) < max;
  });
}
function talismanAvailableS(s, player, id) {
  const t = talDef(id);
  if (!t || t.effect === "omni") return { ok: false, reason: "全能锦囊不能选择自身" };
  if (t.target === "allyWounded") {
    if (!unitsOf(s, player).some((u) => u.hp < u.maxHp)) return { ok: false, reason: "没有生命未满的己方英雄" };
  } else if (t.target === "deadAlly") {
    let any = false;
    for (const g of s.graveyard) if (g.player === player && reviveCellForS(s, g)) { any = true; break; }
    if (!any) return { ok: false, reason: "没有可复活的己方阵亡英雄（或原位置被占用）" };
  } else if (t.target === "allyAlive") {
    if (!unitsOf(s, player).some((u) => talismanCanRefreshUnitS(u))) return { ok: false, reason: "没有可刷新技能次数的己方英雄" };
  }
  return { ok: true, reason: "" };
}
/* 英雄全部技能（含 extraSkills） */
function heroSkills(def) {
  if (!def) return [];
  return [def.skill, ...(def.extraSkills || [])].filter(Boolean);
}
/* 单位实际技能：原始 + 窃神复制技能（追加末尾） */
function unitSkills(u) {
  const base = u ? heroSkills(heroDef(u.heroId)) : [];
  if (!u || !u.copiedSkill) return base;
  return base.concat([u.copiedSkill]);
}
function isPassiveSkillS(s) {
  return !!(s && s.type === "passive");
}
function normalizePassiveSkillS(p) {
  if (!p) return null;
  return Object.assign({ uses: 0 }, p, { type: "passive", passive: true });
}
function heroPassivesS(def) {
  if (!def) return [];
  if (def.passives && def.passives.length) return def.passives;
  return def.passive ? [def.passive] : [];
}
function heroPassivesForUnitS(u) {
  if (!u) return [];
  const out = heroPassivesS(heroDef(u.heroId)).slice();
  const cp = u.copiedSkill;
  if (cp && isPassiveSkillS(cp)) {
    if (!out.some((p) => p && p.name === cp.name)) out.push(cp);
  }
  return out;
}
function copyableSkillsS(u) {
  if (!u) return [];
  const out = unitSkills(u).slice();
  for (const p of heroPassivesForUnitS(u)) {
    const np = normalizePassiveSkillS(p);
    if (!np) continue;
    if (!out.some((sk) => sk && sk.type === "passive" && sk.name === np.name)) out.push(np);
  }
  return out;
}
function hasPassiveEffectS(u, heroId, passiveName) {
  if (!u || u.sword || isSilenced(u)) return false;
  // 时间停止：被动全部停摆；西楚霸王的鬼雄例外，仍需锁血，反击延迟结算。
  if (isTimeStopped(u) && !(heroId === "xiangyu" && passiveName === "鬼雄")) return false;
  if (u.heroId === heroId) {
    const ps = heroPassivesS(heroDef(u.heroId));
    const known = {
      lone: ["孤胆"], xiangyu: ["鬼雄"], assassin: ["暗杀"], asura: ["锻剑"],
      longren: ["龙魂", "龙胆"], yangjian: ["天眼"],
    }[heroId] || [];
    return ps.some((p) => !passiveName || (p && p.name === passiveName)) ||
      (!passiveName ? known.length > 0 : known.indexOf(passiveName) >= 0);
  }
  const cp = u.copiedSkill;
  if (!cp || !isPassiveSkillS(cp)) return false;
  if (u.copiedFrom && u.copiedFrom.heroId === heroId && (!passiveName || cp.name === passiveName)) return true;
  return false;
}
/* 镜影·镜像分身范围（与雷电之主·雷霆万钧一致） */
function mirrorSummonCellsS(s, u, r, c) {
  const cand = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    cand.push([r + dr, c + dc]);
  }
  for (const [dr, dc] of DIRS) cand.push([r + dr * 2, c + dc * 2]);
  const seen = new Set();
  const out = [];
  for (const [rr, cc] of cand) {
    if (!inB(rr, cc)) continue;
    const key = rr + "_" + cc;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.board[rr][cc]) continue;
    out.push([rr, cc]);
  }
  return out;
}
function isMirrorS(cell) {
  return !!(cell && cell.mirror === true);
}
/* 亡灵之主·死亡十字架：不占格、永久、可被亡语复活或亡灵军团消耗 */
function addDeathCrossS(s, target, pos) {
  if (!target || !pos || target.isMinion || target.mirror) return null;
  if (!s.crosses) s.crosses = [];
  if (!s.crossSeq) s.crossSeq = 0;
  const m = { id: ++s.crossSeq, r: pos.r, c: pos.c, player: target.player, heroId: target.heroId, deadUid: target.uid };
  s.crosses.push(m);
  slog(s, "💀 " + uname(s, target) + " 的阵亡处留下了死亡十字架");
  return m;
}
function removeCrossesForDeadS(s, deadUid) {
  if (!deadUid || !s.crosses) return;
  s.crosses = s.crosses.filter((x) => x.deadUid !== deadUid);
}

/* ============================ 时间行者：锚点 / 时间停止 ============================ */
function timeAnchorForS(s, u) {
  return u ? (s.timeAnchors || []).find((a) => a.uid === u.uid) || null : null;
}
function nearestTimeReturnCellS(s, r, c) {
  if (inB(r, c) && !s.board[r][c]) return { r, c };
  let best = null;
  for (let rr = 0; rr < SIZE; rr++) {
    for (let cc = 0; cc < SIZE; cc++) {
      if (s.board[rr][cc]) continue;
      const d = Math.abs(rr - r) + Math.abs(cc - c);
      if (!best || d < best.d || (d === best.d && (rr < best.r || (rr === best.r && cc < best.c)))) {
        best = { r: rr, c: cc, d };
      }
    }
  }
  return best ? { r: best.r, c: best.c } : null;
}
function addTimeAnchorS(s, u, kind, r, c) {
  if (!u || timeAnchorForS(s, u)) return null;
  if (!s.timeAnchors) s.timeAnchors = [];
  if (!s.timeAnchorSeq) s.timeAnchorSeq = 0;
  const a = { id: ++s.timeAnchorSeq, uid: u.uid, owner: u.player, heroId: u.heroId, kind, r, c, castTurn: s.turnSerial || 0, blastDone: false };
  s.timeAnchors.push(a);
  slog(s, "🌌 " + uname(s, u) + " 在 (" + (r + 1) + "," + (c + 1) + ") 留下时空锚点");
  return a;
}
function removeTimeAnchorS(s, anchor) {
  if (!anchor || !s.timeAnchors) return;
  s.timeAnchors = s.timeAnchors.filter((a) => a.id !== anchor.id);
}
function removeTimeAnchorsForS(s, uid) {
  if (!s.timeAnchors) return;
  s.timeAnchors = s.timeAnchors.filter((a) => a.uid !== uid);
}
function thunderRangeCellsS(r, c, includeCenter) {
  const out = [];
  const seen = new Set();
  const add = (rr, cc) => {
    if (!inB(rr, cc)) return;
    if (!includeCenter && rr === r && cc === c) return;
    const k = rr + "_" + cc;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([rr, cc]);
  };
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(r + dr, c + dc);
  for (const [dr, dc] of DIRS) add(r + dr * 2, c + dc * 2);
  return out;
}
function inThunderRangeS(r, c, tr, tc) {
  const dr = r - tr, dc = c - tc;
  if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) return true;
  return (dr === 0 || dc === 0) && Math.abs(dr) + Math.abs(dc) <= 2;
}
function holyDomainForS(s, u) {
  if (!u) return null;
  const p = findPos(s, u);
  if (!p) return null;
  const cells = isTitanS(u) ? titanCellsS(s, u) : [[p.r, p.c]];
  return (s.holyDomains || []).find((d) => d.owner === u.player && d.cells.some(([r, c]) => cells.some(([ur, uc]) => ur === r && uc === c))) || null;
}
function unitBlockSourceS(s, u) {
  if (berserkerBlock(u)) return "狂化";
  if (holyDomainForS(s, u)) return "神圣加护";
  return "";
}
function addHolyDomainS(s, u, center) {
  if (!u || !center) return null;
  if (!s.holyDomains) s.holyDomains = [];
  if (s.holyDomains.some((d) => d.owner === u.player)) return null;
  if (!s.holyDomainSeq) s.holyDomainSeq = 0;
  const d = {
    id: ++s.holyDomainSeq,
    uid: u.uid,
    owner: u.player,
    center: { r: center.r, c: center.c },
    cells: thunderRangeCellsS(center.r, center.c, true),
    turns: 3,
    castTurn: s.turnSerial || 0,
  };
  s.holyDomains.push(d);
  slog(s, "✨ " + uname(s, u) + " 在 (" + (center.r + 1) + "," + (center.c + 1) + ") 展开【神圣加护】，持续 3 回合");
  return d;
}
function tickHolyDomainsS(s) {
  if (!s.holyDomains || !s.holyDomains.length) return;
  for (const d of s.holyDomains.slice()) {
    d.turns -= 1;
    if (d.turns <= 0) {
      s.holyDomains = s.holyDomains.filter((x) => x.id !== d.id);
      slog(s, "✨ 神圣加护领域消散");
    }
  }
}
function applyTimeStopS(s, target, source, skillName) {
  if (!target || !findPos(s, target) || isFormImmuneS(target)) return false;
  if (target.timeStop) {
    target.timeStop.turns = Math.max(target.timeStop.turns || 1, 1);
    return true;
  }
  target.timeStop = { turns: 1, label: "时间停止", sourceUid: source ? source.uid : 0, sourcePlayer: source ? source.player : 0, skill: skillName || "", castTurn: s.turnSerial || 0 };
  target.timeStopPending = target.timeStopPending || [];
  slog(s, "⏳ " + uname(s, target) + " 进入【时间停止】：下个目标行动回合无法行动，所有回合计时暂停");
  return true;
}
function queueTimeStopEffectS(target, effect) {
  if (!target || !effect) return;
  target.timeStopPending = target.timeStopPending || [];
  target.timeStopPending.push(effect);
}
function endTimeStopS(s, target) {
  if (!target) return;
  target.timeStop = null;
  const pending = Array.isArray(target.timeStopPending) ? target.timeStopPending.slice() : [];
  target.timeStopPending = [];
  slog(s, "⏳ " + uname(s, target) + " 的【时间停止】结束，状态计时恢复");
  for (const eff of pending) {
    if (!findPos(s, target)) break;
    if (eff.kind === "guixiong") {
      const victims = (eff.victimUids || []).map((uid) => findUnitByUidS(s, uid)).filter((v) => v && findPos(s, v));
      let hit = 0;
      for (const v of victims) {
        applyDamage(s, v, eff.damage || 2, target);
        hit++;
      }
      slog(s, "👹 延迟结算·鬼雄反击：对九宫格内 " + hit + " 名敌人各造成 " + (eff.damage || 2) + " 点伤害");
    }
  }
}
function processTimeAnchorsStartS(s, player) {
  for (const anchor of (s.timeAnchors || []).slice()) {
    if (anchor.owner !== player) continue;
    if ((s.turnSerial || 0) <= (anchor.castTurn || 0)) continue;
    const caster = findUnitByUidS(s, anchor.uid);
    if (!caster || !findPos(s, caster)) {
      removeTimeAnchorS(s, anchor);
      continue;
    }
    if (anchor.kind !== "void" || anchor.blastDone) continue;
    const p = findPos(s, caster);
    const cells = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = p.r + dr, cc = p.c + dc;
      if (inB(rr, cc)) cells.push([rr, cc]);
    }
    slog(s, "🌌 破空·延迟时空爆发：" + uname(s, caster) + " 当前位置的九宫格开始塌缩");
    for (const [rr, cc] of cells) {
      const t = s.board[rr][cc];
      if (isUnit(t) && !t.sword && t.player !== caster.player) {
        applyDamage(s, t, 2, caster);
      }
    }
    anchor.blastDone = true;
    if (checkVictory(s)) return;
  }
}
function processTimeAnchorsEndS(s, player) {
  for (const anchor of (s.timeAnchors || []).slice()) {
    if (anchor.owner !== player) continue;
    if ((s.turnSerial || 0) <= (anchor.castTurn || 0)) continue;
    const caster = findUnitByUidS(s, anchor.uid);
    if (!caster || !findPos(s, caster)) {
      removeTimeAnchorS(s, anchor);
      continue;
    }
    const from = findPos(s, caster);
    const dest = (from && from.r === anchor.r && from.c === anchor.c)
      ? { r: from.r, c: from.c }
      : nearestTimeReturnCellS(s, anchor.r, anchor.c);
    if (dest && from) {
      if (from.r !== dest.r || from.c !== dest.c) {
        s.board[dest.r][dest.c] = caster;
        s.board[from.r][from.c] = null;
      }
      slog(s, "🌌 " + uname(s, caster) + " " + (from.r === dest.r && from.c === dest.c ? "仍停留在时空锚点原位" : "沿时空锚点回到 (" + (dest.r + 1) + "," + (dest.c + 1) + ")") + (dest.r === anchor.r && dest.c === anchor.c ? "" : "（锚点被占据，改在最近空格）"));
    } else {
      slog(s, "🌌 " + uname(s, caster) + " 没有合法回归落点，位置保持不变");
    }
    removeTimeAnchorS(s, anchor);
    if (checkVictory(s)) return;
  }
}
function reviveAllyFromGraveS(s, rec, tr, tc, hp) {
  if (!rec) return null;
  const def = heroDef(rec.heroId);
  if (!def) return null;
  const snap = rec.snapshot ? JSON.parse(JSON.stringify(rec.snapshot)) : null;
  const revived = snap ? Object.assign({}, snap, { uid: s.unitSeq++, heroId: def.id, player: rec.player, hp: Math.min(hp, def.hp), maxHp: def.hp })
    : { uid: s.unitSeq++, heroId: def.id, player: rec.player, hp: Math.min(hp, def.hp), maxHp: def.hp,
        shield: 0, shieldLayers: [], frozen: 0, swords: rec.swords || 0, usesLeft: rec.usesLeft || 0,
        usesArr: rec.usesArr && rec.usesArr.length ? rec.usesArr.slice() : undefined, statuses: {},
        lockUsed: !!rec.lockUsed, guixiongUsed: !!rec.guixiongUsed, sdStage: 0, dragonMoves: 0, empowerTurns: 0,
        chaseStage: 0, chaseMark: 0, wxtStage: 0, stealth: null, ravenBuff: false, ravenDouble: false, ravenDoubleUsed: false,
        metalBuff: false, metalTide: 0, meditate: null, facing: rec.player === 1 ? [0, 1] : [0, -1], rbStage: 0, rbBlade: null,
        rbDir: null, crowForm: null, copiedSkill: null, copiedUses: 0, copiedFrom: null };
  if (!revived.statuses) revived.statuses = {};
  revived.rbStage = 0; revived.rbBlade = null; revived.rbDir = null; revived.crowForm = null;
  removeCrossesForDeadS(s, rec.deadUid || (rec.snapshot && rec.snapshot.uid));
  s.board[tr][tc] = revived;
  s.graveyard = s.graveyard.filter((g) => g !== rec);
  slog(s, "💜 亡语：" + uname(s, revived) + " 在 (" + (tr + 1) + "," + (tc + 1) + ") 复活（" + revived.hp + " 点生命）");
  return revived;
}
function undeadSpawnCellS(s, cross, reserved) {
  if (!cross) return null;
  const ok = (r, c) => inB(r, c) && !s.board[r][c] && !reserved.has(r + "_" + c);
  if (ok(cross.r, cross.c)) return { r: cross.r, c: cross.c };
  let best = null;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (!ok(r, c)) continue;
    const d = Math.abs(r - cross.r) + Math.abs(c - cross.c);
    if (!best || d < best.d || (d === best.d && (r < best.r || (r === best.r && c < best.c)))) best = { r, c, d };
  }
  return best ? { r: best.r, c: best.c } : null;
}
/* 多技能：每个技能各自的剩余次数（uses==null 用 9999 表示无限） */
function skillUsesLeft(s, u, idx) {
  const skills = unitSkills(u);
  const sk = skills[idx];
  if (!sk || sk.uses == null) return 9999;
  if (u && u.copiedSkill && idx === skills.length - 1) return u.copiedUses != null ? u.copiedUses : sk.uses;
  if (skills.length === 1) return u.usesLeft;
  return u.usesArr && u.usesArr[idx] != null ? u.usesArr[idx] : sk.uses;
}
function skillUsedThisTurnS(s, u, idx) {
  return !!(u && u.skillTurnUsed && u.skillTurnUsed[idx] === (s.turnSerial || 0));
}
function setSkillUses(s, u, idx, v) {
  const skills = unitSkills(u);
  if (u && u.copiedSkill && idx === skills.length - 1) { u.copiedUses = v; return; }
  if (skills.length === 1) { u.usesLeft = v; return; }
  u.usesArr = u.usesArr || [];
  u.usesArr[idx] = v;
  if (idx === 0) u.usesLeft = v; // 兼容：主技能次数镜像
}
/* 被抓取：不能做任何动作 */
function isGrabbed(u) {
  return !!(u && u.statuses && u.statuses.grab && u.statuses.grab.turns > 0);
}
/* 被眩晕：不能移动 / 普攻 / 使用技能；按目标自身行动回合计时 */
function isStunned(u) {
  return !!(u && u.statuses && u.statuses.stun && u.statuses.stun.turns > 0);
}
/* 被定身：不能移动 / 位移技能；仍可普通攻击 / 非位移技能；按目标自身行动回合计时 */
function isRooted(u) {
  return !!(u && u.statuses && u.statuses.root && u.statuses.root.turns > 0);
}
/* 被沉默：主动/被动技能全部失效；仍可移动（除非同时定身）与普通攻击 */
function isSilenced(u) {
  return !!(u && u.statuses && u.statuses.silence && u.statuses.silence.turns > 0);
}
function isTimeStopped(u) {
  return !!(u && u.timeStop && (u.timeStop.turns || 0) > 0);
}
function isDisabled(u) {
  return isGrabbed(u) || isStunned(u) || isTimeStopped(u);
}
/* 定身：不能移动 / 主动位移，但仍可普通攻击与非位移技能 */
const SELF_MOVE_SKILLS = ["dash", "blink", "ziwei", "tianwei", "shuidiao", "duanlang", "thunder", "mistdash", "stealth", "thunderblade", "susano_dash", "push", "crosstep"];
function isSelfMoveSkillS(u, sk) {
  if (!sk) return false;
  if (SELF_MOVE_SKILLS.indexOf(sk.type) >= 0) return true;
  if (sk.type === "chase" && (u.chaseStage || 0) === 1) return true;
  return false;
}
function actionBlockReason(u) {
  if (isTimeStopped(u)) return "时间停止";
  if (isGrabbed(u)) return "抓取";
  if (isStunned(u)) return "眩晕";
  if (isSilenced(u)) return "沉默";
  if (isRooted(u)) return "定身";
  return "";
}
/* 雷电之主：本方的强化英雄 */
function empoweredActorFor(s, player) {
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) continue;
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
/* 花木兰·所向披靡：沿 (dr,dc) 击退最多 2 格；路径上的英雄向侧方推开（服务端权威） */
function chargeKnockbackS(s, tgt, dr, dc) {
  if (isFormImmuneS(tgt)) return { moved: 0, pushed: [], stun: false };
  const pushed = [];
  let moved = 0;
  for (let step = 0; step < 2; step++) {
    const p = findPos(s, tgt);
    if (!p) break;
    const nr = p.r + dr, nc = p.c + dc;
    if (!inB(nr, nc)) break;
    if (isTitanS(tgt)) {
      if (!canTitanFitS(s, tgt, nr, nc, false)) break;
      placeTitanFootprintS(s, tgt, nr, nc); moved++;
      continue;
    }
    const cell = s.board[nr][nc];
    if (!cell) {
      s.board[nr][nc] = tgt; s.board[p.r][p.c] = null; moved++;
      continue;
    }
    if (cell.sword || cell.pillar || cell.hammer) break;
    if (isFormImmuneS(cell)) break;
    const perp = [[-dc, dr], [dc, -dr]];
    const opts = [];
    for (const [pr, pc] of perp) {
      const sr = nr + pr, sc = nc + pc;
      if (inB(sr, sc) && !s.board[sr][sc]) opts.push({ r: sr, c: sc });
    }
    if (!opts.length) break;
    const dest = opts[Math.floor(Math.random() * opts.length)];
    s.board[dest.r][dest.c] = cell;
    s.board[nr][nc] = null;
    pushed.push({ unit: cell, from: { r: nr, c: nc }, to: dest });
    const p2 = findPos(s, tgt);
    if (!p2) break;
    s.board[nr][nc] = tgt; s.board[p2.r][p2.c] = null; moved++;
  }
  return { moved, pushed, stun: moved < 2 };
}
/* 雷电之主：随机击退到四周一个合法格 */
function randomKnockback(s, t) {
  if (isFormImmuneS(t)) return null;
  const p = findPos(s, t);
  if (!p) return null;
  const opts = [];
  for (const [dr, dc] of DIRS) {
    const nr = p.r + dr, nc = p.c + dc;
    if (!inB(nr, nc) || s.board[nr][nc]) continue;
    if (isTitanS(t) && !canTitanFitS(s, t, nr, nc, false)) continue;
    opts.push({ r: nr, c: nc });
  }
  if (!opts.length) return null;
  const pick = opts[Math.floor(Math.random() * opts.length)];
  if (isTitanS(t)) placeTitanFootprintS(s, t, pick.r, pick.c);
  else { s.board[pick.r][pick.c] = t; s.board[p.r][p.c] = null; }
  return pick;
}
/* 孤胆 / 霸体 / 伤害加成 */
function alliesIn3x3(s, u) {
  const p = findPos(s, u);
  if (!p) return 0;
  let n = 0;
  const seen = new Set();
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const v = unitAtS(s, p.r + dr, p.c + dc);
    if (v && v !== u && !v.sword && !isMirrorS(v) && v.player === u.player && !seen.has(v.uid)) { seen.add(v.uid); n++; }
  }
  return n;
}
const isLoneActive = (s, u) => !!(u && !u.sword && hasPassiveEffectS(u, "lone", "孤胆") && alliesIn3x3(s, u) === 0);
/* 狂战士·狂化：按当前实际生命值动态计算阶段。 */
function berserkerStage(u) {
  if (!u || u.sword) return 0;
  if (!hasPassiveEffectS(u, "berserker", "狂化")) return 0;
  const hp = Number(u.hp);
  if (!Number.isFinite(hp)) return 0;
  if (hp <= 1) return 4;
  if (hp <= 2) return 3;
  if (hp <= 3) return 2;
  if (hp <= 4) return 1;
  return 0;
}
function berserkerNormalBonus(u) {
  const stage = berserkerStage(u);
  return stage > 0 ? 1 + (stage >= 4 ? 1 : 0) : 0;
}
function berserkerBlock(u) {
  return berserkerStage(u) >= 3;
}
const hasSuperArmor = (s, u) => isLoneActive(s, u) || berserkerStage(u) >= 2;
const attackerBonus = (s, u) => (s.assaultPlayer === u.player ? 1 : 0) + (isLoneActive(s, u) ? 1 : 0);
/* 负面状态：伤害先结算，负面效果受霸体免疫 */
function applyNegativeStatus(s, target, kind, opts) {
  opts = opts || {};
  let dmg = 0;
  if (opts.damage) dmg = applyDamage(s, target, opts.damage);
  if (!findPos(s, target)) return { applied: false, immune: false, damage: dmg, dead: true };
  if (isFormImmuneS(target)) {
    slog(s, (isCrowFormS(target) ? "🪶 鸦天狗" : "🛡 禅坐") + "：免疫了【" + (opts.label || kind) + "】");
    return { applied: false, immune: true, damage: dmg };
  }
  if (!opts.ignoreSuperArmor && hasSuperArmor(s, target)) {
    slog(s, "🛡 霸体：" + uname(s, target) + " 抵抗了【" + (opts.label || kind) + "】");
    return { applied: false, immune: true, damage: dmg };
  }
  target.statuses = target.statuses || {};
  const prev = target.statuses[kind];
  const next = Object.assign({ kind, label: opts.label || kind }, opts);
  if (prev && prev.turns != null && next.turns != null) next.turns = Math.max(prev.turns, next.turns);
  target.statuses[kind] = next;
  if (!opts.silent) slog(s, "⛓ " + uname(s, target) + " 被施加【" + (opts.label || kind) + "】（" + (opts.turns != null ? opts.turns : 1) + " 回合内无法行动）");
  return { applied: true, immune: false, damage: dmg };
}
function tickStatuses(s, player) {
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) {
      u.timeStop.turns -= 1;
      if (u.timeStop.turns <= 0) endTimeStopS(s, u);
      continue;
    }
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
const isPillar = (cell) => !!cell && cell.pillar === true;
const isHammer = (cell) => !!cell && cell.hammer === true;
const isTitanPart = (cell) => !!cell && cell.titanPart === true;
const isUnit = (cell) => !!cell && !cell.sword && !cell.pillar && !cell.hammer && !cell.titanPart;
const isTitanS = (u) => !!(u && !u.sword && u.size === 2);
function findUnitByUidS(s, uid) {
  if (uid == null) return null;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (u && u.uid === uid && isUnit(u)) return u;
  }
  return null;
}
function unitAtS(s, r, c) {
  if (!inB(r, c)) return null;
  const cell = s.board[r][c];
  if (!cell) return null;
  if (cell.titanPart) return findUnitByUidS(s, cell.ownerUid);
  if (cell.pillar || cell.hammer) return null;
  return cell;
}
function titanCellsForAnchorS(tr, tc) {
  return [[tr, tc], [tr, tc + 1], [tr + 1, tc], [tr + 1, tc + 1]].filter(([r, c]) => inB(r, c));
}
function titanCellsS(s, u) {
  const p = findPos(s, u);
  return p && isTitanS(u) ? titanCellsForAnchorS(p.r, p.c) : (p ? [[p.r, p.c]] : []);
}
function titanPartAtS(s, r, c, u) {
  const cell = inB(r, c) ? s.board[r][c] : null;
  return !!(cell && cell.titanPart && u && cell.ownerUid === u.uid);
}
function clearTitanFootprintS(s, u) {
  if (!u) return;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const cell = s.board[r][c];
    if (cell === u || (cell && cell.titanPart && cell.ownerUid === u.uid)) s.board[r][c] = null;
  }
}
function canTitanFitS(s, u, tr, tc, pickOwnHammer) {
  if (!u) return false;
  if (!inB(tr, tc) || !inB(tr + 1, tc + 1)) return false;
  for (const [r, c] of titanCellsForAnchorS(tr, tc)) {
    const cell = s.board[r][c];
    if (cell === u || titanPartAtS(s, r, c, u)) continue;
    if (!cell) continue;
    if (pickOwnHammer && isHammer(cell) && cell.owner === u.player) continue;
    return false;
  }
  return true;
}
function placeTitanFootprintS(s, u, tr, tc) {
  clearTitanFootprintS(s, u);
  s.board[tr][tc] = u;
  for (const [r, c] of titanCellsForAnchorS(tr, tc)) {
    if (r === tr && c === tc) continue;
    s.board[r][c] = { titanPart: true, ownerUid: u.uid };
  }
  return true;
}
function endTitanFormS(s, u, silent) {
  if (!u || !isTitanS(u)) return;
  const p = findPos(s, u);
  clearTitanFootprintS(s, u);
  u.size = 1;
  u.titanTurns = 0;
  if (p) {
    s.board[p.r][p.c] = u;
    if (!silent) slog(s, "🗿 " + uname(s, u) + " 的泰坦之力结束，恢复 1×1 体型");
  }
}
function tickTitansS(s, player) {
  for (const u of unitsOf(s, player)) {
    if (!isTitanS(u) || isTimeStopped(u)) continue;
    u.titanTurns = Math.max(0, (u.titanTurns || 0) - 1);
    if (u.titanTurns <= 0) endTitanFormS(s, u, false);
    else slog(s, "🗿 " + uname(s, u) + " 的泰坦之力剩余 " + u.titanTurns + " 回合");
  }
}
function hammerAtS(s, r, c) {
  const cell = inB(r, c) ? s.board[r][c] : null;
  return isHammer(cell) ? cell : null;
}
function findHammerS(s, ownerUid) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const cell = s.board[r][c];
    if (isHammer(cell) && (ownerUid == null || cell.ownerUid === ownerUid)) return { r, c, cell };
  }
  return null;
}
function removeHammerS(s, ownerUid) {
  const h = findHammerS(s, ownerUid);
  if (!h) return false;
  s.board[h.r][h.c] = null;
  return true;
}
function placeHammerS(s, owner, ownerUid, r, c) {
  if (!inB(r, c) || s.board[r][c]) return false;
  s.board[r][c] = { hammer: true, owner, ownerUid, uid: s.unitSeq++ };
  return true;
}
function pickupHammerAtS(s, u, cells) {
  if (!u || u.heroId !== "hillking") return false;
  const list = cells && cells.length ? cells : (findPos(s, u) ? [[findPos(s, u).r, findPos(s, u).c]] : []);
  for (const [r, c] of list) {
    const h = hammerAtS(s, r, c);
    if (!h || h.owner !== u.player) continue;
    s.board[r][c] = null;
    u.hammerBuff = true;
    slog(s, "🔨 " + uname(s, u) + " 捡起战争之锤，下一次普通攻击 +1");
    return true;
  }
  return false;
}
function pushUnitToAdjacentS(s, tgt) {
  if (!tgt || isFormImmuneS(tgt)) return null;
  const p = findPos(s, tgt);
  if (!p) return null;
  const dirs = DIRS.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  for (const [dr, dc] of dirs) {
    const nr = p.r + dr, nc = p.c + dc;
    if (!inB(nr, nc) || s.board[nr][nc]) continue;
    if (isTitanS(tgt)) {
      if (!canTitanFitS(s, tgt, nr, nc, false)) continue;
      placeTitanFootprintS(s, tgt, nr, nc);
    } else {
      s.board[nr][nc] = tgt; s.board[p.r][p.c] = null;
    }
    return { r: nr, c: nc };
  }
  return null;
}
function hammerCrossCellsS(r, c) {
  return [[r, c], ...DIRS.map(([dr, dc]) => [r + dr, c + dc])].filter(([rr, cc]) => inB(rr, cc));
}
function findAdjacentFreeForS(s, unit) {
  const p = findPos(s, unit);
  if (!p) return null;
  for (const [dr, dc] of DIRS) {
    const nr = p.r + dr, nc = p.c + dc;
    if (!inB(nr, nc) || s.board[nr][nc]) continue;
    if (isTitanS(unit) && !canTitanFitS(s, unit, nr, nc, false)) continue;
    return { r: nr, c: nc };
  }
  return null;
}
function hammerLandingLegalS(s, r, c, player) {
  if (!inB(r, c)) return false;
  const cell = s.board[r][c];
  if (!cell) return true;
  if (isUnit(cell) && cell.player !== player && !isTitanS(cell)) return !!findAdjacentFreeForS(s, cell);
  return false;
}
function titanPlacementAnchorsS(s, u) {
  const p = findPos(s, u);
  if (!p || isTitanS(u)) return [];
  const cand = [
    { r: p.r, c: p.c },
    { r: p.r - 1, c: p.c },
    { r: p.r, c: p.c - 1 },
    { r: p.r - 1, c: p.c - 1 },
  ];
  const seen = new Set();
  const out = [];
  for (const a of cand) {
    const k = a.r + "_" + a.c;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!inB(a.r, a.c) || !inB(a.r + 1, a.c + 1)) continue;
    if (p.r < a.r || p.r > a.r + 1 || p.c < a.c || p.c > a.c + 1) continue;
    if (canTitanFitS(s, u, a.r, a.c, false)) out.push(a);
  }
  return out;
}
function titanAnchorForClickS(s, u, tr, tc) {
  const anchors = titanPlacementAnchorsS(s, u);
  const exact = anchors.find((a) => a.r === tr && a.c === tc);
  if (exact) return exact;
  return anchors.find((a) => tr >= a.r && tr <= a.r + 1 && tc >= a.c && tc <= a.c + 1) || null;
}
function titanPlacementCellsS(anchor) {
  return [[anchor.r, anchor.c], [anchor.r, anchor.c + 1], [anchor.r + 1, anchor.c], [anchor.r + 1, anchor.c + 1]];
}
function titanAttackPairsS(s, u) {
  const p = findPos(s, u);
  if (!p || !isTitanS(u)) return [];
  const sides = [
    [[p.r - 1, p.c], [p.r - 1, p.c + 1]],
    [[p.r + 2, p.c], [p.r + 2, p.c + 1]],
    [[p.r, p.c - 1], [p.r + 1, p.c - 1]],
    [[p.r, p.c + 2], [p.r + 1, p.c + 2]],
  ];
  return sides.filter((pair) => pair.every(([r, c]) => inB(r, c)));
}
function titanPairForS(s, u, r, c) {
  return titanAttackPairsS(s, u).find((pair) => pair.some(([rr, cc]) => rr === r && cc === c)) || null;
}
function minDistToTitanS(s, u, r, c) {
  if (!isTitanS(u)) return Math.abs(r - (findPos(s, u)?.r ?? r)) + Math.abs(c - (findPos(s, u)?.c ?? c));
  return Math.min(...titanCellsS(s, u).map(([rr, cc]) => Math.abs(r - rr) + Math.abs(c - cc)));
}

/* ============================ 山丘之王·推山 / 石柱（服务端权威） ============================ */
const PILLAR_TURNS = 3; // 生成当回合结束不扣；之后每个完整回合结束 -1

function pushDirInfoS(s, u, r, c, dr, dc, ignoreCell) {
  const r1 = r + dr, c1 = c + dc;
  if (!inB(r1, c1)) return null;
  const a = (ignoreCell && ignoreCell.r === r1 && ignoreCell.c === c1) ? null : s.board[r1][c1];
  if (a) {
    if (!isUnit(a)) return null;
    if (a.player === u.player) return null;
    return { r: r1, c: c1, unit: a, dist: 1 };
  }
  const r2 = r + dr * 2, c2 = c + dc * 2;
  if (!inB(r2, c2)) return null;
  const b = (ignoreCell && ignoreCell.r === r2 && ignoreCell.c === c2) ? null : s.board[r2][c2];
  if (isUnit(b) && b.player !== u.player) return { r: r2, c: c2, unit: b, dist: 2 };
  return null;
}
function pushUnitForwardS(s, tgt, dr, dc, steps) {
  if (isFormImmuneS(tgt)) return 0;
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    const p = findPos(s, tgt);
    if (!p) break;
    const nr = p.r + dr, nc = p.c + dc;
    if (!inB(nr, nc)) break;
    if (isTitanS(tgt)) {
      if (!canTitanFitS(s, tgt, nr, nc, false)) break;
      placeTitanFootprintS(s, tgt, nr, nc); moved++;
      continue;
    }
    if (s.board[nr][nc]) break;
    s.board[nr][nc] = tgt; s.board[p.r][p.c] = null; moved++;
  }
  return moved;
}
function squeezeOutOfCellS(s, unit, cr, cc, nr, nc) {
  if (isFormImmuneS(unit)) return null;
  const p = findPos(s, unit);
  if (!p) return null;
  const ok = (r, c) => inB(r, c) && !s.board[r][c] && !(r === cr && c === cc);
  const dr = Math.sign(nr - cr), dc = Math.sign(nc - cc);
  const dirs = [[dr, dc]].concat(DIRS.filter((d) => !(d[0] === dr && d[1] === dc)));
  for (const [rr, cc2] of dirs) {
    const tr = p.r + rr, tc = p.c + cc2;
    if (!ok(tr, tc)) continue;
    if (isTitanS(unit)) {
      if (!canTitanFitS(s, unit, tr, tc, false)) continue;
      placeTitanFootprintS(s, unit, tr, tc);
    } else s.board[tr][tc] = unit;
    if (!isTitanS(unit)) s.board[p.r][p.c] = null;
    return { r: tr, c: tc };
  }
  let best = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!ok(r, c)) continue;
      if (isTitanS(unit) && !canTitanFitS(s, unit, r, c, false)) continue;
      const d = Math.abs(r - p.r) + Math.abs(c - p.c);
      if (!best || d < best.d || (d === best.d && (r < best.r || (r === best.r && c < best.c)))) best = { r, c, d };
    }
  }
  if (!best) return null;
  if (isTitanS(unit)) placeTitanFootprintS(s, unit, best.r, best.c);
  else { s.board[best.r][best.c] = unit; s.board[p.r][p.c] = null; }
  return { r: best.r, c: best.c };
}
/* 相邻格有英雄 → 强制挤开后再升起石柱；剑刃/已有石柱/越界不生成 */
function createPillarsAroundS(s, r, c, owner) {
  const cells = [];
  const squeezed = [];
  for (const [dr, dc] of DIRS) {
    const rr = r + dr, cc = c + dc;
    if (!inB(rr, cc)) continue;
    const cell = s.board[rr][cc];
    if (cell) {
      if (!isUnit(cell)) continue;
      const dest = squeezeOutOfCellS(s, cell, r, c, rr, cc);
      if (!dest) continue;
      squeezed.push({ unit: cell, to: dest });
    }
    if (s.board[rr][cc]) continue;
    s.board[rr][cc] = { pillar: true, uid: s.unitSeq++, owner, turns: PILLAR_TURNS, fresh: true };
    cells.push({ r: rr, c: cc });
  }
  return { cells, squeezed };
}
function tickPillarsS(s) {
  const broken = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = s.board[r][c];
      if (!isPillar(p)) continue;
      if (p.fresh) { p.fresh = false; continue; }
      p.turns = (p.turns || 0) - 1;
      if (p.turns <= 0) { s.board[r][c] = null; broken.push({ r, c }); }
    }
  }
  if (broken.length) slog(s, "🪨 临时石柱已经消失（" + broken.length + " 根）");
  return broken;
}

/* ============================ 渡鸦（服务端权威） ============================ */
const RAVEN_STEALTH_TURNS = 3;
const MIST_TURNS = 3;

/* ============================ 金蝉：禅坐 / 神掌（服务端） ============================ */
function isMeditatingS(u) { return !!(u && u.meditate); }
function resolveMeditateTurnS(s, player) {
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) continue;
    const md = u.meditate;
    if (!md) continue;
    if ((s.turnSerial || 0) <= (md.castTurn || 0)) continue;
    meditatePulseS(s, u);
    md.turns -= 1;
    if (md.turns <= 0) endMeditateS(s, u);
  }
}
function meditatePulseS(s, u) {
  const p = findPos(s, u);
  if (!p) return;
  const md = u.meditate;
  const cells = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = p.r + dr, cc = p.c + dc;
    if (inB(rr, cc)) cells.push([rr, cc]);
  }
  let remD = Math.max(0, 3 - (md.dealt || 0));
  let remH = Math.max(0, 3 - (md.healed || 0));
  const enemies = cells.map(([r, c]) => s.board[r][c]).filter((t) => isUnit(t) && t.player !== u.player);
  enemies.sort((a, b) => { const pa = findPos(s, a), pb = findPos(s, b); return (pa.r - pb.r) || (pa.c - pb.c); });
  let hits = 0, heals = 0;
  for (const e of enemies) {
    if (remD <= 0) break;
    if (!findPos(s, e)) continue;
    const dealt = applyDamage(s, e, Math.min(1, remD), u);
    if (dealt > 0) { remD -= dealt; md.dealt = (md.dealt || 0) + dealt; hits++; }
  }
  const allies = cells.map(([r, c]) => s.board[r][c]).filter((t) => isUnit(t) && t !== u && t.player === u.player);
  allies.sort((a, b) => { const pa = findPos(s, a), pb = findPos(s, b); return (pa.r - pb.r) || (pa.c - pb.c); });
  for (const a of allies) {
    if (remH <= 0) break;
    if (!findPos(s, a) || a.hp >= a.maxHp) continue;
    const healed = Math.min(1, remH, a.maxHp - a.hp);
    if (healed <= 0) continue;
    a.hp += healed; remH -= healed; md.healed = (md.healed || 0) + healed; heals++;
  }
  slog(s, "🧘 禅坐·佛光：" + hits + " 名敌人受到冲击，" + heals + " 名友军恢复生命（累计伤害 " + md.dealt + "/3，治疗 " + md.healed + "/3）");
}
function endMeditateS(s, u) {
  if (!u || !u.meditate) return;
  const md = u.meditate;
  u.meditate = null;
  const healed = Math.max(0, Math.min(2, u.maxHp - u.hp));
  if (healed > 0) u.hp += healed;
  slog(s, "🪷 禅坐结束：" + uname(s, u) + " 恢复 " + healed + " 点生命（累计伤害 " + md.dealt + "/3，治疗 " + md.healed + "/3）");
}

/* ============================ 鹰佐：雷劈 / 雷鸣刀（服务端） ============================ */
const FACE_NAME_S = { "0,1": "右", "0,-1": "左", "1,0": "下", "-1,0": "上" };
function faceDirS(u) {
  if (!u || !Array.isArray(u.facing) || u.facing.length !== 2) return u && u.player === 2 ? [0, -1] : [0, 1];
  return u.facing;
}
function faceNameS(u) { return FACE_NAME_S[faceDirS(u).join(",")] || "右"; }
function setFaceS(u, dr, dc) { u.facing = [dr, dc]; }
function resetThunderbladeS(u) {
  if (!u) return;
  u.rbStage = 0;
  u.rbBlade = null;
  u.rbDir = null;
}
function raikiriDirInfoS(s, u, r, c, dr, dc) {
  const r1 = r + dr, c1 = c + dc;
  if (!inB(r1, c1)) return null;
  const cell1 = s.board[r1][c1];
  if (isSword(cell1) || isPillar(cell1)) return null;
  if (isUnit(cell1)) {
    if (cell1.player === u.player) return null;
    return { hits: [{ r: r1, c: c1, dmg: 1 }] };
  }
  const r2 = r + dr * 2, c2 = c + dc * 2;
  if (!inB(r2, c2)) return null;
  const cell2 = s.board[r2][c2];
  if (isSword(cell2) || isPillar(cell2)) return null;
  if (isUnit(cell2) && cell2.player !== u.player) return { hits: [{ r: r2, c: c2, dmg: 2 }] };
  return null;
}
function tbForwardInfoS(s, u, r, c) {
  const [dr, dc] = faceDirS(u);
  const mr = r + dr, mc = c + dc;
  if (!inB(mr, mc) || s.board[mr][mc]) return null;
  const br = r + dr * 2, bc = c + dc * 2;
  if (!inB(br, bc)) return null;
  const bcell = s.board[br][bc];
  if (isSword(bcell) || isPillar(bcell)) return null;
  return { dir: [dr, dc], r: mr, c: mc, br, bc };
}
function tbLineCellsS(a, b) {
  if (!a || !b) return null;
  const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
  const adr = Math.abs(b.r - a.r), adc = Math.abs(b.c - a.c);
  if (!(adr === 0 || adc === 0 || adr === adc)) return null;
  const n = Math.max(adr, adc);
  const out = [];
  for (let k = 0; k <= n; k++) out.push({ r: a.r + dr * k, c: a.c + dc * k });
  return out;
}

/* ============================ 须佐：黑炎 / 鸦天狗（服务端） ============================ */
const BLACK_FLAME_TURNS_S = 3;
const CROW_FORM_TURNS_S = 3;
function isCrowFormS(u) { return !!(u && u.crowForm); }
function isFormImmuneS(u) { return isMeditatingS(u) || isCrowFormS(u); }
function resetCrowFormS(u) { if (u) u.crowForm = null; }
function blackFlameKeyS(r, c) { return r + "_" + c; }
function blackFlameAtS(s, r, c) { return (s.blackFlames && s.blackFlames[blackFlameKeyS(r, c)]) || null; }
function addBlackFlameAtS(s, r, c, owner) {
  if (!inB(r, c)) return false;
  if (!s.blackFlames) s.blackFlames = {};
  const key = blackFlameKeyS(r, c);
  if (s.blackFlames[key]) { s.blackFlames[key].turns = BLACK_FLAME_TURNS_S; return false; }
  s.blackFlames[key] = { turns: BLACK_FLAME_TURNS_S, fresh: true, owner };
  return true;
}
function tickBlackFlamesS(s) {
  if (!s.blackFlames) return;
  for (const key of Object.keys(s.blackFlames)) {
    const f = s.blackFlames[key];
    if (f.fresh) { f.fresh = false; continue; }
    f.turns -= 1;
    if (f.turns <= 0) delete s.blackFlames[key];
  }
}

/* ============================ 天穹射手：穿云箭 / 天罚 ============================ */
function skyarrowPlanS(s, u, r, c, dr, dc) {
  if (!u || (!dr && !dc) || (dr !== 0 && dc !== 0)) return null;
  const path = [];
  for (let k = 1; k < SIZE; k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inB(rr, cc)) return { path, hit: null, blocked: "edge", target: null, dir: [dr, dc] };
    const cell = s.board[rr][cc];
    path.push([rr, cc]);
    if (isPillar(cell) || isHammer(cell)) return { path, hit: null, blocked: "pillar", target: null, dir: [dr, dc] };
    if (isTitanPart(cell)) {
      const t = unitAtS(s, rr, cc);
      return { path, hit: t && t.player !== u.player ? t : null, blocked: t && t.player === u.player ? "ally" : "enemy", target: { r: rr, c: cc }, dir: [dr, dc] };
    }
    if (isUnit(cell)) {
      return { path, hit: cell.player !== u.player ? cell : null, blocked: cell.player === u.player ? "ally" : "enemy", target: { r: rr, c: cc }, dir: [dr, dc] };
    }
  }
  return { path, hit: null, blocked: "edge", target: null, dir: [dr, dc] };
}
function meteorCellsS(r, c, radius) {
  const out = [];
  const rad = radius == null ? 1 : radius;
  for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    const rr = r + dr, cc = c + dc;
    if (inB(rr, cc)) out.push([rr, cc]);
  }
  return out;
}
function findUnitByUidS(s, uid) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (isUnit(u) && u.uid === uid) return u;
  }
  return null;
}
function addMeteorS(s, u, r, c, sk) {
  if (!s.meteors) s.meteors = [];
  if (!s.meteorSeq) s.meteorSeq = 0;
  const m = {
    id: ++s.meteorSeq,
    r, c,
    owner: u.player,
    casterUid: u.uid,
    casterHeroId: u.heroId,
    turns: sk.delayTurns == null ? 2 : sk.delayTurns,
    damage: sk.damage == null ? 2 : sk.damage,
    radius: sk.radius == null ? 1 : sk.radius,
  };
  s.meteors.push(m);
  return m;
}
function resolveMeteorS(s, m) {
  if (!m) return;
  const cells = meteorCellsS(m.r, m.c, m.radius);
  slog(s, "☄ 天罚降临！陨星坠落在 (" + (m.r + 1) + "," + (m.c + 1) + ")，3×3 范围内的敌方英雄受到 " + m.damage + " 点伤害");
  const caster = findUnitByUidS(s, m.casterUid) || { uid: -1, heroId: m.casterHeroId || "ranger", player: m.owner };
  let hit = 0;
  for (const [rr, cc] of cells) {
    const v = s.board[rr][cc];
    if (!isUnit(v) || v.player === m.owner) continue;
    const dealt = applyDamage(s, v, m.damage, caster);
    hit++;
    slog(s, "☄ 天罚命中：" + uname(s, v) + " 受到 " + m.damage + " 点伤害" + (dealt > 0 ? "（实际扣血 " + dealt + "）" : "（未造成生命伤害）"));
  }
  if (!hit) slog(s, "☄ 天罚落点范围内没有敌方英雄，未造成伤害");
}
function tickMeteorsS(s, endedPlayer) {
  if (!s.meteors || !s.meteors.length) return;
  const due = [];
  for (const m of s.meteors) {
    if (m.owner === endedPlayer) continue;
    m.turns -= 1;
    if (m.turns > 0) {
      slog(s, "☄ 天罚倒计时：玩家" + m.owner + "·天穹射手的陨星还有 " + m.turns + " 个完整对手回合坠落（落点 (" + (m.r + 1) + "," + (m.c + 1) + ")）");
    } else {
      due.push(m);
    }
  }
  for (const m of due) {
    resolveMeteorS(s, m);
    if (checkVictory(s)) break;
  }
  s.meteors = s.meteors.filter((m) => due.indexOf(m) < 0);
}
function applyBlackFlameS(s, player) {
  for (const u of unitsOf(s, player).slice()) {
    if (isTimeStopped(u)) continue;
    const p = findPos(s, u);
    if (!p) continue;
    const f = blackFlameAtS(s, p.r, p.c);
    if (!f) continue;
    if (f.owner === u.player) continue; // 黑炎不伤害施放者一方
    const dealt = applyDamage(s, u, 0.5, null);
    if (dealt > 0) slog(s, "🔥 黑炎：" + uname(s, u) + " 受到 0.5 点伤害（余 " + u.hp + "）");
  }
}
function crowDirOfS(u) {
  const f = u && u.crowForm;
  if (f && Array.isArray(f.dir)) return f.dir;
  return faceDirS(u);
}
function crowAreaS(s, u) {
  const p = findPos(s, u);
  if (!p) return [];
  const d = crowDirOfS(u);
  const cr = p.r + d[0], cc = p.c + d[1];
  if (!inB(cr, cc)) return [];
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = cr + dr, c2 = cc + dc;
    if (inB(rr, c2)) out.push([rr, c2]);
  }
  return out;
}
function crowPulseS(s, u) {
  const cells = crowAreaS(s, u);
  if (!cells.length) return;
  let hit = 0;
  for (const [r, c] of cells) {
    const e = s.board[r][c];
    if (!isUnit(e) || e === u || e.player === u.player) continue;
    const dealt = applyDamage(s, e, 0.5, u);
    if (dealt > 0) hit++;
  }
  slog(s, "🪶 鸦天狗·风压：正前方九宫格内 " + hit + " 名敌人各受到 0.5 点伤害");
}
function endCrowFormS(s, u) {
  if (!u || !u.crowForm) return;
  u.crowForm = null;
  slog(s, "🪶 " + uname(s, u) + " 的鸦天狗形态结束，解除无敌与行动限制");
}
function resolveCrowTurnS(s, player) {
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) continue;
    const f = u.crowForm;
    if (!f) continue;
    if ((s.turnSerial || 0) <= (f.castTurn || 0)) continue;
    crowPulseS(s, u);
    f.turns -= 1;
    if (f.turns <= 0) endCrowFormS(s, u);
  }
}
function cellsAround3S(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if (inB(rr, cc)) out.push([rr, cc]);
  }
  return out;
}
const SUSANO_DIAG_S = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
function susanoDashPlanS(s, u, r, c, dr, dc) {
  const r1 = r + dr, c1 = c + dc, r2 = r + dr * 2, c2 = c + dc * 2;
  if (!inB(r1, c1) || !inB(r2, c2)) return null;
  const first = s.board[r1][c1];
  if (isPillar(first) || isSword(first)) return null;
  if (s.board[r2][c2]) return null;
  const target = isUnit(first) && first.player !== u.player ? first : null;
  return { first: { r: r1, c: c1 }, second: { r: r2, c: c2 }, target };
}
function susanoPullPlanS(s, u, r, c, dr, dc) {
  const r1 = r + dr, c1 = c + dc, r2 = r + dr * 2, c2 = c + dc * 2;
  if (!inB(r1, c1) || !inB(r2, c2)) return null;
  const t = isUnit(s.board[r1][c1]) ? s.board[r1][c1] : null;
  if (!t || t.player === u.player || hiddenFromS(t, u.player)) return null;
  if (s.board[r2][c2]) return null;
  return { target: t, from: { r: r1, c: c1 }, landing: { r: r2, c: c2 } };
}
function susanoArrowPlanS(s, u, r, c, dr, dc) {
  const r1 = r + dr, c1 = c + dc, r2 = r + dr * 2, c2 = c + dc * 2;
  if (!inB(r1, c1) || !inB(r2, c2)) return null;
  const first = s.board[r1][c1], second = s.board[r2][c2];
  if (isPillar(first) || isSword(first)) return null;
  if (isPillar(second) || isSword(second)) return null;
  if (isUnit(first)) {
    if (first.player === u.player) return null;
    if (second) return null;
    return { mode: "pull", first: { r: r1, c: c1 }, second: { r: r2, c: c2 }, target: first };
  }
  return { mode: "explode", first: { r: r1, c: c1 }, second: { r: r2, c: c2 } };
}
function qiankunTargetsS(s, u) {
  const p = findPos(s, u);
  if (!p) return [];
  const out = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    if (dr === 0 && dc === 0) continue;
    const rr = p.r + dr, cc = p.c + dc;
    if (!inB(rr, cc)) continue;
    const v = s.board[rr][cc];
    if (isUnit(v) && v.player !== u.player) out.push(v);
  }
  return out;
}
function qiankunPullDestS(s, u, from, occupied, reserved) {
  const p = findPos(s, u);
  if (!p) return null;
  const dist = Math.abs(from.r - p.r) + Math.abs(from.c - p.c);
  if (dist <= 1) return null;
  const cand = [];
  for (const [dr, dc] of DIRS) {
    const nr = from.r + dr, nc = from.c + dc;
    if (!inB(nr, nc)) continue;
    if (nr === p.r && nc === p.c) continue;
    const key = nr + "_" + nc;
    if (occupied.has(key) || reserved.has(key)) continue;
    const nd = Math.abs(nr - p.r) + Math.abs(nc - p.c);
    if (nd >= dist) continue;
    cand.push({ r: nr, c: nc, d: nd, axis: Math.abs(from.r - p.r) >= Math.abs(from.c - p.c) ? 0 : 1 });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a.d - b.d || a.axis - b.axis || a.r - b.r || a.c - b.c);
  return { r: cand[0].r, c: cand[0].c };
}

function isStealthedS(u) {
  return !!(u && u.stealth && (u.stealth.turns || 0) > 0);
}
function hiddenFromS(u, viewer) {
  return !!(u && viewer !== u.player && isStealthedS(u));
}
function stealthRangeOkS(dr, dc) {
  if (!dr && !dc) return true;
  const box3 = Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
  const line2 = (dr === 0 || dc === 0) && Math.abs(dr) + Math.abs(dc) <= 2;
  return box3 || line2;
}
function metalPierceInfoS(s, u, r, c, dr, dc) {
  const out = [];
  for (let k = 1; k <= 2; k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inB(rr, cc)) break;
    const cell = s.board[rr][cc];
    if (isPillar(cell) || isSword(cell)) break;
    if (!cell) continue;
    if (cell.player === u.player) break;
    out.push(cell);
  }
  return out;
}
function mistDashPathS(s, u, r, c, dr, dc, maxSteps) {
  const path = [];
  let dest = null;
  for (let k = 1; k <= (maxSteps || 3); k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inB(rr, cc)) break;
    const cell = s.board[rr][cc];
    if (isPillar(cell) || isHammer(cell)) break;
    path.push([rr, cc]);
    if (!cell) dest = { r: rr, c: cc };
  }
  if (!dest) return { path: [], dest: null, dir: [dr, dc] };
  const steps = Math.abs(dest.r - r) + Math.abs(dest.c - c);
  return { path: path.slice(0, steps), dest, dir: [dr, dc] };
}
function mistAtS(s, r, c) { return (s.mists && s.mists[r + "_" + c]) || null; }
function addMistAtS(s, r, c, owner) {
  if (!s.mists) s.mists = {};
  const key = r + "_" + c;
  if (s.mists[key]) return false;
  s.mists[key] = { turns: MIST_TURNS, fresh: true, owner };
  return true;
}
function tickMistsS(s) {
  if (!s.mists) return;
  const gone = 0;
  for (const key of Object.keys(s.mists)) {
    const m = s.mists[key];
    if (m.fresh) { m.fresh = false; continue; }
    m.turns -= 1;
    if (m.turns <= 0) delete s.mists[key];
  }
}
function applyMistPoisonS(s, player) {
  for (const u of unitsOf(s, player).slice()) {
    if (isTimeStopped(u)) continue;
    const p = findPos(s, u);
    if (!p) continue;
    const m = mistAtS(s, p.r, p.c);
    if (!m) continue;
    if (m.owner === u.player) continue; // 己方毒雾不伤己方
    const dealt = applyDamage(s, u, 0.5, null);
    if (dealt > 0) {
      slog(s, "☠ 毒雾： " + uname(s, u) + " 受到 0.5 点伤害（余 " + u.hp + "）");
    }
  }
}
/* 毒雾刚生成：立即对雾格上的敌方单位结算一次 0.5（每个单位一次，己方免疫） */
function mistBurstS(s, cells, owner) {
  const seen = new Set();
  for (const [r, c] of cells) {
    const u = isUnit(s.board[r][c]) ? s.board[r][c] : null;
    if (!u || u.player === owner || seen.has(u.uid)) continue;
    seen.add(u.uid);
    const dealt = applyDamage(s, u, 0.5, null);
    if (dealt > 0) slog(s, "☠ 毒雾瞬间侵蚀： " + uname(s, u) + " 受到 0.5 点伤害（余 " + u.hp + "）");
  }
}
function clearRavenStealthS(u) {
  if (!u) return;
  u.stealth = null;
  u.ravenBuff = false;
  u.ravenDouble = false;
  u.ravenDoubleUsed = false;
}
function consumeRavenAttackStateS(s, u) {
  if (!u) return;
  if (isStealthedS(u)) { u.stealthLog = { reason: "主动攻击", broken: true, at: Date.now() }; slog(s, "🌑 " + uname(s, u) + " 出手攻击，隐身在瞬间破除"); }
  u.stealth = null;
  u.ravenBuff = false;
  u.ravenDouble = false;
  u.ravenDoubleUsed = false;
}
/* 金元素·金属狂潮：按自身行动回合计时（本回合使用后跨 3 个自身回合） */
function tickMetalTurnS(s, player) {
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) continue;
    if (!u.metalTide || u.metalTide <= 0) continue;
    u.metalTide -= 1;
    if (u.metalTide <= 0) {
      u.metalTide = 0;
      slog(s, "🛡 " + uname(s, u) + " 的【金属狂潮】结束，受到的伤害恢复正常");
    }
  }
}
function tickRavenTurnS(s, player, countDuration) {
  if (countDuration) {
    for (const u of unitsOf(s, player)) {
      if (isTimeStopped(u)) continue;
      if (!u.stealth) continue;
      if (u.stealth.fresh) { u.stealth.fresh = false; continue; }
      u.stealth.turns -= 1;
      if (u.stealth.turns <= 0) {
        slog(s, "🌑 " + uname(s, u) + " 的潜行结束（持续时间结束）");
        clearRavenStealthS(u);
      }
    }
  }
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) continue;
    if (u.ravenDoubleUsed) { u.ravenDouble = false; u.ravenDoubleUsed = false; }
  }
}

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
function slog(s, text, opts) {
  if (!s.log) { s.log = []; s.logSeq = 0; }
  s.logSeq = (s.logSeq || 0) + 1;
  const e = { id: s.logSeq, text };
  if (opts && opts.only) e.only = opts.only; // 仅对该玩家可见（隐身坐标等）
  s.log.push(e);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  return s.logSeq;
}
function uname(s, u) {
  if (!u) return "？";
  if (isMirrorS(u)) return "玩家" + u.player + "·镜影";
  const d = heroDef(u.heroId);
  return "玩家" + u.player + "·" + ((d && d.name) || u.heroId);
}
function createState() {
  const board = [];
  for (let r = 0; r < SIZE; r++) board.push(new Array(SIZE).fill(null));
  return { board, phase: "placement", currentPlayer: 1, winner: 0, unitSeq: 1,
           toPlace: PER_PLAYER, placed: { 1: [], 2: [] }, pools: drawPools(), turnActionUsed: false,
           turnActionsMax: 1, turnActionsLeft: 1, turnActorUid: 0, empowerTurnActive: false,
           talisman: { 1: drawTalismanId(), 2: drawTalismanId() }, talismanUsed: { 1: false, 2: false }, wildcards: { 1: 3, 2: 3 },
           assaultPlayer: 0, guardPlayer: 0, extraMoves: 0, extraTurnPending: false, graveyard: [], mists: {}, blackFlames: {}, meteors: [], meteorSeq: 0, crosses: [], crossSeq: 0,
           timeAnchors: [], timeAnchorSeq: 0, holyDomains: [], holyDomainSeq: 0,
           stats: { damage: { 1: 0, 2: 0 }, kills: { 1: 0, 2: 0 }, startedAt: 0, endedAt: 0, lastKiller: null },
           log: [], logSeq: 0, _undo: [] };
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
    if (isUnit(u) && !isMirrorS(u) && u.player === p) list.push(u);
  }
  return list;
};
function hasSwordPassiveS(u) {
  return !!(u && !u.sword && hasPassiveEffectS(u, "asura", "锻剑"));
}
function hasAsuraAlive(s) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (hasSwordPassiveS(u)) return true;
  }
  return false;
}
function flankCountAt(s, r, c) {
  const u = s.board[r][c];
  if (!isUnit(u) || isMirrorS(u)) return { enemy: 0, wall: 0, total: 0 };
  let enemy = 0, wall = 0;
  const seen = new Set();
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (!inB(nr, nc)) { wall++; continue; }
    const t = unitAtS(s, nr, nc);
    if (t && !isMirrorS(t) && t.player !== u.player && !seen.has(t.uid)) { seen.add(t.uid); enemy++; }
  }
  return { enemy, wall, total: enemy + wall };
}
/* 夹击信息：Map<uid, {base, protected, flanked, bonus, count}> */
function flankInfo(s) {
  const info = new Map();
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (!isUnit(u) || isMirrorS(u)) continue;
    const fc = flankCountAt(s, r, c);
    info.set(u.uid, { count: fc.total, base: fc.enemy >= 1 && fc.total >= 2, protected: false, flanked: false, bonus: 0 });
  }
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (!isUnit(u) || isMirrorS(u)) continue;
    const d = info.get(u.uid);
    if (!d || !d.base) continue;
    for (const [dr, dc] of DIRS) {
      const v = unitAtS(s, r + dr, c + dc);
      if (v && !isMirrorS(v) && v.player === u.player && info.get(v.uid) && !info.get(v.uid).base) { d.protected = true; break; }
    }
  }
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const u = s.board[r][c];
    if (!isUnit(u) || isMirrorS(u)) continue;
    const d = info.get(u.uid);
    if (!d) continue;
    d.immune = isLoneActive(s, u) || isTitanS(u);         // 孤胆 / 泰坦形态免疫夹击
    d.flanked = d.base && !d.protected && !d.immune;
    d.bonus = d.flanked ? d.count - 1 : 0;
  }
  return info;
}
/* 刺客·暗杀：刺客是否参与针对 target 的夹击（攻击者是刺客，或目标相邻有同为攻击方阵营的刺客） */
function assassinInFlank(s, attacker, target) {
  if (!attacker || attacker.sword || isSilenced(attacker)) return false;
  const p = findPos(s, target);
  if (!p) return false;
  for (const [dr, dc] of DIRS) {
    const v = inB(p.r + dr, p.c + dc) ? s.board[p.r + dr][p.c + dc] : null;
    if (v && !v.sword && v.player === attacker.player && hasPassiveEffectS(v, "assassin", "暗杀")) return true;
  }
  return false;
}
/* 西楚霸王·鬼雄是否已触发（绝境：普通攻击 +1） */
function isGuixiongActive(s, u) {
  return !!(u && !u.sword && hasPassiveEffectS(u, "xiangyu", "鬼雄") && u.guixiongUsed);
}
function normalDamage(s, attacker, target) {
  const d = flankInfo(s).get(target.uid);
  const assassin = d && d.flanked && assassinInFlank(s, attacker, target) ? 1 : 0;
  const guixiong = isGuixiongActive(s, attacker) ? 1 : 0; // 绝境：普攻 +1
  const berserker = berserkerNormalBonus(attacker); // 狂化：仅普通攻击
  return BASE_ATTACK + (d ? d.bonus : 0) + assassin + guixiong + berserker + attackerBonus(s, attacker);
}
/* 鬼雄触发时的九宫格反击：对周围 8 格内敌人各 2 点（走统一结算） */
function guixiongVictimsS(s, u) {
  const p = findPos(s, u);
  if (!p) return [];
  const victims = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const t = inB(p.r + dr, p.c + dc) ? s.board[p.r + dr][p.c + dc] : null;
      if (isUnit(t) && t.player !== u.player) victims.push(t);
    }
  }
  return victims;
}
function guixiongCounter(s, u, readyVictims) {
  if (!u || !findPos(s, u)) return 0;
  const victims = readyVictims || guixiongVictimsS(s, u);
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
  const seen = new Set();
  let rr = r + dr, cc = c + dc;
  while (inB(rr, cc)) {
    path.push([rr, cc]);
    const cell = s.board[rr][cc];
    const hitTarget = isTitanPart(cell) ? unitAtS(s, rr, cc) : cell;
    if (isUnit(hitTarget) && hitTarget.player !== u.player && !seen.has(hitTarget.uid)) {
      seen.add(hitTarget.uid);
      hits.push({ r: rr, c: cc });
    }
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
/* 单位击杀任意敌人 → 刷新其标记了 refreshOnKill 的技能（刺客·追猎）。
 * 标记 refreshOnlyOnSkillKill 的技能（吸血鬼·血崩）只由“技能自身击杀”触发刷新。
 * 同一次击杀只刷新一次（技能次数已满时不再重复触发）。返回是否真的刷新。 */
function refreshSkillOnKill(s, a) {
  if (!a || a.sword) return false;
  const skills = unitSkills(a);
  let refreshed = false;
  let name = "";
  for (let i = 0; i < skills.length; i++) {
    const skk = skills[i];
    if (!skk || !skk.refreshOnKill) continue;
    if (skk.refreshOnlyOnSkillKill) continue;
    const max = skk.uses == null ? Infinity : skk.uses;
    const cur = skillUsesLeft(s, a, i);
    if (cur === Infinity || cur >= max) continue;
    setSkillUses(s, a, i, max);
    refreshed = true;
    name = skk.name;
  }
  if (refreshed) {
    s.chaseRefreshSeq = (s.chaseRefreshSeq || 0) + 1;
    slog(s, "♻ " + uname(s, a) + " 击杀了敌人，【" + name + "】使用次数已刷新。");
  }
  return refreshed;
}
/* 技能自身击杀 → 刷新标记 refreshOnlyOnSkillKill 的技能（吸血鬼·血崩） */
function refreshSkillOnSkillKill(s, a, idx) {
  if (!a || a.sword) return false;
  const skills = unitSkills(a);
  const sk = skills[idx];
  if (!sk || !sk.refreshOnlyOnSkillKill) return false;
  const max = sk.uses == null ? Infinity : sk.uses;
  const cur = skillUsesLeft(s, a, idx);
  if (cur === Infinity || cur >= max) return false;
  setSkillUses(s, a, idx, max);
  s.chaseRefreshSeq = (s.chaseRefreshSeq || 0) + 1;
  return true;
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
  // 鹰佐·雷鸣刀第三段：不消耗普通行动
  if (sk.type === "thunderblade") return !!(u && (u.rbStage || 0) === 2);
  return isFreeSkillS(sk);
}
function spawnSword(s, r, c) {
  if (!hasAsuraAlive(s) || !inB(r, c) || s.board[r][c]) return false;
  s.board[r][c] = { sword: true, uid: s.unitSeq++ };
  return true;
}
/* ============================ 限时护盾层（杨戬） ============================ */
function addTimedShieldS(s, u, amount, turns, label) {
  if (!u || amount <= 0) return 0;
  u.shieldLayers = u.shieldLayers || [];
  u.shieldLayers.push({ amount, turns: turns == null ? 2 : turns, label: label || "临时护盾" });
  u.shield = (u.shield || 0) + amount;
  slog(s, "🛡 " + uname(s, u) + " 获得 " + amount + " 点临时护盾（持续 " + (turns == null ? 2 : turns) + " 个自身行动回合）");
  return amount;
}
function consumeShieldLayersS(target, absorbed) {
  if (!target || absorbed <= 0) return;
  const layers = target.shieldLayers || [];
  let left = absorbed;
  for (const layer of layers) {
    if (left <= 0) break;
    const take = Math.min(layer.amount, left);
    layer.amount -= take;
    left -= take;
  }
  target.shieldLayers = layers.filter((l) => l.amount > 0.0001);
}
function tickShieldLayersS(s, player) {
  for (const u of unitsOf(s, player)) {
    if (isTimeStopped(u)) continue;
    const layers = u.shieldLayers || [];
    if (!layers.length) continue;
    const expired = [];
    for (const layer of layers) {
      if (layer.turns == null) continue;
      layer.turns -= 1;
      if (layer.turns <= 0) expired.push(layer);
    }
    for (const layer of expired) {
      const idx = layers.indexOf(layer);
      if (idx >= 0) layers.splice(idx, 1);
      u.shield = Math.max(0, (u.shield || 0) - layer.amount);
      slog(s, "🛡 " + uname(s, u) + " 的 " + layer.label + " 到期，剩余 " + layer.amount + " 点护盾消失");
    }
    u.shieldLayers = layers;
  }
}

function applyDamage(s, target, amount, source) {
  const pos = findPos(s, target);
  if (isMirrorS(target)) {
    if (!pos || amount <= 0) return 0;
    s.board[pos.r][pos.c] = null;
    slog(s, "🪞 " + uname(s, target) + " 破碎（受到任意伤害立即消失）", { only: target.player });
    if (source && !source.sword && !isMirrorS(source) && source.player !== target.player && findPos(s, source)) {
      slog(s, "🪞 镜像反射：" + uname(s, source) + " 击败镜像，受到 0.5 点反伤", { only: target.player });
      applyDamage(s, source, 0.5, null);
    }
    return 1;
  }
  if (isFormImmuneS(target)) {
    slog(s, (isCrowFormS(target) ? "🪶 鸦天狗·无敌：" : "🛡 禅坐·无敌：") + uname(s, target) + " 免疫了本次伤害");
    return 0;
  }
  let dmg = amount;
  if (s.guardPlayer === target.player && dmg > 0) { const before = dmg; dmg = Math.max(0, dmg - 1); if (before > dmg) slog(s, "🛡 坚守令为 " + uname(s, target) + " 减免 1 点伤害"); }
  // 金属狂潮：受到伤害减半（只结算一次）
  if (target.metalTide > 0 && dmg > 0) {
    const beforeHalf = dmg;
    dmg = dmg * 0.5;
    slog(s, "🛡 金属狂潮：" + uname(s, target) + " 受到的伤害减半（" + beforeHalf + " → " + dmg + "）");
  }
  // 山丘之王·泰坦之力：形态期间受到的伤害减少 50%
  if (dmg > 0 && isTitanS(target)) {
    const beforeTitan = dmg;
    dmg = Math.max(0, dmg * 0.5);
    slog(s, "🗿 泰坦减伤：" + uname(s, target) + " 受到的伤害减少 50%（" + beforeTitan + " → " + dmg + "）");
  }
  // 统一格挡：狂化 / 神圣加护等来源只取一次 0.5，避免重复叠加。
  const blockSource = unitBlockSourceS(s, target);
  if (blockSource && dmg > 0) {
    const beforeBlock = dmg;
    dmg = Math.max(0, dmg - 0.5);
    slog(s, "🛡 " + blockSource + "·格挡：" + uname(s, target) + " 抵消 0.5 点伤害（" + beforeBlock + " → " + dmg + "）");
  }
  if (target.shield > 0) { const a = Math.min(target.shield, dmg); target.shield -= a; dmg -= a; consumeShieldLayersS(target, a); if (a > 0) slog(s, uname(s, target) + " 的护盾抵挡了 " + a + " 点伤害"); }
  // 龙魂：龙人 1/2 概率闪避（护盾等前置处理之后、完全抵消则不触发）
  if (dmg > 0 && hasPassiveEffectS(target, "longren", "龙魂") && Math.random() < 1 / 2) {
    dmg = 0;
    target.dragonMoves = (target.dragonMoves || 0) + 1;
    slog(s, "🐉 龙魂：" + uname(s, target) + " 闪避了本次伤害（并积累 1 次龙胆）");
  }
  // 孤胆侠·霸体：首次致命伤害锁血到 1
  if (dmg > 0 && target.hp - dmg <= 0 && hasPassiveEffectS(target, "lone", "孤胆") && hasSuperArmor(s, target) && !target.lockUsed) {
    target.lockUsed = true;
    dmg = Math.max(0, target.hp - 1);
    slog(s, "🛡 霸体：" + uname(s, target) + " 抵挡致命伤害，生命锁定为 1（本局一次）");
  }
  // 西楚霸王·鬼雄：首次致命伤害锁血到 1（每局一次），随后反击九宫格并进入绝境
  let guixiongTriggered = false;
  if (dmg > 0 && target.hp - dmg <= 0 && hasPassiveEffectS(target, "xiangyu", "鬼雄") && !target.guixiongUsed) {
    target.guixiongUsed = true;
    guixiongTriggered = true;
    dmg = Math.max(0, target.hp - 1);
    slog(s, "👹 鬼雄：" + uname(s, target) + " 生命锁定为 1，并对九宫格内敌人反击 2 点");
  }
  if (dmg > 0) { target.hp -= dmg; slog(s, uname(s, target) + " 受到 " + dmg + " 点伤害（余 " + target.hp + "）"); }
  if (guixiongTriggered && findPos(s, target)) {
    if (isTimeStopped(target)) {
      const victims = guixiongVictimsS(s, target);
      queueTimeStopEffectS(target, { kind: "guixiong", victimUids: victims.map((v) => v.uid), damage: 2 });
      slog(s, "👹 鬼雄反击已触发，但因【时间停止】延迟到时停结束后结算");
    } else {
      guixiongCounter(s, target);
    }
    slog(s, "👹 西楚霸王进入【绝境】：普通攻击 +1");
  }
  if (target.hp <= 0 && pos) handleUnitDeathS(s, target, source, pos);
  // 真实战绩：实际造成的生命伤害
  if (dmg > 0 && source && !source.sword && source.player !== target.player && s.stats) {
    s.stats.damage[source.player] = (s.stats.damage[source.player] || 0) + dmg;
  }
  return dmg;
}
/* 单位阵亡统一处理（伤害 / 生命代价共用） */
function handleUnitDeathS(s, target, source, pos) {
  if (!target || !pos) return;
  if (target.isMinion) {
    s.board[pos.r][pos.c] = null;
    slog(s, "💀 " + uname(s, target) + " 消散（小亡灵死亡不再留下十字架）");
    if (source && !source.sword && source.player !== target.player) {
      if (s.stats) {
        s.stats.kills[source.player] = (s.stats.kills[source.player] || 0) + 1;
        s.stats.lastKiller = { player: source.player, heroId: source.heroId };
      }
    }
    return;
  }
  resetThunderbladeS(target); // 鹰佐阵亡：终止连招并移除雷刀
  resetCrowFormS(target); // 须佐阵亡：清除鸦天狗形态
  const titanSnapshot = JSON.parse(JSON.stringify(target));
  titanSnapshot.size = 1;
  titanSnapshot.titanTurns = 0;
  if (isTitanS(target)) clearTitanFootprintS(s, target);
  if (target.heroId === "hillking") removeHammerS(s, target.uid);
  target.chaseMark = 0;
  if (target.heroId === "assassin") clearChaseMarks(s, target.uid);
  s.graveyard.push({ player: target.player, heroId: target.heroId, deadUid: target.uid, r: pos.r, c: pos.c, usesLeft: target.usesLeft || 0, usesArr: target.usesArr ? target.usesArr.slice() : null, swords: target.swords || 0, lockUsed: !!target.lockUsed, guixiongUsed: !!target.guixiongUsed, snapshot: titanSnapshot });
  removeTimeAnchorsForS(s, target.uid);
  target.timeStop = null;
  target.timeStopPending = [];
  if (isTitanS(target)) clearTitanFootprintS(s, target);
  else s.board[pos.r][pos.c] = null;
  slog(s, "☠ " + uname(s, target) + " 阵亡！");
  addDeathCrossS(s, target, pos);
  spawnSword(s, pos.r, pos.c);
  if (source && !source.sword && source.player !== target.player && findPos(s, source)) {
    refreshSkillOnKill(s, source);
  }
  if (source && !source.sword && source.player !== target.player) {
    if (s.stats) {
      s.stats.kills[source.player] = (s.stats.kills[source.player] || 0) + 1;
      s.stats.lastKiller = { player: source.player, heroId: source.heroId };
    }
  }
}
/* 金元素：主动支付生命值（不吃护盾/闪避/减伤），归零立即正常阵亡 */
function payHpCostS(s, u, amount, reason) {
  if (!u) return false;
  // 金属狂潮期间：技能的生命代价同样减半
  const cost = u.metalTide > 0 ? amount * 0.5 : amount;
  u.hp -= cost;
  slog(s, "💢 " + uname(s, u) + " 失去 " + cost + " 点生命值（" + (reason || "技能代价") + (cost !== amount ? "·金属狂潮减半" : "") + "）");
  const p = findPos(s, u);
  if (u.hp <= 0 && p) {
    handleUnitDeathS(s, u, null, p);
    return false;
  }
  return true;
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
  const seen = new Set();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const v = unitAtS(s, r + dr, c + dc);
      if (v && v.player !== player && !seen.has(v.uid)) { seen.add(v.uid); out.push(v); }
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
  if (isFormImmuneS(t)) return null;
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
    if (isTitanS(t) && !canTitanFitS(s, t, nr, nc, false)) continue;
    if (isTitanS(t)) placeTitanFootprintS(s, t, nr, nc);
    else { s.board[nr][nc] = t; s.board[p.r][p.c] = null; }
    return { r: nr, c: nc };
  }
  const far = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (!ok(r, c)) continue;
    if (isTitanS(t) && !canTitanFitS(s, t, r, c, false)) continue;
    far.push({ r, c, d: Math.abs(r - p.r) + Math.abs(c - p.c) });
  }
  if (!far.length) return null;
  far.sort((A, B) => A.d - B.d || A.r - B.r || A.c - B.c);
  const dest = far[0];
  if (isTitanS(t)) placeTitanFootprintS(s, t, dest.r, dest.c);
  else { s.board[dest.r][dest.c] = t; s.board[p.r][p.c] = null; }
  return dest;
}
/* 万象天引第三段：沿远离 (fromR,fromC) 的方向击退 1 格 */
function pushAwayOneS(s, t, fromR, fromC) {
  if (isFormImmuneS(t)) return null;
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
    if (isTitanS(t) && !canTitanFitS(s, t, nr, nc, false)) continue;
    if (isTitanS(t)) placeTitanFootprintS(s, t, nr, nc);
    else { s.board[nr][nc] = t; s.board[p.r][p.c] = null; }
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
  const hits = []; const seen = new Set(); let dest = null;
  for (let k = 1; k <= steps; k++) {
    const rr = r + dr * k, cc = c + dc * k;
    if (!inB(rr, cc)) break;
    const cell = s.board[rr][cc];
    if (!cell) { dest = { r: rr, c: cc }; continue; }
    if (cell.sword) { dest = { r: rr, c: cc }; continue; }
    if (cell.pillar || cell.hammer) break; // 石柱 / 战争之锤阻挡突进
    const hitTarget = isTitanPart(cell) ? unitAtS(s, rr, cc) : cell;
    if (!hitTarget) continue;
    if (hitTarget.player === u.player) continue; // 统一突进：友军可穿过，不挡不伤
    if (!seen.has(hitTarget.uid)) { seen.add(hitTarget.uid); hits.push({ r: rr, c: cc }); }
  }
  return { dir: [dr, dc], dest, hits };
}
function beginTurn(s) {
  s.turnSerial = (s.turnSerial || 0) + 1;
  const isExtraTurn = !!s.turnIsExtra; // 行军令额外回合：不推进鸦天狗
  s.turnIsExtra = false;
  s._undo = []; // 新回合：不能悔到上一回合
  // 时间行者：破空延迟爆发在自身下一回合开始时触发
  processTimeAnchorsStartS(s, s.currentPlayer);
  if (checkVictory(s)) return;
  // 金蝉·禅坐：自身行动回合开始时结算九宫格（开启当回合不结算）
  resolveMeditateTurnS(s, s.currentPlayer);
  if (checkVictory(s)) return;
  // 须佐·鸦天狗：自身行动回合开始时结算前方九宫格 0.5（开启当回合不结算；额外回合不推进）
  if (!isExtraTurn) resolveCrowTurnS(s, s.currentPlayer);
  if (checkVictory(s)) return;
  // 限时护盾按自身真实行动回合倒计时，额外回合不推进
  if (!isExtraTurn) tickShieldLayersS(s, s.currentPlayer);
  for (const u of unitsOf(s, s.currentPlayer)) {
    u.skillTurnUsed = {};
    unitSkills(u).forEach((sk, i) => {
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
  const skills = unitSkills(u);
  return skills.some((sk, i) => sk.perTurn && skillUsesLeft(s, u, i) > 0);
}
/* 是否还有可执行行动（用于“不能直接跳过回合”与“无行动自动跳过”）
 * 被抓取 / 冰封的单位不能行动，因此不计入 */
function hasAnyActionState(s, player) {
  for (const u of unitsOf(s, player)) {
    if (u.frozen > 0) continue;
    if (isDisabled(u)) continue; // 抓取 / 眩晕：本回合无法移动/攻击/用技能
    if (isMeditatingS(u)) continue; // 禅坐：本回合无法行动
    if (isCrowFormS(u)) continue; // 鸦天狗：本回合无法行动
    const pos = findPos(s, u);
    if (!pos) continue;
    const rooted = isRooted(u);
    const silenced = isSilenced(u);
    const canMove = !rooted;
    const sk = heroDef(u.heroId).skill;
    if (!silenced && !s.turnActionUsed && sk && u.usesLeft > 0 && !(rooted && isSelfMoveSkillS(u, sk))) return true;
    // 鹰佐：雷鸣刀第三段不耗行动；第二段仍需行动
    if (!silenced && !rooted && (u.rbStage || 0) === 2) return true;
    if (!silenced && !s.turnActionUsed && !rooted && (u.rbStage || 0) === 1) return true;
    for (const [dr, dc] of DIRS) {
      const nr = pos.r + dr, nc = pos.c + dc;
      if (!inB(nr, nc)) continue;
      const t = s.board[nr][nc];
      if (!t) { if (canMove && !s.turnActionUsed) return true; continue; }
      if (isSword(t)) { if (hasSwordPassiveS(u) && canMove && !s.turnActionUsed) return true; continue; }
      if (isUnit(t) && t.player !== player && !hiddenFromS(t, player) && !s.turnActionUsed) return true;
    }
    // 天穹射手：普攻可直线攻击 2 格（跨过中间单位/石柱，但不能斜向）
    if (u.heroId === "ranger" && !s.turnActionUsed) {
      for (const [dr, dc] of DIRS) {
        const nr = pos.r + dr * 2, nc = pos.c + dc * 2;
        if (!inB(nr, nc)) continue;
        const t = s.board[nr][nc];
        if (isUnit(t) && t.player !== player && !hiddenFromS(t, player)) return true;
      }
    }
    // 额外技能（雾冲 / 影牙 等）仍有次数：避免被误判为“无行动”而自动跳过
    if (!silenced && !s.turnActionUsed) {
      const extra = unitSkills(u);
      for (let i = 1; i < extra.length; i++) {
        if (!isPassiveSkillS(extra[i]) && skillUsesLeft(s, u, i) > 0 && !(rooted && isSelfMoveSkillS(u, extra[i]))) return true;
      }
    }
    if (!silenced && heroHasFreeUses(s, u)) return true;
    // 不耗行动步数的主动技能（金元素等）：即使本回合已行动也仍可执行
    if (!silenced) {
      const freeSkills = unitSkills(u);
      for (let i = 0; i < freeSkills.length; i++) {
        const fsk = freeSkills[i];
        if (!fsk || isPassiveSkillS(fsk)) continue;
        if (fsk.free && skillUsesLeft(s, u, i) > 0 && !(rooted && isSelfMoveSkillS(u, fsk))) return true;
      }
    }
  }
  return false;
}
/* 是否还有合法“移动”可做（定身 / 冰封 / 抓取 / 眩晕、四周被占或石柱均不算） */
function hasAnyMoveState(s, player) {
  for (const u of unitsOf(s, player)) {
    if (u.frozen > 0) continue;
    if (isDisabled(u) || isRooted(u)) continue;
    const pos = findPos(s, u);
    if (!pos) continue;
    for (const [dr, dc] of DIRS) {
      const nr = pos.r + dr, nc = pos.c + dc;
      if (!inB(nr, nc)) continue;
      const t = s.board[nr][nc];
      if (!t) return true;
      if (isSword(t) && hasSwordPassiveS(u)) return true;
    }
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
  // 毒雾：当前玩家位于毒雾格的英雄各受 0.5（回合结束时结算）
  applyMistPoisonS(s, s.currentPlayer);
  applyBlackFlameS(s, s.currentPlayer);
  if (checkVictory(s)) return;
  // 临时石柱：每完成一个完整回合结束衰减一次（生成当回合不扣）
  tickPillarsS(s);
  tickHolyDomainsS(s);
  tickTitansS(s, s.currentPlayer);
  for (const u of unitsOf(s, s.currentPlayer)) if (!isTimeStopped(u) && u.frozen > 0) u.frozen--;
  tickStatuses(s, s.currentPlayer);
  // 雷电之主：强化按自身回合递减，归零清除护盾
  if (s.empowerTurnActive) {
    for (const u of unitsOf(s, s.currentPlayer)) {
      if (isTimeStopped(u)) continue;
      if (u.heroId === "thunder" && (u.empowerTurns || 0) > 0) {
        u.empowerTurns -= 1;
        if (u.empowerTurns <= 0) u.shield = 0;
      }
    }
  }
  s.empowerTurnActive = false;
  // 时间行者：裂空斩 / 破空在下一回合结束时回归锚点
  processTimeAnchorsEndS(s, ended);
  if (checkVictory(s)) return;
  // 行军令：若存在「额外回合」，则当前玩家再获得一个完整回合，结束后才交给对手
  const samePlayer = !!s.extraTurnPending;
  s.extraTurnPending = false;
  // 渡鸦：潜行时长只在真实回合交接时推进（额外回合不缩短）；毒雾同理
  tickRavenTurnS(s, ended, !samePlayer);
  // 金元素·金属狂潮：按自身行动回合计时
  tickMetalTurnS(s, ended);
  if (!samePlayer) {
    tickMistsS(s);
    tickBlackFlamesS(s);
    tickMeteorsS(s, ended);
    if (s.phase === "over") return;
    s.currentPlayer = s.currentPlayer === 1 ? 2 : 1;
  }
  slog(s, "玩家" + ended + " 结束回合");
  s.turnIsExtra = samePlayer; // 供 beginTurn 判断额外回合（鸦天狗不提前推进）
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
    // 对局结束：清理临时石柱 / 毒雾 / 潜行状态
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isPillar(s.board[r][c]) || isMirrorS(s.board[r][c])) s.board[r][c] = null;
    s.mists = {};
    s.blackFlames = {};
    s.meteors = [];
    s.crosses = [];
    for (const u of unitsOf(s, 1).concat(unitsOf(s, 2))) { clearRavenStealthS(u); resetThunderbladeS(u); resetCrowFormS(u); }
    if (s.stats && !s.stats.endedAt) s.stats.endedAt = Date.now();
    slog(s, "🏆 玩家" + s.winner + " 获胜，对局结束！");
    return true;
  }
  return false;
}

/* 还魂令落点（服务端镜像）：原位置优先，被占据则退回最近空格 */
function reviveCellForS(s, g) {
  if (!g) return null;
  if (inB(g.r, g.c) && !s.board[g.r][g.c]) return { r: g.r, c: g.c, origin: true };
  let best = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (s.board[r][c]) continue;
      const d = Math.abs(r - g.r) + Math.abs(c - g.c);
      if (!best || d < best.d || (d === best.d && (r < best.r || (r === best.r && c < best.c)))) {
        best = { r, c, d };
      }
    }
  }
  return best ? { r: best.r, c: best.c, origin: false } : null;
}

/* ---------------- 行动校验与执行（服务器权威） ---------------- */
function applyAction(state, player, action) {
  const s = clone(state);
  const err = (m) => ({ ok: false, error: m, state });

  if (s.phase === "over") return err("对局已结束");

  // 龙胆：额外移动（只能在自己的回合、消耗由龙魂闪避积累的次数）
  if (action.type === "dragonmove") {
    const from = action.from || {};
    const u = inB(from.r, from.c) ? s.board[from.r][from.c] : null;
    if (!isUnit(u) || u.player !== player) return err("无效的单位");
    if (player !== s.currentPlayer) return err("只能在自己回合使用龙胆");
    if (!hasPassiveEffectS(u, "longren", "龙胆") || (u.dragonMoves || 0) <= 0) return err("没有额外移动机会");
    if (isTimeStopped(u) || isRooted(u) || isSilenced(u)) return err("当前状态无法使用额外移动");
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
    let usedWildcard = false;
    if (s.pools && s.pools[player] && s.pools[player].indexOf(heroId) < 0) {
      // 选将卡：不在候选池时可消耗 1 张任选英雄
      if ((s.wildcards && s.wildcards[player] || 0) > 0) {
        s.wildcards[player] -= 1;
        usedWildcard = true;
      } else {
        return err("该英雄不在你的候选池中，且选将卡已用尽");
      }
    }
    if (s.placed[player].includes(heroId)) return err("同阵营不可重复英雄");
    const def = heroDef(heroId);
    if (!def) return err("未知英雄");
    s.board[r][c] = { uid: s.unitSeq++, heroId, player, hp: def.hp, maxHp: def.hp,
                      shield: 0, shieldLayers: [], frozen: 0, swords: def.blades || 0,
                      usesLeft: def.skill.uses == null ? 9999 : def.skill.uses,
                      statuses: {}, lockUsed: false, sdStage: 0, dragonMoves: 0, empowerTurns: 0,
                      chaseStage: 0, chaseMark: 0, guixiongUsed: false, wxtStage: 0,
                      stealth: null, ravenBuff: false, ravenDouble: false, ravenDoubleUsed: false, metalBuff: false, metalTide: 0, meditate: null,
                      timeStop: null, timeStopPending: [], skillTurnUsed: {},
                      size: 1, titanTurns: 0, hammerBuff: false,
                      facing: player === 1 ? [0, 1] : [0, -1], rbStage: 0, rbBlade: null, rbDir: null, crowForm: null,
                      copiedSkill: null, copiedUses: 0, copiedFrom: null,
                      usesArr: heroSkills(def).map((sk) => (sk.uses == null ? 9999 : sk.uses)) };
    s.placed[player].push(heroId);
    if (usedWildcard) slog(s, "🎟 玩家" + player + " 使用选将卡任选了【" + (def.name || heroId) + "】（剩余 " + s.wildcards[player] + " 张）");
    s.toPlace = Math.max(0, PER_PLAYER - s.placed[player].length);
    slog(s, "玩家" + player + " 完成一次部署（" + s.placed[player].length + "/" + PER_PLAYER + "）");
    // 双方都完成部署后才正式开战
    if (s.placed[1].length >= PER_PLAYER && s.placed[2].length >= PER_PLAYER) {
      s.phase = "battle";
      s.currentPlayer = 1;
      if (s.stats) s.stats.startedAt = Date.now();
      beginTurn(s);
    }
    return { ok: true, state: s };
  }

  // 对战阶段
  const act = action.type;
  // 联机悔棋：仅本回合、仅自己的上一动作（服务器保留战前快照）
  const pushUndo = () => {
    if (!s._undo) s._undo = [];
    const copy = JSON.parse(JSON.stringify(s));
    delete copy._undo;
    s._undo.push(JSON.stringify(copy));
    if (s._undo.length > 24) s._undo.shift();
  };
  if (act === "undo") {
    if (s.phase !== "battle") return err("当前阶段不能悔棋");
    if (!s._undo || !s._undo.length) return err("没有可悔棋的步骤");
    const keepLog = s.log, keepSeq = s.logSeq;
    const snap = JSON.parse(s._undo.pop());
    const remaining = s._undo;
    Object.assign(s, snap);
    s._undo = remaining;
    s.log = keepLog;
    s.logSeq = keepSeq;
    slog(s, "↩ 玩家" + player + " 悔棋：回退到上一步");
    return { ok: true, state: s };
  }
  if (act === "end") {
    if (s.turnActionsLeft === s.turnActionsMax && hasAnyActionState(s, player) && hasAnyMoveState(s, player)) return err("必须先行动，不能直接跳过回合");
    endTurn(s);
    return { ok: true, state: s };
  }

  if (act === "talisman") {
    if (s.talismanUsed[player] || !s.talisman[player]) return err("没有可用的锦囊");
    const owned = talDef(s.talisman[player]);
    if (!owned) return err("未知锦囊");
    let t = owned;
    let omniUsed = false;
    if (owned.effect === "omni") {
      if (!action.choice || action.choice === "omni") return err("全能锦囊：请选择一张普通锦囊");
      const chosen = talDef(action.choice);
      if (!chosen || chosen.effect === "omni") return err("全能锦囊：不能选择全能锦囊本身");
      const av = talismanAvailableS(s, player, chosen.id);
      if (!av.ok) return err("全能锦囊：" + av.reason);
      t = chosen;
      omniUsed = true;
    }
    pushUndo();
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
        unitSkills(u).forEach((sk, i) => {
          if (!sk || sk.type === "passive" || sk.uses == null) return;
          const max = sk.perTurn ? sk.perTurn : sk.uses;
          if (skillUsesLeft(s, u, i) !== max) { setSkillUses(s, u, i, max); n++; }
        });
        if (n === 0) return err("该英雄没有可刷新的技能次数");
        if (u.heroId === "eagle") resetThunderbladeS(u); // 刷新雷鸣刀：清除旧连招与雷刀
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
        let idx = -1, cell = null;
        if (hasTo) {
          for (let i = 0; i < s.graveyard.length; i++) {
            const g = s.graveyard[i];
            if (g.player !== player) continue;
            const c2 = reviveCellForS(s, g);
            if (c2 && c2.r === to.r && c2.c === to.c) { idx = i; cell = c2; break; }
          }
        }
        if (idx < 0) return err("该位置没有可复活的己方英雄");
        if (!inB(to.r, to.c) || s.board[to.r][to.c]) return err("该位置已被占用，无法复活");
        const rec = s.graveyard[idx];
        removeCrossesForDeadS(s, rec.deadUid || (rec.snapshot && rec.snapshot.uid));
        const def = heroDef(rec.heroId);
        // 复活 = 恢复阵亡瞬间的全部状态，仅生命值变为 3
        let revived;
        if (rec.snapshot) {
          revived = Object.assign({}, JSON.parse(JSON.stringify(rec.snapshot)), { uid: s.unitSeq++, heroId: def.id, player, hp: Math.min(3, def.hp), maxHp: def.hp });
        } else {
          revived = { uid: s.unitSeq++, heroId: def.id, player, hp: Math.min(3, def.hp), maxHp: def.hp,
                      shield: 0, shieldLayers: [], frozen: 0, swords: rec.swords || 0, usesLeft: rec.usesLeft || 0,
                      usesArr: rec.usesArr && rec.usesArr.length ? rec.usesArr.slice() : undefined,
                      statuses: {}, lockUsed: !!rec.lockUsed, sdStage: 0, dragonMoves: 0, empowerTurns: 0, chaseStage: 0, chaseMark: 0, guixiongUsed: !!rec.guixiongUsed, wxtStage: 0,
                      stealth: null, ravenBuff: false, ravenDouble: false, ravenDoubleUsed: false, metalBuff: false, metalTide: 0, meditate: null,
                      facing: player === 1 ? [0, 1] : [0, -1], rbStage: 0, rbBlade: null, rbDir: null, crowForm: null,
                      copiedSkill: rec.copiedSkill ? JSON.parse(JSON.stringify(rec.copiedSkill)) : null,
                      copiedUses: rec.copiedUses != null ? rec.copiedUses : 0,
                      copiedFrom: rec.copiedFrom ? JSON.parse(JSON.stringify(rec.copiedFrom)) : null };
        }
        if (!revived.statuses) revived.statuses = {};
        // 鹰佐：复活不恢复未完成的雷鸣刀连招
        revived.rbStage = 0;
        revived.rbBlade = null;
        revived.rbDir = null;
        revived.crowForm = null;
        if (!Array.isArray(revived.facing)) revived.facing = player === 1 ? [0, 1] : [0, -1];
        s.board[to.r][to.c] = revived;
        s.graveyard.splice(idx, 1);
        slog(s, "💫 " + uname(s, s.board[to.r][to.c]) + " 复活（3 点生命）" + (cell && !cell.origin ? "，原位置被占据，改在最近空格" : ""));
        break;
      }
      default: return err("未知锦囊");
    }
    s.talismanUsed[player] = true;
    // 锦囊成功使用：向双方公开“本次使用的具体名称”（未使用的锦囊与部署阶段仍保密）
    if (omniUsed) slog(s, "🌈 玩家" + player + " 使用全能锦囊，转化为【" + t.name + "】");
    else slog(s, "🎴 玩家" + player + " 使用了【" + t.name + "】");
    return { ok: true, state: s }; // 锦囊不结束回合，也不消耗行动
  }

  const from = action.from || {};
  const u = inB(from.r, from.c) ? s.board[from.r][from.c] : null;
  if (!isUnit(u) || u.player !== player) return err("无效的单位");
  if (isMirrorS(u)) return err("镜像不能移动、攻击或释放技能");
  if (u.frozen > 0) return err("该英雄被冰封");
  if (isDisabled(u)) return err("该英雄处于【" + actionBlockReason(u) + "】状态，无法行动");
  if (isMeditatingS(u)) return err("该英雄正在禅坐，无法行动");
  if (isCrowFormS(u)) return err("该英雄处于鸦天狗形态，无法行动");
  pushUndo();

  if (act === "move") {
    if (isGrabbed(u)) return err("该英雄处于【抓取】状态，无法行动");
    if (isRooted(u)) return err("该英雄处于【定身】状态，无法移动");
    const isExtra = !canActNow(s, u);
    if (isExtra && (s.extraMoves || 0) <= 0) return err("本回合已经行动过了");
    // 渡鸦·潜行双动：隐身期间第一次「走」不消耗行动，之后还可再走一次或普通攻击
    const isDoubleFirst = !isExtra && !s.turnActionUsed && isStealthedS(u) && u.ravenDouble && !u.ravenDoubleUsed;
    const isDoubleSecond = !isExtra && !s.turnActionUsed && u.ravenDoubleUsed;
    const { r, c } = action.to || {};
    if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("只能移动一格");
    if (isTitanS(u)) {
      if (!canTitanFitS(s, u, r, c, true)) return err("泰坦 2×2 占据区域被阻挡");
      pickupHammerAtS(s, u, titanCellsForAnchorS(r, c));
      placeTitanFootprintS(s, u, r, c);
      slog(s, "🗿 " + uname(s, u) + " 整体移动到 (" + (r + 1) + "," + (c + 1) + ")，占据 2×2", isStealthedS(u) ? { only: u.player } : undefined);
      if (isExtra) {
        s.extraMoves -= 1;
        checkVictory(s);
        return { ok: true, state: s };
      }
      finish(s, u, false);
      return { ok: true, state: s };
    }
    const t = inB(r, c) ? s.board[r][c] : null;
    const canPickHammer = isHammer(t) && t.owner === player && u.heroId === "hillking";
    if ((s.board[r][c] && !canPickHammer) || isPillar(t)) return err("目标格被占用");
    if (isSword(t) && u.heroId !== "asura") return err("剑刃阻挡");
    if (isSword(t) && hasSwordPassiveS(u)) { u.swords = (u.swords || 0) + 1; }
    if (canPickHammer) pickupHammerAtS(s, u, [[r, c]]);
    const wasHidden = isStealthedS(u);
    s.board[r][c] = u; s.board[from.r][from.c] = null;
    slog(s, uname(s, u) + (isExtra ? " 额外移动" : " 移动") + "到 (" + (r + 1) + "," + (c + 1) + ")", wasHidden ? { only: u.player } : undefined);
    if (isDoubleFirst) {
      u.ravenDoubleUsed = true;
      slog(s, "🌑 潜行双动：移动完成，还可再进行一次移动或普通攻击", { only: u.player });
      return { ok: true, state: s };
    }
    if (isDoubleSecond) {
      u.ravenDouble = false;
      u.ravenDoubleUsed = false;
      slog(s, "🌑 潜行双动：第二次移动完成", { only: u.player });
    }
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
    const rawTarget = inB(r, c) ? s.board[r][c] : null;
    const t = unitAtS(s, r, c);
    if (!isUnit(t) || t.player === player) return err("无效的攻击目标");
    if (hiddenFromS(t, player)) return err("目标不可见");
    if (isTitanS(u)) {
      const pair = titanPairForS(s, u, r, c);
      if (!pair) return err("泰坦普攻只能选择与自身相邻的连续两格区域");
      const victims = [];
      for (const [rr, cc] of pair) {
        const v = unitAtS(s, rr, cc);
        if (v && v !== u && v.player !== player && !victims.some((x) => x.uid === v.uid)) victims.push(v);
      }
      if (!victims.length) return err("该连续两格区域内没有敌方英雄");
      const hammerB = u.hammerBuff ? 1 : 0;
      const ravenB = u.ravenBuff ? 1 : 0;
      const metalB = u.metalBuff ? 1 : 0;
      for (const v of victims) {
        if (!findPos(s, v)) continue;
        const fi = flankInfo(s).get(v.uid);
        const dmg = normalDamage(s, u, v) + ravenB + metalB + hammerB;
        slog(s, "🗿 " + uname(s, u) + " 的泰坦普攻命中 " + uname(s, v) + "，造成 " + dmg + " 点伤害" + (hammerB ? "（战争之锤 +1）" : "") + (fi && fi.flanked ? "（夹击×" + fi.count + "）" : ""));
        applyDamage(s, v, dmg, u);
      }
      if (hammerB) { u.hammerBuff = false; slog(s, "🔨 战争之锤强化已消耗"); }
      finish(s, u, false);
      return { ok: true, state: s };
    }
    const atkDist = minDistToTitanS(s, t, from.r, from.c);
    const atkRange = u.heroId === "ranger" ? 2 : 1;
    if (atkDist < 1 || atkDist > atkRange) return err(atkRange > 1 ? "只能攻击直线 2 格内的目标" : "只能攻击相邻目标");
    if (atkDist === 2 && r !== from.r && c !== from.c) return err("天穹射手普通攻击只能沿同一行/列直线攻击");
    const fi = flankInfo(s).get(t.uid);
    const ravenB = u.ravenBuff ? 1 : 0;
    const metalB = u.metalBuff ? 1 : 0;
    const hammerB = u.hammerBuff ? 1 : 0;
    slog(s, uname(s, u) + " 攻击 " + uname(s, t) + (fi && fi.flanked ? "（触发夹击×" + fi.count + "）" : "") + (ravenB ? "（影袭 +1）" : "") + (metalB ? "（金属强化 +1）" : "") + (hammerB ? "（战争之锤 +1）" : ""));
    applyDamage(s, t, normalDamage(s, u, t) + ravenB + metalB + hammerB, u);
    if (hammerB) { u.hammerBuff = false; slog(s, "🔨 战争之锤强化已消耗"); }
    // 杨戬·天眼（可被窃取）：仅普通攻击触发，按原始目标位置 3×3 溅射 0.5
    if (hasPassiveEffectS(u, "yangjian", "天眼")) {
      const victims = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (!inB(rr, cc)) continue;
        const v = s.board[rr][cc];
        if (!isUnit(v) || v === t || v.player === player) continue;
        victims.push(v);
      }
      slog(s, "👁 杨戬发动【天眼】：以 (" + (r + 1) + "," + (c + 1) + ") 为中心产生金色溅射");
      for (const v of victims) {
        if (!findPos(s, v)) continue;
        const dealt = applyDamage(s, v, 0.5, u);
        slog(s, "✨ 天眼溅射：" + uname(s, v) + " 受到 0.5 点伤害" + (dealt > 0 ? "（实际扣血 " + dealt + "）" : "（未造成生命伤害）"));
      }
      if (!victims.length) slog(s, "✨ 天眼溅射范围内没有其他敌方英雄");
    }
    if (u.ravenBuff || isStealthedS(u)) consumeRavenAttackStateS(s, u);
    if (metalB) {
      u.metalBuff = false;
      slog(s, "🛡 金元素的强化攻击造成额外 1 点伤害");
      if (findPos(s, t) && t.hp > 0) {
        applyNegativeStatus(s, t, "root", { damage: 0, turns: 1, label: "定身" });
      }
    }
    // 普通攻击击杀 → 攻击者占据目标原先所在的格子（仅限相邻攻击；远程游侠不位移）
    // 仅在「伤害 / 护盾 / 闪避 / 锁血 / 死亡」全部结算完成后判定；夹击击杀同样生效
    if (!isTitanS(t) && atkDist === 1 && t.hp <= 0 && !findPos(s, t) && !s.board[r][c]) {
      const upos = findPos(s, u);
      if (upos && upos.r === from.r && upos.c === from.c) {
        s.board[from.r][from.c] = null;
        s.board[r][c] = u;
        slog(s, "➡ " + uname(s, u) + " 击败目标后占据 (" + (r + 1) + "," + (c + 1) + ")");
      }
    }
    finish(s, u, false);
    return { ok: true, state: s };
  }

  if (act === "skill") {
    if (isGrabbed(u)) return err("该英雄处于【抓取】状态，无法行动");
    if (isSilenced(u)) return err("该英雄处于【沉默】状态，无法使用技能");
    const idx = action.idx || 0;
    const sk = unitSkills(u)[idx] || heroDef(u.heroId).skill;
    if (!sk) return err("未知技能");
    if (isRooted(u) && isSelfMoveSkillS(u, sk)) return err("该英雄处于【定身】状态，无法使用位移技能");
    // 追猎：第二段待释放但已无有效标记目标 → 结束连招，回到第一段
    if (sk.type === "chase" && (u.chaseStage || 0) === 1 && chaseTargetsOf(s, u).length === 0) endChase(s, u);
    const isSd2 = sk.type === "shuidiao" && (u.sdStage || 0) === 1; // 第二段同属一套，不额外占次数
    const isChase2 = sk.type === "chase" && (u.chaseStage || 0) === 1; // 追猎第二段不额外占次数
    const isWxtCombo = sk.type === "wxt" && (u.wxtStage || 0) >= 1; // 万象天引第二/三段不重复占整套次数
    const isTbCombo = sk.type === "thunderblade" && (u.rbStage || 0) > 0; // 雷鸣刀第二/三段共享整套次数
    if (!isSd2 && !isChase2 && !isWxtCombo && !isTbCombo && skillUsesLeft(s, u, idx) <= 0) return err("技能次数不足");
    if (sk.oncePerTurn && skillUsedThisTurnS(s, u, idx)) return err("【" + sk.name + "】每个回合最多使用 1 次");
    if (sk.costSwords && (u.swords || 0) < sk.costSwords) return err("没有剑，无法发动剑圣");
    if (!skillFreeForS(u, sk) && !canActNow(s, u)) return err("本回合已经行动过了");
    slog(s, uname(s, u) + " 释放【" + sk.name + "】");
    const freeAction = skillFreeForS(u, sk); // 结算前判定：追猎会改动 chaseStage，放到最后会翻转结果
    let consumedHere = false; // 追猎第一段在分支内「先扣次数再结算」
    const { r, c } = action.to || {};
    const t = inB(r, c) ? s.board[r][c] : null;
    const dist = Math.abs(r - from.r) + Math.abs(c - from.c);
    const av = attackerBonus(s, u); // 猛攻令 / 孤胆：技能伤害 +1
    // 隐身：指向性技能不能指定不可见的敌方渡鸦（范围技能仍可命中其所在格）
    if (t && isUnit(t) && hiddenFromS(t, player) &&
        ["damage_single", "freeze", "damage_line", "exile", "wxt", "charge", "push", "chase"].includes(sk.type)) {
      return err("目标不可见");
    }

    if (sk.type === "damage_single") {
      if (!isUnit(t) || t.player === player || dist > sk.range) return err("技能目标不合法");
      applyDamage(s, t, sk.damage + av, u);
    } else if (sk.type === "freeze") {
      if (!isUnit(t) || t.player === player || dist > sk.range) return err("技能目标不合法");
      applyDamage(s, t, sk.damage + av, u);
      // 孤胆侠·霸体：抵抗冰封（伤害仍已正常结算）
      if (findPos(s, t) && !hasSuperArmor(s, t)) t.frozen = Math.max(t.frozen, sk.freeze || 1);
    } else if (sk.type === "heal") {
      const inRange = sk.range === "thunder" ? inThunderRangeS(r, c, from.r, from.c) : dist <= sk.range;
      if (!isUnit(t) || t.player !== player || !inRange || t.hp >= t.maxHp) return err("治疗目标不合法");
      t.hp += Math.max(0, Math.min(sk.heal, t.maxHp - t.hp));
    } else if (sk.type === "holyguard") {
      if (!inThunderRangeS(r, c, from.r, from.c)) return err("神圣加护：请选择雷电之主范围内的位置");
      if ((s.holyDomains || []).some((d) => d.owner === player)) return err("神圣加护：当前领域尚未结束");
      addHolyDomainS(s, u, { r, c });
    } else if (sk.type === "warhammer") {
      if (!inThunderRangeS(r, c, from.r, from.c)) return err("战争之锤：落点不在范围内");
      if (findHammerS(s, u.uid)) return err("战争之锤：场上已有未回收的锤子");
      const landing = inB(r, c) ? s.board[r][c] : null;
      let pushed = null;
      if (landing) {
        if (!isUnit(landing) || landing.player === player || isTitanS(landing)) return err("战争之锤：落点被实体或友军占据");
        pushed = pushUnitToAdjacentS(s, landing);
        if (!pushed) return err("战争之锤：无法挤开落点上的敌人");
        slog(s, "🔨 战争之锤挤开 " + uname(s, landing) + " 到 (" + (pushed.r + 1) + "," + (pushed.c + 1) + ")");
      }
      if (!placeHammerS(s, player, u.uid, r, c)) return err("战争之锤：无法落在该位置");
      const hitUids = new Set();
      let hit = 0;
      for (const [rr, cc] of hammerCrossCellsS(r, c)) {
        const v = unitAtS(s, rr, cc);
        if (!v || v.player === player || hitUids.has(v.uid)) continue;
        hitUids.add(v.uid);
        applyDamage(s, v, sk.damage || 1, u);
        hit++;
      }
      slog(s, "🔨 " + uname(s, u) + " 将战争之锤投掷到 (" + (r + 1) + "," + (c + 1) + ")，十字范围命中 " + hit + " 名敌人");
    } else if (sk.type === "titan") {
      if (isTitanS(u)) return err("泰坦之力已经生效");
      const anchor = titanAnchorForClickS(s, u, r, c);
      if (!anchor) return err("泰坦之力：请选择包含山丘之王的合法 2×2 区域");
      u.size = 2;
      u.titanTurns = sk.duration || 4;
      placeTitanFootprintS(s, u, anchor.r, anchor.c);
      slog(s, "🗿 " + uname(s, u) + " 释放【泰坦之力】，选择占据以 (" + (anchor.r + 1) + "," + (anchor.c + 1) + ") 为左上角的 2×2 区域，持续 " + u.titanTurns + " 回合");
    } else if (sk.type === "damage_adjacent_all") {
      let any = false;
      for (const [dr, dc] of DIRS) {
        const e = inB(from.r + dr, from.c + dc) ? s.board[from.r + dr][from.c + dc] : null;
        if (isUnit(e) && e.player !== player) { applyDamage(s, e, sk.damage + av, u); any = true; }
      }
      if (!any) return err("相邻没有敌人");
    } else if (sk.type === "damage_line") {
      // 游侠：前后左右 4 格 + 自身九宫格内指定敌人；无视中间阻挡
      if (!isUnit(t) || t.player === player) return err("射击目标必须是敌方英雄");
      const rdr = r - from.r, rdc = c - from.c;
      const inNine = Math.abs(rdr) <= 1 && Math.abs(rdc) <= 1 && !(rdr === 0 && rdc === 0);
      const inLine = (rdr === 0 || rdc === 0) && !(rdr === 0 && rdc === 0) && (Math.abs(rdr) + Math.abs(rdc)) <= sk.range;
      if (!inNine && !inLine) return err("射击目标必须在正前/后/左/右 4 格或自身九宫格内");
      applyDamage(s, t, sk.damage + av, u);
    } else if (sk.type === "skyarrow") {
      // 天穹射手·穿云箭：选择直线方向，命中路径第一个英雄；石柱/友军/边界阻断
      if (!inB(r, c)) return err("穿云箭：请选择棋盘内的直线方向");
      const dr = Math.sign(r - from.r), dc = Math.sign(c - from.c);
      if ((!dr && !dc) || (dr !== 0 && dc !== 0)) return err("穿云箭：请选择上/下/左/右一个直线方向");
      const plan = skyarrowPlanS(s, u, from.r, from.c, dr, dc);
      if (!plan) return err("穿云箭：该方向无法射击");
      slog(s, "🏹 " + uname(s, u) + " 向【" + (FACE_NAME_S[[dr, dc].join(",")] || "前方") + "】射出穿云箭");
      if (plan.hit && findPos(s, plan.hit)) {
        applyDamage(s, plan.hit, sk.damage + av, u);
        slog(s, "☄ 穿云箭命中 " + uname(s, plan.hit) + "，造成 " + (sk.damage + av) + " 点伤害");
      } else if (plan.blocked === "ally") {
        slog(s, "🛡 穿云箭被友军挡住，友军不会受伤");
      } else if (plan.blocked === "pillar") {
        slog(s, "🧱 穿云箭命中石柱后停止");
      } else {
        slog(s, "穿云箭飞出棋盘边界，未命中敌人");
      }
    } else if (sk.type === "meteor") {
      // 天穹射手·天罚：全棋盘落点，延迟 2 个完整对手回合后 3×3 结算
      if (!inB(r, c)) return err("天罚：请选择棋盘内的合法落点");
      const m = addMeteorS(s, u, r, c, sk);
      slog(s, "☄ " + uname(s, u) + " 发动【天罚】，在 (" + (r + 1) + "," + (c + 1) + ") 标记 3×3 陨星区域；" + m.turns + " 个完整对手回合后坠落");
    } else if (sk.type === "soulrevive") {
      // 亡灵之主·亡语：原地复活己方阵亡英雄至 2 血
      const rec = s.graveyard.find((g) => {
        if (g.player !== player) return false;
        const cell = reviveCellForS(s, g);
        return cell && cell.r === r && cell.c === c;
      });
      if (!rec) return err("亡语：该位置没有可复活的己方阵亡英雄");
      if (!inB(r, c) || s.board[r][c]) return err("亡语：复活位置已被占用");
      reviveAllyFromGraveS(s, rec, r, c, 2);
    } else if (sk.type === "undeadarmy") {
      // 亡灵之主·亡灵军团：所有有效十字架一次性转化为己方小亡灵
      if (!s.crosses || !s.crosses.length) return err("亡灵军团：场上没有死亡十字架");
      const list = s.crosses.slice();
      const reserved = new Set();
      let spawned = 0;
      for (const cr of list) {
        const cell = undeadSpawnCellS(s, cr, reserved);
        if (!cell) continue;
        const m = {
          uid: s.unitSeq++, heroId: "minion", isMinion: true, player,
          hp: 2, maxHp: 2, shield: 0, shieldLayers: [], frozen: 0, swords: 0, statuses: {},
          usesLeft: 0, usesArr: [], facing: player === 1 ? [0, 1] : [0, -1],
          lockUsed: false, guixiongUsed: false, sdStage: 0, dragonMoves: 0, empowerTurns: 0, chaseStage: 0,
          chaseMark: 0, wxtStage: 0, stealth: null, ravenBuff: false, ravenDouble: false, ravenDoubleUsed: false,
          metalBuff: false, metalTide: 0, meditate: null, rbStage: 0, rbBlade: null, rbDir: null, crowForm: null,
          copiedSkill: null, copiedUses: 0, copiedFrom: null,
        };
        s.board[cell.r][cell.c] = m;
        reserved.add(cell.r + "_" + cell.c);
        s.crosses = s.crosses.filter((x) => x.id !== cr.id);
        spawned++;
      }
      slog(s, "💀 " + uname(s, u) + " 释放【亡灵军团】：" + spawned + " 个死亡十字架转化为小亡灵");
    } else if (sk.type === "mirrorclone") {
      // 镜影·镜像分身：雷霆万钧同范围空格召唤永久镜像，可选与镜像换位
      const valid = mirrorSummonCellsS(s, u, from.r, from.c).some(([rr, cc]) => rr === r && cc === c);
      if (!valid) return err("镜像分身：请选择雷霆万钧同范围内的合法空格");
      const m = { mirror: true, uid: s.unitSeq++, player, heroId: "mirror", hp: 1, maxHp: 1 };
      if (action.swap) {
        s.board[r][c] = u;
        s.board[from.r][from.c] = m;
        slog(s, "🪞 " + uname(s, u) + " 在 (" + (r + 1) + "," + (c + 1) + ") 召唤镜像并交换位置", { only: player });
      } else {
        s.board[r][c] = m;
        slog(s, "🪞 " + uname(s, u) + " 在 (" + (r + 1) + "," + (c + 1) + ") 召唤镜像", { only: player });
      }
    } else if (sk.type === "mirrorshift") {
      // 镜影·镜面折射：与任意己方镜像交换位置
      if (!isMirrorS(t) || t.player !== player) return err("镜面折射：请选择一个己方镜像");
      s.board[from.r][from.c] = t;
      s.board[r][c] = u;
      slog(s, "🪞 " + uname(s, u) + " 与镜像交换位置：(" + (from.r + 1) + "," + (from.c + 1) + ") ↔ (" + (r + 1) + "," + (c + 1) + ")", { only: player });
    } else if (sk.type === "steal") {
      // 窃神·窃取权柄：复制目标一个主动/被动技能，独立次数
      if (!isUnit(t) || isMirrorS(t) || t.player === player || hiddenFromS(t, player)) return err("窃取权柄：请选择一名可见的敌方英雄");
      const choices = copyableSkillsS(t);
      const ci = action.copyIdx == null ? -1 : (action.copyIdx | 0);
      if (ci < 0 || ci >= choices.length) return err("窃取权柄：请选择一个可复制的技能");
      const chosen = JSON.parse(JSON.stringify(choices[ci]));
      if (!chosen.type) chosen.type = "passive";
      u.copiedSkill = chosen;
      u.copiedUses = chosen.uses == null ? 9999 : chosen.uses;
      u.copiedFrom = {
        uid: t.uid, player: t.player, heroId: t.heroId,
        name: (heroDef(t.heroId) || {}).name || t.heroId,
        skillName: chosen.name,
        passive: chosen.type === "passive",
      };
      slog(s, "👑 " + uname(s, u) + " 释放【窃取权柄】，从 " + uname(s, t) + " 复制了【" + chosen.name + "】" +
        (chosen.type === "passive" ? "（被动）" : "（主动）") + "；双方次数独立，原英雄不受影响");
    } else if (sk.type === "soulsteal") {
      // 窃神·窃魂：全体敌人定身 + 沉默 1 个完整敌方行动回合
      const foes = unitsOf(s, player === 1 ? 2 : 1).filter((v) => v && !v.sword);
      if (!foes.length) return err("窃魂：场上没有敌方英雄");
      let rootCount = 0, silenceCount = 0;
      for (const v of foes) {
        if (!findPos(s, v)) continue;
        const r1 = applyNegativeStatus(s, v, "root", { turns: 1, label: "窃魂·定身", ignoreSuperArmor: true, silent: true });
        const r2 = applyNegativeStatus(s, v, "silence", { turns: 1, label: "窃魂·沉默", ignoreSuperArmor: true, silent: true });
        if (r1.applied) rootCount++;
        if (r2.applied) silenceCount++;
      }
      slog(s, "👑 " + uname(s, u) + " 释放【窃魂】：黑金封印扩散，对全体敌人施加定身与沉默，持续 1 个完整敌方回合");
      slog(s, "🔒 窃魂结算：定身 " + rootCount + " 名、沉默 " + silenceCount + " 名敌人");
    } else if (sk.type === "shield_self") {
      u.shield += sk.shield;
    } else if (sk.type === "blink") {
      if (!inB(r, c) || s.board[r][c] || dist > sk.range || dist === 0) return err("瞬移目标不合法");
      s.board[r][c] = u; s.board[from.r][from.c] = null;
    } else if (sk.type === "crosstep") {
      if (!inB(r, c) || dist !== 1 || s.board[r][c]) return err("狂徒：只能沿上下左右位移到相邻空格");
      s.board[r][c] = u;
      s.board[from.r][from.c] = null;
      setFaceS(u, r - from.r, c - from.c);
      slog(s, "🪓 " + uname(s, u) + " 发动【狂徒】，十字位移到 (" + (r + 1) + "," + (c + 1) + ")");
    } else if (sk.type === "riftslash") {
      if (timeAnchorForS(s, u)) return err("裂空斩：当前已有时空锚点，必须等待它回归");
      const rp = action.reposition || {};
      const lr = rp.r, lc = rp.c;
      const stay = lr === from.r && lc === from.c;
      if (!inB(lr, lc) || (!stay && s.board[lr][lc]) || Math.abs(lr - from.r) > 1 || Math.abs(lc - from.c) > 1 || (stay && s.board[lr][lc] !== u)) {
        return err("裂空斩：请选择锚点九宫格内的合法落点（可原地劈）");
      }
      if (!isUnit(t) || t.player === player || isMirrorS(t) || hiddenFromS(t, player) || Math.abs(r - lr) + Math.abs(c - lc) !== 1) {
        return err("裂空斩：请选择落点旁的一名敌方英雄");
      }
      addTimeAnchorS(s, u, "rift", from.r, from.c);
      if (!stay) {
        s.board[lr][lc] = u;
        s.board[from.r][from.c] = null;
      }
      // 先挂时停再结算伤害，保证受伤触发的被动反击进入延迟队列。
      if (findPos(s, t)) applyTimeStopS(s, t, u, sk.name);
      applyDamage(s, t, sk.damage == null ? 1.5 : sk.damage, u);
      slog(s, "🌌 " + uname(s, u) + " 发动【裂空斩】，" + (stay ? "原地劈击" : "位移到 (" + (lr + 1) + "," + (lc + 1) + ")") + " 并斩击 " + uname(s, t));
    } else if (sk.type === "voidstep") {
      if (timeAnchorForS(s, u)) return err("破空：当前已有时空锚点，必须等待它回归");
      if (!inB(r, c) || (r === from.r && c === from.c) || s.board[r][c]) return err("破空：请选择棋盘内未被占据的合法空格");
      addTimeAnchorS(s, u, "void", from.r, from.c);
      s.board[r][c] = u;
      s.board[from.r][from.c] = null;
      slog(s, "🌌 " + uname(s, u) + " 发动【破空】，穿梭到 (" + (r + 1) + "," + (c + 1) + ")");
    } else if (sk.type === "dash") {
      const opt = DIRS.map(([dr, dc]) => computeDash(s, u, from.r, from.c, dr, dc))
                      .find((o) => o.dest && o.dest.r === r && o.dest.c === c);
      if (!opt) return err("突进方向不合法");
      for (const h of opt.hits) {
        const e = s.board[h.r][h.c];
        if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av, u);
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
        if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av, u);
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
        for (const h of opt.hits) { const e = s.board[h.r][h.c]; if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av, u); }
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
        if (isUnit(e) && e.player !== player) applyDamage(s, e, sk.damage + av, u);
      }
    } else if (sk.type === "thunder") {
      const inRange = (Math.abs(r - from.r) <= 1 && Math.abs(c - from.c) <= 1 && !(r === from.r && c === from.c)) ||
        (Math.abs(r - from.r) + Math.abs(c - from.c) === 2 && (r === from.r || c === from.c));
      if (!inRange || !inB(r, c)) return err("雷霆万钧目标不合法");
      if (t && (t.sword || t.player === player)) return err("目标格不可选");
      if (t && !t.sword && t.player !== player) {
        applyDamage(s, t, sk.damage + av, u);
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
      let kills = 0;
      for (const e of victims) {
        const aliveBefore = !!findPos(s, e);
        totalDealt += applyDamage(s, e, sk.damage + av, u); // 返回值=实际扣掉的生命
        if (aliveBefore && !findPos(s, e)) kills++;
      }
      if (totalDealt > 0) u.hp += totalDealt; // 吸血鬼：按实际总伤害回血（不受 maxHp 限制）
      // 只有“血崩自身击杀”才刷新（普攻击杀不刷新）
      if (kills > 0 && refreshSkillOnSkillKill(s, u, idx)) {
        slog(s, "🩸 " + uname(s, u) + " 使用【" + sk.name + "】击杀 " + kills + " 名敌人，使用次数已刷新。");
      }
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
        applyDamage(s, target2, sk.damage + av, u); // 统一伤害结算（击杀 → 刷新追猎）
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
        for (const e of hitUnits) applyDamage(s, e, sk.damage + av, u);
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
      for (const e of zBefore) { if (findPos(s, e)) applyDamage(s, e, sk.damage + av, u); }
      for (const e of zAfter) { if (findPos(s, e)) applyDamage(s, e, sk.damage + av, u); } // 重叠区域再结算一次
    } else if (sk.type === "exile") {
      const et = action.exileTarget && action.exileTarget.r != null ? action.exileTarget : null;
      const target = et && inB(et.r, et.c) ? s.board[et.r][et.c] : null;
      if (!isUnit(target) || target.player === player) return err("放逐目标不合法（需存活敌人）");
      if (isFormImmuneS(target)) return err("该目标处于无敌形态，无法放逐");
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
        applyDamage(s, e, sk.damage + av, u); // 每名敌人最多一次
        if (findPos(s, e)) knockOutBox3(s, e, r, c);
      }
    } else if (sk.type === "shenluo") {
      // 神罗天征：九宫格内敌人各 1 伤并击退出九宫格
      const victims = sortUnitsByPosS(s, box3Enemies(s, from.r, from.c, player));
      for (const e of victims) {
        if (!findPos(s, e)) continue;
        applyDamage(s, e, sk.damage + av, u);
        if (findPos(s, e)) knockOutBoxAwayS(s, e, from.r, from.c, from.r, from.c);
      }
    } else if (sk.type === "wxt") {
      // 万象天引：三阶段连招
      const stage = u.wxtStage || 0;
      const wt = isUnit(t) ? t : null;
      if (!wt || wt.player === player) return err("万象天引：请选择一名存活的敌方英雄");
      if (stage === 2) {
        if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("万象天引·第三段：只能选择相邻敌人");
        applyDamage(s, wt, sk.damage + av, u);
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
          if (!isFormImmuneS(wt) && (tp.r !== lr || tp.c !== lc)) { s.board[lr][lc] = wt; s.board[tp.r][tp.c] = null; }
          applyDamage(s, wt, sk.damage + av, u);
          u.wxtStage = 1;
        } else {
          const lr = from.r + dr, lc = from.c + dc;        // 正前方一格
          if (!inB(lr, lc) || (s.board[lr][lc] && s.board[lr][lc] !== wt)) return err("万象天引·第二段：正前方格被占据或越界");
          const tp = findPos(s, wt);
          if (!isFormImmuneS(wt) && (tp.r !== lr || tp.c !== lc)) { s.board[lr][lc] = wt; s.board[tp.r][tp.c] = null; }
          applyDamage(s, wt, sk.damage + av, u);
          if (findPos(s, wt)) applyNegativeStatus(s, wt, "grab", { damage: 0, turns: 1, label: "万象天引·抓取" });
          u.wxtStage = 2;
        }
      }
    } else if (sk.type === "charge") {
      // 花木兰·所向披靡：只能对相邻（普攻范围）敌人释放；方向由目标位置决定
      if (!isUnit(t) || t.player === player) return err("所向披靡：请选择普通攻击范围内的敌方目标");
      const dr = r - from.r, dc = c - from.c;
      if (Math.abs(dr) + Math.abs(dc) !== 1) return err("所向披靡：只能对相邻敌人释放");
      slog(s, "🌺 " + uname(s, u) + " 发动【" + sk.name + "】，目标 " + uname(s, t));
      const cdmg = sk.damage + av;
      applyDamage(s, t, cdmg, u);
      if (findPos(s, t)) {
        const res = chargeKnockbackS(s, t, dr, dc);
        for (const pd of res.pushed) {
          const pname = uname(s, pd.unit);
          const ps = { r: pd.to.r + 1, c: pd.to.c + 1 };
          applyDamage(s, pd.unit, cdmg, u);
          slog(s, "↔ " + pname + " 被向侧方推开到 (" + ps.r + "," + ps.c + ")，受到 " + cdmg + " 点伤害");
        }
        const np = findPos(s, t);
        if (res.moved > 0 && np) slog(s, "➡ " + uname(s, t) + " 被击退 " + res.moved + " 格到 (" + (np.r + 1) + "," + (np.c + 1) + ")");
        if (res.stun && findPos(s, t)) {
          const st = applyNegativeStatus(s, t, "stun", { damage: 0, turns: 2, label: "眩晕", silent: true });
          if (st.applied) slog(s, "💫 " + uname(s, t) + " 撞上阻挡，被眩晕 2 个自身行动回合");
          else slog(s, "🛡 " + uname(s, t) + " 抵抗了眩晕");
        }
      } else {
        slog(s, "💥 " + uname(s, t) + " 被冲锋击倒，未发生击退");
      }
    } else if (sk.type === "push") {
      // 山丘之王·推山：先可十字位移 1–2 格（原地也可），再推前方 2 格内第一个敌人
      let sr = from.r, sc = from.c;
      const mv = action.moveTo;
      if (mv && mv.r != null) {
        const mdr = mv.r - from.r, mdc = mv.c - from.c;
        const mdist = Math.abs(mdr) + Math.abs(mdc);
        const stay = mdr === 0 && mdc === 0;
        if (!stay) {
          if (isRooted(u)) return err("定身状态下无法使用位移");
          if ((mdr !== 0 && mdc !== 0) || mdist !== 1) return err("推山：位移只能选择原地或上下左右 1 格");
          if (!inB(mv.r, mv.c) || s.board[mv.r][mv.c]) return err("推山：位移落点必须是空格");
          sr = mv.r; sc = mv.c;
        }
      }
      if (!isUnit(t) || t.player === player) return err("推山：请选择前方 2 格内的敌方英雄");
      const pdr = r - sr, pdc = c - sc;
      const pdist = Math.abs(pdr) + Math.abs(pdc);
      if ((pdr !== 0 && pdc !== 0) || pdist < 1 || pdist > 2) return err("推山：目标必须在正前方 1–2 格内");
      const sdr = Math.sign(pdr), sdc = Math.sign(pdc);
      const ignore = (sr !== from.r || sc !== from.c) ? { r: from.r, c: from.c } : null;
      const pinfo = pushDirInfoS(s, u, sr, sc, sdr, sdc, ignore);
      if (!pinfo || pinfo.unit !== t) return err("推山：只能推击正前方 2 格内的第一个敌人（友军或障碍会阻挡）");
      if (sr !== from.r || sc !== from.c) {
        s.board[sr][sc] = u;
        s.board[from.r][from.c] = null;
        slog(s, "⛰ " + uname(s, u) + " 踏步到 (" + (sr + 1) + "," + (sc + 1) + ")");
      }
      const dirTxt = sdr === -1 ? "上" : sdr === 1 ? "下" : sdc === -1 ? "左" : "右";
      slog(s, "⛰ " + uname(s, u) + " 发动【" + sk.name + "】，向" + dirTxt + "推击 " + uname(s, t));
      applyDamage(s, t, sk.damage + av, u);
      if (!findPos(s, t)) {
        slog(s, "💥 " + uname(s, t) + " 被推山击倒，未发生推动与石柱");
      } else {
        const moved = pushUnitForwardS(s, t, sdr, sdc, Math.max(0, 2 - pinfo.dist));
        const np = findPos(s, t);
        if (moved > 0 && np) slog(s, "➡ " + uname(s, t) + " 被推击到 (" + (np.r + 1) + "," + (np.c + 1) + ")，距山丘之王 2 格");
        else if (pinfo.dist === 2) slog(s, "⛰ " + uname(s, t) + " 已在正前方第二格，未再推动");
        else slog(s, "⛰ " + uname(s, t) + " 前方受阻，停留在原地");
        if (np) {
          const made = createPillarsAroundS(s, np.r, np.c, player);
          for (const sq of made.squeezed) {
            slog(s, "↔ 石柱将 " + uname(s, sq.unit) + " 挤开到 (" + (sq.to.r + 1) + "," + (sq.to.c + 1) + ")");
          }
          if (made.cells.length) slog(s, "🪨 石柱升起，封锁了 " + uname(s, t) + " 四周（" + made.cells.length + " 根）");
        }
      }
    } else if (sk.type === "metalpierce") {
      // 金元素·金属穿刺：正前方 1–2 格所有可命中敌人各 1 伤；先付 1 HP
      const pdr = r - from.r, pdc = c - from.c;
      if (Math.abs(pdr) + Math.abs(pdc) !== 1) return err("金属穿刺：请点击上下左右选择一个方向");
      const targets = metalPierceInfoS(s, u, from.r, from.c, pdr, pdc);
      if (!targets.length) return err("金属穿刺：该方向没有可命中的敌人");
      slog(s, "⚙ " + uname(s, u) + " 发动【金属穿刺】！");
      if (!payHpCostS(s, u, sk.costHp || 1, "金属穿刺")) {
        slog(s, "💥 金元素因生命代价倒下，金属穿刺中止，未造成伤害");
      } else {
        let hit = 0;
        for (const e of targets) {
          if (!findPos(s, e)) continue;
          applyDamage(s, e, sk.damage + av, u);
          hit++;
        }
        slog(s, "⚙ 金属穿刺命中 " + hit + " 名敌方英雄，各造成 " + sk.damage + " 点伤害");
      }
    } else if (sk.type === "metalarmor") {
      slog(s, "⚙ " + uname(s, u) + " 发动【金属装甲】！");
      if (!payHpCostS(s, u, sk.costHp || 1, "金属装甲")) {
        slog(s, "💥 金元素因生命代价倒下，金属装甲中止，未获得强化");
      } else {
        u.metalBuff = true;
        slog(s, "🛡 金元素的下一次普通攻击已强化");
      }
    } else if (sk.type === "metaltide") {
      u.metalTide = 3;
      slog(s, "🛡 " + uname(s, u) + " 发动【金属狂潮】：本回合及之后两个自身行动回合，受到的伤害减半");
    } else if (sk.type === "meditate") {
      // 金蝉·禅坐：每局一次、免费，持续 3 个自身行动回合
      if (u.meditate) return err("金蝉已在禅坐中，无法重复开启");
      u.meditate = { turns: 3, dealt: 0, healed: 0, castTurn: s.turnSerial || 0 };
      slog(s, "🪷 " + uname(s, u) + " 进入【禅坐】：持续 3 个自身行动回合，期间无敌、无法行动");
    } else if (sk.type === "divinepalm") {
      // 金蝉·神掌：相邻敌人 1 伤 + 击退最多 3 格
      if (!isUnit(t) || t.player === player) return err("神掌：请选择相邻的敌方英雄");
      if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("神掌：只能对相邻敌人发动");
      const ddr = r - from.r, ddc = c - from.c;
      slog(s, "🖐 " + uname(s, u) + " 发动【神掌】，击向 " + uname(s, t));
      applyDamage(s, t, sk.damage + av, u);
      if (!findPos(s, t)) {
        slog(s, "💥 " + uname(s, t) + " 被神掌击倒，未发生击退");
      } else {
        const moved = pushUnitForwardS(s, t, ddr, ddc, sk.push || 3);
        const np = findPos(s, t);
        if (moved > 0 && np) slog(s, "➡ " + uname(s, t) + " 被击退 " + moved + " 格到 (" + (np.r + 1) + "," + (np.c + 1) + ")");
        else if (isFormImmuneS(t)) slog(s, "🛡 " + uname(s, t) + " 处于无敌形态，未被击退");
        else slog(s, "🖐 " + uname(s, t) + " 前方受阻，未被击退");
      }
    } else if (sk.type === "raikiri") {
      // 鹰佐·雷劈：选择方向，攻击正前方两格（英雄 / 石柱 / 剑刃阻挡后方）
      const rdr = r - from.r, rdc = c - from.c;
      if (!DIRS.some(([ddr, ddc]) => ddr === rdr && ddc === rdc)) return err("雷劈：请选择上/下/左/右一个方向");
      const info = raikiriDirInfoS(s, u, from.r, from.c, rdr, rdc);
      if (!info) return err("雷劈：该方向没有可命中的敌人");
      setFaceS(u, rdr, rdc);
      slog(s, "⚡ " + uname(s, u) + " 发动【雷劈】，朝向【" + faceNameS(u) + "】");
      for (const hit of info.hits) {
        const v = s.board[hit.r][hit.c];
        if (!isUnit(v) || v.player === player) continue;
        const nominal = hit.dmg + av;
        applyDamage(s, v, nominal, u);
        slog(s, "⚡ 雷劈·" + (hit.dmg === 1 ? "第一格" : "第二格") + "：" + uname(s, v) + " 受到 " + nominal + " 点雷电伤害");
      }
    } else if (sk.type === "thunderblade") {
      const stage = u.rbStage || 0;
      // 幂等 / 防重复请求：客户端必须携带它认为的当前阶段，服务器阶段已变化则拒绝
      if (action.rbStage == null) return err("雷鸣刀：缺少阶段确认");
      if ((action.rbStage | 0) !== stage) return err("雷鸣刀阶段已变化，请以最新状态为准");
      if (stage === 0) {
        // 第一段：原地释放，或十字位移 1 格 + 对相邻敌人 2 点雷斩
        const mv = action.moveTo || {};
        const mr = mv.r != null ? mv.r : from.r;
        const mc = mv.c != null ? mv.c : from.c;
        const stay = mr === from.r && mc === from.c;
        const mdr = mr - from.r;
        const mdc = mc - from.c;
        if (!stay) {
          if ((mdr !== 0 && mdc !== 0) || Math.abs(mdr) + Math.abs(mdc) !== 1) return err("雷鸣刀·第一段：可以选择原地释放，或向十字方向移动 1 格");
          if (!inB(mr, mc) || s.board[mr][mc]) return err("雷鸣刀·第一段：位移落点必须是空格");
        }
        if (!isUnit(t) || t.player === player || hiddenFromS(t, player)) return err("雷鸣刀·第一段：请选择释放后相邻的敌方英雄");
        if (Math.abs(r - mr) + Math.abs(c - mc) !== 1) return err("雷鸣刀·第一段：攻击目标必须与释放后位置相邻");
        if (!stay) {
          s.board[mr][mc] = u;
          s.board[from.r][from.c] = null;
          setFaceS(u, mdr, mdc);
          u.rbDir = [mdr, mdc];
        } else {
          const fd = faceDirS(u);
          u.rbDir = [fd[0], fd[1]];
        }
        u.rbStage = 1;
        slog(s, stay
          ? "⚡ " + uname(s, u) + " 发动【雷鸣刀·第一段·原地雷斩】，留在 (" + (mr + 1) + "," + (mc + 1) + ")，朝向【" + faceNameS(u) + "】"
          : "⚡ " + uname(s, u) + " 发动【雷鸣刀·第一段·十字突进·雷斩】，位移到 (" + (mr + 1) + "," + (mc + 1) + ")");
        applyDamage(s, t, sk.damage + av, u);
        slog(s, "🗡 雷斩：" + uname(s, t) + " 受到 " + (sk.damage + av) + " 点伤害；第二段已就绪（可跨回合）");
      } else if (stage === 1) {
        // 第二段：普攻范围相邻一格插刀 → 反方向后撤一格 → 对刀的位置吐火
        const dr = r - from.r, dc = c - from.c;
        if (!DIRS.some(([a1, b1]) => a1 === dr && b1 === dc)) return err("雷鸣刀·第二段：请选择上/下/左/右插刀位置");
        const br = r, bc = c;
        const bcell = s.board[br][bc];
        if (!inB(br, bc) || isPillar(bcell) || isSword(bcell)) return err("雷鸣刀·第二段：插刀位置不能是石柱/剑刃/棋盘外");
        u.rbBlade = { r: br, c: bc };
        setFaceS(u, dr, dc);
        u.rbDir = [dr, dc];
        u.rbStage = 2;
        slog(s, "🔪 " + uname(s, u) + " 在普攻范围内的 (" + (br + 1) + "," + (bc + 1) + ") 插下【雷刀】（不占格）");
        const sr = from.r - dr, sc = from.c - dc;
        let backstep = false;
        if (inB(sr, sc) && !s.board[sr][sc]) {
          s.board[sr][sc] = u;
          s.board[from.r][from.c] = null;
          backstep = true;
        }
        slog(s, backstep ? "💨 鹰佐向反方向后撤一格到 (" + (sr + 1) + "," + (sc + 1) + ")" : "💨 后撤方向被阻挡，鹰佐留在原地");
        const ft = s.board[br][bc];
        if (isUnit(ft) && ft.player !== player) {
          applyDamage(s, ft, (sk.fire || 1) + av, u);
          slog(s, "🔥 鹰佐对雷刀所在格吐火：" + uname(s, ft) + " 受到 " + ((sk.fire || 1) + av) + " 点火焰伤害");
        } else {
          slog(s, "🔥 吐火：雷刀所在格没有敌方英雄，未造成伤害");
        }
        slog(s, "🔪 雷鸣刀·第二段完成，第三段已就绪（可跨回合）");
      } else if (stage === 2) {
        // 第三段：九宫格位移 + 与雷刀直线雷击
        const tdr = r - from.r, tdc = c - from.c;
        if (!inB(r, c) || s.board[r][c] || Math.abs(tdr) > 1 || Math.abs(tdc) > 1 || (tdr === 0 && tdc === 0)) return err("雷鸣刀·第三段：请选择九宫格内的其他合法空格");
        const blade = u.rbBlade ? { r: u.rbBlade.r, c: u.rbBlade.c } : null;
        s.board[r][c] = u;
        s.board[from.r][from.c] = null;
        slog(s, "🌩 " + uname(s, u) + " 发动【雷鸣刀·第三段·雷遁·终结】，瞬移到 (" + (r + 1) + "," + (c + 1) + ")");
        if (blade) {
          const line = tbLineCellsS({ r, c }, blade);
          if (line) {
            for (const p of line) {
              if (p.r === r && p.c === c) continue;
              const cell = s.board[p.r][p.c];
              if (isPillar(cell)) { slog(s, "🧱 雷击路径被石柱阻挡"); break; }
              if (!isUnit(cell) || cell.player === player) continue;
              applyDamage(s, cell, (sk.line || 1) + av, u);
              slog(s, "⚡ 直线雷击：" + uname(s, cell) + " 受到 " + ((sk.line || 1) + av) + " 点雷电伤害");
            }
          } else {
            slog(s, "⚡ 雷刀与鹰佐未形成直线，未触发雷击");
          }
        }
        resetThunderbladeS(u);
        slog(s, "🔚 雷鸣刀·第三段完成，整套连招结束（雷刀已移除）");
      } else return err("雷鸣刀阶段异常");
    } else if (sk.type === "susano_dash") {
      // 须佐·雷刀：斜向两格，第一格敌人受 1（不耗行动）
      const dr = r - from.r, dc = c - from.c;
      if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2 || !SUSANO_DIAG_S.some(([a1, b1]) => a1 === Math.sign(dr) && b1 === Math.sign(dc))) return err("雷刀：请选择斜向第二格");
      const plan = susanoDashPlanS(s, u, from.r, from.c, Math.sign(dr), Math.sign(dc));
      if (!plan) return err("雷刀：第二格不是合法空格，或路径被阻挡");
      if (plan.target) {
        applyDamage(s, plan.target, sk.damage + av, u);
        slog(s, "⚡ 雷刀路径：" + uname(s, plan.target) + " 受到 " + (sk.damage + av) + " 点雷电伤害");
      }
      s.board[plan.second.r][plan.second.c] = u;
      s.board[from.r][from.c] = null;
      slog(s, "🌀 " + uname(s, u) + " 使用【雷刀】斜向闪现到 (" + (plan.second.r + 1) + "," + (plan.second.c + 1) + ")");
    } else if (sk.type === "susano_pull") {
      // 须佐·雷鸣：相邻敌人 2 伤 + 拉到第二格
      const dr = r - from.r, dc = c - from.c;
      if (!isUnit(t) || t.player === player || hiddenFromS(t, player) || Math.abs(dr) + Math.abs(dc) !== 1) return err("雷鸣：请选择相邻的敌方英雄");
      const plan = susanoPullPlanS(s, u, from.r, from.c, dr, dc);
      if (!plan) return err("雷鸣：目标身后第二格被占据或越界");
      slog(s, "⚡ " + uname(s, u) + " 发动【雷鸣】，雷电抓取 " + uname(s, t));
      applyDamage(s, t, sk.damage + av, u);
      slog(s, "⚡ 雷鸣：" + uname(s, t) + " 受到 " + (sk.damage + av) + " 点雷电伤害");
      if (findPos(s, t)) {
        if (isFormImmuneS(t)) {
          slog(s, "🛡 " + uname(s, t) + " 处于无敌形态，未被拉动");
        } else if (hasSuperArmor(s, t)) {
          slog(s, "🛡 霸体：" + uname(s, t) + " 抵抗了抓取，未被拉动（伤害已结算）");
        } else if (isTitanS(t) && !canTitanFitS(s, t, plan.landing.r, plan.landing.c, false)) {
          slog(s, "🛡 " + uname(s, t) + " 的 2×2 体型无法被完全拉入该格，停留原位");
        } else {
          if (isTitanS(t)) placeTitanFootprintS(s, t, plan.landing.r, plan.landing.c);
          else { s.board[plan.landing.r][plan.landing.c] = t; s.board[plan.from.r][plan.from.c] = null; }
          slog(s, "➡ " + uname(s, t) + " 被拉到 (" + (plan.landing.r + 1) + "," + (plan.landing.c + 1) + ")");
        }
      } else {
        slog(s, "💥 " + uname(s, t) + " 被雷鸣击倒，不再移动");
      }
    } else if (sk.type === "susano_arrow") {
      // 须佐·须佐箭：第二格九宫格爆炸 + 黑炎
      const dr = r - from.r, dc = c - from.c;
      if (!DIRS.some(([a1, b1]) => a1 === dr && b1 === dc)) return err("须佐箭：请选择方向");
      const plan = susanoArrowPlanS(s, u, from.r, from.c, dr, dc);
      if (!plan) return err("须佐箭：前方第二格不合法或路径被阻挡");
      setFaceS(u, dr, dc);
      slog(s, "🏹 " + uname(s, u) + " 射出【须佐箭】，目标第二格 (" + (plan.second.r + 1) + "," + (plan.second.c + 1) + ")");
      const center = plan.second;
      if (plan.mode === "pull" && findPos(s, plan.target)) {
        if (isFormImmuneS(plan.target)) {
          slog(s, "🛡 " + uname(s, plan.target) + " 处于无敌形态，未被牵引");
        } else if (hasSuperArmor(s, plan.target)) {
          slog(s, "🛡 霸体：" + uname(s, plan.target) + " 抵抗了牵引，停留在第一格");
        } else if (isTitanS(plan.target) && !canTitanFitS(s, plan.target, center.r, center.c, false)) {
          slog(s, "🛡 " + uname(s, plan.target) + " 的 2×2 体型无法被完全拉入该格，停留原位");
        } else {
          if (isTitanS(plan.target)) placeTitanFootprintS(s, plan.target, center.r, center.c);
          else { s.board[center.r][center.c] = plan.target; s.board[plan.first.r][plan.first.c] = null; }
          slog(s, "⚡ 须佐箭牵引：" + uname(s, plan.target) + " 被拉到第二格");
        }
      }
      let hit = 0;
      for (const [rr, cc] of cellsAround3S(center.r, center.c)) {
        const v = s.board[rr][cc];
        if (!isUnit(v) || v === u || v.player === player) continue;
        applyDamage(s, v, sk.damage + av, u);
        hit++;
        slog(s, "💥 须佐箭爆炸：" + uname(s, v) + " 受到 " + (sk.damage + av) + " 点伤害");
      }
      slog(s, "💥 须佐箭爆炸，命中 " + hit + " 名敌人");
      const flames = [];
      if (addBlackFlameAtS(s, center.r, center.c, player)) flames.push([center.r, center.c]);
      for (const [ddr, ddc] of DIRS) {
        if (addBlackFlameAtS(s, center.r + ddr, center.c + ddc, player)) flames.push([center.r + ddr, center.c + ddc]);
      }
      if (flames.length) slog(s, "🔥 黑炎生成 " + flames.length + " 格（持续 3 个完整回合）");
    } else if (sk.type === "susano_crow") {
      // 须佐·鸦天狗：前方九宫格 1 伤 + 进入 3 个自身回合的无敌形态
      const dr = r - from.r, dc = c - from.c;
      if (!DIRS.some(([a1, b1]) => a1 === dr && b1 === dc) || !inB(r, c)) return err("鸦天狗：请选择方向");
      setFaceS(u, dr, dc);
      let hit = 0;
      for (const [rr, cc] of cellsAround3S(r, c)) {
        const v = s.board[rr][cc];
        if (!isUnit(v) || v === u || v.player === player) continue;
        applyDamage(s, v, sk.damage + av, u);
        hit++;
        slog(s, "💥 鸦天狗冲击：" + uname(s, v) + " 受到 " + (sk.damage + av) + " 点伤害");
      }
      u.crowForm = { turns: CROW_FORM_TURNS_S, dir: [dr, dc], castTurn: s.turnSerial || 0 };
      slog(s, "🪶 " + uname(s, u) + " 进入【鸦天狗】形态（无敌、无法行动，持续 3 个自身行动回合；命中 " + hit + " 名敌人）");
    } else if (sk.type === "qiankun") {
      // 杨戬·逆转乾坤：5×5 锁定 → 群体拉近 → 1 伤 → 等额限时护盾 → 外圈眩晕
      const targets = qiankunTargetsS(s, u);
      if (!targets.length) return err("逆转乾坤：5×5 范围内没有敌方英雄");
      const yp = findPos(s, u);
      if (!yp) return err("杨戬位置异常");
      const occupied = new Set();
      for (let rr = 0; rr < SIZE; rr++) for (let cc = 0; cc < SIZE; cc++) if (s.board[rr][cc]) occupied.add(rr + "_" + cc);
      const list = [];
      for (const v of targets) {
        const from = findPos(s, v);
        if (!from) continue;
        list.push({ v, from, outer: Math.max(Math.abs(from.r - yp.r), Math.abs(from.c - yp.c)) === 2 });
      }
      list.sort((A, B) => (Math.abs(A.from.r - yp.r) + Math.abs(A.from.c - yp.c)) - (Math.abs(B.from.r - yp.r) + Math.abs(B.from.c - yp.c)) || A.from.r - B.from.r || A.from.c - B.from.c);
      const reserved = new Set();
      const plans = [];
      for (const it of list) {
        const to = qiankunPullDestS(s, u, it.from, occupied, reserved);
        if (to) reserved.add(to.r + "_" + to.c);
        plans.push(Object.assign({}, it, { to }));
      }
      slog(s, "👁 " + uname(s, u) + " 发动【逆转乾坤】，锁定 5×5 范围内 " + plans.length + " 名敌人");
      for (const p of plans) {
        if (!p.to || !findPos(s, p.v)) continue;
        s.board[p.to.r][p.to.c] = p.v;
        s.board[p.from.r][p.from.c] = null;
        slog(s, "🌀 逆转乾坤·牵引：" + uname(s, p.v) + " 被拉近到 (" + (p.to.r + 1) + "," + (p.to.c + 1) + ")");
      }
      let totalDealt = 0;
      for (const p of plans) {
        if (!findPos(s, p.v)) continue;
        const dealt = applyDamage(s, p.v, sk.damage, u);
        totalDealt += dealt;
        slog(s, "💥 逆转乾坤：" + uname(s, p.v) + " 受到 " + sk.damage + " 点伤害" + (dealt > 0 ? "（实际扣血 " + dealt + "）" : "（未造成生命伤害）"));
      }
      if (totalDealt > 0) addTimedShieldS(s, u, totalDealt, sk.shieldTurns || 2, "逆转乾坤护盾");
      else slog(s, "🛡 逆转乾坤未造成实际生命伤害，未获得护盾");
      for (const p of plans) {
        if (!p.outer || !findPos(s, p.v)) continue;
        const res = applyNegativeStatus(s, p.v, "stun", { damage: 0, turns: sk.stun || 1, label: "逆转乾坤·眩晕" });
        if (res.applied) slog(s, "💫 逆转乾坤·外围眩晕：" + uname(s, p.v) + " 被眩晕 " + (sk.stun || 1) + " 回合");
        else slog(s, "🛡 " + uname(s, p.v) + " 抵抗了眩晕");
      }
    } else if (sk.type === "stealth") {
      // 渡鸦·潜行：位移到雷霆万钧范围的空格（或原地），进入隐身
      const sdr = r - from.r, sdc = c - from.c;
      if (!stealthRangeOkS(sdr, sdc)) return err("潜行：落点必须在自身九宫格或上下左右 2 格内");
      if (!(sdr === 0 && sdc === 0) && (!inB(r, c) || s.board[r][c])) return err("潜行：落点必须是空格");
      if (!(sdr === 0 && sdc === 0)) {
        s.board[r][c] = u;
        s.board[from.r][from.c] = null;
      }
      u.stealth = { turns: RAVEN_STEALTH_TURNS, fresh: true, startTurn: s.turnSerial || 0, reason: "", broken: false };
      u.ravenBuff = true;
      u.ravenDouble = true;
      u.ravenDoubleUsed = false;
      slog(s, "🌑 " + uname(s, u) + " 使用【潜行】，进入隐身（" + RAVEN_STEALTH_TURNS + " 个完整回合），并获得【影袭强化】与一次【潜行双动】");
    } else if (sk.type === "mistdash") {
      // 渡鸦·雾冲：向指定方向突进最多 3 格，路径敌人 0.5 伤害，实际路径生成毒雾
      const wdr = r - from.r, wdc = c - from.c;
      if (Math.abs(wdr) + Math.abs(wdc) !== 1) return err("雾冲：请点击上下左右选择一个方向");
      const o = mistDashPathS(s, u, from.r, from.c, wdr, wdc, sk.range || 3);
      if (!o.dest) return err("雾冲：该方向无法突进（第一格被石柱/边界阻挡）");
      const seen = new Set();
      for (const [rr, cc] of o.path) {
        const e = s.board[rr][cc];
        if (!isUnit(e) || e.player === player || seen.has(e.uid)) continue;
        seen.add(e.uid);
        applyDamage(s, e, sk.damage + av, u);
      }
      s.board[o.dest.r][o.dest.c] = u;
      s.board[from.r][from.c] = null;
      const newMist = [];
      for (const [rr, cc] of o.path) if (addMistAtS(s, rr, cc, player)) newMist.push([rr, cc]);
      // 毒雾生成瞬间：站在雾格上的敌人立即受到 0.5（己方免疫）
      if (newMist.length) mistBurstS(s, newMist, player);
      slog(s, "🌫 " + uname(s, u) + " 使用【雾冲】，路径留下 " + o.path.length + " 格毒雾", isStealthedS(u) ? { only: player } : undefined);
    } else if (sk.type === "shadowfang") {
      // 渡鸦·影牙：相邻敌人 2 伤（影袭 +1），击杀刷新 1 次
      if (!isUnit(t) || t.player === player) return err("影牙：请选择普通攻击范围内的敌方英雄");
      if (hiddenFromS(t, player)) return err("目标不可见");
      if (Math.abs(r - from.r) + Math.abs(c - from.c) !== 1) return err("影牙：只能对相邻敌人发动");
      const buff = u.ravenBuff ? 1 : 0;
      const dmg = sk.damage + av + buff;
      consumedHere = true;
      setSkillUses(s, u, idx, Math.max(0, skillUsesLeft(s, u, idx) - 1));
      slog(s, "🖤 " + uname(s, u) + " 发动【" + sk.name + "】" + (buff ? "（影袭强化 +1）" : ""));
      applyDamage(s, t, dmg, u);
      if (!findPos(s, t)) {
        if (skillUsesLeft(s, u, idx) < 1) setSkillUses(s, u, idx, 1);
        slog(s, "🗡 影牙击败目标，技能次数已刷新！");
      }
      consumeRavenAttackStateS(s, u);
    } else return err("未知技能");

    if (sk.oncePerTurn) {
      u.skillTurnUsed = u.skillTurnUsed || {};
      u.skillTurnUsed[idx] = s.turnSerial || 0;
    }
    if (!isSd2 && !isChase2 && !isWxtCombo && !isTbCombo && !consumedHere) setSkillUses(s, u, idx, Math.max(0, skillUsesLeft(s, u, idx) - 1));
    if (sk.costSwords) u.swords = Math.max(0, (u.swords || 0) - sk.costSwords);
    const isFree = freeAction;
    finish(s, u, isFree, !!(sk.free && !sk.perTurn));
    return { ok: true, state: s };
  }

  return err("未知行动");
}

module.exports = { createState, applyAction, applyNegativeStatus, hasSuperArmor, isLoneActive, applyDamage, SIZE, PER_PLAYER,
  normalDamage, assassinInFlank, computeChaseLine, chaseTargetsOf, chaseBlinkCells, refreshChase, endChase, skillFreeForS, refreshSkillOnKill, refreshSkillOnSkillKill,
  isGuixiongActive, guixiongCounter, box3Enemies, CORNERS, cornerOk, knockOutBox3,
  findPos, unitAtS, isTitanS, titanCellsS, canTitanFitS, pushUnitForwardS, findHammerS };
