/* =========================================================================
 * talismans.js —— 锦囊配置表（集中管理，便于以后新增锦囊）
 * -------------------------------------------------------------------------
 * 字段：
 *   id      唯一标识（英文，程序内部使用）
 *   name    名称
 *   icon    图标（emoji）
 *   target  目标类型：
 *            "none"        无目标，点击「使用」立即生效
 *            "allyWounded" 需要选一名“生命未满的己方英雄”
 *            "deadAlly"    需要选一名“已阵亡且原位置可用的己方英雄”
 *   desc    效果说明
 *
 * 效果执行在 game.js 的 useTalismanEffect()（前端）与 server/rules.js（联机权威）中，
 * 按 id 分派，双方保持一致。
 * ========================================================================= */

const TALISMANS = [
  {
    id: "assault",
    name: "猛攻令",
    icon: "🔥",
    target: "none",
    desc: "本回合内，己方所有英雄造成的伤害 +1（普通攻击、技能、剑圣均适用，均为 +1）。",
    effect: "assault",
  },
  {
    id: "revive",
    name: "还魂令",
    icon: "💫",
    target: "deadAlly",
    desc: "选择一名本局阵亡的己方英雄，在其阵亡位置复活并恢复至 3 点生命（技能剩余次数不变，原位置需为空）。",
    effect: "revive",
  },
  {
    id: "march",
    name: "行军令",
    icon: "🐎",
    target: "none",
    desc: "使用后，本回合结束时立刻获得一个【额外回合】（完整的行动机会：移动 / 攻击 / 技能，技能次数按各自规则结算），该额外回合结束后才轮到对手行动。每局 1 次，不消耗行动。",
    effect: "march",
  },
  {
    id: "refresh",
    name: "技能重整令",
    icon: "♻️",
    target: "allyAlive",
    desc: "选择一名己方存活英雄，仅刷新该英雄的技能使用次数至上限（不改变生命、护盾、携带剑数、强化/负面状态与其他英雄）。",
    effect: "refresh",
  },
  {
    id: "guard",
    name: "坚守令",
    icon: "🛡️",
    target: "none",
    desc: "己方英雄在对手的下一个回合受到的每次伤害减少 1 点（最低减到 0）。",
    effect: "guard",
  },
  {
    id: "heal",
    name: "战地急救令",
    icon: "➕",
    target: "allyWounded",
    desc: "选择一名生命未满的己方英雄，立即恢复 2 点生命（不超过生命上限）。",
    effect: "heal",
    heal: 2,         // 可配置：恢复量
  },
];

function getTalismanById(id) {
  return TALISMANS.find((t) => t.id === id) || null;
}
