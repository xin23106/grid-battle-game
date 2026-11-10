/* ==========================================================================
   herovisuals.js —— 英雄视觉身份表
   纯表现层：不参与任何战斗规则判定。
   每个英雄拥有独立主色、副色、武器轮廓、光环、粒子、待机与移动节奏。
   ========================================================================== */
(function () {
  const LOOKS = {
    berserker: { c1: "#ef4444", c2: "#7f1d1d", c3: "#fca5a5", weapon: "axe", aura: "fire", dur: 340, tilt: 7 },
    mage:      { c1: "#8b5cf6", c2: "#4c1d95", c3: "#ddd6fe", weapon: "orb", aura: "arcane", dur: 340, tilt: 3 },
    knight:    { c1: "#60a5fa", c2: "#1e3a8a", c3: "#dbeafe", weapon: "sword", aura: "blade", dur: 340, tilt: 5 },
    ranger:    { c1: "#22c55e", c2: "#14532d", c3: "#bbf7d0", weapon: "bow", aura: "wind", dur: 300, tilt: 4 },
    assassin:  { c1: "#64748b", c2: "#0f172a", c3: "#cbd5e1", weapon: "daggers", aura: "dark", dur: 240, tilt: 8 },
    warlock:   { c1: "#38bdf8", c2: "#0c4a6e", c3: "#e0f2fe", weapon: "staff", aura: "ice", dur: 340, tilt: 3 },
    cleric:    { c1: "#fbbf24", c2: "#92400e", c3: "#fef3c7", weapon: "staff", aura: "holy", dur: 350, tilt: 2 },
    guardian:  { c1: "#94a3b8", c2: "#334155", c3: "#e2e8f0", weapon: "shield", aura: "shield", dur: 400, tilt: 2 },
    asura:     { c1: "#e2e8f0", c2: "#475569", c3: "#f8fafc", weapon: "blade", aura: "blade", dur: 270, tilt: 7 },
    lone:      { c1: "#f97316", c2: "#7c2d12", c3: "#fed7aa", weapon: "claw", aura: "fire", dur: 300, tilt: 7 },
    cang:      { c1: "#0ea5e9", c2: "#0c4a6e", c3: "#bae6fd", weapon: "fan", aura: "water", dur: 300, tilt: 4 },
    longren:   { c1: "#22c55e", c2: "#14532d", c3: "#bbf7d0", weapon: "spear", aura: "dragon", dur: 330, tilt: 5 },
    thunder:   { c1: "#60a5fa", c2: "#7c3aed", c3: "#e0f2fe", weapon: "staff", aura: "thunder", dur: 210, tilt: 6 },
    vampire:   { c1: "#e11d48", c2: "#4c0519", c3: "#fecdd3", weapon: "dagger", aura: "blood", dur: 330, tilt: 4 },
    jade:      { c1: "#fbbf24", c2: "#78350f", c3: "#fde68a", weapon: "scepter", aura: "royal", dur: 340, tilt: 2 },
    xiangyu:   { c1: "#ef4444", c2: "#7f1d1d", c3: "#fecaca", weapon: "spear", aura: "blood", dur: 400, tilt: 6 },
    tiandao:   { c1: "#c084fc", c2: "#4c1d95", c3: "#ede9fe", weapon: "orb", aura: "void", dur: 260, tilt: 3 },
    huamulan:  { c1: "#f43f5e", c2: "#881337", c3: "#fecdd3", weapon: "sword", aura: "petal", dur: 300, tilt: 5 },
    hillking:  { c1: "#a8a29e", c2: "#44403c", c3: "#e7e5e4", weapon: "hammer", aura: "stone", dur: 460, tilt: 2 },
    raven:     { c1: "#8b5cf6", c2: "#1e1b4b", c3: "#c4b5fd", weapon: "claw", aura: "raven", dur: 300, tilt: 6 },
    metal:     { c1: "#fbbf24", c2: "#78716c", c3: "#fde68a", weapon: "hammer", aura: "metal", dur: 400, tilt: 2 },
    cicada:    { c1: "#fcd34d", c2: "#b45309", c3: "#fef3c7", weapon: "staff", aura: "gold", dur: 360, tilt: 2 },
    eagle:     { c1: "#a78bfa", c2: "#4c1d95", c3: "#c4b5fd", weapon: "blade", aura: "storm", dur: 220, tilt: 7 },
    susanoo:   { c1: "#7c3aed", c2: "#312e81", c3: "#c4b5fd", weapon: "bow", aura: "chakra", dur: 380, tilt: 3 },
  };
  const DEFAULT = { c1: "#93c5fd", c2: "#334155", c3: "#e2e8f0", weapon: "sword", aura: "default", dur: 340, tilt: 4 };

  const WEAPONS = {
    sword: '<path class="hf-wpn-fill" d="M49 58 L53 20 L56 15 L57 19 L53 60 Z"/><path class="hf-wpn-line" d="M47 56 L53 56"/>',
    blade: '<path class="hf-wpn-fill" d="M48 60 L54 20 L58 14 L58 20 L52 62 Z"/><path class="hf-wpn-line" d="M45 57 L53 57"/>',
    staff: '<path class="hf-wpn-line" d="M48 20 L48 64"/><circle class="hf-wpn-fill" cx="48" cy="15" r="5"/>',
    orb: '<path class="hf-wpn-line" d="M47 28 L47 62"/><circle class="hf-wpn-fill" cx="48" cy="20" r="7"/><circle class="hf-wpn-glow" cx="48" cy="20" r="10"/>',
    bow: '<path class="hf-wpn-line" d="M49 16 Q60 39 49 62"/><path class="hf-wpn-line thin" d="M49 16 L49 62"/>',
    shield: '<path class="hf-wpn-fill" d="M47 20 Q59 24 55 43 Q51 56 47 61 Q43 56 39 43 Q35 24 47 20 Z"/><path class="hf-wpn-line thin" d="M47 26 L47 54"/>',
    axe: '<path class="hf-wpn-line" d="M47 58 L47 20"/><path class="hf-wpn-fill" d="M45 22 Q58 14 58 28 Q58 38 45 34 Z"/>',
    hammer: '<path class="hf-wpn-line" d="M47 62 L47 22"/><rect class="hf-wpn-fill" x="39" y="12" width="17" height="12" rx="3"/>',
    daggers: '<path class="hf-wpn-fill" d="M46 40 L54 18 L57 20 L50 44 Z"/><path class="hf-wpn-fill" d="M52 46 L60 28 L62 30 L56 50 Z"/>',
    dagger: '<path class="hf-wpn-fill" d="M47 46 L54 18 L58 20 L51 50 Z"/><path class="hf-wpn-line" d="M45 48 L53 48"/>',
    claw: '<path class="hf-wpn-line" d="M45 30 L55 18"/><path class="hf-wpn-line" d="M48 38 L60 26"/><path class="hf-wpn-line" d="M51 46 L62 36"/>',
    spear: '<path class="hf-wpn-line" d="M47 64 L53 14"/><path class="hf-wpn-fill" d="M53 14 L58 4 L50 10 Z"/>',
    fan: '<path class="hf-wpn-fill" d="M48 58 Q66 40 58 18 Q46 28 42 48 Z"/><path class="hf-wpn-line thin" d="M48 58 L57 20"/>',
    scepter: '<path class="hf-wpn-line" d="M48 22 L48 64"/><path class="hf-wpn-fill" d="M48 8 L55 17 L48 26 L41 17 Z"/>',
  };

  function look(id) { return LOOKS[id] || DEFAULT; }

  function figureSVG(id) {
    const L = look(id);
    const wpn = WEAPONS[L.weapon] || WEAPONS.sword;
    return '<svg class="hero-figure" viewBox="0 0 64 78" aria-hidden="true">' +
      '<ellipse class="hf-shadow" cx="32" cy="73" rx="17" ry="4"/>' +
      '<path class="hf-cloak" d="M13 36 Q7 54 12 71 L52 71 Q57 54 51 36 Z"/>' +
      '<path class="hf-armor" d="M22 32 L32 25 L42 32 L39 55 L32 61 L25 55 Z"/>' +
      '<path class="hf-leg" d="M26 59 L24 71 M38 59 L40 71"/>' +
      '<circle class="hf-head" cx="32" cy="22" r="8.5"/>' +
      '<path class="hf-hood" d="M22 22 Q23 8 32 8 Q41 8 42 22 Q36 16 32 16 Q28 16 22 22 Z"/>' +
      '<circle class="hf-eye" cx="29" cy="23" r="1.25"/><circle class="hf-eye" cx="35" cy="23" r="1.25"/>' +
      '<g class="hf-weapon">' + wpn + '</g>' +
      '</svg>';
  }

  /* 通用视觉块：光环 + 环绕粒子 + 角色主体 */
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
    return {
      color: L.c3,
      dur: L.dur,
      tilt: L.tilt,
      dash: L.dur <= 300,
      aura: L.aura,
    };
  }

  window.HeroVisuals = { LOOKS, DEFAULT, look, figureSVG, visualHTML, applyVars, moveStyle };
})();
