/* =========================================================================
 * sfx.js —— 战斗音效系统（Web Audio 实时合成，无外部音频文件 / 无版权风险）
 * -------------------------------------------------------------------------
 * 设计要点：
 *  · 每个音效由「多层」原语组合而成：tone / noise / metal / thump / sweep
 *    —— 不同技能是不同配方的组合，而不是同一个音效换音量/变速。
 *  · 每名英雄有独立音色（HERO），并作用于出手、命中、技能层。
 *  · 普通攻击 / 命中 / 受击 / 重击 / 护盾 / 闪避 / 死亡都有多个变体，
 *    随机选择且不会连续重复同一个变体。
 *  · 全局声道：master → compressor → destination，下列 bus：
 *      sfxBus(战斗音效音量) → master
 *      skillBus(技能音效开关) → sfxBus
 *      loopBus(持续音，独立限幅) → sfxBus
 *  · 持续音可启动/停止，重新开局、胜负结算、关闭音效时统一清理。
 *  · 失败安全：任何异常都不影响游戏运行。
 *
 * 对外接口：
 *   SFX.play(event, {hero, heavy, ...})     兼容旧调用
 *   SFX.playSkill(skillType, {hero, stage})  技能专属配方
 *   SFX.startLoop(key, opts) / stopLoop(key) / stopAll()
 *   SFX.getSettings() / setSettings(patch) / resetDefaults()
 *   SFX.setEnabled / setVolume（兼容旧接口）
 *   SFX.unlock() / getLog() / testDemo()
 * ========================================================================= */
