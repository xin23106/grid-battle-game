/* =========================================================================
 * battlefx.js —— 战斗表现层（Canvas 粒子 / 技能演出 / 战场留痕 / 镜头反馈）
 * -------------------------------------------------------------------------
 * 纯视觉层：不读取也不修改任何游戏状态，只接收“已经结算完成”的事件元数据。
 * 所有坐标来自真实棋盘格，画布覆盖在 #board 之上且 pointer-events:none。
 *
 * 对外接口（全部容错，缺参数直接忽略）：
 *   BFX.init({wrap, board})
 *   BFX.sync()                       // 每次 render 后调用，校正尺寸/坐标
 *   BFX.setOptions(partial)          // enabled/traces/speed/shake/reduce
 *   BFX.options                      // 只读副本
 *   BFX.banner(heroName, skillName, stageText)
 *   BFX.attack({from,to,flank,color,heroId})
 *   BFX.hit({r,c,amount,kind,color,heroId})
 *   BFX.shieldAbsorb({r,c,amount,color})
 *   BFX.dodge({r,c,heroId})
 *   BFX.immune({r,c,text})
 *   BFX.death({r,c,color})
 *   BFX.move({from,to,color,dash,blink})
 *   BFX.knockback({from,to,color})
 *   BFX.grab({from,to,color})
 *   BFX.heal({r,c,amount})
 *   BFX.shield({r,c,amount})
 *   BFX.revive({r,c})
 *   BFX.swordSpawn(r,c)
 *   BFX.cast({type,heroId,caster,target,cells,from,to,dir,stage})
 *   BFX.mark(kind,r,c,color,ttl)
 *   BFX.shake(mag)
 *   BFX.flash(color,alpha)
 *   BFX.hitstop(ms)
 *   BFX.clear()
 * ========================================================================= */
