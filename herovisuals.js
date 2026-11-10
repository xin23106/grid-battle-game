/* ==========================================================================
   herovisuals.js —— 英雄视觉身份表（v2）
   每个英雄：主色/副色/武器/体型/头饰/披风/徽记/光环/粒子/待机/移动/技能姿态。
   纯表现层，不参与战斗判定。
   ========================================================================== */
(function () {
  const LOOKS = {
    berserker: { c1:"#ef4444", c2:"#7f1d1d", c3:"#fca5a5", weapon:"axe", aura:"fire", build:"heavy", head:"horns", acc:"none", sigil:"diamond", dur:340, tilt:7 },
    mage:      { c1:"#8b5cf6", c2:"#4c1d95", c3:"#ddd6fe", weapon:"orb", aura:"arcane", build:"robed", head:"hat", acc:"orb", sigil:"star", dur:340, tilt:3 },
    knight:    { c1:"#60a5fa", c2:"#1e3a8a", c3:"#dbeafe", weapon:"sword", aura:"blade", build:"armored", head:"helm", acc:"cape", sigil:"shield", dur:340, tilt:5 },
    ranger:    { c1:"#22c55e", c2:"#14532d", c3:"#bbf7d0", weapon:"bow", aura:"wind", build:"lean", head:"hood", acc:"scarf", sigil:"arrow", dur:300, tilt:4 },
    assassin:  { c1:"#64748b", c2:"#0f172a", c3:"#cbd5e1", weapon:"daggers", aura:"dark", build:"lean", head:"mask", acc:"none", sigil:"diamond", dur:240, tilt:8 },
    warlock:   { c1:"#38bdf8", c2:"#0c4a6e", c3:"#e0f2fe", weapon:"staff", aura:"ice", build:"robed", head:"hood", acc:"orb", sigil:"star", dur:340, tilt:3 },
    cleric:    { c1:"#fbbf24", c2:"#92400e", c3:"#fef3c7", weapon:"staff", aura:"holy", build:"robed", head:"halo", acc:"halo", sigil:"cross", dur:350, tilt:2 },
    guardian:  { c1:"#94a3b8", c2:"#334155", c3:"#e2e8f0", weapon:"shield", aura:"shield", build:"heavy", head:"helm", acc:"cape", sigil:"shield", dur:400, tilt:2 },
    asura:     { c1:"#e2e8f0", c2:"#475569", c3:"#f8fafc", weapon:"blade", aura:"blade", build:"armored", head:"helm", acc:"none", sigil:"blade", dur:270, tilt:7 },
    lone:      { c1:"#f97316", c2:"#7c2d12", c3:"#fed7aa", weapon:"claw", aura:"fire", build:"lean", head:"horns", acc:"tail", sigil:"claw", dur:300, tilt:7 },
    cang:      { c1:"#0ea5e9", c2:"#0c4a6e", c3:"#bae6fd", weapon:"fan", aura:"water", build:"robed", head:"hood", acc:"scarf", sigil:"wave", dur:300, tilt:4 },
    longren:   { c1:"#22c55e", c2:"#14532d", c3:"#bbf7d0", weapon:"spear", aura:"dragon", build:"armored", head:"horns", acc:"tail", sigil:"dragon", dur:330, tilt:5 },
    thunder:   { c1:"#60a5fa", c2:"#7c3aed", c3:"#e0f2fe", weapon:"staff", aura:"thunder", build:"robed", head:"hood", acc:"cape", sigil:"bolt", dur:210, tilt:6 },
    vampire:   { c1:"#e11d48", c2:"#4c0519", c3:"#fecdd3", weapon:"dagger", aura:"blood", build:"lean", head:"mask", acc:"cape", sigil:"drop", dur:330, tilt:4 },
    jade:      { c1:"#fbbf24", c2:"#78350f", c3:"#fde68a", weapon:"scepter", aura:"royal", build:"robed", head:"crown", acc:"halo", sigil:"diamond", dur:340, tilt:2 },
    xiangyu:   { c1:"#ef4444", c2:"#7f1d1d", c3:"#fecaca", weapon:"spear", aura:"blood", build:"heavy", head:"horns", acc:"cape", sigil:"diamond", dur:400, tilt:6 },
    tiandao:   { c1:"#c084fc", c2:"#4c1d95", c3:"#ede9fe", weapon:"orb", aura:"void", build:"robed", head:"halo", acc:"orb", sigil:"eye", dur:260, tilt:3 },
    huamulan:  { c1:"#f43f5e", c2:"#881337", c3:"#fecdd3", weapon:"sword", aura:"petal", build:"lean", head:"hood", acc:"scarf", sigil:"blade", dur:300, tilt:5 },
    hillking:  { c1:"#a8a29e", c2:"#44403c", c3:"#e7e5e4", weapon:"hammer", aura:"stone", build:"heavy", head:"helm", acc:"none", sigil:"mountain", dur:460, tilt:2 },
    raven:     { c1:"#8b5cf6", c2:"#1e1b4b", c3:"#c4b5fd", weapon:"claw", aura:"raven", build:"winged", head:"mask", acc:"wings", sigil:"feather", dur:300, tilt:6 },
    metal:     { c1:"#fbbf24", c2:"#78716c", c3:"#fde68a", weapon:"hammer", aura:"metal", build:"heavy", head:"helm", acc:"none", sigil:"gear", dur:400, tilt:2 },
    cicada:    { c1:"#fcd34d", c2:"#b45309", c3:"#fef3c7", weapon:"staff", aura:"gold", build:"robed", head:"halo", acc:"halo", sigil:"lotus", dur:360, tilt:2 },
    eagle:     { c1:"#a78bfa", c2:"#4c1d95", c3:"#c4b5fd", weapon:"blade", aura:"storm", build:"lean", head:"mask", acc:"scarf", sigil:"bolt", dur:220, tilt:7 },
    susanoo:   { c1:"#7c3aed", c2:"#312e81", c3:"#c4b5fd", weapon:"bow", aura:"chakra", build:"armored", head:"helm", acc:"cape", sigil:"eye", dur:380, tilt:3 },
  };
  const DEFAULT = { c1:"#93c5fd", c2:"#334155", c3:"#e2e8f0", weapon:"sword", aura:"default", build:"lean", head:"hood", acc:"none", sigil:"diamond", dur:340, tilt:4 };

  const WEAPONS = {
    sword:'<path class="hf-wpn-fill" d="M49 58 L53 20 L56 15 L57 19 L53 60 Z"/><path class="hf-wpn-line" d="M47 56 L53 56"/>',
    blade:'<path class="hf-wpn-fill" d="M48 60 L54 20 L58 14 L58 20 L52 62 Z"/><path class="hf-wpn-line" d="M45 57 L53 57"/>',
    staff:'<path class="hf-wpn-line" d="M48 20 L48 64"/><circle class="hf-wpn-fill" cx="48" cy="15" r="5"/>',
    orb:'<path class="hf-wpn-line" d="M47 28 L47 62"/><circle class="hf-wpn-fill" cx="48" cy="20" r="7"/><circle class="hf-wpn-glow" cx="48" cy="20" r="10"/>',
    bow:'<path class="hf-wpn-line" d="M49 16 Q60 39 49 62"/><path class="hf-wpn-line thin" d="M49 16 L49 62"/>',
    shield:'<path class="hf-wpn-fill" d="M47 20 Q59 24 55 43 Q51 56 47 61 Q43 56 39 43 Q35 24 47 20 Z"/><path class="hf-wpn-line thin" d="M47 26 L47 54"/>',
    axe:'<path class="hf-wpn-line" d="M47 58 L47 20"/><path class="hf-wpn-fill" d="M45 22 Q58 14 58 28 Q58 38 45 34 Z"/>',
    hammer:'<path class="hf-wpn-line" d="M47 62 L47 22"/><rect class="hf-wpn-fill" x="39" y="12" width="17" height="12" rx="3"/>',
    daggers:'<path class="hf-wpn-fill" d="M46 40 L54 18 L57 20 L50 44 Z"/><path class="hf-wpn-fill" d="M52 46 L60 28 L62 30 L56 50 Z"/>',
    dagger:'<path class="hf-wpn-fill" d="M47 46 L54 18 L58 20 L51 50 Z"/><path class="hf-wpn-line" d="M45 48 L53 48"/>',
    claw:'<path class="hf-wpn-line" d="M45 30 L55 18"/><path class="hf-wpn-line" d="M48 38 L60 26"/><path class="hf-wpn-line" d="M51 46 L62 36"/>',
    spear:'<path class="hf-wpn-line" d="M47 64 L53 14"/><path class="hf-wpn-fill" d="M53 14 L58 4 L50 10 Z"/>',
    fan:'<path class="hf-wpn-fill" d="M48 58 Q66 40 58 18 Q46 28 42 48 Z"/><path class="hf-wpn-line thin" d="M48 58 L57 20"/>',
    scepter:'<path class="hf-wpn-line" d="M48 22 L48 64"/><path class="hf-wpn-fill" d="M48 8 L55 17 L48 26 L41 17 Z"/>',
  };

  function look(id) { return LOOKS[id] || DEFAULT; }

  function bodySVG(L) {
    const b = L.build;
    if (b === "heavy") {
      return '<path class="hf-cloak" d="M10 36 Q3 56 10 72 L54 72 Q61 56 54 36 Z"/>' +
        '<path class="hf-shoulder" d="M10 34 Q20 26 28 34 L26 42 Q16 38 8 44 Z"/>' +
        '<path class="hf-shoulder" d="M54 34 Q44 26 36 34 L38 42 Q48 38 56 44 Z"/>' +
        '<path class="hf-armor" d="M20 32 L32 24 L44 32 L41 57 L32 63 L23 57 Z"/>' +
        '<path class="hf-leg" d="M24 58 L21 72 M40 58 L43 72"/>';
    }
    if (b === "robed") {
      return '<path class="hf-cloak" d="M12 34 Q4 56 10 73 L54 73 Q60 56 52 34 Z"/>' +
        '<path class="hf-robe" d="M24 36 L40 36 L46 73 L18 73 Z"/>' +
        '<path class="hf-armor" d="M23 30 L32 24 L41 30 L40 48 L32 54 L24 48 Z"/>' +
        '<path class="hf-belt" d="M23 52 L41 52" />';
    }
    if (b === "winged") {
      return '<path class="hf-cape" d="M15 34 Q2 54 14 72 L50 72 Q62 54 49 34 Z"/>' +
        '<path class="hf-armor" d="M22 31 L32 24 L42 31 L40 56 L32 62 L24 56 Z"/>' +
        '<path class="hf-leg" d="M26 58 L24 72 M38 58 L40 72"/>';
    }
    if (b === "armored") {
      return '<path class="hf-cloak" d="M13 35 Q7 54 12 71 L52 71 Q57 54 51 35 Z"/>' +
        '<path class="hf-shoulder" d="M13 33 Q22 25 29 33 L27 41 Q18 37 10 43 Z"/>' +
        '<path class="hf-shoulder" d="M51 33 Q42 25 35 33 L37 41 Q46 37 54 43 Z"/>' +
        '<path class="hf-armor" d="M21 31 L32 24 L43 31 L40 57 L32 63 L24 57 Z"/>' +
        '<path class="hf-leg" d="M25 58 L23 72 M39 58 L41 72"/>' +
        '<path class="hf-belt" d="M24 55 L40 55"/>';
    }
    return '<path class="hf-cloak" d="M14 35 Q8 53 13 71 L51 71 Q56 53 50 35 Z"/>' +
      '<path class="hf-armor" d="M22 32 L32 25 L42 32 L39 56 L32 62 L25 56 Z"/>' +
      '<path class="hf-leg" d="M26 59 L24 72 M38 59 L40 72"/>';
  }

  function headSVG(L) {
    const h = L.head;
    if (h === "helm") {
      return '<path class="hf-helm" d="M22 24 Q22 9 32 9 Q42 9 42 24 L39 30 L25 30 Z"/>' +
        '<path class="hf-visor" d="M24 23 L40 23 L39 27 L25 27 Z"/>' +
        '<path class="hf-plume" d="M32 9 Q38 3 43 7 Q38 7 34 12 Z"/>';
    }
    if (h === "crown") {
      return '<path class="hf-head" d="M24 24 Q24 13 32 13 Q40 13 40 24 Z"/>' +
        '<path class="hf-crown" d="M22 15 L25 8 L29 14 L32 6 L35 14 L39 8 L42 15 Z"/>';
    }
    if (h === "mask") {
      return '<path class="hf-head" d="M23 23 Q23 12 32 12 Q41 12 41 23 L38 29 Q32 33 26 29 Z"/>' +
        '<path class="hf-mask" d="M24 20 L40 20 L38 28 Q32 31 26 28 Z"/>' +
        '<path class="hf-eye-slit" d="M26 23 L30 23 M34 23 L38 23"/>';
    }
    if (h === "horns") {
      return '<path class="hf-head" d="M24 24 Q24 13 32 13 Q40 13 40 24 Z"/>' +
        '<path class="hf-horn" d="M24 16 Q17 8 20 3 Q24 9 27 14 Z"/>' +
        '<path class="hf-horn" d="M40 16 Q47 8 44 3 Q40 9 37 14 Z"/>';
    }
    if (h === "hat") {
      return '<path class="hf-head" d="M24 24 Q24 14 32 14 Q40 14 40 24 Z"/>' +
        '<path class="hf-hat" d="M22 16 Q32 4 42 16 L48 20 L16 20 Z"/>';
    }
    if (h === "halo") {
      return '<path class="hf-head" d="M24 23 Q24 13 32 13 Q40 13 40 23 Z"/>' +
        '<ellipse class="hf-halo" cx="32" cy="8" rx="11" ry="3"/>';
    }
    return '<path class="hf-head" d="M24 23 Q24 12 32 12 Q40 12 40 23 Z"/>' +
      '<path class="hf-hood" d="M21 23 Q22 7 32 7 Q42 7 43 23 Q37 16 32 16 Q27 16 21 23 Z"/>';
  }

  function accSVG(L) {
    const a = L.acc;
    if (a === "wings") {
      return '<path class="hf-wing" d="M20 36 Q2 22 3 50 Q10 48 14 56 Q18 44 24 46 Z"/>' +
        '<path class="hf-wing" d="M44 36 Q62 22 61 50 Q54 48 50 56 Q46 44 40 46 Z"/>';
    }
    if (a === "cape") {
      return '<path class="hf-back-cape" d="M17 32 Q4 52 12 70 L22 68 L20 36 Z"/>';
    }
    if (a === "scarf") {
      return '<path class="hf-scarf" d="M22 30 Q32 36 42 30 Q38 40 30 40 Q44 48 54 44 Q44 54 29 44 Q24 38 22 30 Z"/>';
    }
    if (a === "halo" || a === "orb") {
      return '<circle class="hf-float-orb" cx="50" cy="12" r="3.2"/>';
    }
    if (a === "tail") {
      return '<path class="hf-tail" d="M14 60 Q0 64 4 74 Q12 70 18 68 Z"/>';
    }
    return "";
  }

  function sigilSVG(L) {
    const s = L.sigil;
    if (s === "diamond") return '<path class="hf-sigil" d="M32 40 L36 46 L32 52 L28 46 Z"/>';
    if (s === "star") return '<path class="hf-sigil" d="M32 39 L34 45 L40 45 L35 49 L37 55 L32 51 L27 55 L29 49 L24 45 L30 45 Z"/>';
    if (s === "shield") return '<path class="hf-sigil" d="M27 42 Q32 39 37 42 Q36 50 32 53 Q28 50 27 42 Z"/>';
    if (s === "cross") return '<path class="hf-sigil" d="M30 40 L34 40 L34 44 L38 44 L38 48 L34 48 L34 54 L30 54 L30 48 L26 48 L26 44 L30 44 Z"/>';
    if (s === "bolt") return '<path class="hf-sigil" d="M34 39 L28 47 L32 47 L29 54 L37 45 L33 45 Z"/>';
    if (s === "eye") return '<path class="hf-sigil" d="M25 46 Q32 40 39 46 Q32 52 25 46 Z"/><circle class="hf-sigil-dot" cx="32" cy="46" r="1.6"/>';
    if (s === "feather") return '<path class="hf-sigil" d="M32 54 Q28 46 32 39 Q36 46 32 54 Z"/>';
    if (s === "lotus") return '<path class="hf-sigil" d="M32 52 Q26 48 27 42 Q32 45 32 52 Q32 45 37 42 Q38 48 32 52 Z"/>';
    if (s === "mountain") return '<path class="hf-sigil" d="M24 53 L30 42 L34 48 L38 41 L42 53 Z"/>';
    if (s === "gear") return '<circle class="hf-sigil-ring" cx="32" cy="46" r="5"/><circle class="hf-sigil-dot" cx="32" cy="46" r="1.8"/>';
    if (s === "drop") return '<path class="hf-sigil" d="M32 39 Q38 47 32 53 Q26 47 32 39 Z"/>';
    if (s === "wave") return '<path class="hf-sigil-line" d="M24 48 Q28 43 32 48 Q36 53 40 48"/>';
    if (s === "dragon") return '<path class="hf-sigil-line" d="M24 50 Q30 42 34 48 Q38 54 42 46"/>';
    if (s === "claw") return '<path class="hf-sigil-line" d="M27 40 L35 52 M31 39 L39 51"/>';
    if (s === "arrow") return '<path class="hf-sigil-line" d="M25 50 L37 42 M32 42 L37 42 L37 47"/>';
    if (s === "blade") return '<path class="hf-sigil-line" d="M28 52 L36 40 M33 41 L36 40 L35 44"/>';
    return "";
  }

  function figureSVG(id) {
    const L = look(id);
    const wpn = WEAPONS[L.weapon] || WEAPONS.sword;
    return '<svg class="hero-figure" viewBox="0 0 64 78" aria-hidden="true">' +
      '<ellipse class="hf-shadow" cx="32" cy="73" rx="17" ry="4"/>' +
      accSVG(L) +
      bodySVG(L) +
      '<path class="hf-neck" d="M29 28 L35 28 L36 33 L28 33 Z"/>' +
      headSVG(L) +
      '<circle class="hf-eye" cx="29" cy="23" r="1.25"/><circle class="hf-eye" cx="35" cy="23" r="1.25"/>' +
      sigilSVG(L) +
      '<g class="hf-weapon">' + wpn + '</g>' +
      '</svg>';
  }

  function visualHTML(id, extraClass) {
    const L = look(id);
    return '<span class="hero-aura aura-' + L.aura + '"></span>' +
      '<span class="hero-particle-field" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="hero-figure-wrap ' + (extraClass || "") + '">' + figureSVG(id) + '</span>';
  }

  function applyVars(el, id) {
    if (!el) return;
    const L = look(id);
    el.style.setProperty("--c1", L.c1);
    el.style.setProperty("--c2", L.c2);
    el.style.setProperty("--c3", L.c3);
    el.style.setProperty("--move-dur", L.dur + "ms");
    el.style.setProperty("--idle-dur", (2.4 + (L.dur % 90) / 100) + "s");
  }

  function moveStyle(id) {
    const L = look(id);
    return { color: L.c3, dur: L.dur, tilt: L.tilt, dash: L.dur <= 300, aura: L.aura };
  }

  /* 技能身体姿态分类：同一技能类型在不同英雄身上仍有专属配色/武器 */
  const POSE_BY_TYPE = {
    damage_single:"channel", freeze:"channel", damage_line:"ranged", damage_adjacent_all:"area",
    heal:"heal", shield_self:"defense", shield_ally:"defense", blink:"teleport", dash:"dash",
    duanlang:"dash", shuidiao:"dash", dragonbreath:"area", thunder:"area", chase:"dash",
    bloodburst:"area", ziwei:"teleport", exile:"channel", tianwei:"area", shenluo:"area",
    wxt:"pull", metalpierce:"ranged", metalarmor:"defense", metaltide:"buff", meditate:"lotus",
    divinepalm:"thrust", stealth:"stealth", mistdash:"dash", shadowfang:"slash",
    push:"thrust", charge:"dash", raikiri:"ranged", thunderblade:"dash",
    susano_dash:"dash", susano_pull:"pull", susano_arrow:"ranged", susano_crow:"summon",
  };
  function poseFor(heroId, skill, stage) {
    if (!skill) return "channel";
    const type = skill.type;
    // 重点技能：独立骨骼/姿态类（不再只走 15 类通用姿态）
    const special = {
      "thunder:thunder": "thunder-discharge",
      "eagle:raikiri": "eagle-raikiri",
      "eagle:thunderblade:0": "eagle-tb0",
      "eagle:thunderblade:1": "eagle-tb1",
      "eagle:thunderblade:2": "eagle-tb2",
      "susanoo:susano_dash": "susanoo-dash",
      "susanoo:susano_pull": "susanoo-pull",
      "susanoo:susano_arrow": "susanoo-arrow",
      "susanoo:susano_crow": "susanoo-crow",
      "cicada:meditate": "cicada-meditate",
      "cicada:divinepalm": "cicada-palm",
      "metal:metalpierce": "metal-pierce",
      "metal:metalarmor": "metal-armor",
      "metal:metaltide": "metal-tide",
      "raven:stealth": "raven-stealth",
      "raven:mistdash": "raven-mist",
      "raven:shadowfang": "raven-fang",
      "hillking:push": "hillking-push",
      "huamulan:charge": "huamulan-charge",
      "ranger:damage_line": "ranger-shot",
      "knight:damage_adjacent_all": "knight-sweep",
      "cleric:heal": "cleric-pray",
      "warlock:freeze": "warlock-frost",
      "jade:exile": "jade-exile",
      "tiandao:wxt": "tiandao-pull",
      "cang:shuidiao": "cang-dance",
      "longren:dragonbreath": "longren-breath",
      "vampire:bloodburst": "vampire-burst",
    };
    const key = heroId + ":" + type + (type === "thunderblade" ? ":" + (stage || 0) : "");
    if (special[key]) return special[key];
    if (type === "thunderblade") return ["slash", "thrust", "area"][stage || 0] || "dash";
    if (type === "meditate") return "lotus";
    if (type === "susano_crow") return "summon";
    if (type === "susano_arrow") return "ranged";
    if (type === "stealth") return "stealth";
    return POSE_BY_TYPE[type] || "channel";
  }
  const ATTACK_POSE_BY_WEAPON = {
    bow: "ranged", staff: "channel", orb: "channel", spear: "thrust", axe: "smash",
    hammer: "smash", sword: "slash", blade: "slash", dagger: "slash", daggers: "slash",
    claw: "slash", fan: "channel", shield: "defense", scepter: "channel",
  };
  function attackPose(heroId) {
    return ATTACK_POSE_BY_WEAPON[look(heroId).weapon] || "slash";
  }

  /* 技能图标：小尺寸矢量徽记，不用 emoji */
  function skillIcon(type) {
    const t = type || "";
    let inner = "";
    if (/thunder|raikiri|bolt|discharge|susano_arrow|damage_line|ranged/.test(t)) {
      inner = '<path d="M13 2 L6 13 H11 L9 22 L19 10 H14 Z"/>';
    } else if (/thunderblade|slash|charge|dash|duanlang|shuidiao|metalpierce|shadowfang|divinepalm|push/.test(t)) {
      inner = '<path d="M4 20 L18 6 L21 3 L20 7 L7 21 Z"/><path d="M4 20 L9 15"/>';
    } else if (/pull|wxt|grab|exile|tianwei/.test(t)) {
      inner = '<path d="M4 12 Q8 4 12 12 Q16 20 20 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';
    } else if (/stealth|raven|mist/.test(t)) {
      inner = '<path d="M17 3 Q8 5 6 12 Q5 19 14 21 Q8 16 10 10 Q12 6 17 3 Z"/>';
    } else if (/heal|meditate|cleric/.test(t)) {
      inner = '<path d="M10 3 H14 V9 H20 V13 H14 V21 H10 V13 H4 V9 H10 Z"/>';
    } else if (/shield|metalarmor|guard|defense/.test(t)) {
      inner = '<path d="M12 2 Q19 5 19 12 Q19 18 12 22 Q5 18 5 12 Q5 5 12 2 Z"/>';
    } else if (/summon|crow|wings/.test(t)) {
      inner = '<path d="M12 13 Q4 4 2 11 Q6 12 8 16 Q10 13 12 13 Q14 13 16 16 Q18 12 22 11 Q20 4 12 13 Z"/>';
    } else {
      inner = '<path d="M12 2 L15 9 L22 12 L15 15 L12 22 L9 15 L2 12 L9 9 Z"/>';
    }
    return '<svg class="skill-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + inner + '</svg>';
  }

  /* ---------------------------------------------------------------------
     立绘资源接口（可替换为正式美术资源）
     当前示范：雷电之主 / 鹰佐 / 须佐 的高分辨率透明 SVG 立绘。
     同一资源可派生 board / avatar / icon / silhouette；后续换成 PNG/WebP
     只需修改这里的路径，游戏内卡片会自动加载并在失败时回退到矢量棋子。
     --------------------------------------------------------------------- */
  const HERO_ART = {
    thunder: { portrait: "art/thunder-portrait.webp", board: "art/thunder-board.webp", avatar: "art/thunder-avatar.webp", icon: "art/thunder-icon.webp", silhouette: "art/thunder-silhouette.webp" },
    eagle: { portrait: "art/eagle-portrait.webp", board: "art/eagle-board.webp", avatar: "art/eagle-avatar.webp", icon: "art/eagle-icon.webp", silhouette: "art/eagle-silhouette.webp" },
    susanoo: { portrait: "art/susanoo-portrait.webp", board: "art/susanoo-board.webp", avatar: "art/susanoo-avatar.webp", icon: "art/susanoo-icon.webp", silhouette: "art/susanoo-silhouette.webp" },
  };
  function portraitHTML(id, extraClass) {
    const art = HERO_ART[id];
    if (!art || !art.portrait) return visualHTML(id, extraClass);
    const src = (extraClass && extraClass.indexOf("mini") >= 0 && art.avatar) ? art.avatar : art.portrait;
    return '<span class="hero-art-wrap ' + (extraClass || "") + '">' +
      '<img class="hero-art-img" src="' + src + '" alt="" ' +
      'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'hero-art-failed\')">' +
      '<span class="hero-art-fallback">' + visualHTML(id) + '</span>' +
      '</span>';
  }

  window.HeroVisuals = { LOOKS, DEFAULT, look, figureSVG, visualHTML, applyVars, moveStyle, poseFor, attackPose, skillIcon, POSE_BY_TYPE, HERO_ART, portraitHTML };
})();
