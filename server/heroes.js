/* =========================================================================
 * server/heroes.js —— 服务器端英雄数据（与前端 heroes.js 保持一致）
 * 说明：当前采用“数据副本”的方式让服务器也拥有英雄数值。
 *       若后续做统一规则模块，可把这份数据与前端合并为共享 JSON。
 * ========================================================================= */
module.exports = [
  { id: "berserker", name: "狂战士", hp: 5, sfx: "heavy",
    skill: { name: "狂暴突袭", type: "damage_single", range: 1, damage: 3, uses: 2 } },
  { id: "mage", name: "法师", hp: 5, sfx: "magic",
    skill: { name: "火球术", type: "damage_single", range: 3, damage: 2, uses: 3 } },
  { id: "knight", name: "骑士", hp: 6, sfx: "sword",
    skill: { name: "横扫", type: "damage_adjacent_all", range: 1, damage: 1, uses: 3, free: true } },
  { id: "ranger", name: "游侠", hp: 6, sfx: "ranged",
    skill: { name: "穿透射击", type: "damage_line", range: 4, damage: 2, uses: 3 } },
  { id: "assassin", name: "刺客", hp: 6, sfx: "fast",
    passive: { name: "暗杀" },
    skill: { name: "追猎", type: "chase", damage: 1, uses: 1, refreshOnKill: true } },
  { id: "warlock", name: "术士", hp: 7, sfx: "ice",
    skill: { name: "冰封", type: "freeze", range: 3, damage: 1, freeze: 1, uses: 2 } },
  { id: "cleric", name: "牧师", hp: 5, sfx: "holy",
    skill: { name: "圣光", type: "heal", range: 3, heal: 3, uses: 2 } },
  { id: "guardian", name: "守卫", hp: 8, sfx: "shield",
    skill: { name: "铁壁", type: "shield_ally", range: 0, shield: 2, uses: 1, free: true } },
  { id: "asura", name: "阿修罗", hp: 6, sfx: "blade", blades: 3,
    skill: { name: "剑圣", type: "dash", range: 3, damage: 1, uses: 2, perTurn: 2, costSwords: 1 } },
  { id: "lone", name: "孤胆侠", hp: 7, sfx: "heavy",
    skill: { name: "孤胆", type: "passive", uses: 0 } },
  { id: "cang", name: "沧", hp: 6, sfx: "fast",
    skill: { name: "断浪", type: "duanlang", range: 1, damage: 1, uses: 1 },
    extraSkills: [
      { name: "水调歌头", type: "shuidiao", range: 3, damage: 1, grabDamage: 2, uses: 1 },
    ] },
  { id: "longren", name: "龙人", hp: 5, sfx: "magic",
    skill: { name: "龙息", type: "dragonbreath", damage: 1, uses: 1, free: true } },
  { id: "thunder", name: "雷电之主", hp: 5, sfx: "ice",
    skill: { name: "雷霆万钧", type: "thunder", damage: 1, uses: 1, empowerTurns: 3, empowerShield: 2, empowerActions: 2 } },
  { id: "vampire", name: "吸血鬼", hp: 5, sfx: "magic",
    skill: { name: "血崩", type: "bloodburst", damage: 1, uses: 1, free: true, refreshOnlyOnSkillKill: true } },
  { id: "jade", name: "玉皇大帝", hp: 5, sfx: "magic",
    skill: { name: "紫薇神步", type: "ziwei", damage: 1, uses: 1, free: true },
    extraSkills: [
      { name: "放逐", type: "exile", uses: 1, free: true },
      { name: "天威", type: "tianwei", damage: 1, uses: 1 },
    ] },
  { id: "xiangyu", name: "西楚霸王", hp: 6, sfx: "heavy",
    skill: { name: "鬼雄", type: "passive", uses: 0 } },
  { id: "tiandao", name: "天道超", hp: 6, sfx: "magic",
    skill: { name: "神罗天征", type: "shenluo", damage: 1, uses: 2 },
    extraSkills: [
      { name: "万象天引", type: "wxt", damage: 1, uses: 1 },
    ] },
  { id: "huamulan", name: "花木兰", hp: 8, sfx: "heavy",
    skill: { name: "所向披靡", type: "charge", damage: 2, uses: 1, knockback: 2 } },
];