(function () {
  "use strict";

  const STORE_KEY = "herochess.fx";
  const DEFAULTS = { enabled: true, traces: true, speed: 1, shake: true, reduce: false };
  let opts = Object.assign({}, DEFAULTS);
  try { Object.assign(opts, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (e) {}
  function saveOpts() { try { localStorage.setItem(STORE_KEY, JSON.stringify(opts)); } catch (e) {} }

  /* ---------------- 英雄 / 技能配色 ---------------- */
  const HERO_COLOR = {
    berserker: "#f97316", mage: "#fb7185", knight: "#fde68a", ranger: "#34d399",
    assassin: "#22d3ee", warlock: "#a5f3fc", cleric: "#86efac", guardian: "#93c5fd",
    asura: "#e2e8f0", lone: "#facc15", cang: "#38bdf8", longren: "#fbbf24",
    thunder: "#c084fc", vampire: "#e11d48", jade: "#a78bfa", xiangyu: "#f87171",
    tiandao: "#c084fc",
  };
  function heroColor(id) { return HERO_COLOR[id] || "#93c5fd"; }

  /* ---------------- 基础状态 ---------------- */
  let wrap = null, boardEl = null, canvas = null, ctx = null;
  let W = 0, H = 0, DPR = 1;
  let geo = { cell: 66, gap: 6 };
  let raf = 0, lastT = 0, lastMarkDraw = 0;
  let hitStopUntil = 0;
  let shakeUntil = 0, shakeAmp = 0;
  let shakeCssTimer = 0;
  let bannerEl = null, bannerTimer = 0;
  let hasShaken = false;

  const effects = [];
  const particles = [];
  const marks = [];
  const MAX_PARTICLES = 700, MAX_MARKS = 64, MAX_EFFECTS = 120;

  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const spd = () => (opts.speed || 1);
  const dur = (ms) => Math.max(40, ms / spd());
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeIn = (p) => p * p;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function px(c) { return geo.x0 + c * (geo.cell + geo.gx); }
  function py(r) { return geo.y0 + r * (geo.cell + geo.gy); }

  /* ---------------- 几何同步 ---------------- */
  function sync() {
    if (!boardEl || !canvas) return;
    const w = boardEl.offsetWidth, h = boardEl.offsetHeight;
    const left = boardEl.offsetLeft, top = boardEl.offsetTop;
    if (!w || !h) return;
    // 用真实格子的矩形推导几何：CSS 网格容器可能比 6 条轨道更宽，不能用容器宽度反推
    const cells = boardEl.children;
    let cell = 56, gx = 6, gy = 6, x0 = 28, y0 = 28;
    if (cells.length >= 8) {
      const bw = boardEl.getBoundingClientRect();
      const a = cells[0].getBoundingClientRect();
      const b = cells[1].getBoundingClientRect();   // 同行右邻
      const d = cells[6].getBoundingClientRect();   // 下一行同列
      cell = a.width || cell;
      gx = b.left - a.left - cell;
      gy = d.top - a.top - cell;
      x0 = a.left - bw.left + cell / 2;
      y0 = a.top - bw.top + cell / 2;
    }
    geo = { cell, gx, gy, x0, y0 };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const changed = w !== W || h !== H || dpr !== DPR ||
      canvas.style.left !== left + "px" || canvas.style.top !== top + "px";
    if (!changed) return;
    W = w; H = h; DPR = dpr;
    canvas.style.left = left + "px";
    canvas.style.top = top + "px";
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- 循环 ---------------- */
  function kick() {
    if (!raf && canvas) { lastT = 0; raf = requestAnimationFrame(frame); }
  }

  function frame(t) {
    raf = 0;
    if (!ctx) return;
    const dt = lastT ? Math.min(50, t - lastT) : 16;
    lastT = t;
    const effDt = t < hitStopUntil ? dt * 0.15 : dt;

    // 只有痕迹时降低刷新频率（省电，但仍在淡出）
    if (!effects.length && !particles.length) {
      if (t - lastMarkDraw < 90) { raf = requestAnimationFrame(frame); return; }
      lastMarkDraw = t;
    }
    step(effDt, t);
    draw(t);
    if (effects.length || particles.length || marks.length) raf = requestAnimationFrame(frame);
    else lastT = 0;
  }

  function step(dt, t) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      if (t < e.t0 + (e.delay || 0)) continue;
      if (t > e.t0 + (e.delay || 0) + e.dur) effects.splice(i, 1);
    }
    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (t < p.t0) continue;
      p.life = t - p.t0;
      if (p.life > p.maxLife) { particles.splice(i, 1); continue; }
      const k = dt / 16.67;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= p.drag == null ? 0.94 : p.drag;
      p.vy = p.vy * (p.drag == null ? 0.94 : p.drag) + (p.grav || 0) * k;
    }
    // 痕迹
    for (let i = marks.length - 1; i >= 0; i--) {
      if (t > marks[i].t0 + marks[i].ttl) marks.splice(i, 1);
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    // 痕迹层（低透明度，不遮挡棋子/血条）
    if (opts.traces) {
      for (const m of marks) {
        const p = clamp01((t - m.t0) / m.ttl);
        const a = p < 0.82 ? 1 : 1 - (p - 0.82) / 0.18;
        drawMark(m, a * 0.5);
      }
    }
    // 瞬时特效
    for (const e of effects) {
      const t0 = e.t0 + (e.delay || 0);
      if (t < t0) continue;
      const p = clamp01((t - t0) / e.dur);
      ctx.save();
      drawEffect(e, p, t);
      ctx.restore();
    }
    // 粒子
    for (const p of particles) {
      if (t < p.t0) continue;
      const life = (t - p.t0) / p.maxLife;
      if (life > 1) continue;
      const a = (1 - life) * (p.alpha == null ? 1 : p.alpha);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.type === "line") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size || 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.size || 2) * (1 - life * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- 特效绘制 ---------------- */
  function drawEffect(e, p, t) {
    const c = e.color || "#93c5fd";
    switch (e.kind) {
      case "ring": {
        const r = e.r0 + (e.r1 - e.r0) * easeOut(p);
        ctx.globalAlpha = (e.alpha == null ? 0.95 : e.alpha) * (1 - p);
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(0.4, (e.width || 3) * (1 - p));
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
        if (e.double) {
          ctx.globalAlpha *= 0.55;
          ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.62, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      }
      case "wave": {
        const r = (e.r1 || geo.cell) * easeOut(p);
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, Math.max(1, r));
        g.addColorStop(0, hexA(c, 0.55 * (1 - p)));
        g.addColorStop(0.55, hexA(c, 0.22 * (1 - p)));
        g.addColorStop(1, hexA(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(1, r), 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "slash": {
        const prog = clamp01(p / 0.45);
        const len = (e.len || geo.cell) * (0.3 + 0.7 * prog);
        const a = (1 - clamp01((p - 0.45) / 0.55));
        ctx.globalAlpha = a * (e.alpha == null ? 1 : e.alpha);
        ctx.translate(e.x, e.y);
        ctx.rotate(e.angle || 0);
        ctx.strokeStyle = c;
        ctx.lineCap = "round";
        for (let k = 0; k < (e.lines || 1); k++) {
          const off = (k - ((e.lines || 1) - 1) / 2) * 7;
          ctx.lineWidth = Math.max(0.6, (e.width || 5) * (1 - p * 0.7) / (k + 1));
          ctx.globalAlpha = a * (k === 0 ? 1 : 0.55);
          ctx.beginPath();
          ctx.moveTo(-len / 2, off);
          ctx.quadraticCurveTo(0, off + (e.curve || 0), len / 2, off);
          ctx.stroke();
        }
        // 亮芯
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(0.5, (e.width || 5) * 0.22 * (1 - p));
        ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
        break;
      }
      case "line": {
        ctx.globalAlpha = (1 - p) * (e.alpha == null ? 0.95 : e.alpha);
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(0.5, (e.width || 3) * (1 - p * 0.6));
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        break;
      }
      case "beam": {
        const a = 1 - clamp01((p - 0.35) / 0.65);
        ctx.globalAlpha = a;
        ctx.strokeStyle = c;
        ctx.lineCap = "round";
        ctx.lineWidth = (e.width || 6) * (0.6 + 0.4 * Math.sin(p * Math.PI));
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(0.6, (e.width || 6) * 0.25);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        // 流动的亮点
        if (e.flow !== false) {
          const n = 6;
          for (let i = 0; i < n; i++) {
            const q = ((p * 1.6 + i / n) % 1);
            const x = e.x + (e.x2 - e.x) * q;
            const y = e.y + (e.y2 - e.y) * q;
            ctx.globalAlpha = a * (1 - Math.abs(q - 0.5) * 1.4);
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(x, y, (e.width || 6) * 0.16, 0, Math.PI * 2); ctx.fill();
          }
        }
        break;
      }
      case "bolt": {
        // 程序化锯齿闪电：每帧用固定种子重建，避免抖动过强
        const a = 1 - clamp01((p - 0.4) / 0.6);
        ctx.globalAlpha = a;
        const segs = e.segs || 7;
        const pts = [];
        const dx = (e.x2 - e.x), dy = (e.y2 - e.y);
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const seed = (e.seed || 1) + Math.floor(p * 8);
        for (let i = 0; i <= segs; i++) {
          const q = i / segs;
          let off = 0;
          if (i > 0 && i < segs) off = (pseudo(seed + i * 37) - 0.5) * (e.jitter || 16);
          pts.push([e.x + dx * q + nx * off, e.y + dy * q + ny * off]);
        }
        ctx.strokeStyle = c;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = (e.width || 4) * (1 - p * 0.5);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
        ctx.globalAlpha = a * 0.95;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(0.6, (e.width || 4) * 0.26);
        ctx.stroke();
        break;
      }
      case "tendril": {
        const a = 1 - clamp01((p - 0.3) / 0.7);
        ctx.globalAlpha = a * 0.95;
        ctx.strokeStyle = c;
        ctx.lineWidth = e.width || 3;
        ctx.lineCap = "round";
        const mx = (e.x + e.x2) / 2 + (e.bend || 0);
        const my = (e.y + e.y2) / 2 - (e.bend || 0);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.quadraticCurveTo(mx, my, e.x2, e.y2);
        ctx.stroke();
        break;
      }
      case "text": {
        const rise = (e.rise || 26) * easeOut(p);
        ctx.globalAlpha = 1 - clamp01((p - 0.55) / 0.45);
        ctx.font = "700 " + (e.size || 14) + "px system-ui, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,.65)";
        ctx.strokeText(e.text, e.x, e.y - rise);
        ctx.fillStyle = c;
        ctx.fillText(e.text, e.x, e.y - rise);
        break;
      }
      case "ghost": {
        ctx.globalAlpha = (1 - p) * 0.42;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(e.x, e.y, (e.r || geo.cell * 0.32) * (1 - p * 0.25), 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "cellbox": {
        const s = geo.cell;
        const a = Math.sin(clamp01(p) * Math.PI) * (e.alpha == null ? 0.55 : e.alpha);
        ctx.globalAlpha = a;
        ctx.fillStyle = hexA(c, 0.30);
        roundRect(e.x - s / 2 + 2, e.y - s / 2 + 2, s - 4, s - 4, 10);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        roundRect(e.x - s / 2 + 2, e.y - s / 2 + 2, s - 4, s - 4, 10);
        ctx.stroke();
        break;
      }
      case "rune": {
        const a = 1 - p;
        ctx.globalAlpha = a;
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.translate(e.x, e.y);
        ctx.rotate((e.rot || 0) + p * Math.PI * 1.6);
        const n = e.sides || 6, r = (e.r || geo.cell * 0.42) * (1 - p * 0.2);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const X = Math.cos(ang) * r, Y = Math.sin(ang) * r;
          i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
        }
        ctx.closePath(); ctx.stroke();
        break;
      }
      case "swords": {
        const a = (1 - p) * (e.alpha == null ? 1 : e.alpha);
        ctx.globalAlpha = a;
        const n = e.count || 3;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + p * Math.PI * 2 * (e.dir || 1);
          const rad = (e.r || geo.cell * 0.5) * (0.75 + 0.25 * Math.sin(p * Math.PI));
          const X = e.x + Math.cos(ang) * rad;
          const Y = e.y + Math.sin(ang) * rad * 0.72;
          ctx.save();
          ctx.translate(X, Y);
          ctx.rotate(ang + Math.PI / 2);
          ctx.fillStyle = c;
          ctx.fillRect(-1.4, -9, 2.8, 18);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-0.6, -9, 1.2, 18);
          ctx.restore();
        }
        break;
      }
      case "flash": {
        ctx.globalAlpha = (e.alpha == null ? 0.35 : e.alpha) * (1 - p);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case "portal": {
        const a = 1 - p;
        ctx.globalAlpha = a;
        ctx.translate(e.x, e.y);
        for (let i = 0; i < 3; i++) {
          ctx.strokeStyle = c;
          ctx.globalAlpha = a * (0.9 - i * 0.25);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, 0, (e.r || 12) * (0.6 + i * 0.35), (e.r || 12) * (1.3 - i * 0.3), p * Math.PI, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case "crack": {
        const a = 1 - p;
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.6;
        const n = e.n || 7;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + (e.seed || 0);
          const r1 = (e.r || geo.cell * 0.3) * (0.4 + p * 0.6);
          const r2 = r1 * (0.6 + pseudo(i + (e.seed || 0)) * 0.8);
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(ang) * r1, e.y + Math.sin(ang) * r1);
          ctx.lineTo(e.x + Math.cos(ang) * r2, e.y + Math.sin(ang) * r2);
          ctx.stroke();
        }
        break;
      }
      default: break;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hexA(hex, a) {
    const h = (hex || "#93c5fd").replace("#", "");
    const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function pseudo(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ---------------- 痕迹（第三层：战场印记） ---------------- */
  const MARK_TTL = { sword: 14000, water: 12000, thunder: 15000, impact: 13000, blood: 16000, space: 11000, ember: 10000, frost: 12000 };
  function addMark(kind, r, c, color, ttl) {
    if (!opts.enabled || !opts.traces) return;
    if (r == null || c == null) return;
    const t = now();
    marks.push({ kind, r, c, color: color || "#94a3b8", t0: t, ttl: dur(ttl || MARK_TTL[kind] || 12000), seed: Math.random() * 10 });
    while (marks.length > MAX_MARKS) marks.shift();
    kick();
  }

  function drawMark(m, alpha) {
    const x = px(m.c), y = py(m.r), s = geo.cell;
    ctx.save();
    ctx.globalAlpha = alpha;
    switch (m.kind) {
      case "sword": {
        ctx.strokeStyle = m.color;
        ctx.lineCap = "round";
        for (let i = 0; i < 2; i++) {
          ctx.globalAlpha = alpha * (0.75 - i * 0.25);
          ctx.lineWidth = 2.2 - i * 0.6;
          const ang = (i ? -0.62 : 0.55) + m.seed * 0.06;
          const L = s * (0.30 + m.seed * 0.03);
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(ang) * L, y - Math.sin(ang) * L);
          ctx.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L);
          ctx.stroke();
        }
        break;
      }
      case "water": {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = alpha * (0.5 - i * 0.12);
          ctx.beginPath();
          ctx.ellipse(x, y + i * 3 - 3, s * (0.22 + i * 0.09), s * (0.10 + i * 0.045), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case "thunder": {
        ctx.fillStyle = hexA("#1c1917", 0.5);
        ctx.beginPath(); ctx.arc(x, y, s * 0.26, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = alpha * (0.55 - i * 0.14);
          ctx.beginPath();
          let cx = x - s * 0.2 + i * 4, cy = y - s * 0.18;
          ctx.moveTo(cx, cy);
          for (let k = 0; k < 4; k++) { cx += (pseudo(m.seed + i * 9 + k) - 0.5) * 12; cy += s * 0.12; ctx.lineTo(cx, cy); }
          ctx.stroke();
        }
        break;
      }
      case "impact": {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          ctx.globalAlpha = alpha * 0.5;
          const ang = (i / 6) * Math.PI * 2 + m.seed;
          const L = s * (0.16 + pseudo(m.seed + i) * 0.16);
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * s * 0.08, y + Math.sin(ang) * s * 0.08);
          ctx.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L);
          ctx.stroke();
        }
        ctx.globalAlpha = alpha * 0.4;
        ctx.beginPath(); ctx.arc(x, y, s * 0.15, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case "blood": {
        ctx.fillStyle = hexA("#7f1d1d", 0.42);
        for (let i = 0; i < 4; i++) {
          const ang = m.seed + i * 1.7;
          const d = s * (0.08 + pseudo(m.seed + i * 3) * 0.2);
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(ang) * d, y + Math.sin(ang) * d, s * (0.07 + pseudo(i) * 0.06), s * 0.05, ang, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "space": {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = alpha * 0.75;
        ctx.beginPath();
        let cx = x + (pseudo(m.seed) - 0.5) * 10, cy = y - s * 0.24;
        ctx.moveTo(cx, cy);
        for (let k = 0; k < 5; k++) { cx += (pseudo(m.seed + k * 5) - 0.5) * 14; cy += s * 0.1; ctx.lineTo(cx, cy); }
        ctx.stroke();
        break;
      }
      case "ember": {
        ctx.fillStyle = hexA(m.color, 0.5);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + (pseudo(m.seed + i) - 0.5) * s * 0.4, y + (pseudo(m.seed + i * 7) - 0.5) * s * 0.4, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "frost": {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = alpha * 0.6;
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          const L = s * 0.2;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * 3, y + Math.sin(ang) * 3);
          ctx.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L);
          ctx.stroke();
        }
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  /* ---------------- 粒子 ---------------- */
  function spawn(x, y, n, cfg) {
    if (!opts.enabled) return;
    cfg = cfg || {};
    const cnt = opts.reduce ? Math.max(1, Math.round(n * 0.35)) : n;
    for (let i = 0; i < cnt && particles.length < MAX_PARTICLES; i++) {
      const ang = cfg.angle != null ? cfg.angle + (Math.random() - 0.5) * (cfg.spread == null ? Math.PI * 2 : cfg.spread)
        : Math.random() * Math.PI * 2;
      const sp = (cfg.speed == null ? 1 : cfg.speed) * (0.4 + Math.random());
      particles.push({
        x: x + (Math.random() - 0.5) * (cfg.jitter || 0),
        y: y + (Math.random() - 0.5) * (cfg.jitter || 0),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        t0: now() + (cfg.delay || 0),
        maxLife: dur((cfg.life == null ? 420 : cfg.life) * (0.6 + Math.random() * 0.7)),
        color: cfg.color || "#fff",
        size: cfg.size || 2,
        alpha: cfg.alpha == null ? 1 : cfg.alpha,
        type: cfg.type || "dot",
        grav: cfg.grav || 0,
        drag: cfg.drag,
      });
    }
    kick();
  }

  /* ---------------- 效果入队 ---------------- */
  function push(e) {
    if (!opts.enabled) return;
    if (effects.length >= MAX_EFFECTS) effects.shift();
    e.t0 = now();
    e.dur = dur(e.dur || 300);
    effects.push(e);
    kick();
  }

  /* ---------------- 对外：基础反馈 ---------------- */
  function unitReact(uid, cls) {
    if (!uid) return;
    setTimeout(function () {
      const el = document.querySelector('.board-wrap [data-uid="' + uid + '"]');
      if (!el) return;
      el.classList.remove("fx-hit", "fx-dodge", "fx-guard");
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(function () { el.classList.remove(cls); }, 320);
    }, 0);
  }

  function attack(m) {
    if (!m || !m.from || !m.to) return;
    const x0 = px(m.from.c), y0 = py(m.from.r);
    const x1 = px(m.to.c), y1 = py(m.to.r);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const col = m.color || "#e2e8f0";
    const strong = !!m.flank;
    const d = m.reduce == null ? 120 : m.reduce;

    // 突进残影
    push({ kind: "ghost", x: x0, y: y0, r: geo.cell * 0.34, color: col, dur: 220 });
    push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: col, width: strong ? 4 : 2.5, dur: 160, alpha: 0.5 });
    // 挥击弧线（命中前一瞬）
    push({ kind: "slash", x: (x0 + x1) / 2 + Math.cos(ang) * 4, y: (y0 + y1) / 2 + Math.sin(ang) * 4, angle: ang + Math.PI / 2, len: geo.cell * (strong ? 1.15 : 0.82), width: strong ? 7 : 4.5, color: strong ? "#fbbf24" : col, lines: strong ? 3 : 1, curve: strong ? 9 : 5, dur: 260, delay: d });
    if (strong) {
      push({ kind: "slash", x: (x0 + x1) / 2, y: (y0 + y1) / 2, angle: ang - Math.PI / 2, len: geo.cell * 0.8, width: 4, color: "#f97316", dur: 240, delay: d + 40 });
      push({ kind: "ring", x: x1, y: y1, r0: 4, r1: geo.cell * 0.6, color: "#fbbf24", width: 3, dur: 300, delay: d, alpha: 0.8 });
      push({ kind: "text", x: x1, y: y1 - geo.cell * 0.32, text: "夹击!", color: "#fbbf24", size: 15, dur: 520, delay: d, rise: 22 });
    }
    spawn(x1, y1, strong ? 20 : 12, { color: strong ? "#fbbf24" : "#ffffff", speed: strong ? 3.4 : 2.4, life: 300, size: strong ? 2.4 : 1.9, angle: ang, spread: 1.5, delay: d });
    if (strong) shake(4);
  }

  function hit(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    const col = m.color || (m.kind === "skill" ? "#c4b5fd" : "#fca5a5");
    unitReact(m.uid, "fx-hit");
    const size = m.amount ? Math.min(26, 12 + m.amount * 3) : 20;
    push({ kind: "wave", x, y, r1: geo.cell * (m.amount >= 3 ? 0.95 : 0.72), color: col, dur: 300 });
    push({ kind: "ring", x, y, r0: 3, r1: geo.cell * 0.55, color: col, width: 2.5, dur: 260 });
    spawn(x, y, m.amount >= 3 ? 16 : 10, { color: col, speed: 2.8, life: 340, size: 2, jitter: 4 });
    // 技能命中额外留痕
    if (m.kind === "skill") addMark("impact", m.r, m.c, col, 11000);
  }

  function shieldAbsorb(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    unitReact(m.uid, "fx-guard");
    push({ kind: "rune", x, y, r: geo.cell * 0.4, color: "#93c5fd", sides: 6, dur: 360 });
    push({ kind: "ring", x, y, r0: geo.cell * 0.18, r1: geo.cell * 0.5, color: "#bfdbfe", width: 3, dur: 320, double: true });
    spawn(x, y, 10, { color: "#bfdbfe", speed: 2.2, life: 300, size: 1.8 });
    push({ kind: "text", x, y: y - geo.cell * 0.3, text: "护盾 -" + (m.amount || 0), color: "#93c5fd", size: 13, dur: 560, rise: 20 });
  }

  function dodge(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    const col = m.heroId === "longren" ? "#fbbf24" : "#e2e8f0";
    unitReact(m.uid, "fx-dodge");
    // 侧闪残影
    push({ kind: "ghost", x: x - 10, y, r: geo.cell * 0.3, color: col, dur: 320 });
    push({ kind: "ghost", x: x + 10, y, r: geo.cell * 0.26, color: col, dur: 360, alpha: 0.3 });
    push({ kind: "text", x, y: y - geo.cell * 0.3, text: m.heroId === "longren" ? "龙魂·闪避" : "闪避", color: col, size: 14, dur: 620, rise: 24 });
    spawn(x, y, 8, { color: col, speed: 1.6, life: 360, size: 1.6 });
    if (m.heroId === "longren") {
      push({ kind: "ring", x, y, r0: 6, r1: geo.cell * 0.62, color: "#fbbf24", width: 3, dur: 380 });
      push({ kind: "swords", x, y, count: 2, r: geo.cell * 0.46, color: "#fde68a", dur: 420, alpha: 0.5, dir: -1 });
    }
  }

  function immune(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    push({ kind: "rune", x, y, r: geo.cell * 0.42, color: "#facc15", sides: 8, dur: 420 });
    push({ kind: "text", x, y: y - geo.cell * 0.3, text: m.text || "抵抗", color: "#facc15", size: 14, dur: 640, rise: 22 });
  }

  function death(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    const col = m.color || "#f87171";
    push({ kind: "ring", x, y, r0: 4, r1: geo.cell * 0.85, color: col, width: 3, dur: 420 });
    push({ kind: "wave", x, y, r1: geo.cell * 1.0, color: col, dur: 420 });
    push({ kind: "ghost", x, y, r: geo.cell * 0.36, color: "#ffffff", dur: 380 });
    spawn(x, y, 30, { color: col, speed: 3.2, life: 620, size: 2.6, jitter: 6, grav: 0.04 });
    spawn(x, y, 12, { color: "#ffffff", speed: 2.0, life: 480, size: 1.6 });
    shake(3);
  }

  function move(m) {
    if (!m || !m.from || !m.to) return;
    const x0 = px(m.from.c), y0 = py(m.from.r);
    const x1 = px(m.to.c), y1 = py(m.to.r);
    const col = m.color || "#93c5fd";
    if (m.blink) {
      push({ kind: "portal", x: x0, y: y0, r: geo.cell * 0.3, color: col, dur: 320 });
      push({ kind: "portal", x: x1, y: y1, r: geo.cell * 0.3, color: col, dur: 320, delay: 60 });
      spawn(x0, y0, 8, { color: col, speed: 1.4, life: 300, size: 1.6 });
      spawn(x1, y1, 8, { color: col, speed: 1.4, life: 300, size: 1.6 });
      addMark("space", m.to.r, m.to.c, col, 10000);
    } else if (m.dash) {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / (geo.cell * 0.6)));
      for (let i = 0; i < n; i++) {
        const q = i / n;
        push({ kind: "ghost", x: x0 + (x1 - x0) * q, y: y0 + (y1 - y0) * q, r: geo.cell * 0.28, color: col, dur: 260, delay: i * 35 });
      }
      push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: col, width: 3, dur: 220, alpha: 0.6 });
    } else {
      push({ kind: "ghost", x: x0, y: y0, r: geo.cell * 0.3, color: col, dur: 220 });
      push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: col, width: 2, dur: 190, alpha: 0.35 });
    }
  }

  function knockback(m) {
    if (!m || !m.from || !m.to) return;
    const x0 = px(m.from.c), y0 = py(m.from.r);
    const x1 = px(m.to.c), y1 = py(m.to.r);
    const col = m.color || "#fbbf24";
    const ang = Math.atan2(y1 - y0, x1 - x0);
    push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: col, width: 3, dur: 260, alpha: 0.7 });
    for (let i = 0; i < 3; i++) {
      push({ kind: "ghost", x: x0 + (x1 - x0) * (i / 3), y: y0 + (y1 - y0) * (i / 3), r: geo.cell * 0.26, color: col, dur: 300, delay: i * 50 });
    }
    spawn(x1, y1, 12, { color: col, speed: 2.4, life: 340, size: 2, angle: ang, spread: 1.2 });
    addMark("impact", m.to.r, m.to.c, col, 9000);
  }

  function grab(m) {
    if (!m || !m.from || !m.to) return;
    const x0 = px(m.from.c), y0 = py(m.from.r);
    const x1 = px(m.to.c), y1 = py(m.to.r);
    const col = m.color || "#38bdf8";
    push({ kind: "tendril", x: x0, y: y0, x2: x1, y2: y1, color: col, width: 3, bend: 18, dur: 420 });
    push({ kind: "tendril", x: x0, y: y0, x2: x1, y2: y1, color: col, width: 2, bend: -14, dur: 460, delay: 40 });
    push({ kind: "ring", x: x1, y: y1, r0: geo.cell * 0.3, r1: geo.cell * 0.16, color: col, width: 2.5, dur: 380 });
    push({ kind: "text", x: x1, y: y1 - geo.cell * 0.32, text: "抓取", color: col, size: 13, dur: 620, rise: 20 });
    spawn(x1, y1, 10, { color: col, speed: 1.8, life: 400, size: 1.8 });
    addMark("water", m.to.r, m.to.c, col, 9000);
  }

  function drain(m) {
    if (!m || !m.from || !m.to) return;
    const col = m.color || "#e11d48";
    const x0 = px(m.from.c), y0 = py(m.from.r);
    const x1 = px(m.to.c), y1 = py(m.to.r);
    push({ kind: "tendril", x: x0, y: y0, x2: x1, y2: y1, color: col, width: 3, bend: -18, dur: 520 });
    push({ kind: "tendril", x: x0, y: y0, x2: x1, y2: y1, color: "#fb7185", width: 1.6, bend: 12, dur: 560, delay: 40 });
    spawn(x1, y1, 8, { color: col, speed: 1.3, life: 460, size: 1.8 });
    kick();
  }

  function heal(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    push({ kind: "ring", x, y, r0: geo.cell * 0.42, r1: geo.cell * 0.16, color: "#4ade80", width: 2.5, dur: 420 });
    push({ kind: "rune", x, y, r: geo.cell * 0.36, color: "#86efac", sides: 6, dur: 460 });
    spawn(x, y + geo.cell * 0.2, 14, { color: "#4ade80", speed: 1.1, life: 620, size: 2, angle: -Math.PI / 2, spread: 0.9, grav: -0.02 });
    for (let i = 0; i < 3; i++) push({ kind: "text", x: x + (i - 1) * 12, y: y - geo.cell * 0.1 - i * 6, text: i === 1 ? "+" + (m.amount || 0) : "✚", color: "#86efac", size: i === 1 ? 15 : 10, dur: 640, delay: i * 70, rise: 26 });
  }

  function shieldFx(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 0.52, color: "#60a5fa", width: 3, dur: 420, double: true });
    push({ kind: "rune", x, y, r: geo.cell * 0.42, color: "#bfdbfe", sides: 6, dur: 520 });
    push({ kind: "text", x, y: y - geo.cell * 0.3, text: "护盾 +" + (m.amount || 0), color: "#93c5fd", size: 13, dur: 640, rise: 22 });
    spawn(x, y, 12, { color: "#bfdbfe", speed: 1.6, life: 420, size: 1.8 });
  }

  function revive(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    push({ kind: "beam", x, y: y - geo.cell, x2: x, y2: y, color: "#fde68a", width: 10, dur: 700 });
    push({ kind: "ring", x, y, r0: 4, r1: geo.cell * 0.7, color: "#fde68a", width: 3, dur: 620 });
    push({ kind: "rune", x, y, r: geo.cell * 0.4, color: "#fef3c7", sides: 8, dur: 720 });
    push({ kind: "text", x, y: y - geo.cell * 0.34, text: "复活", color: "#fde68a", size: 15, dur: 760, rise: 26 });
    spawn(x, y + geo.cell * 0.25, 20, { color: "#fde68a", speed: 1.2, life: 760, size: 2, angle: -Math.PI / 2, spread: 0.8, grav: -0.03 });
  }

  function swordSpawn(r, c) {
    const x = px(c), y = py(r);
    push({ kind: "beam", x, y: y - geo.cell * 0.55, x2: x, y2: y + 4, color: "#e2e8f0", width: 6, dur: 320 });
    push({ kind: "ring", x, y, r0: 3, r1: geo.cell * 0.4, color: "#e2e8f0", width: 2, dur: 300 });
    spawn(x, y, 8, { color: "#f1f5f9", speed: 1.4, life: 360, size: 1.6, grav: 0.03 });
    addMark("impact", r, c, "#cbd5e1", 9000);
  }

  /* ---------------- 对外：技能演出 ---------------- */
  function cast(m) {
    if (!m) return;
    const col = m.color || heroColor(m.heroId);
    const c = m.caster || {};
    const x = px(c.c || 0), y = py(c.r || 0);
    // 蓄力
    push({ kind: "rune", x, y, r: geo.cell * 0.46, color: col, sides: 6, dur: 420 });
    push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.22, color: col, width: 2.5, dur: 420 });
    spawn(x, y, 12, { color: col, speed: 1.4, life: 380, size: 1.8 });

    const t = m.type;
    const tg = m.target || {};
    const tx = tg.c !== undefined ? px(tg.c) : null;
    const ty = tg.r !== undefined ? py(tg.r) : null;

    switch (t) {
      case "damage_single":
        if (tx != null) {
          push({ kind: "beam", x, y, x2: tx, y2: ty, color: col, width: 7, dur: 380 });
          push({ kind: "ring", x: tx, y: ty, r0: 4, r1: geo.cell * 0.62, color: col, width: 3, dur: 380, delay: 120 });
          spawn(tx, ty, 18, { color: col, speed: 3, life: 420, size: 2.2 });
          addMark(m.heroId === "mage" ? "ember" : "impact", tg.r, tg.c, col, 11000);
        }
        break;
      case "freeze":
        if (tx != null) {
          push({ kind: "beam", x, y, x2: tx, y2: ty, color: "#a5f3fc", width: 6, dur: 340 });
          for (let i = 0; i < 6; i++) {
            push({ kind: "slash", x: tx, y: ty, angle: (i / 6) * Math.PI * 2, len: geo.cell * 0.5, width: 2.2, color: "#a5f3fc", dur: 380, delay: i * 18 });
          }
          push({ kind: "ring", x: tx, y: ty, r0: 4, r1: geo.cell * 0.7, color: "#67e8f9", width: 3, dur: 460 });
          spawn(tx, ty, 16, { color: "#a5f3fc", speed: 2, life: 520, size: 2 });
          addMark("frost", tg.r, tg.c, "#a5f3fc", 14000);
        }
        break;
      case "heal":
        if (tx != null) {
          push({ kind: "beam", x, y, x2: tx, y2: ty, color: "#86efac", width: 5, dur: 460, flow: true });
          heal({ r: tg.r, c: tg.c, amount: m.amount });
        }
        break;
      case "damage_adjacent_all":
        push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 1.25, color: col, width: 6, dur: 420 });
        push({ kind: "slash", x, y, angle: 0, len: geo.cell * 1.7, width: 5, color: col, dur: 380, lines: 1, curve: 0 });
        push({ kind: "slash", x, y, angle: Math.PI, len: geo.cell * 1.7, width: 4, color: col, dur: 380, delay: 30 });
        addMark("impact", c.r, c.c, col, 12000);
        break;
      case "damage_line":
        if (tx != null) {
          push({ kind: "line", x, y, x2: tx, y2: ty, color: col, width: 4, dur: 300 });
          push({ kind: "slash", x: tx, y: ty, angle: Math.atan2(ty - y, tx - x), len: geo.cell * 0.9, width: 3, color: col, dur: 300, delay: 60 });
          addMark("impact", tg.r, tg.c, col, 9000);
        }
        break;
      case "shield_self":
        shieldFx({ r: c.r, c: c.c, amount: m.amount });
        break;
      case "shield_ally":
        if (tx != null) {
          push({ kind: "beam", x, y, x2: tx, y2: ty, color: "#93c5fd", width: 5, dur: 420 });
          shieldFx({ r: tg.r, c: tg.c, amount: m.amount });
        }
        break;
      case "blink":
        if (tx != null) {
          push({ kind: "portal", x, y, r: geo.cell * 0.32, color: col, dur: 380 });
          push({ kind: "portal", x: tx, y: ty, r: geo.cell * 0.32, color: col, dur: 380, delay: 70 });
          addMark("space", tg.r, tg.c, col, 10000);
        }
        break;
      case "dash":
        push({ kind: "swords", x, y, count: 3, r: geo.cell * 0.52, color: "#e2e8f0", dur: 460 });
        if (m.from && m.to) {
          const x0 = px(m.from.c), y0 = py(m.from.r), x1 = px(m.to.c), y1 = py(m.to.r);
          push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: "#e2e8f0", width: 4, dur: 300, alpha: 0.8 });
          const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / (geo.cell * 0.55)));
          for (let i = 0; i <= n; i++) push({ kind: "ghost", x: x0 + (x1 - x0) * (i / n), y: y0 + (y1 - y0) * (i / n), r: geo.cell * 0.28, color: "#f8fafc", dur: 260, delay: i * 30 });
        }
        break;
      case "duanlang":
        if (tx != null) {
          push({ kind: "wave", x: tx, y: ty, r1: geo.cell * 1.3, color: "#38bdf8", dur: 520 });
          push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.2, r1: geo.cell * 1.15, color: "#7dd3fc", width: 4, dur: 460, double: true });
          spawn(tx, ty, 22, { color: "#7dd3fc", speed: 2.6, life: 520, size: 2 });
          addMark("water", tg.r, tg.c, "#38bdf8", 12000);
        }
        break;
      case "shuidiao":
        if (tx != null) {
          push({ kind: "tendril", x, y, x2: tx, y2: ty, color: "#38bdf8", width: 4, bend: 22, dur: 480 });
          push({ kind: "wave", x: tx, y: ty, r1: geo.cell * 1.15, color: "#38bdf8", dur: 520 });
          push({ kind: "text", x: tx, y: ty - geo.cell * 0.34, text: (m.stage || 0) >= 1 ? "引渡" : "断浪", color: "#7dd3fc", size: 13, dur: 620, rise: 22 });
          spawn(tx, ty, 18, { color: "#7dd3fc", speed: 2.4, life: 480, size: 2 });
          addMark("water", tg.r, tg.c, "#38bdf8", 12000);
        }
        break;
      case "dragonbreath":
        if (m.cells && m.cells.length) {
          m.cells.forEach((cell, i) => {
            push({ kind: "cellbox", x: px(cell[1]), y: py(cell[0]), color: "#fbbf24", dur: 460, delay: i * 55, alpha: 0.5 });
            push({ kind: "wave", x: px(cell[1]), y: py(cell[0]), r1: geo.cell * 0.62, color: "#f59e0b", dur: 420, delay: i * 55 });
            spawn(px(cell[1]), py(cell[0]), 5, { color: "#fde68a", speed: 1.6, life: 420, size: 1.8, delay: i * 55 });
            addMark("ember", cell[0], cell[1], "#f59e0b", 10000);
          });
        }
        break;
      case "thunder":
        if (tx != null) {
          push({ kind: "bolt", x: tx, y: ty - geo.cell * 1.6, x2: tx, y2: ty, color: "#facc15", width: 5, dur: 340, seed: Math.random() * 99 });
          push({ kind: "bolt", x: tx, y: ty - geo.cell * 1.6, x2: tx, y2: ty, color: "#e0f2fe", width: 2, dur: 260, delay: 40, seed: Math.random() * 99 });
          push({ kind: "ring", x: tx, y: ty, r0: 4, r1: geo.cell * 0.85, color: "#facc15", width: 3, dur: 420, delay: 60 });
          spawn(tx, ty, 20, { color: "#fde047", speed: 3.2, life: 420, size: 2.2 });
          addMark("thunder", tg.r, tg.c, "#facc15", 15000);
        }
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.9, color: "#a78bfa", width: 3, dur: 480 });
        break;
      case "chase":
        if ((m.stage || 0) >= 1 && tx != null) {
          push({ kind: "portal", x: tx, y: ty, r: geo.cell * 0.3, color: "#22d3ee", dur: 320 });
          push({ kind: "slash", x: tx, y: ty, angle: Math.atan2(ty - y, tx - x), len: geo.cell * 0.9, width: 4, color: "#22d3ee", dur: 300, delay: 90 });
          addMark("sword", tg.r, tg.c, "#22d3ee", 10000);
        } else if (m.path && m.path.length) {
          const p0 = m.path[0], p1 = m.path[m.path.length - 1];
          push({ kind: "line", x: px(p0[1]), y: py(p0[0]), x2: px(p1[1]), y2: py(p1[0]), color: "#22d3ee", width: 3, dur: 320 });
          for (const cell of m.path) spawn(px(cell[1]), py(cell[0]), 3, { color: "#67e8f9", speed: 1.2, life: 340, size: 1.6 });
        }
        break;
      case "bloodburst":
        push({ kind: "wave", x, y, r1: geo.cell * 1.5, color: "#e11d48", dur: 560 });
        push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 1.2, color: "#fb7185", width: 4, dur: 520, double: true });
        spawn(x, y, 24, { color: "#e11d48", speed: 2.8, life: 520, size: 2.2 });
        addMark("blood", c.r, c.c, "#e11d48", 15000);
        break;
      case "ziwei":
        if (tx != null) {
          push({ kind: "portal", x, y, r: geo.cell * 0.32, color: "#a78bfa", dur: 360 });
          push({ kind: "portal", x: tx, y: ty, r: geo.cell * 0.32, color: "#a78bfa", dur: 360, delay: 60 });
          push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.2, r1: geo.cell * 0.85, color: "#c4b5fd", width: 3, dur: 460, delay: 60 });
          addMark("space", tg.r, tg.c, "#a78bfa", 11000);
        }
        break;
      case "exile":
        if (tx != null) {
          push({ kind: "portal", x: tx, y: ty, r: geo.cell * 0.34, color: "#a78bfa", dur: 520 });
          push({ kind: "crack", x: tx, y: ty, r: geo.cell * 0.45, color: "#c4b5fd", dur: 480 });
          spawn(tx, ty, 14, { color: "#c4b5fd", speed: 1.8, life: 480, size: 2 });
        }
        if (m.from && m.to) {
          push({ kind: "portal", x: px(m.to.c), y: py(m.to.r), r: geo.cell * 0.3, color: "#a78bfa", dur: 460, delay: 180 });
          addMark("space", m.to.r, m.to.c, "#a78bfa", 11000);
        }
        break;
      case "tianwei":
        if (tx != null) {
          push({ kind: "beam", x: tx, y: ty - geo.cell * 1.8, x2: tx, y2: ty, color: "#c4b5fd", width: 12, dur: 420 });
          push({ kind: "ring", x: tx, y: ty, r0: 6, r1: geo.cell * 1.3, color: "#a78bfa", width: 5, dur: 520, delay: 80 });
          push({ kind: "wave", x: tx, y: ty, r1: geo.cell * 1.5, color: "#8b5cf6", dur: 520, delay: 80 });
          spawn(tx, ty, 24, { color: "#c4b5fd", speed: 3, life: 520, size: 2.2 });
          addMark("space", tg.r, tg.c, "#a78bfa", 12000);
        }
        break;
      case "shenluo":
        push({ kind: "ring", x, y, r0: geo.cell * 0.18, r1: geo.cell * 1.45, color: "#c084fc", width: 6, dur: 520, double: true });
        push({ kind: "wave", x, y, r1: geo.cell * 1.5, color: "#a855f7", dur: 520 });
        push({ kind: "crack", x, y, r: geo.cell * 0.7, color: "#c084fc", dur: 460 });
        spawn(x, y, 26, { color: "#c084fc", speed: 3.4, life: 500, size: 2.2 });
        addMark("impact", c.r, c.c, "#c084fc", 12000);
        break;
      case "wxt":
        if (tx != null) {
          push({ kind: "tendril", x, y, x2: tx, y2: ty, color: "#c084fc", width: 4, bend: 26, dur: 460 });
          push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.42, r1: geo.cell * 0.12, color: "#c084fc", width: 3, dur: 420 });
          push({ kind: "text", x: tx, y: ty - geo.cell * 0.34, text: ["引力", "束缚", "弹射"][m.stage || 0] || "引力", color: "#c084fc", size: 13, dur: 640, rise: 22 });
          spawn(tx, ty, 14, { color: "#c084fc", speed: 1.8, life: 420, size: 2 });
          addMark("space", tg.r, tg.c, "#c084fc", 10000);
        }
        break;
      case "passive":
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.3, color: col, width: 3, dur: 520 });
        break;
      default:
        break;
    }
  }

  /* ---------------- 镜头 / 提示 ---------------- */
  function shake(mag) {
    if (!opts.enabled || !opts.shake || opts.reduce) return;
    const amp = Math.min(9, mag || 3);
    if (!wrap) return;
    wrap.style.setProperty("--bfx-shake", amp + "px");
    wrap.classList.remove("bfx-shake");
    // 触发重排以重启动画
    void wrap.offsetWidth;
    wrap.classList.add("bfx-shake");
    clearTimeout(shakeCssTimer);
    shakeCssTimer = setTimeout(() => wrap.classList.remove("bfx-shake"), 220);
    // 画布内也轻微抖动，让粒子跟随
    shakeUntil = now() + 200; shakeAmp = amp * 0.5;
  }

  function flash(color, alpha) {
    if (!opts.enabled || opts.reduce) return;
    push({ kind: "flash", x: 0, y: 0, color: color || "#ffffff", alpha: alpha == null ? 0.16 : alpha, dur: 260 });
  }

  function hitstop(ms) {
    if (!opts.enabled || opts.reduce) return;
    hitStopUntil = Math.max(hitStopUntil, now() + dur(ms || 70));
  }

  function banner(hero, skill, stage) {
    if (!bannerEl) return;
    const txt = hero + (skill ? " · " + skill : "") + (stage ? "　" + stage : "");
    bannerEl.querySelector(".bfx-banner-main").textContent = txt;
    bannerEl.classList.remove("show");
    void bannerEl.offsetWidth;
    bannerEl.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove("show"), 1500);
  }

  /* ---------------- 初始化 ---------------- */
  function init(o) {
    wrap = (o && o.wrap) || document.querySelector(".board-wrap");
    boardEl = (o && o.board) || document.getElementById("board");
    if (!wrap || !boardEl) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "bfx-canvas";
      canvas.setAttribute("aria-hidden", "true");
    }
    if (canvas.parentNode !== wrap) wrap.appendChild(canvas);
    ctx = canvas.getContext("2d");
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.className = "bfx-banner";
      bannerEl.innerHTML = '<span class="bfx-banner-main"></span>';
      wrap.appendChild(bannerEl);
    }
    sync();
    if (!init._bound) {
      init._bound = true;
      window.addEventListener("resize", () => { sync(); });
      window.addEventListener("orientationchange", () => setTimeout(sync, 120));
    }
    kick();
  }

  function setOptions(o) {
    Object.assign(opts, o || {});
    saveOpts();
    if (!opts.enabled) clear();
    kick();
  }

  function clear() {
    effects.length = 0; particles.length = 0; marks.length = 0;
    if (ctx) ctx.clearRect(0, 0, W, H);
    if (bannerEl) bannerEl.classList.remove("show");
  }

  window.BFX = {
    init, sync, setOptions, clear, banner, attack, hit, shieldAbsorb: shieldAbsorb,
    dodge, immune, death, move, knockback, grab, heal, shield: shieldFx, revive,
    swordSpawn, cast, drain, mark: addMark, shake, flash, hitstop, heroColor,
    get options() { return Object.assign({}, opts); },
    DEFAULTS,
    /* 测试/调试钩子：手动推进一帧（隐藏标签页里 rAF 会被浏览器暂停） */
    __tick(t) {
      const nowT = t == null ? now() : t;
      step(16.67, nowT);
      draw(nowT);
    },
    __state() { return { effects: effects.length, particles: particles.length, marks: marks.length, geo: Object.assign({}, geo) }; },
  };
})();
