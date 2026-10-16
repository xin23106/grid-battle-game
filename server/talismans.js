/* =========================================================================
 * server/talismans.js —— 锦囊配置（与前端 talismans.js 保持一致）
 * 服务器用它验证与执行锦囊效果。修改锦囊时请两边同步。
 * ========================================================================= */
module.exports = [
  { id: "assault", name: "猛攻令", icon: "🔥", target: "none", effect: "assault" },
  { id: "revive", name: "还魂令", icon: "💫", target: "deadAlly", effect: "revive" },
  { id: "march", name: "行军令", icon: "🐎", target: "none", effect: "march", extraMoves: 1 },
  { id: "refresh", name: "技能重整令", icon: "♻️", target: "none", effect: "refresh" },
  { id: "guard", name: "坚守令", icon: "🛡️", target: "none", effect: "guard" },
  { id: "heal", name: "战地急救令", icon: "➕", target: "allyWounded", effect: "heal", heal: 2 },
];
