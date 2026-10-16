/* =========================================================================
 * sfx.js —— 打击音效系统（Web Audio 实时合成，无需任何音频文件 / 无版权风险）
 * -------------------------------------------------------------------------
 * · 每名英雄有独立音色配置（见 PROFILES，与 heroes.js 里的 sfx 字段对应）
 * · 区分事件：攻击 / 命中 / 受击 / 阵亡 / 技能 / 技能命中 / 夹击 /
 *            突进 / 突进命中 / 生成剑 / 回收剑 / 胜利 / 失败
 * · 提供开关与音量调节，保存在 localStorage，刷新后保留
 * · 失败安全：任何异常都不会影响游戏运行
 *
 * 对外接口：
 *   SFX.play(event, { sfx: "sword" })   播放某事件
 *   SFX.setEnabled(bool) / SFX.setVolume(0..1)
 *   SFX.getSettings() / SFX.isEnabled()
 *   SFX.unlock()   首次用户交互后调用（满足浏览器自动播放策略）
 *   SFX.getLog()   最近事件日志（供测试）
 * ========================================================================= */
(function () {
  const KEY = "herochess.sfx";
  let settings = load();
  let ctx = null;
  let master = null;
  let voices = 0;           // 当前正在发声的语音数（限流用）
  const lastAt = {};        // 每个事件上次播放时间（去重 / 限流）
  const log = [];

  /* ---------------- 设置持久化 ---------------- */
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return {
        enabled: raw && raw.enabled === false ? false : true,
        volume: raw && typeof raw.volume === "number" ? Math.max(0, Math.min(1, raw.volume)) : 0.6,
      };
    } catch (e) {
      return { enabled: true, volume: 0.6 };
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (e) { /* 忽略 */ }
  }

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.volume;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      return true;
    } catch (e) {
      ctx = null;
      return false;
    }
  }

  /* ---------------- 音色配置（与 heroes.js 的 sfx 字段对应） ---------------- */
  const PROFILES = {
    sword:  { wave: "square",   freq: 880,  q: 900,  metal: 0.5 },
    heavy:  { wave: "sawtooth", freq: 180,  q: 400,  metal: 0.15 },
    magic:  { wave: "sine",     freq: 520,  q: 1200, metal: 0.05 },
    fast:   { wave: "triangle", freq: 1300, q: 2000, metal: 0.35 },
    ranged: { wave: "triangle", freq: 720,  q: 1500, metal: 0.2 },
    ice:    { wave: "sine",     freq: 1600, q: 2600, metal: 0.1 },
    holy:   { wave: "sine",     freq: 980,  q: 800,  metal: 0.0 },
    shield: { wave: "square",   freq: 300,  q: 500,  metal: 0.6 },
    blade:  { wave: "square",   freq: 1500, q: 2200, metal: 0.7 },
  };
  const def = (name) => PROFILES[name] || PROFILES.sword;

  /* ---------------- 基础发声原语 ---------------- */
  function now() { return ctx.currentTime; }

  function tone(wave, f0, f1, at, dur, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, at);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(master);
    o.start(at);
    o.stop(at + dur + 0.03);
    voices++;
    setTimeout(() => { voices = Math.max(0, voices - 1); }, (dur + 0.05) * 1000);
  }

  function noise(at, dur, peak, hp, lp) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = peak;
    let node = src;
    if (hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; node.connect(f); node = f; }
    if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; node.connect(f); node = f; }
    node.connect(g);
    g.connect(master);
    src.start(at);
    voices++;
    setTimeout(() => { voices = Math.max(0, voices - 1); }, (dur + 0.05) * 1000);
  }

  /* ---------------- 事件演奏 ---------------- */
  function perform(event, name) {
    const p = def(name);
    const t = now();
    const v = 0.9; // 基础力度，最终受 master 音量控制
    try {
      switch (event) {
        case "attack": // 挥击 / 破风
          noise(t, 0.10, 0.20 * v, 700, 0);
          tone(p.wave, p.freq * 0.9, p.freq * 1.5, t, 0.09, 0.10 * v);
          break;
        case "hit": // 命中
          noise(t, 0.06, 0.22 * v, 1200, 4000);
          tone(p.wave, p.freq * 0.6, p.freq * 0.3, t, 0.10, 0.16 * v);
          break;
        case "hurt": // 受击（偏低闷）
          tone("sawtooth", 260, 120, t, 0.14, 0.16 * v);
          noise(t, 0.05, 0.12 * v, 0, 900);
          break;
        case "death": // 阵亡（下行）
          tone("sawtooth", p.freq, 70, t, 0.5, 0.22 * v);
          noise(t, 0.35, 0.16 * v, 0, 1200);
          break;
        case "skill": // 技能释放
          tone(p.wave, p.freq, p.freq * 1.9, t, 0.22, 0.16 * v);
          if (p.metal) noise(t, 0.14, p.metal * 0.25 * v, p.q, 0);
          break;
        case "skillHit": // 技能命中
          noise(t, 0.09, 0.24 * v, 900, 5000);
          tone(p.wave, p.freq * 1.2, p.freq * 0.4, t, 0.14, 0.16 * v);
          break;
        case "flank": // 夹击（更厚重）
          noise(t, 0.12, 0.3 * v, 500, 4500);
          tone("square", p.freq * 0.8, p.freq * 0.3, t, 0.18, 0.22 * v);
          tone("sawtooth", 90, 60, t, 0.2, 0.18 * v);
          break;
        case "dash": // 突进破风（上行扫频 + 噪声）
          noise(t, 0.28, 0.22 * v, 500, 6000);
          tone("sine", 300, 1400, t, 0.26, 0.10 * v);
          break;
        case "dashHit": // 剑刃命中
          noise(t, 0.10, 0.28 * v, 1500, 0);
          tone("square", 1600, 500, t, 0.16, 0.20 * v);
          tone("square", 2400, 900, t + 0.02, 0.12, 0.12 * v);
          break;
        case "swordSpawn": // 生成剑刃（闪亮下行）
          tone("sine", 1800, 900, t, 0.25, 0.14 * v);
          tone("sine", 1200, 600, t + 0.05, 0.22, 0.10 * v);
          break;
        case "swordPickup": // 回收剑刃（上行清脆）
          tone("square", 700, 1400, t, 0.14, 0.16 * v);
          tone("square", 1050, 2100, t + 0.06, 0.16, 0.12 * v);
          break;
        case "win": // 胜利（上行三音）
          [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, t + i * 0.12, 0.28, 0.16 * v));
          break;
        case "lose": // 失败（下行三音）
          [440, 349, 262].forEach((f, i) => tone("sawtooth", f, f * 0.9, t + i * 0.16, 0.34, 0.16 * v));
          break;
        default:
          break;
      }
    } catch (e) { /* 忽略 */ }
  }

  const MIN_GAP = { attack: 40, hit: 35, hurt: 35, skill: 80, skillHit: 45, dash: 80, dashHit: 40, flank: 30 };
  const MAX_VOICES = 14;

  const SFX = {
    isEnabled() { return settings.enabled; },
    getSettings() { return { enabled: settings.enabled, volume: settings.volume }; },
    setEnabled(on) {
      settings.enabled = !!on;
      if (master) master.gain.value = settings.enabled ? settings.volume : 0;
      save();
    },
    setVolume(v) {
      settings.volume = Math.max(0, Math.min(1, v));
      if (master && settings.enabled) master.gain.value = settings.volume;
      save();
    },
    getLog() { return log.slice(); },
    unlock() {
      if (!ensure()) return false;
      if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
      return true;
    },
    play(event, opts) {
      if (!settings.enabled) return false;
      if (!ctx && !ensure()) return false;
      if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
      const name = (opts && opts.sfx) || "sword";
      const gap = MIN_GAP[event] || 25;
      const tms = (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (lastAt[event] != null && tms - lastAt[event] < gap) return false; // 去重 / 限流
      if (voices >= MAX_VOICES) return false;                              // 防止声音叠加刺耳
      lastAt[event] = tms;
      log.push({ event, sfx: name });
      if (log.length > 200) log.shift();
      perform(event, name);
      return true;
    },
  };
  window.SFX = SFX;
})();