(function () {
  "use strict";

  const KEY = "herochess.sfx.v2";
  const DEFAULTS = { enabled: true, master: 0.85, sfx: 0.7, skills: true };
  const MAX_VOICES = 64;   // 分层设计下按“层”计数；超出后新声音直接丢弃

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function load() {
    const out = Object.assign({}, DEFAULTS);
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw === "object") {
        if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
        if (typeof raw.master === "number") out.master = clamp01(raw.master);
        if (typeof raw.sfx === "number") out.sfx = clamp01(raw.sfx);
        if (typeof raw.skills === "boolean") out.skills = raw.skills;
      } else {
        // 迁移旧版设置
        const old = JSON.parse(localStorage.getItem("herochess.sfx") || "null");
        if (old && typeof old === "object") {
          if (typeof old.enabled === "boolean") out.enabled = old.enabled;
          if (typeof old.volume === "number") out.sfx = clamp01(old.volume);
        }
      }
    } catch (e) { /* 忽略 */ }
    return out;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }
  let settings = load();

  let ctx = null, master = null, busSfx = null, busSkill = null, busLoop = null, comp = null;
  const voiceEnds = [];   // 每个发声层的结束时间（performance.now），避免依赖被节流的 setTimeout
  let noiseBuf = null;
  const lastAt = {};
  const lastVariant = {};
  const loops = new Map();
  const log = [];

  /* ---------------- 英雄音色 ----------------
   * wave: 主体波形  base: 基频  air: 破风噪声中心频率
   * metal: 金属泛音强度  wet: 低频厚度  pan: 轻微声像  */
  const HERO = {
    berserker: { wave: "sawtooth", base: 150, air: 1500, metal: 0.20, wet: 0.8, pan: -0.05 },
    mage:      { wave: "sine",     base: 620, air: 2600, metal: 0.10, wet: 0.2, pan: 0.05 },
    knight:    { wave: "square",   base: 300, air: 2100, metal: 0.55, wet: 0.5, pan: -0.02 },
    ranger:    { wave: "triangle", base: 760, air: 3200, metal: 0.15, wet: 0.1, pan: 0.08 },
    assassin:  { wave: "triangle", base: 1500, air: 4200, metal: 0.30, wet: 0.05, pan: 0.10 },
    warlock:   { wave: "sine",     base: 1750, air: 5200, metal: 0.18, wet: 0.05, pan: -0.08 },
    cleric:    { wave: "sine",     base: 900, air: 2400, metal: 0.05, wet: 0.15, pan: 0.04 },
    guardian:  { wave: "square",   base: 240, air: 1200, metal: 0.45, wet: 0.9, pan: -0.06 },
    asura:     { wave: "square",   base: 1350, air: 4600, metal: 0.85, wet: 0.20, pan: 0.02 },
    lone:      { wave: "sawtooth", base: 200, air: 1400, metal: 0.20, wet: 0.85, pan: 0.0 },
    cang:      { wave: "sine",     base: 520, air: 1800, metal: 0.10, wet: 0.55, pan: -0.04 },
    longren:   { wave: "sawtooth", base: 180, air: 900,  metal: 0.15, wet: 0.95, pan: 0.06 },
    thunder:   { wave: "sawtooth", base: 230, air: 6000, metal: 0.25, wet: 0.7, pan: -0.03 },
    vampire:   { wave: "sawtooth", base: 260, air: 1000, metal: 0.12, wet: 0.9, pan: 0.03 },
    jade:      { wave: "sine",     base: 440, air: 2800, metal: 0.35, wet: 0.3, pan: 0.0 },
    xiangyu:   { wave: "sawtooth", base: 130, air: 1600, metal: 0.35, wet: 1.0, pan: -0.03 },
    tiandao:   { wave: "sine",     base: 165, air: 1200, metal: 0.30, wet: 0.8, pan: 0.05 },
    __default: { wave: "triangle", base: 600, air: 2400, metal: 0.25, wet: 0.3, pan: 0 },
  };
  function H(id) { return HERO[id] || HERO.__default; }

  /* ---------------- 音频上下文 ---------------- */
  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;

      master = ctx.createGain();
      busSfx = ctx.createGain();
      busSkill = ctx.createGain();
      busLoop = ctx.createGain();
      busLoop.gain.value = 0.5;

      busSfx.connect(master);
      busSkill.connect(busSfx);
      busLoop.connect(busSfx);
      master.connect(comp);
      comp.connect(ctx.destination);
      applyGains();
      return true;
    } catch (e) {
      ctx = null;
      return false;
    }
  }
  function applyGains() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.enabled ? settings.master : 0, t, 0.02);
    busSfx.gain.setTargetAtTime(settings.sfx, t, 0.02);
    busSkill.gain.setTargetAtTime(settings.skills ? 1 : 0, t, 0.02);
  }
  function now() { return ctx ? ctx.currentTime : 0; }

  /* ---------------- 噪声缓冲（复用，避免每次都生成） ---------------- */
  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.6);
    noiseBuf = ctx.createBuffer(1, len, sr);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* ---------------- 输出节点：pan + gain ---------------- */
  function outNode(bus, pan) {
    let node = bus;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(bus);
      node = p;
    }
    return node;
  }
  function activeVoices() {
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    for (let i = voiceEnds.length - 1; i >= 0; i--) {
      if (voiceEnds[i] <= t) voiceEnds.splice(i, 1);
    }
    return voiceEnds.length;
  }
  function track(dur) {
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    voiceEnds.push(t + dur * 1000 + 90);
    if (voiceEnds.length > 400) voiceEnds.splice(0, voiceEnds.length - 400);
  }

  /* ---------------- 原语 ---------------- */
  function snap(v) { return Math.max(0.01, v); }

  function tone(o) {
    const at = o.at, dur = Math.max(0.02, o.dur || 0.12);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.wave || "sine";
    const f0 = Math.max(20, o.f0 || 440);
    osc.frequency.setValueAtTime(f0, at);
    if (o.f1) {
      const f1 = Math.max(20, o.f1);
      if (o.linear) osc.frequency.linearRampToValueAtTime(f1, at + (o.glide || dur));
      else osc.frequency.exponentialRampToValueAtTime(f1, at + (o.glide || dur));
    }
    if (o.detune) osc.detune.value = o.detune;
    const peak = snap((o.peak || 0.1) * duck());
    const a = Math.max(0.002, o.attack == null ? 0.006 : o.attack);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + a);
    if (o.hold) g.gain.setValueAtTime(peak, at + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(outNode(o.bus || busSfx, o.pan));
    osc.start(at);
    osc.stop(at + dur + 0.03);
    track(dur);
  }

  function noise(o) {
    const at = o.at, dur = Math.max(0.02, o.dur || 0.12);
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    let node = src;
    if (o.bp) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(Math.max(60, o.bp), at);
      f.Q.value = o.q == null ? 1.2 : o.q;
      if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.sweepTo), at + (o.sweepDur || dur));
      node.connect(f); node = f;
    } else {
      if (o.hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = o.hp; node.connect(f); node = f; }
      if (o.lp) {
        const f = ctx.createBiquadFilter(); f.type = "lowpass";
        f.frequency.setValueAtTime(Math.max(80, o.lp), at);
        if (o.lpTo) f.frequency.exponentialRampToValueAtTime(Math.max(80, o.lpTo), at + (o.sweepDur || dur));
        f.Q.value = o.lpQ || 0.7;
        node.connect(f); node = f;
      }
    }
    const g = ctx.createGain();
    const peak = snap((o.peak || 0.12) * duck());
    const a = Math.max(0.002, o.attack == null ? 0.004 : o.attack);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + a);
    if (o.hold) g.gain.setValueAtTime(peak, at + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    node.connect(g);
    g.connect(outNode(o.bus || busSfx, o.pan));
    src.start(at, Math.random() * 0.8);
    src.stop(at + dur + 0.03);
    track(dur);
  }

  /* 非谐波金属泛音（剑鸣/护盾/钟） */
  function metal(o) {
    const at = o.at, dur = Math.max(0.05, o.dur || 0.3);
    const parts = o.partials || [1, 2.76, 5.4, 8.93];
    const base = o.base || 900;
    parts.forEach((r, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = base * r;
      const p = snap((o.peak || 0.1) * duck() / (i + 1.4));
      const a = o.attack == null ? 0.004 : o.attack;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(p, at + a);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur * (1 - i * 0.12));
      osc.connect(g);
      g.connect(outNode(o.bus || busSfx, o.pan));
      osc.start(at);
      osc.stop(at + dur + 0.03);
    });
    track(dur);
  }

  /* 低频冲击（落地/击杀/重击） */
  function thump(o) {
    const at = o.at, dur = Math.max(0.06, o.dur || 0.22);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.wave || "sine";
    osc.frequency.setValueAtTime(Math.max(24, o.f0 || 160), at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 || 42), at + dur * 0.85);
    const peak = snap((o.peak || 0.3) * duck());
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(outNode(o.bus || busSfx, o.pan));
    osc.start(at);
    osc.stop(at + dur + 0.02);
    track(dur);
  }

  /* 频率扫掠（蓄力/空间折叠） */
  function sweep(o) {
    tone(Object.assign({ wave: "sine", f0: 200, f1: 1200, attack: 0.02 }, o));
  }

  /* ---------------- 层构造（先入队，再统一调度） ---------------- */
  function T(L, o) { L.push(Object.assign({ k: "tone" }, o)); }
  function N(L, o) { L.push(Object.assign({ k: "noise" }, o)); }
  function M(L, o) { L.push(Object.assign({ k: "metal" }, o)); }
  function HP(L, o) { L.push(Object.assign({ k: "thump" }, o)); }
  function S(L, o) { L.push(Object.assign({ k: "tone", wave: o.wave || "sine", attack: o.attack == null ? 0.02 : o.attack }, o)); }

  /* ---------------- 变体与限流 ---------------- */
  function pickVariant(key, n) {
    if (n <= 1) return 0;
    let v = Math.floor(Math.random() * n);
    if (v === lastVariant[key]) v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n;
    lastVariant[key] = v;
    return v;
  }
  function duck() {
    const v = activeVoices();
    if (v > 44) return 0.5;
    if (v > 30) return 0.72;
    if (v > 16) return 0.88;
    return 1;
  }

  /* ---------------- 配方：普通战斗 ---------------- */
  function recipeAttack(h, o, L) {
    const v = pickVariant("attack", 5);
    const heavy = !!o.heavy;
    const air = h.air * (heavy ? 0.7 : 1.15);
    const at = 0;
    // 破风（每变体不同滤波与时长）
    const w = [0.09, 0.11, 0.08, 0.13, 0.07][v];
    N(L, { at, dur: w, bp: air, q: 0.9 + v * 0.12, sweepTo: air * (0.5 - v * 0.03), peak: heavy ? 0.16 : 0.11, attack: 0.004 });
    // 主体
    T(L, { at: at + 0.005, dur: 0.08 + v * 0.008, wave: h.wave, f0: h.base * (1.2 + v * 0.05), f1: h.base * 0.82, peak: heavy ? 0.10 : 0.055, attack: 0.004 });
    if (heavy) {
      HP(L, { at, dur: 0.16, f0: 120, f1: 48, peak: 0.20 });
      N(L, { at, dur: 0.10, lp: 700, peak: 0.10 });
    } else if (v === 1 || v === 3) {
      M(L, { at: at + 0.01, base: h.base * 2.2, dur: 0.10, peak: 0.05 * (0.3 + h.metal), partials: [1, 2.9, 5.1] });
    }
    if (v === 4) N(L, { at: at + 0.05, dur: 0.06, bp: air * 1.4, q: 1.6, peak: 0.05 });
  }

  function recipeHit(h, o, L) {
    const heavy = !!o.heavy || (o.amount || 1) >= 3;
    const n = heavy ? 3 : 5;
    const v = pickVariant("hit", n);
    const at = 0;
    const f1 = heavy ? [38, 44, 33][v] : [62, 54, 72, 48, 66][v];
    const lp = heavy ? [620, 520, 700][v] : [1100, 880, 1380, 760, 1220][v];
    const f0 = heavy ? [118, 126, 110][v] : [170, 158, 182, 150, 176][v];
    HP(L, { at, dur: heavy ? 0.24 : 0.10, f0, f1, peak: heavy ? 0.34 : 0.18 });
    N(L, { at, dur: heavy ? 0.16 : 0.07, lp, peak: heavy ? 0.16 : 0.09, attack: 0.003 });
    if (h.metal > 0.18) M(L, { at: at + 0.004, base: h.base * (1.7 + v * 0.09), dur: heavy ? 0.22 : 0.12, peak: 0.06 * h.metal, partials: [1, 2.4, 4.7] });
    if (v === 2) N(L, { at: at + 0.02, dur: 0.05, bp: h.air, q: 2.4, peak: 0.06 });
    if (v === 4) T(L, { at, dur: 0.07, wave: h.wave, f0: h.base * 1.6, f1: h.base * 0.9, peak: 0.045 });
  }

  function recipeHurt(h, o, L) {
    const v = pickVariant("hurt", 3);
    T(L, { at: 0, dur: 0.12 + v * 0.02, wave: "sawtooth", f0: 260 - v * 25, f1: 120, peak: 0.11, attack: 0.004 });
    N(L, { at: 0, dur: 0.06, lp: 900, peak: 0.06 });
  }

  function recipeShieldHit(h, o, L) {
    const v = pickVariant("shieldHit", 3);
    M(L, { at: 0, base: 1250 + v * 180, dur: 0.24, peak: 0.12, partials: [1, 1.53, 2.71, 4.2] });
    N(L, { at: 0, dur: 0.12, bp: 2600 + v * 300, q: 1.6, peak: 0.10 });
    HP(L, { at: 0, dur: 0.10, f0: 220, f1: 90, peak: 0.08 });
  }
  function recipeShieldBreak(h, o, L) {
    N(L, { at: 0, dur: 0.22, bp: 3400, q: 0.9, sweepTo: 900, peak: 0.18 });
    M(L, { at: 0, base: 1500, dur: 0.34, peak: 0.13, partials: [1, 2.1, 3.7, 6.4] });
    for (let i = 0; i < 4; i++) T(L, { at: 0.03 + i * 0.035, dur: 0.10, wave: "triangle", f0: 1800 + i * 400, f1: 900 + i * 200, peak: 0.05, pan: (i - 1.5) * 0.2 });
  }
  function recipeShieldUp(h, o, L) {
    S(L, { at: 0, f0: 300, f1: 900, dur: 0.22, peak: 0.07, wave: "sine" });
    M(L, { at: 0.04, base: 900, dur: 0.30, peak: 0.07, partials: [1, 1.6, 2.7] });
    N(L, { at: 0, dur: 0.20, bp: 1600, q: 1.2, sweepTo: 2400, peak: 0.06 });
  }

  function recipeDodge(h, o, L) {
    N(L, { at: 0, dur: 0.20, bp: 3000, q: 1.4, sweepTo: 1100, peak: 0.10 });
    T(L, { at: 0.02, dur: 0.14, wave: "sine", f0: 1300, f1: 2300, peak: 0.05 });
    if (o.hero === "longren") M(L, { at: 0, base: 1000, dur: 0.26, peak: 0.06, partials: [1, 2.76, 5.4] });
  }

  function recipeFlank(h, o, L) {
    N(L, { at: 0, dur: 0.13, bp: h.air * 1.2, q: 1.0, sweepTo: h.air * 0.4, peak: 0.18 });
    N(L, { at: 0.035, dur: 0.12, bp: h.air * 0.8, q: 1.0, sweepTo: h.air * 0.3, peak: 0.14 });
    HP(L, { at: 0.02, dur: 0.22, f0: 130, f1: 42, peak: 0.30 });
    M(L, { at: 0.03, base: h.base * 2.4, dur: 0.26, peak: 0.10, partials: [1, 2.4, 4.9] });
    T(L, { at: 0.02, dur: 0.18, wave: "square", f0: 150, f1: 80, peak: 0.12 });
  }

  function recipeDeath(h, o, L) {
    const v = pickVariant("death", 3);
    T(L, { at: 0, dur: 0.55 + v * 0.08, wave: "sawtooth", f0: h.base * 0.9, f1: 55, peak: 0.16, attack: 0.01 });
    N(L, { at: 0, dur: 0.45, lp: 1200, peak: 0.13, attack: 0.01 });
    HP(L, { at: 0.02, dur: 0.4, f0: 90, f1: 30, peak: 0.22 });
    if (v === 2) M(L, { at: 0.05, base: h.base, dur: 0.5, peak: 0.05, partials: [1, 2.1, 3.6] });
  }

  function recipeRevive(h, o, L) {
    [0, 4, 7, 12].forEach((semi, i) => {
      const f = 330 * Math.pow(2, semi / 12);
      T(L, { at: i * 0.08, dur: 0.5 - i * 0.05, wave: "sine", f0: f * 0.98, f1: f, peak: 0.09, attack: 0.02 });
    });
    N(L, { at: 0, dur: 0.6, bp: 2600, q: 1.2, sweepTo: 5200, peak: 0.07, attack: 0.05 });
  }

  function recipeHeal(h, o, L) {
    const v = pickVariant("heal", 3);
    [0, 7].forEach((semi, i) => {
      const f = (523 + v * 30) * Math.pow(2, semi / 12);
      T(L, { at: i * 0.05, dur: 0.4, wave: "sine", f0: f, peak: 0.06, attack: 0.03 });
    });
    for (let i = 0; i < 4; i++) T(L, { at: 0.06 + i * 0.055, dur: 0.16, wave: "sine", f0: 1600 + i * 320, f1: 2100 + i * 380, peak: 0.045, pan: (i - 1.5) * 0.12 });
    N(L, { at: 0, dur: 0.35, bp: 3800, q: 1.4, sweepTo: 6000, peak: 0.04, attack: 0.04 });
  }

  function recipeBuffUp(h, o, L) {
    S(L, { at: 0, f0: 180, f1: 760, dur: 0.35, peak: 0.10, wave: h.wave });
    M(L, { at: 0.10, base: h.base, dur: 0.35, peak: 0.06, partials: [1, 2.2, 3.9] });
    N(L, { at: 0, dur: 0.4, bp: 1800, q: 1.0, sweepTo: 900, peak: 0.05, attack: 0.08 });
  }
  function recipeBuffDown(h, o, L) {
    S(L, { at: 0, f0: 700, f1: 160, dur: 0.4, peak: 0.08, wave: h.wave });
    N(L, { at: 0, dur: 0.35, bp: 2000, q: 1.0, sweepTo: 700, peak: 0.045, attack: 0.02 });
  }

  function recipeGrab(h, o, L) {
    T(L, { at: 0, dur: 0.28, wave: "sawtooth", f0: 220, f1: 320, peak: 0.08, attack: 0.02 });
    N(L, { at: 0, dur: 0.3, bp: 900, q: 2.2, sweepTo: 1600, peak: 0.09, attack: 0.02 });
    T(L, { at: 0.06, dur: 0.22, wave: "sine", f0: 420, f1: 260, peak: 0.06 });
  }
  function recipeKnockback(h, o, L) {
    N(L, { at: 0, dur: 0.22, lp: 1400, lpTo: 500, peak: 0.13 });
    HP(L, { at: 0, dur: 0.16, f0: 140, f1: 50, peak: 0.20 });
  }
  function recipeMark(h, o, L) {
    T(L, { at: 0, dur: 0.10, wave: "square", f0: 1900, peak: 0.05 });
    T(L, { at: 0.09, dur: 0.12, wave: "square", f0: 2600, peak: 0.04 });
  }
  function recipeSwordSpawn(h, o, L) {
    T(L, { at: 0, dur: 0.18, wave: "sine", f0: 1800, f1: 800, peak: 0.09 });
    M(L, { at: 0.02, base: 1400, dur: 0.3, peak: 0.07, partials: [1, 2.7, 5.2] });
    HP(L, { at: 0.02, dur: 0.12, f0: 160, f1: 70, peak: 0.10 });
  }
  function recipeSwordPickup(h, o, L) {
    M(L, { at: 0, base: 800, dur: 0.28, peak: 0.09, partials: [1, 1.5, 2.9, 4.4] });
    T(L, { at: 0.02, dur: 0.16, wave: "square", f0: 700, f1: 1600, peak: 0.06 });
  }

  function recipeTalisman(h, o, L) {
    N(L, { at: 0, dur: 0.14, bp: 3200, q: 0.8, sweepTo: 5200, peak: 0.07 });
    [0, 5, 9].forEach((s, i) => T(L, { at: 0.02 + i * 0.04, dur: 0.3, wave: "sine", f0: 660 * Math.pow(2, s / 12), peak: 0.05 }));
  }

  /* ---------------- 回合切换 ---------------- */
  function recipeTurnEnd(h, o, L) {
    // 低音收束：下沉 + 轻微噪声，短促不抢戏
    T(L, { at: 0, dur: 0.26, wave: "sine", f0: 220, f1: 110, peak: 0.09, attack: 0.005 });
    N(L, { at: 0, dur: 0.2, lp: 700, lpTo: 300, peak: 0.05, attack: 0.004 });
  }
  function recipeTurnSweep(h, o, L) {
    // 扫过：带通噪声从左到右（声像扫动）
    const p = o.dir === -1 ? -1 : 1;
    N(L, { at: 0, dur: 0.32, bp: 1200, q: 0.9, sweepTo: 2600, peak: 0.07, attack: 0.03, pan: -0.5 * p });
    N(L, { at: 0.10, dur: 0.26, bp: 1800, q: 1.1, sweepTo: 3200, peak: 0.05, attack: 0.02, pan: 0.35 * p });
  }
  function recipeTurnStart(h, o, L) {
    // 新回合：清晰的两音上扬（不刺耳）
    [0, 7].forEach((s, i) => T(L, { at: i * 0.07, dur: 0.32, wave: "triangle", f0: 392 * Math.pow(2, s / 12), f1: 392 * Math.pow(2, s / 12), peak: 0.085, attack: 0.01 }));
    T(L, { at: 0.02, dur: 0.5, wave: "sine", f0: 196, peak: 0.05, attack: 0.02 });
    N(L, { at: 0.02, dur: 0.3, bp: 3200, q: 1.2, peak: 0.035, attack: 0.03 });
  }
  function recipeExtraTurn(h, o, L) {
    // 额外回合：战鼓 + 金色和弦
    HP(L, { at: 0, dur: 0.30, f0: 120, f1: 46, peak: 0.30 });
    HP(L, { at: 0.16, dur: 0.26, f0: 120, f1: 46, peak: 0.24 });
    N(L, { at: 0, dur: 0.16, lp: 900, peak: 0.10 });
    [0, 7, 12].forEach((s, i) => M(L, { at: 0.12 + i * 0.05, base: 660 * Math.pow(2, s / 12), dur: 0.42, peak: 0.055, partials: [1, 1.5, 2.7] }));
  }

  /* ---------------- 锦囊专属（按 id） ---------------- */
  function recipeTalismanId(id, h, o, L) {
    switch (id) {
      case "assault": // 猛攻令：战号 + 金属摩擦
        T(L, { at: 0, dur: 0.22, wave: "sawtooth", f0: 180, f1: 300, peak: 0.09 });
        T(L, { at: 0.04, dur: 0.26, wave: "sawtooth", f0: 270, f1: 360, peak: 0.07 });
        M(L, { at: 0.02, base: 900, dur: 0.3, peak: 0.06, partials: [1, 2.2, 3.9] });
        N(L, { at: 0, dur: 0.22, bp: 2400, q: 1.0, sweepTo: 4200, peak: 0.06 });
        break;
      case "revive": // 还魂令：上行的合唱/钟
        [0, 5, 9, 12].forEach((s, i) => T(L, { at: i * 0.09, dur: 0.7 - i * 0.06, wave: "sine", f0: 330 * Math.pow(2, s / 12), peak: 0.075, attack: 0.03 }));
        N(L, { at: 0, dur: 0.7, bp: 2800, q: 1.2, sweepTo: 6000, peak: 0.05, attack: 0.08 });
        M(L, { at: 0.1, base: 1320, dur: 0.6, peak: 0.04, partials: [1, 2.1, 3.6] });
        break;
      case "march": // 行军令：鼓 + 旗
        HP(L, { at: 0, dur: 0.28, f0: 110, f1: 44, peak: 0.28 });
        HP(L, { at: 0.18, dur: 0.24, f0: 120, f1: 48, peak: 0.20 });
        N(L, { at: 0.02, dur: 0.35, bp: 900, q: 0.8, sweepTo: 2600, peak: 0.07 });
        T(L, { at: 0.06, dur: 0.3, wave: "triangle", f0: 523, f1: 784, peak: 0.05 });
        break;
      case "refresh": // 技能重整令：符文上涌
        for (let i = 0; i < 4; i++) T(L, { at: i * 0.05, dur: 0.2, wave: "square", f0: 1200 + i * 260, f1: 1600 + i * 300, peak: 0.035, pan: (i - 1.5) * 0.2 });
        M(L, { at: 0.06, base: 1800, dur: 0.4, peak: 0.045, partials: [1, 2.6, 5.1] });
        break;
      case "guard": // 坚守令：护盾展开
        recipeShieldUp(h, o, L);
        T(L, { at: 0.1, dur: 0.35, wave: "sine", f0: 330, f1: 440, peak: 0.05 });
        break;
      case "heal": // 战地急救令
        recipeHeal(h, o, L);
        break;
      default:
        recipeTalisman(h, o, L);
        break;
    }
  }

  function recipeWin(h, o, L) {
    [0, 4, 7, 12].forEach((s, i) => T(L, { at: i * 0.12, dur: 0.5, wave: "triangle", f0: 523 * Math.pow(2, s / 12), peak: 0.12, attack: 0.01 }));
    N(L, { at: 0.1, dur: 0.6, bp: 3000, q: 1.0, sweepTo: 6000, peak: 0.05, attack: 0.1 });
    // 按当前胜利英雄的音色叠一层专属收尾
    if (h.metal > 0.3) M(L, { at: 0.1, base: h.base, dur: 0.7, peak: 0.055, partials: [1, 2.2, 3.9] });
    else T(L, { at: 0.08, dur: 0.75, wave: "sine", f0: h.base, f1: h.base * 1.5, peak: 0.04, attack: 0.03 });
  }
  function recipeLose(h, o, L) {
    [0, -3, -7].forEach((s, i) => T(L, { at: i * 0.16, dur: 0.55, wave: "sawtooth", f0: 440 * Math.pow(2, s / 12), f1: 400 * Math.pow(2, s / 12), peak: 0.10 }));
  }
  function recipeDraw(h, o, L) {
    [0, 5].forEach((s, i) => T(L, { at: i * 0.14, dur: 0.55, wave: "triangle", f0: 392 * Math.pow(2, s / 12), peak: 0.07, attack: 0.02 }));
    N(L, { at: 0, dur: 0.5, lp: 1200, peak: 0.05, attack: 0.08 });
  }

  /* ---------------- 配方：技能专属（按真实技能类型） ---------------- */
  function recipeSkill(type, h, o, L) {
    const st = o.stage || 0;
    switch (type) {
      case "damage_single": // 法师火球 / 狂战士突袭
        if (h.base > 400) {
          S(L, { at: 0, f0: 260, f1: 900, dur: 0.22, peak: 0.07, wave: "sine" });
          N(L, { at: 0.16, dur: 0.28, bp: 2400, q: 1.1, sweepTo: 900, peak: 0.13 });
          HP(L, { at: 0.30, dur: 0.26, f0: 150, f1: 48, peak: 0.26 });
          M(L, { at: 0.30, base: 1200, dur: 0.22, peak: 0.07, partials: [1, 2.3, 4.1] });
        } else {
          N(L, { at: 0, dur: 0.16, bp: 1400, q: 1.0, sweepTo: 600, peak: 0.15 });
          HP(L, { at: 0.06, dur: 0.30, f0: 130, f1: 40, peak: 0.30 });
          T(L, { at: 0.06, dur: 0.18, wave: "sawtooth", f0: 170, f1: 90, peak: 0.10 });
        }
        break;

      case "freeze":
        M(L, { at: 0, base: 2400, dur: 0.3, peak: 0.08, partials: [1, 1.8, 3.1, 5.2] });
        N(L, { at: 0.04, dur: 0.35, bp: 5200, q: 1.6, sweepTo: 2600, peak: 0.12 });
        for (let i = 0; i < 4; i++) T(L, { at: 0.12 + i * 0.04, dur: 0.12, wave: "sine", f0: 2200 - i * 260, peak: 0.05, pan: (i - 1.5) * 0.2 });
        break;

      case "heal":
        recipeHeal(h, o, L);
        break;

      case "damage_adjacent_all": // 骑士横扫：一次金属大扫
        N(L, { at: 0, dur: 0.26, bp: h.air, q: 0.8, sweepTo: h.air * 2.0, peak: 0.14 });
        M(L, { at: 0.02, base: h.base * 2.1, dur: 0.32, peak: 0.11, partials: [1, 2.6, 4.8] });
        for (let i = 0; i < 3; i++) N(L, { at: 0.05 + i * 0.05, dur: 0.08, bp: h.air * (1.1 + i * 0.25), q: 1.4, peak: 0.06 });
        break;

      case "damage_line": // 游侠穿透
        T(L, { at: 0, dur: 0.10, wave: "triangle", f0: 900, f1: 1600, peak: 0.10 });
        N(L, { at: 0.02, dur: 0.4, bp: 4000, q: 2.0, sweepTo: 1200, peak: 0.10 });
        HP(L, { at: 0.30, dur: 0.16, f0: 200, f1: 70, peak: 0.12 });
        break;

      case "shield_self":
      case "shield_ally":
        recipeShieldUp(h, o, L);
        if (type === "shield_ally") {
          S(L, { at: 0.08, f0: 500, f1: 1200, dur: 0.26, peak: 0.05, wave: "sine" });
        }
        break;

      case "blink":
        N(L, { at: 0, dur: 0.24, bp: 3400, q: 1.8, sweepTo: 600, peak: 0.10 });
        T(L, { at: 0.02, dur: 0.18, wave: "sine", f0: 900, f1: 180, peak: 0.07 });
        break;

      case "dash": // 阿修罗剑圣
        M(L, { at: 0, base: h.base * 1.4, dur: 0.30, peak: 0.10, partials: [1, 2.76, 5.4] });
        N(L, { at: 0.03, dur: 0.26, bp: h.air, q: 1.1, sweepTo: h.air * 0.35, peak: 0.15 });
        for (let i = 0; i < 3; i++) M(L, { at: 0.14 + i * 0.055, base: h.base * (2.0 + i * 0.15), dur: 0.14, peak: 0.06, partials: [1, 2.4, 4.6] });
        break;

      case "duanlang": // 沧·断浪：水聚 → 掠过 → 水浪 → 剑刃
        N(L, { at: 0, dur: 0.18, bp: 900, q: 1.8, sweepTo: 1800, peak: 0.08, attack: 0.02 });
        N(L, { at: 0.10, dur: 0.24, bp: 2600, q: 0.9, sweepTo: 700, peak: 0.13 });
        HP(L, { at: 0.24, dur: 0.30, f0: 170, f1: 60, peak: 0.20 });
        N(L, { at: 0.24, dur: 0.34, bp: 1600, q: 0.7, sweepTo: 4200, peak: 0.12 });
        M(L, { at: 0.26, base: 1500, dur: 0.18, peak: 0.06, partials: [1, 2.7, 5.1] });
        break;

      case "shuidiao": // 沧·水调歌头：水流 → 牵引 → 重浪
        N(L, { at: 0, dur: 0.30, bp: 1200, q: 1.6, sweepTo: 3200, peak: 0.10, attack: 0.01 });
        T(L, { at: 0.04, dur: 0.26, wave: "sine", f0: 420, f1: 700, peak: 0.06 });
        if (st >= 1) {
          S(L, { at: 0.22, f0: 300, f1: 140, dur: 0.3, peak: 0.08, wave: "sawtooth" }); // 牵引
          HP(L, { at: 0.30, dur: 0.34, f0: 150, f1: 50, peak: 0.26 });
          N(L, { at: 0.30, dur: 0.40, bp: 1500, q: 0.7, sweepTo: 3800, peak: 0.14 });
        }
        break;

      case "dragonbreath": // 龙人：低吼 → 吐息 → 余烬
        T(L, { at: 0, dur: 0.26, wave: "sawtooth", f0: 120, f1: 170, peak: 0.09, attack: 0.03 });
        N(L, { at: 0.10, dur: 0.60, lp: 2200, lpTo: 700, peak: 0.16, attack: 0.05, hold: 0.15 });
        N(L, { at: 0.14, dur: 0.5, bp: 700, q: 1.2, sweepTo: 1800, peak: 0.09, attack: 0.04 });
        for (let i = 0; i < 5; i++) N(L, { at: 0.30 + i * 0.06, dur: 0.05, bp: 3200, q: 2.0, peak: 0.035, pan: (Math.random() - 0.5) * 0.5 });
        break;

      case "thunder": // 雷电：蓄电 → 落雷 → 电弧（压低高频，避免刺耳）
        S(L, { at: 0, f0: 80, f1: 760, dur: 0.26, peak: 0.06, wave: "sawtooth" });
        N(L, { at: 0, dur: 0.22, bp: 3600, q: 1.4, peak: 0.045, attack: 0.02 });
        N(L, { at: 0.24, dur: 0.10, hp: 1200, peak: 0.22, attack: 0.001 });     // 爆裂（收敛）
        HP(L, { at: 0.24, dur: 0.38, f0: 105, f1: 32, peak: 0.38 });           // 雷鸣
        N(L, { at: 0.26, dur: 0.55, lp: 620, peak: 0.16, attack: 0.004 });      // 余响
        N(L, { at: 0.30, dur: 0.05, bp: 4200, q: 1.8, peak: 0.028, pan: -0.2 }); // 少量电弧碎响
        N(L, { at: 0.36, dur: 0.05, bp: 5200, q: 1.8, peak: 0.024, pan: 0.2 });
        break;

      case "raikiri": // 鹰佐·雷劈：蓄电 → 短雷 → 强雷
        S(L, { at: 0, f0: 90, f1: 880, dur: 0.20, peak: 0.06, wave: "sawtooth" });
        N(L, { at: 0, dur: 0.16, bp: 3800, q: 1.6, peak: 0.05, attack: 0.01 });
        N(L, { at: 0.18, dur: 0.09, hp: 1500, peak: 0.16, attack: 0.001 });
        HP(L, { at: 0.18, dur: 0.28, f0: 120, f1: 40, peak: 0.24 });
        N(L, { at: 0.30, dur: 0.10, hp: 1100, peak: 0.22, attack: 0.001 });
        HP(L, { at: 0.30, dur: 0.34, f0: 90, f1: 30, peak: 0.30 });
        N(L, { at: 0.34, dur: 0.4, lp: 700, peak: 0.10 });
        break;
      case "thunderblade": // 鹰佐·雷鸣刀：三段
        if (st === 2) {
          // 第二段：突进 → 插刀 → 火焰
          N(L, { at: 0, dur: 0.14, bp: 4200, q: 2.0, sweepTo: 900, peak: 0.09 }); // 突进
          M(L, { at: 0.08, base: 1900, dur: 0.16, peak: 0.07, partials: [1, 2.4, 4.2] }); // 插刀
          N(L, { at: 0.10, dur: 0.22, lp: 1200, peak: 0.08, attack: 0.01 }); // 雷刀放电
          N(L, { at: 0.24, dur: 0.42, lp: 2100, lpTo: 500, peak: 0.14, attack: 0.04 }); // 吐火
          HP(L, { at: 0.24, dur: 0.30, f0: 160, f1: 60, peak: 0.16 });
          for (let i = 0; i < 4; i++) N(L, { at: 0.34 + i * 0.05, dur: 0.05, bp: 3000, q: 1.8, peak: 0.03, pan: (Math.random() - 0.5) * 0.4 });
        } else if (st === 3) {
          // 第三段：瞬移 → 直线雷击 → 爆发
          N(L, { at: 0, dur: 0.12, bp: 5200, q: 2.2, sweepTo: 1200, peak: 0.08 }); // 闪现
          N(L, { at: 0.10, dur: 0.28, bp: 2400, q: 1.2, sweepTo: 4200, peak: 0.12 }); // 引雷
          N(L, { at: 0.18, dur: 0.10, hp: 1400, peak: 0.22, attack: 0.001 });
          HP(L, { at: 0.18, dur: 0.46, f0: 110, f1: 30, peak: 0.36 }); // 雷暴
          N(L, { at: 0.28, dur: 0.55, lp: 600, peak: 0.14 });
        } else {
          // 第一段：十字突进 + 雷斩
          N(L, { at: 0, dur: 0.13, bp: 4400, q: 2.0, sweepTo: 900, peak: 0.09 });
          T(L, { at: 0.02, dur: 0.10, wave: "triangle", f0: 1700, f1: 2500, peak: 0.05 });
          N(L, { at: 0.10, dur: 0.10, hp: 1900, peak: 0.18, attack: 0.001 });
          HP(L, { at: 0.10, dur: 0.26, f0: 130, f1: 42, peak: 0.24 });
        }
        break;
      case "chase": // 刺客：飞镖 / 瞬步
        if (st >= 1) {
          N(L, { at: 0, dur: 0.18, bp: 4600, q: 2.0, sweepTo: 900, peak: 0.10 });  // 瞬步
          M(L, { at: 0.06, base: 2600, dur: 0.16, peak: 0.09, partials: [1, 2.6, 5.0] });
          M(L, { at: 0.10, base: 3200, dur: 0.12, peak: 0.05, partials: [1, 2.2] });
        } else {
          N(L, { at: 0, dur: 0.12, bp: 4800, q: 2.6, sweepTo: 2200, peak: 0.12 }); // 飞镖
          T(L, { at: 0.01, dur: 0.08, wave: "triangle", f0: 1800, f1: 2600, peak: 0.06 });
          // 标记提示音在真正的命中/标记时由游戏层触发（这里不预置，避免未命中也有声音）
        }
        break;

      case "bloodburst": // 吸血鬼
        T(L, { at: 0, dur: 0.34, wave: "sawtooth", f0: 110, f1: 190, peak: 0.10, attack: 0.03 });
        N(L, { at: 0, dur: 0.28, bp: 500, q: 1.4, sweepTo: 1400, peak: 0.10, attack: 0.03 });
        HP(L, { at: 0.20, dur: 0.34, f0: 140, f1: 42, peak: 0.30 });
        N(L, { at: 0.20, dur: 0.30, bp: 1200, q: 0.9, sweepTo: 300, peak: 0.10 });
        if (o.drained > 0) {
          S(L, { at: 0.28, f0: 700, f1: 240, dur: 0.34, peak: 0.06, wave: "sine" }); // 吸取
          T(L, { at: 0.5, dur: 0.24, wave: "sine", f0: 520, f1: 660, peak: 0.05 });   // 回血
        }
        break;

      case "ziwei": // 玉帝：空间折叠 + 双段冲击
        S(L, { at: 0, f0: 240, f1: 1200, dur: 0.18, peak: 0.07, wave: "sine" });
        N(L, { at: 0.14, dur: 0.22, bp: 3400, q: 1.6, sweepTo: 700, peak: 0.11 });
        HP(L, { at: 0.30, dur: 0.26, f0: 170, f1: 55, peak: 0.22 });
        M(L, { at: 0.32, base: 1600, dur: 0.20, peak: 0.06, partials: [1, 2.8, 5.2] });
        HP(L, { at: 0.42, dur: 0.22, f0: 150, f1: 48, peak: 0.16 });
        break;

      case "exile": // 放逐：锁定 → 裂隙 → 落点
        T(L, { at: 0, dur: 0.18, wave: "square", f0: 800, f1: 1200, peak: 0.05 });
        N(L, { at: 0.12, dur: 0.30, bp: 5200, q: 2.4, sweepTo: 1200, peak: 0.12 });
        HP(L, { at: 0.40, dur: 0.24, f0: 120, f1: 42, peak: 0.24 });
        break;

      case "tianwei": // 天威：穿梭 → 落地
        N(L, { at: 0, dur: 0.34, bp: 900, q: 1.0, sweepTo: 4200, peak: 0.10, attack: 0.02 });
        S(L, { at: 0.04, f0: 120, f1: 600, dur: 0.30, peak: 0.06, wave: "sine" });
        HP(L, { at: 0.36, dur: 0.40, f0: 100, f1: 30, peak: 0.38 });
        N(L, { at: 0.36, dur: 0.45, lp: 900, peak: 0.16, attack: 0.004 });
        break;

      case "shenluo": // 神罗：压缩 → 向外爆发
        S(L, { at: 0, f0: 520, f1: 130, dur: 0.24, peak: 0.09, wave: "sawtooth" });
        N(L, { at: 0, dur: 0.24, bp: 1200, q: 2.0, sweepTo: 600, peak: 0.07, attack: 0.02 });
        HP(L, { at: 0.24, dur: 0.34, f0: 120, f1: 36, peak: 0.34 });
        N(L, { at: 0.24, dur: 0.40, bp: 2400, q: 0.7, sweepTo: 6000, peak: 0.15 });
        break;

      case "wxt": // 万象天引三段
        if (st === 0) {
          S(L, { at: 0, f0: 300, f1: 120, dur: 0.22, peak: 0.07, wave: "sine" });
          N(L, { at: 0.02, dur: 0.34, bp: 800, q: 2.2, sweepTo: 1800, peak: 0.10, attack: 0.02 }); // 牵引
          T(L, { at: 0.16, dur: 0.22, wave: "sawtooth", f0: 160, f1: 240, peak: 0.06 });
        } else if (st === 1) {
          T(L, { at: 0, dur: 0.34, wave: "sawtooth", f0: 200, f1: 260, peak: 0.07, attack: 0.03 }); // 束缚
          N(L, { at: 0, dur: 0.34, bp: 600, q: 2.6, peak: 0.07, attack: 0.03 });
          HP(L, { at: 0.20, dur: 0.24, f0: 140, f1: 55, peak: 0.18 });
        } else {
          HP(L, { at: 0, dur: 0.22, f0: 150, f1: 46, peak: 0.24 });                                   // 斥力
          N(L, { at: 0, dur: 0.26, bp: 2600, q: 0.8, sweepTo: 5200, peak: 0.12 });
          M(L, { at: 0.02, base: 2000, dur: 0.18, peak: 0.06, partials: [1, 2.6, 4.8] });
        }
        break;

      case "passive":
        recipeBuffUp(h, o, L);
        break;

      case "charge": // 花木兰·所向披靡：蓄势 → 破空冲锋 → 重击
        HP(L, { at: 0, dur: 0.20, f0: 140, f1: 92, peak: 0.16, attack: 0.02 });
        N(L, { at: 0.04, dur: 0.28, bp: 900, q: 1.1, sweepTo: 2600, peak: 0.09, attack: 0.03 });
        N(L, { at: 0.18, dur: 0.26, bp: 2400, q: 0.9, sweepTo: 700, peak: 0.15 });
        HP(L, { at: 0.30, dur: 0.34, f0: 130, f1: 40, peak: 0.34 });
        N(L, { at: 0.30, dur: 0.22, lp: 700, peak: 0.15 });
        M(L, { at: 0.32, base: 1400, dur: 0.22, peak: 0.07, partials: [1, 2.4, 4.6] });
        break;

      case "push": // 山丘之王·推山：沉重蓄力 → 地面推击 → 岩层震动
        HP(L, { at: 0, dur: 0.26, f0: 120, f1: 70, peak: 0.20, attack: 0.03 });
        N(L, { at: 0.05, dur: 0.34, bp: 700, q: 1.2, sweepTo: 2200, peak: 0.10, attack: 0.04 });
        HP(L, { at: 0.20, dur: 0.30, f0: 90, f1: 40, peak: 0.30 });
        N(L, { at: 0.22, dur: 0.30, lp: 600, peak: 0.16 });
        M(L, { at: 0.24, base: 900, dur: 0.34, peak: 0.06, partials: [1, 2.1, 3.7] });
        break;

      case "meditate": // 金蝉·禅坐：低沉钟声 + 金光升起
        HP(L, { at: 0, dur: 0.40, f0: 130, f1: 55, peak: 0.16 });
        T(L, { at: 0.02, dur: 0.55, wave: "sine", f0: 330, peak: 0.06 });
        T(L, { at: 0.10, dur: 0.50, wave: "sine", f0: 495, peak: 0.04 });
        M(L, { at: 0.05, base: 920, dur: 0.40, peak: 0.05, partials: [1, 2, 3.2] });
        break;
      case "divinepalm": // 金蝉·神掌：掌风 → 重击 → 冲击
        N(L, { at: 0, dur: 0.16, bp: 2200, q: 1.0, sweepTo: 700, peak: 0.14 });
        HP(L, { at: 0.06, dur: 0.24, f0: 150, f1: 60, peak: 0.22 });
        M(L, { at: 0.08, base: 1500, dur: 0.20, peak: 0.06, partials: [1, 2.5, 4.8] });
        break;

      case "stealth": // 渡鸦·潜行：暗影下沉 + 羽毛轻响
        N(L, { at: 0, dur: 0.30, bp: 1800, q: 0.9, sweepTo: 400, peak: 0.10, attack: 0.05 });
        T(L, { at: 0, dur: 0.30, wave: "sine", f0: 420, f1: 180, peak: 0.06 });
        for (let i = 0; i < 4; i++) N(L, { at: 0.08 + i * 0.05, dur: 0.10, bp: 4200 + i * 300, q: 1.3, peak: 0.03 });
        break;
      case "mistdash": // 渡鸦·雾冲：掠过 → 低鸣 → 雾气扩散
        N(L, { at: 0, dur: 0.20, bp: 2600, q: 1.0, sweepTo: 900, peak: 0.12 });
        HP(L, { at: 0.08, dur: 0.24, f0: 150, f1: 70, peak: 0.12 });
        N(L, { at: 0.18, dur: 0.34, lp: 520, peak: 0.10 });
        break;
      case "shadowfang": // 渡鸦·影牙：短促锋利
        N(L, { at: 0, dur: 0.10, bp: 3600, q: 1.4, peak: 0.16 });
        M(L, { at: 0.02, base: 2100, dur: 0.16, peak: 0.06, partials: [1, 2.6, 4.4] });
        HP(L, { at: 0.05, dur: 0.18, f0: 130, f1: 50, peak: 0.16 });
        break;

      case "metalpierce": // 金元素·金属穿刺：金属摩擦 → 尖锐穿刺
        M(L, { at: 0, base: 1800, dur: 0.14, peak: 0.07, partials: [1, 2.4, 4.2] });
        N(L, { at: 0.04, dur: 0.16, bp: 4200, q: 1.3, peak: 0.12 });
        HP(L, { at: 0.08, dur: 0.16, f0: 160, f1: 70, peak: 0.14 });
        break;
      case "metalarmor": // 金元素·金属装甲：金属包覆
        M(L, { at: 0, base: 1100, dur: 0.30, peak: 0.07, partials: [1, 2.1, 3.8] });
        HP(L, { at: 0.04, dur: 0.24, f0: 170, f1: 100, peak: 0.12 });
        N(L, { at: 0.10, dur: 0.22, bp: 3000, q: 1.0, peak: 0.05 });
        break;
      case "metaltide": // 金元素·金属狂潮：低频轰鸣 + 金属共鸣
        HP(L, { at: 0, dur: 0.40, f0: 110, f1: 50, peak: 0.26 });
        M(L, { at: 0.04, base: 900, dur: 0.45, peak: 0.08, partials: [1, 2.4, 4.8] });
        N(L, { at: 0.02, dur: 0.42, bp: 2400, q: 1.0, peak: 0.08, attack: 0.1 });
        break;

      default:
        S(L, { at: 0, f0: h.base * 0.6, f1: h.base * 1.8, dur: 0.22, peak: 0.07, wave: h.wave });
        N(L, { at: 0.02, dur: 0.2, bp: h.air, q: 1.3, peak: 0.05 });
        break;
    }
  }

  /* ---------------- 渲染到音频节点 ---------------- */
  function render(layers, bus) {
    const t0 = now() + 0.006;
    for (const x of layers) {
      const layer = Object.assign({}, x);
      layer.at = t0 + (x.at || 0);
      layer.bus = x.bus || bus;
      try {
        if (layer.k === "tone") tone(layer);
        else if (layer.k === "noise") noise(layer);
        else if (layer.k === "metal") metal(layer);
        else if (layer.k === "thump") thump(layer);
      } catch (e) { /* 单层失败不影响其它层 */ }
    }
  }

  function buildLayers(event, o) {
    const h = H(o.hero);
    const L = [];
    switch (event) {
      case "attack": recipeAttack(h, o, L); break;
      case "hit": recipeHit(h, o, L); break;
      case "hurt": recipeHurt(h, o, L); break;
      case "shieldHit": recipeShieldHit(h, o, L); break;
      case "shieldBreak": recipeShieldBreak(h, o, L); break;
      case "shieldUp": recipeShieldUp(h, o, L); break;
      case "dodge": recipeDodge(h, o, L); break;
      case "flank": recipeFlank(h, o, L); break;
      case "death": recipeDeath(h, o, L); break;
      case "revive": recipeRevive(h, o, L); break;
      case "heal": recipeHeal(h, o, L); break;
      case "buffUp": recipeBuffUp(h, o, L); break;
      case "buffDown": recipeBuffDown(h, o, L); break;
      case "grab": recipeGrab(h, o, L); break;
      case "knockback": recipeKnockback(h, o, L); break;
      case "mark": recipeMark(h, o, L); break;
      case "stun":
        HP(L, { at: 0, dur: 0.18, f0: 180, f1: 70, peak: 0.18 });
        M(L, { at: 0.02, base: 1800, dur: 0.35, peak: 0.06, partials: [1, 2.7, 5.1] });
        for (let i = 0; i < 3; i++) T(L, { at: 0.06 + i * 0.05, dur: 0.18, wave: "triangle", f0: 1200 + i * 220, peak: 0.04 });
        break;
      case "pillarRise":
        HP(L, { at: 0, dur: 0.30, f0: 100, f1: 45, peak: 0.22 });
        N(L, { at: 0.04, dur: 0.28, lp: 900, q: 0.9, peak: 0.10 });
        M(L, { at: 0.10, base: 620, dur: 0.30, peak: 0.05, partials: [1, 2.3] });
        break;
      case "pillarBreak":
        N(L, { at: 0, dur: 0.26, bp: 2600, q: 0.8, peak: 0.14 });
        HP(L, { at: 0.02, dur: 0.26, f0: 150, f1: 60, peak: 0.18 });
        for (let i = 0; i < 4; i++) M(L, { at: 0.04 + i * 0.035, base: 1800 + i * 260, dur: 0.14, peak: 0.04, partials: [1, 2.6] });
        break;
      case "stealthEnter":
        N(L, { at: 0, dur: 0.34, bp: 1600, q: 0.8, sweepTo: 320, peak: 0.12 });
        T(L, { at: 0.02, dur: 0.30, wave: "sine", f0: 520, f1: 200, peak: 0.06 });
        break;
      case "stealthEnd":
        N(L, { at: 0, dur: 0.18, bp: 2800, q: 1.2, peak: 0.09 });
        T(L, { at: 0.02, dur: 0.22, wave: "triangle", f0: 300, f1: 160, peak: 0.05 });
        break;
      case "mist":
        N(L, { at: 0, dur: 0.42, lp: 420, peak: 0.10, attack: 0.08 });
        HP(L, { at: 0.04, dur: 0.32, f0: 120, f1: 55, peak: 0.10 });
        break;
      case "poison":
        T(L, { at: 0, dur: 0.16, wave: "sine", f0: 320, f1: 240, peak: 0.05 });
        N(L, { at: 0, dur: 0.14, lp: 800, peak: 0.05 });
        break;
      case "refresh":
        [0, 7, 12].forEach((q, i) => T(L, { at: i * 0.06, dur: 0.18, wave: "triangle", f0: 700 * Math.pow(2, q / 12), peak: 0.07 }));
        N(L, { at: 0, dur: 0.20, bp: 3200, peak: 0.05 });
        break;
      case "cost":
        T(L, { at: 0, dur: 0.14, wave: "triangle", f0: 260, f1: 180, peak: 0.05 });
        N(L, { at: 0, dur: 0.12, lp: 900, peak: 0.05 });
        break;
      case "meditateEnter":
        HP(L, { at: 0, dur: 0.42, f0: 120, f1: 50, peak: 0.18 });
        T(L, { at: 0.02, dur: 0.6, wave: "sine", f0: 320, peak: 0.06 });
        break;
      case "meditatePulse":
        T(L, { at: 0, dur: 0.45, wave: "sine", f0: 660, f1: 880, peak: 0.05 });
        N(L, { at: 0, dur: 0.35, bp: 2800, peak: 0.05 });
        break;
      case "meditateEnd":
        [0, 4, 7, 12].forEach((q, i) => T(L, { at: i * 0.08, dur: 0.4, wave: "triangle", f0: 523 * Math.pow(2, q / 12), peak: 0.06 }));
        N(L, { at: 0, dur: 0.5, lp: 900, peak: 0.06 });
        break;
      case "meditateGuard":
        T(L, { at: 0, dur: 0.16, wave: "sine", f0: 880, peak: 0.04 });
        N(L, { at: 0, dur: 0.12, bp: 3200, peak: 0.04 });
        break;
      case "root":
        M(L, { at: 0, base: 700, dur: 0.22, peak: 0.05, partials: [1, 2.2] });
        HP(L, { at: 0.02, dur: 0.18, f0: 130, f1: 60, peak: 0.10 });
        break;
      case "metalGuard":
        M(L, { at: 0, base: 1500, dur: 0.20, peak: 0.05, partials: [1, 2.5, 4.2] });
        N(L, { at: 0, dur: 0.12, bp: 3200, peak: 0.05 });
        break;
      case "metalTide":
        HP(L, { at: 0, dur: 0.34, f0: 120, f1: 55, peak: 0.18 });
        M(L, { at: 0.02, base: 950, dur: 0.38, peak: 0.06, partials: [1, 2.3, 4.6] });
        break;
      case "swordSpawn": recipeSwordSpawn(h, o, L); break;
      case "swordPickup": recipeSwordPickup(h, o, L); break;
      case "talisman": recipeTalisman(h, o, L); break;
      case "turnEnd": recipeTurnEnd(h, o, L); break;
      case "turnSweep": recipeTurnSweep(h, o, L); break;
      case "turnStart": recipeTurnStart(h, o, L); break;
      case "extraTurn": recipeExtraTurn(h, o, L); break;
      case "win": recipeWin(h, o, L); break;
      case "lose": recipeLose(h, o, L); break;
      case "draw": recipeDraw(h, o, L); break;
      case "dash": // 兼容旧调用
        N(L, { at: 0, dur: 0.28, bp: h.air, q: 1.0, sweepTo: h.air * 0.35, peak: 0.14 });
        T(L, { at: 0, dur: 0.22, wave: h.wave, f0: h.base * 0.8, f1: h.base * 1.6, peak: 0.05 });
        break;
      case "dashHit":
        M(L, { at: 0, base: h.base * 2.4, dur: 0.22, peak: 0.10, partials: [1, 2.7, 5.2] });
        N(L, { at: 0, dur: 0.12, bp: 3400, q: 1.4, peak: 0.10 });
        break;
      case "skill": // 兼容旧调用：用英雄音色的通用施法
        S(L, { at: 0, f0: h.base * 0.6, f1: h.base * 1.9, dur: 0.24, peak: 0.08, wave: h.wave });
        if (h.metal > 0.2) M(L, { at: 0.03, base: h.base, dur: 0.22, peak: 0.05 * h.metal, partials: [1, 2.3, 4.1] });
        break;
      case "skillHit":
        recipeHit(h, Object.assign({ heavy: true }, o), L);
        break;
      default: break;
    }
    return L;
  }

  /* ---------------- 限流表 ---------------- */
  const MIN_GAP = {
    attack: 55, hit: 40, hurt: 60, shieldHit: 55, shieldBreak: 90, shieldUp: 80,
    dodge: 80, flank: 70, death: 120, revive: 200, heal: 90, buffUp: 120, buffDown: 120,
    grab: 90, knockback: 60, mark: 60, swordSpawn: 80, swordPickup: 60, stun: 140,
    pillarRise: 120, pillarBreak: 160,
    stealthEnter: 200, stealthEnd: 120, mist: 220, poison: 180, refresh: 300,
    cost: 220, root: 180, metalGuard: 120, metalTide: 400,
    meditateEnter: 300, meditatePulse: 180, meditateEnd: 400, meditateGuard: 120,
    talisman: 120, dash: 90, dashHit: 60, skill: 60, skillHit: 45, win: 500, lose: 500, draw: 500,
    turnEnd: 220, turnSweep: 200, turnStart: 260, extraTurn: 400,
  };

  function canPlay(key) {
    if (!settings.enabled) return false;
    const gap = MIN_GAP[key] || 45;
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (lastAt[key] != null && t - lastAt[key] < gap) return false;
    if (activeVoices() >= MAX_VOICES) return false;
    lastAt[key] = t;
    return true;
  }

  function doPlay(event, o) {
    if (!ensure()) return false;
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    if (!canPlay(event)) return false;
    const layers = buildLayers(event, o || {});
    if (!layers.length) return false;
    render(layers, busSfx);
    log.push({ event, hero: (o && o.hero) || "", at: Date.now() });
    if (log.length > 300) log.shift();
    return true;
  }

  /* ---------------- 持续音 ---------------- */
  const LOOP_DEF = {
    empower: { // 雷电之主强化：极轻的低频呼吸音（无高频嘶声，避免刺耳）
      build(t0) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.020, t0 + 0.6);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 170; lp.Q.value = 0.6;
        const osc = ctx.createOscillator();
        osc.type = "sine"; osc.frequency.value = 55;
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle"; osc2.frequency.value = 82.5;
        const lfo = ctx.createOscillator();
        lfo.type = "sine"; lfo.frequency.value = 0.22;         // 慢速呼吸，不是持续电流
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.010;
        lfo.connect(lfoGain); lfoGain.connect(g.gain);
        osc.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(busLoop);
        osc.start(t0); osc2.start(t0); lfo.start(t0);
        return { g, nodes: [osc, osc2, lfo] };
      },
    },
  };

  function startLoop(key, o) {
    if (!settings.enabled) return;
    if (!ensure()) return;
    if (loops.has(key)) return;
    const d = LOOP_DEF[key];
    if (!d) return;
    try {
      const t0 = now() + 0.02;
      const handle = d.build(t0, o || {});
      loops.set(key, handle);
    } catch (e) { /* 忽略 */ }
  }
  function stopLoop(key, fadeMs) {
    const h = loops.get(key);
    if (!h) return;
    loops.delete(key);
    try {
      const t = now();
      const f = Math.max(0.03, (fadeMs == null ? 260 : fadeMs) / 1000);
      h.g.gain.cancelScheduledValues(t);
      h.g.gain.setValueAtTime(Math.max(0.0001, h.g.gain.value), t);
      h.g.gain.exponentialRampToValueAtTime(0.0001, t + f);
      setTimeout(() => { try { h.nodes.forEach((n) => n.stop()); } catch (e) {} }, f * 1000 + 60);
    } catch (e) { /* 忽略 */ }
  }
  function stopAll() {
    for (const k of Array.from(loops.keys())) stopLoop(k, 120);
  }

  /* ---------------- 设置 ---------------- */
  function setSettings(patch, opts) {
    if (!patch) return getSettings();
    if (typeof patch.enabled === "boolean") settings.enabled = patch.enabled;
    if (typeof patch.master === "number") settings.master = clamp01(patch.master);
    if (typeof patch.sfx === "number") settings.sfx = clamp01(patch.sfx);
    if (typeof patch.skills === "boolean") settings.skills = patch.skills;
    save();
    applyGains();
    if (!settings.enabled) stopAll();
    return getSettings();
  }
  function getSettings() {
    return { enabled: settings.enabled, master: settings.master, sfx: settings.sfx, skills: settings.skills };
  }
  function resetDefaults() {
    Object.assign(settings, DEFAULTS);
    save();
    applyGains();
    return getSettings();
  }

  const SFX = {
    version: 2,
    getSettings,
    setSettings,
    resetDefaults,
    isEnabled() { return settings.enabled; },
    setEnabled(on) { return setSettings({ enabled: !!on }); },
    setVolume(v) { return setSettings({ sfx: clamp01(v) }); },   // 兼容旧接口：战斗音效音量
    setMaster(v) { return setSettings({ master: clamp01(v) }); },
    getLog() { return log.slice(); },
    unlock() {
      if (!ensure()) return false;
      if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
      return true;
    },
    play(event, opts) {
      try { return doPlay(event, opts || {}); } catch (e) { return false; }
    },
    /* 技能专属：失败/取消不会调用到这里 */
    playSkill(type, opts) {
      try {
        const o = opts || {};
        if (!settings.enabled) return false;
        if (!settings.skills) return false;
        if (!ensure()) return false;
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
        const key = "skill:" + type;
        const gap = 55;
        const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (lastAt[key] != null && t - lastAt[key] < gap) return false;
        if (activeVoices() >= MAX_VOICES) return false;
        lastAt[key] = t;
        const h = H(o.hero);
        const L = [];
        recipeSkill(type, h, o, L);
        if (!L.length) return false;
        render(L, busSkill);
        log.push({ event: "skill:" + type, hero: o.hero || "", stage: o.stage || 0, at: Date.now() });
        if (log.length > 300) log.shift();
        return true;
      } catch (e) { return false; }
    },
    startLoop, stopLoop, stopAll,
    /* 锦囊专属音效（按 id 分派，未收录的走通用锦囊音） */
    playTalisman(id, opts) {
      try {
        const o = opts || {};
        if (!settings.enabled) return false;
        if (!ensure()) return false;
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
        const key = "talisman:" + id;
        const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (lastAt[key] != null && t - lastAt[key] < 120) return false;
        if (activeVoices() >= MAX_VOICES) return false;
        lastAt[key] = t;
        const L = [];
        recipeTalismanId(id, H(o.hero), o, L);
        if (!L.length) return false;
        render(L, busSfx);
        log.push({ event: "talisman:" + id, at: Date.now() });
        if (log.length > 300) log.shift();
        return true;
      } catch (e) { return false; }
    },
    /* 测试/调试钩子：绕过节流强制播放；返回技能的分层结构（不发声） */
    __forcePlay(event, opts) {
      try {
        if (!ensure()) return false;
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
        const layers = buildLayers(event, opts || {});
        if (!layers.length) return false;
        render(layers, busSfx);
        log.push({ event, hero: (opts && opts.hero) || "", at: Date.now() });
        return true;
      } catch (e) { return false; }
    },
    __layers(type, opts) {
      try {
        const o = opts || {};
        const L = [];
        recipeSkill(type, H(o.hero), o, L);
        return L.map((x) => x.k);
      } catch (e) { return []; }
    },
    __eventLayers(event, opts) {
      try { return buildLayers(event, opts || {}).map((x) => x.k); } catch (e) { return []; }
    },
    __eventRecipe(event, opts) {
      try { return buildLayers(event, opts || {}); } catch (e) { return []; }
    },
    __loopKeys() { return Array.from(loops.keys()); },
    __voices() { return activeVoices(); },
    __state() { return { ctx: ctx ? ctx.state : "none", voices: activeVoices(), loops: Array.from(loops.keys()), settings: getSettings() }; },
    __resetVoices() { voiceEnds.length = 0; for (const k in lastAt) delete lastAt[k]; return true; },
    /* 试听：依次播放一段有代表性的组合 */
    testDemo() {
      const seq = [
        ["attack", { hero: "knight" }],
        ["hit", { hero: "knight", amount: 2 }],
        ["dodge", { hero: "longren" }],
        ["shieldHit", { hero: "guardian" }],
        ["skill", { hero: "asura" }],
      ];
      seq.forEach((x, i) => setTimeout(() => SFX.play(x[0], x[1]), i * 260));
      setTimeout(() => SFX.playSkill("dash", { hero: "asura" }), 1300);
      setTimeout(() => SFX.playSkill("duanlang", { hero: "cang" }), 1800);
      setTimeout(() => SFX.playSkill("thunder", { hero: "thunder" }), 2400);
      setTimeout(() => SFX.playSkill("shenluo", { hero: "tiandao" }), 3000);
      return true;
    },
  };

  window.SFX = SFX;

  /* 浏览器自动播放策略：首次用户交互即解锁音频（只绑定一次） */
  try {
    const unlockOnce = () => { try { SFX.unlock(); } catch (e) {} };
    ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
      window.addEventListener(ev, unlockOnce, { once: true, passive: true })
    );
  } catch (e) { /* 忽略 */ }
})();
