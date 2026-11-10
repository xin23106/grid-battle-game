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
    tiandao: "#c084fc", huamulan: "#f43f5e", hillking: "#a8a29e", raven: "#8b5cf6", metal: "#fbbf24", cicada: "#fcd34d", eagle: "#a78bfa", susanoo: "#7c3aed",
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
    // 痕迹层：低透明度 + 选目标时进一步变淡；有单位的格子避开中心（不盖棋子/血条）
    if (opts.traces) {
      const ta = targeting ? 0.35 : 1;
      for (const m of marks) {
        const p = clamp01((t - m.t0) / m.ttl);
        const fade = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;  // 后 45% 逐渐淡出
        const st = MARK_STYLE[m.kind] || {};
        const occ = occupancyFn ? !!occupancyFn(m.r, m.c) : false;
        const a = (st.alpha || 0.18) * fade * ta * (occ ? 0.75 : 1);
        if (a <= 0.01) continue;
        drawMark(m, a, occ);
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
      case "ribbon": {
        const a = 1 - clamp01((p - 0.45) / 0.55);
        const dx = e.x2 - e.x, dy = e.y2 - e.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        ctx.strokeStyle = c;
        ctx.lineCap = "round";
        for (let k = 0; k < 2; k++) {
          ctx.globalAlpha = a * (k ? 0.45 : 0.9);
          ctx.lineWidth = (e.width || 3) * (k ? 0.55 : 1);
          ctx.beginPath();
          const N = 16;
          for (let i = 0; i <= N; i++) {
            const q = i / N;
            const off = Math.sin(q * Math.PI * 2 + p * 7 + k * 1.9) * (e.bend || 7) * Math.sin(q * Math.PI);
            const X = e.x + dx * q + nx * off;
            const Y = e.y + dy * q + ny * off;
            if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
          }
          ctx.stroke();
        }
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
      case "sweep": {
        // 阵营交接：横向能量带扫过棋盘
        const q = easeOut(p);
        const x = e.x + (e.x2 - e.x) * q;
        const a = Math.sin(Math.PI * clamp01(p)) * (e.alpha == null ? 0.55 : e.alpha);
        const band = e.width || 150;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createLinearGradient(x - band / 2, 0, x + band / 2, 0);
        g.addColorStop(0, hexA(c, 0));
        g.addColorStop(0.42, hexA(c, a * 0.5));
        g.addColorStop(0.5, hexA(c, a));
        g.addColorStop(0.58, hexA(c, a * 0.5));
        g.addColorStop(1, hexA(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.restore();
        break;
      }
      case "sideGlow": {
        // 当前行动方半场亮起（克制，不遮挡棋子）
        const a = Math.sin(Math.PI * clamp01(p)) * (e.alpha == null ? 0.22 : e.alpha);
        const half = W / 2;
        const cx = e.side === 1 ? half * 0.5 : W - half * 0.5;
        const g = ctx.createRadialGradient(cx, H / 2, 10, cx, H / 2, half * 0.95);
        g.addColorStop(0, hexA(c, a));
        g.addColorStop(1, hexA(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
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
      case "pillar": {
        const h = (e.h || geo.cell * 0.9) * Math.min(1, p * 2.2);
        const a = Math.min(1, p * 4);
        ctx.globalAlpha = a * 0.95;
        const w = geo.cell * 0.46;
        ctx.fillStyle = "#57534e";
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x - w, e.y + h * 0.15);
        ctx.lineTo(e.x - w * 0.82, e.y - h * 0.65);
        ctx.lineTo(e.x + w * 0.55, e.y - h * 0.78);
        ctx.lineTo(e.x + w, e.y - h * 0.1);
        ctx.lineTo(e.x + w * 0.8, e.y + h * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#a8a29e";
        ctx.beginPath();
        ctx.ellipse(e.x, e.y - h * 0.7, w * 0.8, w * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
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
  /* 痕迹层级：不同技能留下不同“重量”的印记；alpha 较低，永不压过棋子与操作范围 */
  const MARK_STYLE = {
    sword:   { alpha: 0.20, ttl: 12000, rim: true },  // 剑痕：淡、细、偏边缘
    water:   { alpha: 0.15, ttl: 7000,  rim: true },  // 水纹：最短命，流动后消失
    thunder: { alpha: 0.26, ttl: 15000, rim: false }, // 焦痕：最重但面积小
    impact:  { alpha: 0.12, ttl: 10000, rim: true },  // 冲击纹：很淡
    blood:   { alpha: 0.20, ttl: 16000, rim: true },  // 血痕：低饱和、偏角落
    space:   { alpha: 0.18, ttl: 9000,  rim: true },  // 空间裂隙：中等寿命
    ember:   { alpha: 0.12, ttl: 8000,  rim: true },  // 灼痕：最轻
    frost:   { alpha: 0.14, ttl: 10000, rim: true },  // 霜痕
    shadow:  { alpha: 0.18, ttl: 9000,  rim: true },  // 暗影残痕
  };
  let occupancyFn = null;   // (r,c) => 该格是否有单位（有则痕迹避开中心）
  let targeting = false;    // 正在选目标 / 显示范围时，痕迹进一步变淡

  function addMark(kind, r, c, color, ttl) {
    if (!opts.enabled || !opts.traces) return;
    if (r == null || c == null) return;
    const st = MARK_STYLE[kind] || {};
    const t = now();
    marks.push({
      kind, r, c, color: color || "#94a3b8", t0: t,
      ttl: dur(ttl || st.ttl || 12000),
      seed: Math.random() * 10,
    });
    // 超出上限时优先清掉“最不重要”（impact/ember 先走），同类再按最旧
    while (marks.length > MAX_MARKS) {
      let idx = 0, best = 99;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const w = (m.kind === "impact" || m.kind === "ember") ? 0 : (m.kind === "water" ? 1 : 2);
        if (w < best) { best = w; idx = i; }
      }
      marks.splice(idx, 1);
    }
    kick();
  }

  function drawMark(m, alpha, occupied) {
    const x = px(m.c), y = py(m.r), s = geo.cell;
    ctx.save();
    if (occupied) {
      // 有单位：中心挖空 + 整体向外扩张，印记只落在格子边缘（不压棋子/血条，但仍可见）
      ctx.beginPath();
      ctx.rect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2);
      ctx.arc(x, y, s * 0.28, 0, Math.PI * 2, true);
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(1.55, 1.55);
      ctx.translate(-x, -y);
    }
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
    const id = m.heroId || "";
    /* 每个英雄有自己的“出手语言”：重击宽而慢、快攻细而急 */
    const heavy = /^(berserker|xiangyu|guardian|knight|jade|huamulan)$/.test(id);
    const fast = /^(assassin|ranger|cang|longren|tiandao)$/.test(id);
    const d = m.reduce == null ? (fast ? 90 : heavy ? 150 : 120) : m.reduce;
    const width = strong ? 7 : heavy ? 6 : fast ? 3.2 : 4.5;
    const len = geo.cell * (strong ? 1.15 : heavy ? 0.95 : fast ? 0.7 : 0.82);

    push({ kind: "ghost", x: x0, y: y0, r: geo.cell * 0.34, color: col, dur: fast ? 190 : 240 });
    push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: col, width: fast ? 1.6 : strong ? 4 : 2.5, dur: fast ? 130 : 170, alpha: 0.5 });
    // 挥击弧线：重击更开阔、快攻更短促
    push({
      kind: "slash", x: (x0 + x1) / 2 + Math.cos(ang) * 4, y: (y0 + y1) / 2 + Math.sin(ang) * 4,
      angle: ang + Math.PI / 2, len, width,
      color: strong ? "#fbbf24" : col, lines: strong ? 3 : 1,
      curve: strong ? 9 : heavy ? 8 : 4,
      dur: heavy ? 300 : fast ? 200 : 260, delay: d,
    });
    if (strong) {
      push({ kind: "slash", x: (x0 + x1) / 2, y: (y0 + y1) / 2, angle: ang - Math.PI / 2, len: geo.cell * 0.8, width: 4, color: "#f97316", dur: 240, delay: d + 40 });
      push({ kind: "ring", x: x1, y: y1, r0: 4, r1: geo.cell * 0.6, color: "#fbbf24", width: 3, dur: 300, delay: d, alpha: 0.8 });
      push({ kind: "text", x: x1, y: y1 - geo.cell * 0.32, text: "夹击!", color: "#fbbf24", size: 15, dur: 520, delay: d, rise: 22 });
    }
    if (heavy) {
      // 重击：落点尘土 + 更沉的星火
      spawn(x1, y1, 10, { color: col, speed: 2.0, life: 380, size: 2.6, angle: ang, spread: 1.1, delay: d, grav: 0.02 });
      shake(3);
    } else if (fast) {
      // 快攻：一道细长的破风线
      spawn(x1, y1, 8, { color: "#ffffff", speed: 3.6, life: 220, size: 1.5, angle: ang, spread: 0.9, delay: d, type: "line" });
    } else {
      spawn(x1, y1, strong ? 20 : 12, { color: strong ? "#fbbf24" : "#ffffff", speed: strong ? 3.4 : 2.4, life: 300, size: strong ? 2.4 : 1.9, angle: ang, spread: 1.5, delay: d });
    }
    if (strong) shake(4);
  }

  /* 每个英雄的“命中语言”：同样是 1 点伤害，刀是刀、水是水、雷是雷 */
  function hitStyle(heroId) {
    if (/^(asura|assassin|knight|ranger|berserker|xiangyu|huamulan)$/.test(heroId || "")) return "blade";
    if (heroId === "cang") return "water";
    if (heroId === "longren") return "flame";
    if (/^(thunder|tiandao|jade|warlock)$/.test(heroId || "")) return "arcane";
    if (heroId === "vampire") return "blood";
    if (/^(cleric|guardian)$/.test(heroId || "")) return "holy";
    return "blade";
  }

  function hit(m) {
    if (!m) return;
    const x = px(m.c), y = py(m.r);
    const col = m.color || (m.kind === "skill" ? "#c4b5fd" : "#fca5a5");
    const style = hitStyle(m.heroId);
    const big = (m.amount || 1) >= 3;
    const k = big ? 1.25 : (m.amount || 1) >= 2 ? 1.1 : 0.95;
    unitReact(m.uid, "fx-hit");

    // 极短的落点底光（保证“打中了”可读，但不做成通用大光环）
    push({ kind: "wave", x, y, r1: geo.cell * 0.34 * k, color: col, dur: 200, alpha: 0.5 });

    if (style === "blade") {
      push({ kind: "slash", x, y, angle: -0.72, len: geo.cell * 0.46 * k, width: big ? 4 : 2.8, color: "#f8fafc", dur: 190 });
      push({ kind: "slash", x, y, angle: 0.86, len: geo.cell * 0.38 * k, width: 2, color: col, dur: 210, delay: 25 });
      spawn(x, y, big ? 14 : 9, { type: "line", color: "#fff7ed", speed: 4.4, life: 220, size: 1.5, angle: -0.72, spread: 1.0, jitter: 3 });
    } else if (style === "water") {
      for (let i = 0; i < 3; i++) {
        push({ kind: "ring", x, y, r0: 3, r1: geo.cell * (0.16 + i * 0.11) * k, color: "#7dd3fc", width: 1.6, dur: 380, delay: i * 55, alpha: 0.55 });
      }
      spawn(x, y, big ? 14 : 9, { color: "#38bdf8", speed: 1.5, life: 520, size: 2, grav: 0.035 });
    } else if (style === "flame") {
      push({ kind: "ring", x, y, r0: 3, r1: geo.cell * 0.42 * k, color: "#f59e0b", width: 2.4, dur: 300 });
      spawn(x, y, big ? 16 : 10, { color: "#fbbf24", speed: 1.6, life: 560, size: 2.1, angle: -Math.PI / 2, spread: 1.4, grav: -0.01 });
      spawn(x, y, 5, { color: "#fef3c7", speed: 2.6, life: 300, size: 1.4 });
    } else if (style === "arcane") {
      for (let i = 0; i < 3; i++) {
        push({ kind: "slash", x, y, angle: (i / 3) * Math.PI * 2 + 0.4, len: geo.cell * 0.3 * k, width: 1.6, color: "#e9d5ff", dur: 200, delay: i * 22 });
      }
      push({ kind: "rune", x, y, r: geo.cell * 0.3 * k, color: col, sides: 6, dur: 260, alpha: 0.7 });
      spawn(x, y, big ? 12 : 8, { color: "#e9d5ff", speed: 2.8, life: 300, size: 1.6 });
    } else if (style === "blood") {
      push({ kind: "ring", x, y, r0: 3, r1: geo.cell * 0.4 * k, color: "#be123c", width: 2.2, dur: 260 });
      spawn(x, y, big ? 16 : 10, { color: "#e11d48", speed: 2.2, life: 440, size: 2.2, grav: 0.06 });
    } else if (style === "holy") {
      push({ kind: "rune", x, y, r: geo.cell * 0.34 * k, color: "#fde68a", sides: 4, dur: 300 });
      spawn(x, y + geo.cell * 0.14, big ? 12 : 8, { color: "#fef3c7", speed: 1.2, life: 520, size: 1.8, angle: -Math.PI / 2, spread: 0.7, grav: -0.02 });
    }

    if (m.kind === "skill") {
      // 技能命中留下与该英雄属性一致的印记
      const mk = style === "water" ? "water" : style === "flame" ? "ember" : style === "blood" ? "blood" : style === "arcane" ? (m.heroId === "tiandao" || m.heroId === "jade" ? "space" : "impact") : "sword";
      addMark(mk, m.r, m.c, col);
    }
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
        // 阿修罗：三剑环绕 → 直线突进 → 落点剑痕（锐利、无光环）
        push({ kind: "swords", x, y, count: 3, r: geo.cell * 0.52, color: "#e2e8f0", dur: 460 });
        if (m.from && m.to) {
          const x0 = px(m.from.c), y0 = py(m.from.r), x1 = px(m.to.c), y1 = py(m.to.r);
          push({ kind: "line", x: x0, y: y0, x2: x1, y2: y1, color: "#e2e8f0", width: 3.2, dur: 280, alpha: 0.8 });
          const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / (geo.cell * 0.55)));
          for (let i = 0; i <= n; i++) push({ kind: "ghost", x: x0 + (x1 - x0) * (i / n), y: y0 + (y1 - y0) * (i / n), r: geo.cell * 0.24, color: "#f8fafc", dur: 250, delay: i * 28 });
          const ang = Math.atan2(y1 - y0, x1 - x0);
          push({ kind: "slash", x: x1, y: y1, angle: ang + 1.1, len: geo.cell * 0.62, width: 3, color: "#f1f5f9", dur: 240, delay: 110 });
          push({ kind: "slash", x: x1, y: y1, angle: ang - 1.1, len: geo.cell * 0.5, width: 2, color: "#cbd5e1", dur: 240, delay: 150 });
          addMark("sword", m.to.r, m.to.c, "#e2e8f0");
        }
        break;
      case "duanlang":
        if (tx != null) {
          // 沧：水流线条 + 小涟漪（不用通用大光环）
          push({ kind: "ribbon", x, y, x2: tx, y2: ty, color: "#38bdf8", width: 5, bend: 14, dur: 420 });
          push({ kind: "ribbon", x, y, x2: tx, y2: ty, color: "#7dd3fc", width: 3, bend: -10, dur: 460, delay: 50 });
          for (let i = 0; i < 3; i++) {
            push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.12, r1: geo.cell * (0.42 + i * 0.2), color: "#7dd3fc", width: 1.8, dur: 480, delay: i * 70, alpha: 0.6 });
          }
          spawn(tx, ty, 20, { color: "#7dd3fc", speed: 2.0, life: 520, size: 2, grav: 0.02 });
          addMark("water", tg.r, tg.c, "#38bdf8");
        }
        break;
      case "shuidiao":
        if (tx != null) {
          push({ kind: "ribbon", x, y, x2: tx, y2: ty, color: "#38bdf8", width: 4, bend: 20, dur: 460 });
          push({ kind: "tendril", x, y, x2: tx, y2: ty, color: "#7dd3fc", width: 1.6, bend: 10, dur: 500, delay: 40 });
          push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.4, r1: geo.cell * 0.1, color: "#7dd3fc", width: 2.4, dur: 460 });
          push({ kind: "text", x: tx, y: ty - geo.cell * 0.34, text: (m.stage || 0) >= 1 ? "引渡" : "断浪", color: "#7dd3fc", size: 13, dur: 620, rise: 22 });
          spawn(tx, ty, 16, { color: "#7dd3fc", speed: 1.8, life: 480, size: 2, grav: 0.02 });
          addMark("water", tg.r, tg.c, "#38bdf8");
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
          // 雷电：落雷 + 焦痕 + 地面电弧，不用通用大光环
          push({ kind: "bolt", x: tx, y: ty - geo.cell * 1.6, x2: tx, y2: ty, color: "#facc15", width: 5, dur: 340, seed: Math.random() * 99 });
          push({ kind: "bolt", x: tx, y: ty - geo.cell * 1.6, x2: tx, y2: ty, color: "#e0f2fe", width: 2, dur: 260, delay: 40, seed: Math.random() * 99 });
          push({ kind: "crack", x: tx, y: ty, r: geo.cell * 0.45, color: "#facc15", dur: 360, n: 6 });
          push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.5, r1: geo.cell * 0.16, color: "#facc15", width: 2.2, dur: 380, delay: 50 });
          spawn(tx, ty, 18, { color: "#fde047", speed: 3.2, life: 420, size: 2.2 });
          addMark("thunder", tg.r, tg.c, "#facc15");
        }
        // 施法者周围逸散的电弧
        push({ kind: "crack", x, y, r: geo.cell * 0.42, color: "#a78bfa", dur: 420, n: 5 });
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
        // 天道超：向内坍缩 + 空间裂纹 + 碎片外抛，区别于“向外炸开的光圈”
        push({ kind: "ring", x, y, r0: geo.cell * 1.35, r1: geo.cell * 0.12, color: "#c084fc", width: 3, dur: 440 });
        push({ kind: "ring", x, y, r0: geo.cell * 0.95, r1: geo.cell * 0.08, color: "#e9d5ff", width: 2, dur: 480, delay: 70 });
        push({ kind: "rune", x, y, r: geo.cell * 0.52, color: "#c084fc", sides: 8, dur: 420 });
        push({ kind: "crack", x, y, r: geo.cell * 0.62, color: "#a855f7", dur: 460, n: 8 });
        spawn(x, y, 18, { color: "#e9d5ff", speed: 3.0, life: 460, size: 1.8 });
        addMark("space", c.r, c.c, "#c084fc");
        break;
      case "wxt":
        if (tx != null) {
          push({ kind: "tendril", x, y, x2: tx, y2: ty, color: "#c084fc", width: 4, bend: 26, dur: 460 });
          // 引力：粒子朝目标“吸”过去（负速度）
          spawn(tx, ty, 12, { color: "#e9d5ff", speed: -1.4, life: 420, size: 1.6 });
          push({ kind: "ring", x: tx, y: ty, r0: geo.cell * 0.42, r1: geo.cell * 0.12, color: "#c084fc", width: 2.6, dur: 420 });
          push({ kind: "crack", x: tx, y: ty, r: geo.cell * 0.32, color: "#c084fc", dur: 360, n: 5 });
          push({ kind: "text", x: tx, y: ty - geo.cell * 0.34, text: ["引力", "束缚", "弹射"][m.stage || 0] || "引力", color: "#c084fc", size: 13, dur: 640, rise: 22 });
          addMark("space", tg.r, tg.c, "#c084fc");
        }
        break;
      case "charge": {
        // 花木兰·所向披靡：蓄势 → 沿目标方向冲锋残影 → 命中冲击
        const d0 = m.dir || [0, 1];
        const tx2 = tg.c !== undefined ? px(tg.c) : x + d0[1] * geo.cell * 2;
        const ty2 = tg.r !== undefined ? py(tg.r) : y + d0[0] * geo.cell * 2;
        const ang = Math.atan2(ty2 - y, tx2 - x);
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.18, color: "#fbbf24", width: 3, dur: dur(320) });
        push({ kind: "line", x, y, x2: tx2, y2: ty2, color: "#f43f5e", width: 9, dur: dur(240), alpha: 0.55 });
        for (let i = 0; i <= 3; i++) {
          const q = (i / 3) * 0.72;
          push({ kind: "ghost", x: x + (tx2 - x) * q, y: y + (ty2 - y) * q, r: geo.cell * 0.24, color: "#f43f5e", dur: dur(230), delay: dur(i * 26) });
        }
        push({ kind: "slash", x: tx2, y: ty2, angle: ang + Math.PI / 2, len: geo.cell * 0.95, width: 6, color: "#fde68a", dur: dur(280), delay: dur(40) });
        push({ kind: "ring", x: tx2, y: ty2, r0: 4, r1: geo.cell * 0.6, color: "#fbbf24", width: 3, dur: dur(300), delay: dur(40) });
        spawn(tx2, ty2, 18, { color: "#fbbf24", speed: 3.2, life: 420, size: 2.2, angle: ang, spread: 1.2 });
        if (tg.r !== undefined) addMark("impact", tg.r, tg.c, "#f43f5e");
        break;
      }
      case "push": {
        // 山丘之王·推山：踏地蓄力 → 直线推击 → 目标处冲击
        const d0 = m.dir || [0, 1];
        const ang = Math.atan2(d0[0], d0[1]);
        push({ kind: "crack", x, y, r: geo.cell * 0.42, color: "#a8a29e", n: 6, dur: dur(360) });
        push({ kind: "ring", x, y, r0: geo.cell * 0.55, r1: geo.cell * 0.2, color: "#f59e0b", width: 3, dur: dur(300) });
        const tx2 = tg.c !== undefined ? px(tg.c) : x + d0[1] * geo.cell;
        const ty2 = tg.r !== undefined ? py(tg.r) : y + d0[0] * geo.cell;
        push({ kind: "line", x, y, x2: tx2, y2: ty2, color: "#d6d3d1", width: 10, dur: dur(260), alpha: 0.55 });
        push({ kind: "slash", x: tx2, y: ty2, angle: ang, len: geo.cell * 0.9, width: 5, color: "#fbbf24", dur: dur(260), delay: dur(50) });
        push({ kind: "ring", x: tx2, y: ty2, r0: 6, r1: geo.cell * 0.75, color: "#a8a29e", width: 4, dur: dur(340), delay: dur(50) });
        for (let i = 1; i <= 3; i++) {
          push({ kind: "ghost", x: tx2 + d0[1] * geo.cell * i * 0.5, y: ty2 + d0[0] * geo.cell * i * 0.5, r: geo.cell * 0.22, color: "#a8a29e", dur: dur(220), delay: dur(i * 40) });
        }
        spawn(tx2, ty2, 18, { color: "#d6d3d1", speed: 2.8, life: 460, size: 2.2, angle: ang, spread: 1.1 });
        if (tg.r !== undefined) addMark("impact", tg.r, tg.c, "#a8a29e");
        break;
      }
      case "stealth": {
        // 渡鸦·潜行：暗影散开 → 羽毛残影 → 位移
        const sc = m.target || m.caster || {};
        const sx = px(c.c), sy = py(c.r);
        const dx = sc.c !== undefined ? px(sc.c) : sx, dy = sc.r !== undefined ? py(sc.r) : sy;
        push({ kind: "ring", x: sx, y: sy, r0: geo.cell * 0.5, r1: geo.cell * 0.12, color: "#8b5cf6", width: 3, dur: dur(380) });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          push({ kind: "ghost", x: sx + Math.cos(a) * 6, y: sy + Math.sin(a) * 6, r: geo.cell * 0.12, color: "#c4b5fd", dur: dur(460), delay: dur(i * 25) });
        }
        if (dx !== sx || dy !== sy) {
          push({ kind: "line", x: sx, y: sy, x2: dx, y2: dy, color: "#a78bfa", width: 5, dur: dur(300), alpha: 0.6 });
          for (let i = 1; i <= 3; i++) {
            const q = i / 4;
            push({ kind: "ghost", x: sx + (dx - sx) * q, y: sy + (dy - sy) * q, r: geo.cell * 0.26, color: "#6d28d9", dur: dur(300), delay: dur(i * 40) });
          }
        }
        spawn(sx, sy, 16, { color: "#c4b5fd", speed: 1.4, life: 600, size: 2, angle: -Math.PI / 2, spread: 1.6, grav: 0.02 });
        if (sc.r !== undefined) addMark("shadow", sc.r, sc.c, "#8b5cf6", 12000);
        break;
      }
      case "stealthBreak": {
        push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 0.9, color: "#8b5cf6", width: 3, dur: dur(360) });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.3;
          push({ kind: "slash", x, y, angle: a, len: geo.cell * 0.55, width: 2.4, color: "#4c1d95", dur: dur(300), delay: dur(i * 20) });
        }
        spawn(x, y, 14, { color: "#a78bfa", speed: 2.4, life: 420, size: 2, spread: 1.8 });
        break;
      }
      case "mistdash": {
        // 渡鸦·雾冲：暗影突进 → 路径残影 → 毒雾
        const d0 = m.dir || [0, 1];
        const ex = tg.c !== undefined ? px(tg.c) : x + d0[1] * geo.cell * 2;
        const ey = tg.r !== undefined ? py(tg.r) : y + d0[0] * geo.cell * 2;
        const ang = Math.atan2(ey - y, ex - x);
        push({ kind: "line", x, y, x2: ex, y2: ey, color: "#7c3aed", width: 9, dur: dur(260), alpha: 0.5 });
        for (let i = 1; i <= 4; i++) {
          const q = i / 5;
          push({ kind: "ghost", x: x + (ex - x) * q, y: y + (ey - y) * q, r: geo.cell * 0.25, color: "#8b5cf6", dur: dur(260), delay: dur(i * 28) });
        }
        push({ kind: "ring", x: ex, y: ey, r0: 4, r1: geo.cell * 0.6, color: "#a78bfa", width: 3, dur: dur(320), delay: dur(60) });
        spawn(ex, ey, 18, { color: "#a78bfa", speed: 2.4, life: 480, size: 2, angle: ang, spread: 1.2 });
        break;
      }
      case "shadowfang": {
        // 渡鸦·影牙：暗色刀光 + 锋利突刺
        const sx = px(c.c), sy = py(c.r);
        const tx2 = tg.c !== undefined ? px(tg.c) : x, ty2 = tg.r !== undefined ? py(tg.r) : y;
        const ang = Math.atan2(ty2 - sy, tx2 - sx);
        push({ kind: "line", x: sx, y: sy, x2: tx2, y2: ty2, color: "#4c1d95", width: 8, dur: dur(200), alpha: 0.7 });
        push({ kind: "slash", x: (sx + tx2) / 2, y: (sy + ty2) / 2, angle: ang + Math.PI / 2, len: geo.cell * 0.9, width: 5, color: "#c4b5fd", dur: dur(240), delay: dur(30), curve: 6 });
        push({ kind: "slash", x: tx2, y: ty2, angle: ang - 0.5, len: geo.cell * 0.8, width: 3, color: "#8b5cf6", dur: dur(280), delay: dur(70) });
        push({ kind: "ring", x: tx2, y: ty2, r0: 4, r1: geo.cell * 0.55, color: "#7c3aed", width: 3, dur: dur(300), delay: dur(40) });
        spawn(tx2, ty2, 16, { color: "#c4b5fd", speed: 3, life: 380, size: 1.9, angle: ang, spread: 1.1 });
        if (tg.r !== undefined) addMark("shadow", tg.r, tg.c, "#8b5cf6");
        break;
      }
      case "refresh": {
        push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 0.9, color: "#fde68a", width: 3, dur: dur(420) });
        push({ kind: "rune", x, y, r: geo.cell * 0.42, color: "#c4b5fd", sides: 6, dur: dur(520) });
        spawn(x, y, 18, { color: "#fde68a", speed: 1.8, life: 560, size: 2, angle: -Math.PI / 2, spread: 1.2, grav: -0.02 });
        break;
      }
      case "metalpierce": {
        // 金元素·金属穿刺：金属尖刺沿正前方 1–2 格穿刺
        const d0 = m.dir || [0, 1];
        const cells = m.cells || [];
        for (let k = 1; k <= 2; k++) {
          const rr = c.r + d0[0] * k, cc = c.c + d0[1] * k;
          if (rr < 0 || rr >= 6 || cc < 0 || cc >= 6) continue;
          const xx = px(cc), yy = py(rr);
          push({ kind: "line", x, y, x2: xx, y2: yy, color: "#e5e7eb", width: 5, dur: dur(220), delay: dur(k * 30), alpha: 0.65 });
          push({ kind: "slash", x: xx, y: yy, angle: Math.atan2(d0[0], d0[1]) + Math.PI / 2, len: geo.cell * 0.8, width: 3, color: "#fbbf24", dur: dur(220), delay: dur(k * 30) });
          spawn(xx, yy, 8, { type: "line", color: "#fef3c7", speed: 3.2, life: 260, size: 1.6, angle: Math.atan2(d0[0], d0[1]), spread: 0.8, delay: dur(k * 30) });
        }
        push({ kind: "ring", x, y, r0: geo.cell * 0.45, r1: geo.cell * 0.18, color: "#fbbf24", width: 2.5, dur: dur(260) });
        break;
      }
      case "metalarmor": {
        // 金元素·金属装甲：金属外壳包裹 + 火花
        push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 0.75, color: "#d4d4d8", width: 4, dur: dur(360) });
        push({ kind: "rune", x, y, r: geo.cell * 0.46, color: "#fbbf24", sides: 6, dur: dur(420) });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          spawn(x + Math.cos(a) * geo.cell * 0.35, y + Math.sin(a) * geo.cell * 0.35, 1, { type: "line", color: "#fef3c7", speed: 2.2, life: 300, size: 1.4, angle: a, spread: 0.2 });
        }
        break;
      }
      case "metaltide": {
        // 金元素·金属狂潮：银金能量环 + 环绕碎片
        push({ kind: "ring", x, y, r0: geo.cell * 0.25, r1: geo.cell * 1.25, color: "#fbbf24", width: 5, dur: dur(700) });
        push({ kind: "ring", x, y, r0: geo.cell * 0.4, r1: geo.cell * 1.5, color: "#d4d4d8", width: 2.5, dur: dur(800), delay: dur(90) });
        push({ kind: "rune", x, y, r: geo.cell * 0.55, color: "#fef3c7", sides: 8, dur: dur(800) });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          push({ kind: "ghost", x: x + Math.cos(a) * geo.cell * 0.65, y: y + Math.sin(a) * geo.cell * 0.65, r: geo.cell * 0.08, color: "#fbbf24", dur: dur(650), delay: dur(i * 40) });
        }
        spawn(x, y, 18, { color: "#fbbf24", speed: 2, life: 700, size: 2, spread: 2 });
        push({ kind: "text", x, y: y - geo.cell * 0.75, text: "金属狂潮", color: "#fde68a", size: 13, dur: dur(900), rise: 18 });
        break;
      }
      case "metalCost": {
        // 金元素：主动支付生命值（非受击）
        push({ kind: "ring", x, y, r0: geo.cell * 0.3, r1: geo.cell * 0.12, color: "#f87171", width: 2.5, dur: dur(260) });
        push({ kind: "text", x, y: y - geo.cell * 0.42, text: "-" + (m.amount || 1), color: "#fca5a5", size: 14, dur: dur(600), rise: 18 });
        spawn(x, y, 6, { color: "#fca5a5", speed: 1.6, life: 320, size: 1.8, spread: 1.2, grav: 0.02 });
        break;
      }
      case "root": {
        // 定身：金属锁链 / 尖刺固定目标
        push({ kind: "ring", x, y, r0: geo.cell * 0.55, r1: geo.cell * 0.2, color: "#a8a29e", width: 3, dur: dur(360) });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          push({ kind: "line", x, y, x2: x + Math.cos(a) * geo.cell * 0.45, y2: y + Math.sin(a) * geo.cell * 0.45, color: "#d6d3d1", width: 2.5, dur: dur(300), delay: dur(i * 30) });
        }
        push({ kind: "text", x, y: y - geo.cell * 0.45, text: "定身", color: "#e7e5e4", size: 13, dur: dur(700), rise: 16 });
        break;
      }
      case "metalGuard": {
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.22, color: "#d4d4d8", width: 3, dur: dur(300) });
        push({ kind: "ring", x, y, r0: geo.cell * 0.25, r1: geo.cell * 0.6, color: "#fbbf24", width: 2, dur: dur(340), delay: dur(40) });
        break;
      }
      case "meditate": {
        // 金蝉·禅坐：莲花佛光 + 盘坐光环
        push({ kind: "ring", x, y, r0: geo.cell * 0.15, r1: geo.cell * 0.95, color: "#fcd34d", width: 4, dur: dur(620) });
        push({ kind: "ring", x, y, r0: geo.cell * 0.35, r1: geo.cell * 1.15, color: "#fef3c7", width: 2.5, dur: dur(760), delay: dur(90) });
        push({ kind: "rune", x, y, r: geo.cell * 0.5, color: "#fde68a", sides: 8, dur: dur(760) });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          push({ kind: "ghost", x: x + Math.cos(a) * geo.cell * 0.55, y: y + Math.sin(a) * geo.cell * 0.55, r: geo.cell * 0.13, color: "#fde68a", dur: dur(620), delay: dur(i * 30) });
        }
        spawn(x, y, 18, { color: "#fde68a", speed: 1.2, life: 800, size: 2, angle: -Math.PI / 2, spread: 1.6, grav: -0.02 });
        push({ kind: "text", x, y: y - geo.cell * 0.8, text: "禅坐", color: "#fef3c7", size: 15, dur: dur(1000), rise: 20 });
        break;
      }
      case "meditatePulse": {
        // 九宫格佛光：敌人冲击 / 友军治疗
        push({ kind: "ring", x, y, r0: geo.cell * 0.3, r1: geo.cell * 1.45, color: "#fcd34d", width: 3.5, dur: dur(560) });
        const cs = m.cells || [];
        for (const cell of cs) {
          const rr = cell.r !== undefined ? cell.r : cell[0];
          const cc = cell.c !== undefined ? cell.c : cell[1];
          const xx = px(cc), yy = py(rr);
          if (rr === c.r && cc === c.c) continue;
          push({ kind: "ring", x: xx, y: yy, r0: 3, r1: geo.cell * 0.42, color: "#fde68a", width: 2, dur: dur(380), delay: dur(40) });
          spawn(xx, yy, 6, { color: "#fde68a", speed: 1.6, life: 420, size: 1.8 });
        }
        break;
      }
      case "meditateEnd": {
        // 莲华绽放 + 恢复 2 点
        for (let i = 0; i < 3; i++) push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * (1.0 + i * 0.45), color: i % 2 ? "#fde68a" : "#86efac", width: 3, dur: dur(700), delay: dur(i * 90) });
        spawn(x, y, 24, { color: "#bbf7d0", speed: 1.4, life: 800, size: 2.2, angle: -Math.PI / 2, spread: 1.4, grav: -0.02 });
        push({ kind: "text", x, y: y - geo.cell * 0.7, text: "禅定圆满 +2", color: "#bbf7d0", size: 14, dur: dur(1000), rise: 22 });
        break;
      }
      case "meditateGuard": {
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.24, color: "#fde68a", width: 3, dur: dur(300) });
        push({ kind: "rune", x, y, r: geo.cell * 0.4, color: "#fef3c7", sides: 8, dur: dur(420) });
        break;
      }
      case "divinepalm": {
        // 金蝉·神掌：金色掌印 + 冲击波 + 击退轨迹
        const d0 = m.dir || [0, 1];
        const tx2 = tg.c !== undefined ? px(tg.c) : x + d0[1] * geo.cell;
        const ty2 = tg.r !== undefined ? py(tg.r) : y + d0[0] * geo.cell;
        const ang = Math.atan2(ty2 - y, tx2 - x);
        push({ kind: "ring", x, y, r0: geo.cell * 0.4, r1: geo.cell * 0.18, color: "#fbbf24", width: 3, dur: dur(280) });
        // 掌印：用圆形 + 五道短指节表示
        push({ kind: "ghost", x: tx2, y: ty2, r: geo.cell * 0.34, color: "#fcd34d", dur: dur(300) });
        for (let i = -2; i <= 2; i++) {
          push({ kind: "line", x: tx2 + Math.cos(ang + Math.PI / 2) * i * 3, y: ty2 + Math.sin(ang + Math.PI / 2) * i * 3, x2: tx2 + Math.cos(ang) * geo.cell * 0.34, y2: ty2 + Math.sin(ang) * geo.cell * 0.34, color: "#fde68a", width: 2, dur: dur(320) });
        }
        push({ kind: "ring", x: tx2, y: ty2, r0: 4, r1: geo.cell * 0.7, color: "#fbbf24", width: 4, dur: dur(360), delay: dur(50) });
        for (let i = 1; i <= 3; i++) {
          push({ kind: "ghost", x: tx2 + d0[1] * geo.cell * i * 0.6, y: ty2 + d0[0] * geo.cell * i * 0.6, r: geo.cell * 0.18, color: "#fcd34d", dur: dur(260), delay: dur(i * 60) });
        }
        spawn(tx2, ty2, 16, { color: "#fde68a", speed: 2.6, life: 480, size: 2.2, angle: ang, spread: 1.2 });
        if (tg.r !== undefined) addMark("impact", tg.r, tg.c, "#fbbf24");
        break;
      }
      case "raikiri": {
        // 鹰佐·雷劈：蓄电 → 第一格短雷 → 第二格强雷
        const hits = m.hits || [];
        push({ kind: "crack", x, y, r: geo.cell * 0.55, color: "#a78bfa", dur: dur(380), n: 7 });
        push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 0.6, color: "#c4b5fd", width: 2.4, dur: dur(340) });
        hits.forEach((h, i) => {
          const hx = px(h.c), hy = py(h.r);
          const strong = i > 0 || (h.hitDmg || 0) >= 2;
          push({ kind: "line", x, y, x2: hx, y2: hy, color: "#a78bfa", width: strong ? 4 : 2, dur: dur(strong ? 360 : 260) });
          push({ kind: "bolt", x: hx, y: hy - geo.cell * 1.5, x2: hx, y2: hy, color: strong ? "#fde047" : "#facc15", width: strong ? 7 : 4, dur: dur(strong ? 380 : 260), seed: Math.random() * 99 });
          push({ kind: "ring", x: hx, y: hy, r0: 4, r1: geo.cell * (strong ? 0.72 : 0.5), color: "#fde047", width: strong ? 3.5 : 2.2, dur: dur(400) });
          spawn(hx, hy, strong ? 24 : 12, { color: "#fde047", speed: strong ? 3.4 : 2.4, life: 460, size: 2.2 });
          addMark("thunder", h.r, h.c, "#facc15", 10000);
        });
        break;
      }
      case "thunderblade": {
        const stage = m.stage || 0;
        const from = m.from || {};
        if (stage === 1) {
          // 十字突进残影 + 雷斩
          if (from.r != null) push({ kind: "line", x: px(from.c), y: py(from.r), x2: x, y2: y, color: "#8b5cf6", width: 3, dur: dur(320) });
          if (tx != null) {
            push({ kind: "slash", x: tx, y: ty, angle: Math.atan2(ty - y, tx - x), len: geo.cell * 1.05, width: 5, color: "#a78bfa", dur: dur(340), delay: dur(60) });
            push({ kind: "ring", x: tx, y: ty, r0: 4, r1: geo.cell * 0.7, color: "#fde047", width: 3, dur: dur(360), delay: dur(80) });
            addMark("thunder", tg.r, tg.c, "#a78bfa", 10000);
          }
          spawn(x, y, 14, { color: "#8b5cf6", speed: 2.4, life: 380, size: 2 });
          break;
        }
        if (stage === 2) {
          // 前突 + 插刀 + 火焰
          if (from.r != null) push({ kind: "line", x: px(from.c), y: py(from.r), x2: x, y2: y, color: "#8b5cf6", width: 3, dur: dur(300) });
          const bl = m.blade || {};
          if (bl.r != null) {
            push({ kind: "bolt", x: px(bl.c), y: py(bl.r) - geo.cell * 1.4, x2: px(bl.c), y2: py(bl.r), color: "#a78bfa", width: 4, dur: dur(340), seed: Math.random() * 99 });
            push({ kind: "ring", x: px(bl.c), y: py(bl.r), r0: geo.cell * 0.5, r1: geo.cell * 0.14, color: "#c4b5fd", width: 2.4, dur: dur(400) });
            addMark("sword", bl.r, bl.c, "#8b5cf6", 10000);
          }
          // 吐火：以鹰佐为中心向外喷射
          const dir = m.dir || [0, 1];
          const fa = Math.atan2(dir[0], dir[1]);
          for (let i = 0; i < 14; i++) {
            const a = fa + (Math.random() - 0.5) * 1.3;
            spawn(x, y, 1, { color: i % 2 ? "#f97316" : "#fde047", speed: 2.2, life: 420, size: 2.4, angle: a, spread: 0.7 });
          }
          push({ kind: "ring", x, y, r0: geo.cell * 0.2, r1: geo.cell * 0.9, color: "#f97316", width: 3, dur: dur(420) });
          spawn(x, y, 16, { color: "#fb923c", speed: 1.2, life: 520, size: 2, angle: -Math.PI / 2, spread: 1.2, grav: -0.02 });
          break;
        }
        if (stage === 3) {
          const bl = m.blade || {};
          if (from.r != null) push({ kind: "portal", x: px(from.c), y: py(from.r), r: geo.cell * 0.28, color: "#a78bfa", dur: dur(320) });
          push({ kind: "portal", x, y, r: geo.cell * 0.28, color: "#c4b5fd", dur: dur(360) });
          if (bl.r != null) {
            push({ kind: "bolt", x, y, x2: px(bl.c), y2: py(bl.r), color: "#fde047", width: 8, dur: dur(520), seed: Math.random() * 99 });
            push({ kind: "bolt", x, y, x2: px(bl.c), y2: py(bl.r), color: "#c4b5fd", width: 3, dur: dur(460), seed: Math.random() * 99 });
            push({ kind: "ring", x: px(bl.c), y: py(bl.r), r0: 5, r1: geo.cell * 0.95, color: "#fde047", width: 4, dur: dur(520) });
            addMark("thunder", bl.r, bl.c, "#facc15", 9000);
          }
          push({ kind: "ring", x, y, r0: geo.cell * 0.3, r1: geo.cell * 1.5, color: "#a78bfa", width: 4, dur: dur(560) });
          push({ kind: "wave", x, y, r1: geo.cell * 1.7, color: "#8b5cf6", dur: dur(560) });
          spawn(x, y, 26, { color: "#fde047", speed: 3.2, life: 520, size: 2.4 });
          break;
        }
        break;
      }
      case "susano_dash": {
        // 须佐·雷刀：斜向闪现 + 路径雷光
        const to = m.to || {};
        const from = m.from || {};
        if (from.r != null) push({ kind: "line", x: px(from.c), y: py(from.r), x2: px(to.c != null ? to.c : from.c), y2: py(to.r != null ? to.r : from.r), color: "#8b5cf6", width: 4, dur: dur(320) });
        if (tx != null) {
          push({ kind: "slash", x: tx, y: ty, angle: Math.atan2(ty - y, tx - x), len: geo.cell * 0.95, width: 4.5, color: "#a78bfa", dur: dur(320), delay: dur(50) });
          push({ kind: "ring", x: tx, y: ty, r0: 4, r1: geo.cell * 0.55, color: "#c4b5fd", width: 2.4, dur: dur(340) });
        }
        if (to.r != null) {
          push({ kind: "bolt", x: px(to.c), y: py(to.r) - geo.cell * 1.5, x2: px(to.c), y2: py(to.r), color: "#a78bfa", width: 5, dur: dur(360), seed: Math.random() * 99 });
          push({ kind: "ring", x: px(to.c), y: py(to.r), r0: 5, r1: geo.cell * 0.72, color: "#c4b5fd", width: 3, dur: dur(400) });
          spawn(px(to.c), py(to.r), 16, { color: "#a78bfa", speed: 2.6, life: 420, size: 2 });
        }
        break;
      }
      case "susano_pull": {
        // 须佐·雷鸣：雷电牵引
        const land = m.landing || {};
        if (tx != null) {
          push({ kind: "line", x, y, x2: tx, y2: ty, color: "#a78bfa", width: 4, dur: dur(260) });
          push({ kind: "bolt", x: tx, y: ty - geo.cell * 1.2, x2: tx, y2: ty, color: "#c4b5fd", width: 5, dur: dur(320), seed: Math.random() * 99 });
          addMark("thunder", tg.r, tg.c, "#a78bfa", 10000);
        }
        if (land.r != null) {
          push({ kind: "line", x: tx != null ? tx : x, y: ty != null ? ty : y, x2: px(land.c), y2: py(land.r), color: "#8b5cf6", width: 3, dur: dur(320), delay: dur(60) });
          push({ kind: "ring", x: px(land.c), y: py(land.r), r0: 4, r1: geo.cell * 0.62, color: "#c4b5fd", width: 2.5, dur: dur(380), delay: dur(80) });
          addMark("impact", land.r, land.c, "#8b5cf6", 9000);
          spawn(px(land.c), py(land.r), 14, { color: "#a78bfa", speed: 2.4, life: 420, size: 2 });
        }
        break;
      }
      case "susano_arrow": {
        // 须佐·须佐箭：巨大须佐轮廓 + 蓄力 + 爆炸 + 黑炎
        const sec = m.second || {};
        push({ kind: "ring", x, y, r0: geo.cell * 0.3, r1: geo.cell * 1.15, color: "#7c3aed", width: 5, dur: dur(560) });
        push({ kind: "rune", x, y, r: geo.cell * 0.6, color: "#a78bfa", sides: 6, dur: dur(620) });
        spawn(x, y, 20, { color: "#8b5cf6", speed: 2.2, life: 520, size: 2.2, angle: -Math.PI / 2, spread: 1.4, grav: -0.015 });
        if (sec.r != null) {
          const sx = px(sec.c), sy = py(sec.r);
          push({ kind: "line", x, y, x2: sx, y2: sy, color: "#c4b5fd", width: 5, dur: dur(300), delay: dur(80) });
          push({ kind: "ring", x: sx, y: sy, r0: 6, r1: geo.cell * 1.6, color: "#a78bfa", width: 5, dur: dur(520), delay: dur(100) });
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const rx = px(sec.c + dc), ry = py(sec.r + dr);
            push({ kind: "wave", x: rx, y: ry, r1: geo.cell * 0.55, color: "#7c3aed", dur: dur(420), delay: dur(150) });
            spawn(rx, ry, 10, { color: "#7c3aed", speed: 1.6, life: 620, size: 2.2, angle: -Math.PI / 2, spread: 0.8, grav: -0.01 });
          }
          spawn(sx, sy, 28, { color: "#c4b5fd", speed: 3.4, life: 520, size: 2.4 });
          addMark("impact", sec.r, sec.c, "#7c3aed", 11000);
        }
        break;
      }
      case "susano_crow": {
        // 须佐·鸦天狗：黑翼展开 + 前方冲击
        push({ kind: "ring", x, y, r0: geo.cell * 0.25, r1: geo.cell * 1.35, color: "#4c1d95", width: 5, dur: dur(560) });
        push({ kind: "rune", x, y, r: geo.cell * 0.55, color: "#7c3aed", sides: 8, dur: dur(600) });
        const cen = m.center || {};
        if (cen.r != null) {
          const cx = px(cen.c), cy = py(cen.r);
          push({ kind: "wave", x: cx, y: cy, r1: geo.cell * 1.5, color: "#4c1d95", dur: dur(520) });
          push({ kind: "ring", x: cx, y: cy, r0: geo.cell * 0.3, r1: geo.cell * 1.3, color: "#a78bfa", width: 3, dur: dur(480) });
          spawn(cx, cy, 22, { color: "#4c1d95", speed: 2.8, life: 520, size: 2.2 });
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            spawn(cx, cy, 1, { color: i % 2 ? "#4c1d95" : "#8b5cf6", speed: 2.2, life: 620, size: 2.4, angle: a, spread: 0.6, grav: 0.02 });
          }
        }
        break;
      }
      case "crowPulse": {
        const cells = m.cells || [];
        for (const cell of cells) {
          const rr = cell[0], cc = cell[1];
          const xx = px(cc), yy = py(rr);
          push({ kind: "ring", x: xx, y: yy, r0: 3, r1: geo.cell * 0.45, color: "#7c3aed", width: 2, dur: dur(360), delay: dur(30) });
          spawn(xx, yy, 5, { color: "#4c1d95", speed: 1.8, life: 420, size: 1.8, angle: -Math.PI / 2, spread: 1.2, grav: 0.01 });
        }
        break;
      }
      case "crowEnd": {
        push({ kind: "ring", x, y, r0: geo.cell * 0.9, r1: geo.cell * 0.15, color: "#4c1d95", width: 3, dur: dur(460) });
        spawn(x, y, 18, { color: "#8b5cf6", speed: 1.6, life: 620, size: 2, angle: -Math.PI / 2, spread: 1.6, grav: -0.02 });
        break;
      }
      case "crowGuard": {
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.22, color: "#7c3aed", width: 3, dur: dur(300) });
        push({ kind: "rune", x, y, r: geo.cell * 0.42, color: "#c4b5fd", sides: 8, dur: dur(400) });
        break;
      }
      case "blackflame": {
        const cells = m.cells || [];
        for (const cell of cells) {
          const rr = cell[0], cc = cell[1];
          const xx = px(cc), yy = py(rr);
          if ((m.mode || "rise") === "fade") {
            push({ kind: "ring", x: xx, y: yy, r0: geo.cell * 0.4, r1: 3, color: "#7c3aed", width: 2, dur: dur(380) });
            spawn(xx, yy, 8, { color: "#4c1d95", speed: 1.2, life: 420, size: 1.8, angle: -Math.PI / 2, spread: 1.2, grav: -0.02 });
          } else {
            push({ kind: "ring", x: xx, y: yy, r0: 3, r1: geo.cell * 0.45, color: "#7c3aed", width: 2.5, dur: dur(420) });
            spawn(xx, yy, 12, { color: "#4c1d95", speed: 1.4, life: 620, size: 2.2, angle: -Math.PI / 2, spread: 1.0, grav: -0.03 });
          }
        }
        break;
      }
      case "stun": {
        const sx = tx !== null ? tx : x, sy = ty !== null ? ty : y;
        push({ kind: "rune", x: sx, y: sy, r: geo.cell * 0.4, color: "#fbbf24", sides: 5, dur: dur(700) });
        push({ kind: "ring", x: sx, y: sy, r0: geo.cell * 0.5, r1: geo.cell * 0.18, color: "#fbbf24", width: 2.5, dur: dur(600) });
        push({ kind: "swords", x: sx, y: sy, count: 3, r: geo.cell * 0.42, color: "#fde68a", dur: dur(700), alpha: 0.7, dir: -1 });
        push({ kind: "text", x: sx, y: sy - geo.cell * 0.5, text: "眩晕 2 回合", color: "#fbbf24", size: 14, dur: dur(900), rise: 20 });
        break;
      }
      case "passive":
        push({ kind: "ring", x, y, r0: geo.cell * 0.5, r1: geo.cell * 0.3, color: col, width: 3, dur: 520 });
        break;
      default:
        break;
    }
  }

  /* 山丘之王·石柱：升起 / 碎裂（cells: [[r,c],...]） */
  function pillars(cells, mode) {
    if (!opts.enabled || !cells || !cells.length) return;
    for (const cell of cells) {
      const r = cell.r !== undefined ? cell.r : cell[0];
      const c = cell.c !== undefined ? cell.c : cell[1];
      const x = px(c), y = py(r);
      if (mode === "break") {
        spawn(x, y, 16, { color: "#a8a29e", speed: 2.2, life: 520, size: 2.2, grav: 0.12 });
        push({ kind: "ring", x, y, r0: geo.cell * 0.45, r1: geo.cell * 0.12, color: "#78716c", width: 3, dur: dur(360) });
        push({ kind: "crack", x, y, r: geo.cell * 0.42, color: "#78716c", n: 5, dur: dur(420) });
      } else {
        push({ kind: "pillar", x, y, h: geo.cell * 0.9, color: "#a8a29e", dur: dur(420) });
        push({ kind: "ring", x, y: y + geo.cell * 0.22, r0: geo.cell * 0.18, r1: geo.cell * 0.55, color: "#d6d3d1", width: 2.5, dur: dur(380) });
        spawn(x, y + geo.cell * 0.2, 12, { color: "#d6d3d1", speed: 1.4, life: 520, size: 1.8, angle: -Math.PI / 2, spread: 1.4, grav: 0.05 });
      }
    }
  }

  /* 渡鸦·毒雾：生成 / 消散 */
  function mist(cells, mode) {
    if (!opts.enabled || !cells || !cells.length) return;
    for (const cell of cells) {
      const r = cell.r !== undefined ? cell.r : cell[0];
      const c = cell.c !== undefined ? cell.c : cell[1];
      const x = px(c), y = py(r);
      if (mode === "fade") {
        spawn(x, y, 10, { color: "#a78bfa", speed: 0.9, life: 620, size: 3.2, spread: 1.6 });
        push({ kind: "ring", x, y, r0: geo.cell * 0.4, r1: geo.cell * 0.1, color: "#6d28d9", width: 2, dur: dur(500) });
      } else {
        for (let i = 0; i < 3; i++) {
          push({ kind: "ghost", x: x + (Math.random() - 0.5) * geo.cell * 0.4, y: y + (Math.random() - 0.5) * geo.cell * 0.4, r: geo.cell * 0.3, color: i % 2 ? "#7c3aed" : "#4c1d95", dur: dur(700), delay: dur(i * 60) });
        }
        spawn(x, y, 8, { color: "#a78bfa", speed: 0.7, life: 900, size: 3, spread: 1.8 });
      }
    }
  }

  /* ---------------- 镜头 / 提示 ---------------- */  function shake(mag) {
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

  /* ---------------- 回合切换演出 ---------------- */
  let turnEl = null, turnTitleEl = null, turnSubEl = null, turnEmblemEl = null, turnTimer = 0;
  function ensureTurnEl() {
    if (turnEl) return;
    turnEl = document.createElement("div");
    turnEl.className = "bfx-turn";
    turnEl.innerHTML =
      '<div class="bfx-turn-scrim"></div>' +
      '<div class="bfx-turn-ring"></div>' +
      '<div class="bfx-turn-emblem">Ⅰ</div>' +
      '<div class="bfx-turn-title"></div>' +
      '<div class="bfx-turn-sub"></div>';
    (wrap || document.body).appendChild(turnEl);
    turnTitleEl = turnEl.querySelector(".bfx-turn-title");
    turnSubEl = turnEl.querySelector(".bfx-turn-sub");
    turnEmblemEl = turnEl.querySelector(".bfx-turn-emblem");
  }

  /* o: { player, extra, title, sub } */
  function turnTransition(o) {
    o = o || {};
    const player = o.player === 2 ? 2 : 1;
    const extra = !!o.extra;
    const c = extra ? "#fbbf24" : (player === 1 ? "#60a5fa" : "#f87171");

    if (opts.enabled && W && H) {
      // 阶段 B：能量带从离开方扫向接任方
      push({ kind: "sweep", x: player === 1 ? W + 60 : -60, y: 0, x2: player === 1 ? -60 : W + 60, y2: 0, color: c, width: 170, dur: dur(620), alpha: 0.5 });
      // 阶段 C：接任方半场亮起
      push({ kind: "sideGlow", side: player, color: c, dur: dur(900), delay: dur(120), alpha: extra ? 0.30 : 0.20 });
      push({ kind: "ring", x: W / 2, y: H / 2, r0: 14, r1: geo.cell * 2.2, color: c, width: 2.6, dur: dur(760), delay: dur(200), alpha: 0.75 });
      spawn(W / 2, H / 2, extra ? 30 : 18, { color: c, speed: extra ? 2.8 : 2.1, life: 620, size: 2.1, delay: 180 });
      if (extra) {
        push({ kind: "ring", x: W / 2, y: H / 2, r0: geo.cell * 0.4, r1: geo.cell * 2.8, color: "#fde68a", width: 3, dur: dur(900), delay: dur(260), alpha: 0.6 });
      }
    }

    // DOM 标题（挡不住棋盘：整体半透明、1.1s 自动淡出）
    ensureTurnEl();
    turnEl.className = "bfx-turn" + (player === 1 ? " p1" : " p2") + (extra ? " extra" : "");
    turnTitleEl.textContent = o.title || ("玩家 " + player + " 的回合");
    turnSubEl.textContent = o.sub || "";
    turnEmblemEl.textContent = extra ? "Ⅱ" : (player === 1 ? "Ⅰ" : "Ⅱ");
    void turnEl.offsetWidth;
    turnEl.classList.add("show");
    clearTimeout(turnTimer);
    turnTimer = setTimeout(() => turnEl.classList.remove("show"), 1150);

    // 音效：收束 → 扫过 → 新回合（分段，不叠成一声巨响）
    if (window.SFX) {
      window.SFX.play("turnSweep", { dir: player === 1 ? -1 : 1 });
      setTimeout(() => { if (window.SFX) window.SFX.play(extra ? "extraTurn" : "turnStart", {}); }, 300);
    }
  }

  /* ---------------- 锦囊卡牌演出 ---------------- */
  const TZ_CAT = {
    assault: { cls: "cat-atk", tag: "攻击强化", line: "本回合伤害 +1" },
    revive: { cls: "cat-life", tag: "复活", line: "复活 · 恢复 3 点生命" },
    march: { cls: "cat-march", tag: "额外回合", line: "获得一个完整额外回合" },
    refresh: { cls: "cat-arcane", tag: "技能重整", line: "技能次数刷新至上限" },
    guard: { cls: "cat-guard", tag: "防御", line: "受到的伤害 -1" },
    heal: { cls: "cat-life", tag: "治疗", line: "恢复 2 点生命" },
  };
  let cardEl = null, cardTimer = 0, cardEnd = 0;
  function ensureCardEl() {
    if (cardEl) return;
    cardEl = document.createElement("div");
    cardEl.className = "bfx-tcard";
    cardEl.innerHTML =
      '<div class="bfx-tcard-trail"></div>' +
      '<div class="bfx-tcard-face">' +
      '<div class="bfx-tcard-sigil"></div>' +
      '<div class="bfx-tcard-name"></div>' +
      '<div class="bfx-tcard-line"></div>' +
      '<div class="bfx-tcard-tag"></div>' +
      '</div>';
    document.body.appendChild(cardEl);
  }

  /* o: { id, name, icon, target:{r,c} } */
  function talismanCast(o) {
    if (!o || !opts.enabled) return false;
    const id = o.id || "";
    const cat = TZ_CAT[id] || { cls: "cat-atk", tag: "锦囊" };
    ensureCardEl();
    clearTimeout(cardTimer);

    const startEl = document.getElementById("talisman-card");
    const sr = startEl ? startEl.getBoundingClientRect() : null;
    const sx = sr ? sr.left + sr.width / 2 : window.innerWidth * 0.15;
    const sy = sr ? sr.top + Math.min(70, sr.height / 2) : window.innerHeight * 0.35;

    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    if (canvas) {
      const cr = canvas.getBoundingClientRect();
      if (o.target && o.target.r != null && o.target.c != null) {
        tx = cr.left + px(o.target.c);
        ty = cr.top + py(o.target.r);
      } else {
        tx = cr.left + cr.width / 2;
        ty = cr.top + cr.height * 0.46;
      }
    }

    cardEl.className = "bfx-tcard " + cat.cls;
    cardEl.querySelector(".bfx-tcard-sigil").textContent = o.icon || "🎴";
    cardEl.querySelector(".bfx-tcard-name").textContent = o.name || "锦囊";
    cardEl.querySelector(".bfx-tcard-line").textContent = cat.line || "";
    cardEl.querySelector(".bfx-tcard-tag").textContent = cat.tag;
    cardEl.style.left = sx + "px";
    cardEl.style.top = sy + "px";
    cardEl.style.setProperty("--dx", (tx - sx) + "px");
    cardEl.style.setProperty("--dy", (ty - sy) + "px");
    void cardEl.offsetWidth;
    cardEl.classList.add("fly");

    // 到达瞬间：卡牌放大 + 对应锦囊的战场效果
    cardTimer = setTimeout(() => {
      cardEl.classList.add("impact");
      const at = o.target && o.target.r != null ? { r: o.target.r, c: o.target.c } : null;
      const rr = at ? at.r : 2.5, cc = at ? at.c : 2.5;
      talismanEffect(id, rr, cc);
      if (window.SFX && window.SFX.playTalisman) window.SFX.playTalisman(id, {});
      cardTimer = setTimeout(() => {
        cardEl.classList.add("out");
        cardTimer = setTimeout(() => { cardEl.className = "bfx-tcard"; }, 340);
      }, 380);
    }, 460);
    return true;
  }

  /* 锦囊效果展开（战场层） */
  function talismanEffect(id, r, c) {
    if (!opts.enabled) return;
    const x = px(c), y = py(r);
    const big = geo.cell;
    switch (id) {
      case "assault": {
        for (let i = 0; i < 3; i++) push({ kind: "ring", x, y, r0: 8, r1: big * (1.1 + i * 0.55), color: "#f97316", width: 3, dur: dur(600), delay: dur(i * 70), alpha: 0.8 });
        push({ kind: "slash", x, y, angle: -0.62, len: big * 2.2, width: 4, color: "#fbbf24", dur: dur(460) });
        push({ kind: "slash", x, y, angle: 0.72, len: big * 1.9, width: 3, color: "#ef4444", dur: dur(500), delay: dur(60) });
        spawn(x, y, 30, { color: "#fbbf24", speed: 3.2, life: 620, size: 2.2, angle: -Math.PI / 2, spread: 2.6 });
        push({ kind: "text", x, y: y - big * 0.7, text: "伤害 +1", color: "#fbbf24", size: 16, dur: dur(1000), rise: 26 });
        addMark("impact", r, c, "#f97316", 11000);
        break;
      }
      case "revive": {
        revive({ r, c });
        push({ kind: "ring", x, y, r0: big * 0.15, r1: big * 0.9, color: "#fde68a", width: 3, dur: dur(900), delay: dur(120), double: true });
        push({ kind: "beam", x, y: y - big * 1.4, x2: x, y2: y, color: "#fef3c7", width: 12, dur: dur(900) });
        spawn(x, y + big * 0.3, 26, { color: "#fde68a", speed: 1.1, life: 900, size: 2, angle: -Math.PI / 2, spread: 0.8, grav: -0.03 });
        push({ kind: "text", x, y: y - big * 0.75, text: "还魂成功", color: "#fde68a", size: 15, dur: dur(1100), rise: 24 });
        break;
      }
      case "march": {
        // 战鼓震动 + 旗帜冲击波
                  push({ kind: "ring", x, y, r0: 10, r1: big * 3.2, color: "#fbbf24", width: 5, dur: dur(900), alpha: 0.75 });
          push({ kind: "ring", x, y, r0: big * 0.4, r1: big * 2.2, color: "#fde68a", width: 3, dur: dur(800), delay: dur(140) });
          push({ kind: "wave", x, y, r1: big * 2.4, color: "#f59e0b", dur: dur(900) });
          spawn(x, y, 34, { color: "#fbbf24", speed: 3.4, life: 760, size: 2.2 });
          push({ kind: "text", x, y: y - big * 0.8, text: "获得额外回合", color: "#fde68a", size: 16, dur: dur(1200), rise: 26 });
        addMark("impact", Math.max(0, Math.min(5, Math.round(r))), Math.max(0, Math.min(5, Math.round(c))), "#fbbf24", 12000);
        break;
      }
      case "refresh": {
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          push({ kind: "rune", x: x + Math.cos(ang) * big * 0.55, y: y + Math.sin(ang) * big * 0.45, r: big * 0.16, color: "#a78bfa", sides: 5, dur: dur(700), delay: dur(i * 50) });
        }
        push({ kind: "ring", x, y, r0: big * 0.5, r1: big * 0.18, color: "#c4b5fd", width: 3, dur: dur(700), double: true });
        spawn(x, y, 22, { color: "#c4b5fd", speed: 1.4, life: 760, size: 1.9, angle: -Math.PI / 2, spread: 0.7 });
        push({ kind: "text", x, y: y - big * 0.7, text: "技能已重整", color: "#c4b5fd", size: 15, dur: dur(1100), rise: 24 });
        addMark("space", r, c, "#a78bfa", 10000);
        break;
      }
      case "guard": {
        shieldFx({ r, c, amount: 0 });
        for (let i = 0; i < 3; i++) push({ kind: "ring", x, y, r0: big * 0.2, r1: big * (0.9 + i * 0.35), color: "#93c5fd", width: 3, dur: dur(800), delay: dur(i * 90), alpha: 0.7 });
        push({ kind: "rune", x, y, r: big * 0.62, color: "#bfdbfe", sides: 8, dur: dur(800) });
        push({ kind: "text", x, y: y - big * 0.72, text: "伤害 -1", color: "#93c5fd", size: 15, dur: dur(1100), rise: 24 });
        addMark("frost", r, c, "#93c5fd", 11000);
        break;
      }
      case "heal": {
        heal({ r, c, amount: 0 });
        push({ kind: "ring", x, y, r0: big * 0.55, r1: big * 0.18, color: "#4ade80", width: 3, dur: dur(760), double: true });
        spawn(x, y + big * 0.25, 24, { color: "#86efac", speed: 1.2, life: 820, size: 2, angle: -Math.PI / 2, spread: 0.9, grav: -0.02 });
        push({ kind: "text", x, y: y - big * 0.7, text: "恢复生命", color: "#86efac", size: 15, dur: dur(1000), rise: 24 });
        break;
      }
      default:
        push({ kind: "ring", x, y, r0: 10, r1: big * 1.4, color: "#fbbf24", width: 3, dur: dur(700) });
        break;
    }
  }

  /* ---------------- 胜负结算演出 ---------------- */
  let victoryEl = null, victoryMain = null, victorySub = null, victoryTimer = 0;

  function ensureVictoryEl() {
    if (victoryEl) return;
    victoryEl = document.createElement("div");
    victoryEl.className = "bfx-victory";
    victoryEl.innerHTML =
      '<div class="bfx-victory-scrim"></div>' +
      '<div class="bfx-victory-rays"></div>' +
      '<div class="bfx-victory-main"></div>' +
      '<div class="bfx-victory-sub"></div>';
    (wrap || document.body).appendChild(victoryEl);
    victoryMain = victoryEl.querySelector(".bfx-victory-main");
    victorySub = victoryEl.querySelector(".bfx-victory-sub");
  }

  /* 第二阶段：胜负氛围爆发（胜利方半场金爆 / 失败方压暗） */
  function victoryBurst(o) {
    o = o || {};
    const kind = o.kind || "win";
    const win = kind === "win";
    const draw = kind === "draw";
    const c = draw ? "#94a3b8" : (win ? "#fbbf24" : "#9f1239");
    if (!opts.enabled) return;
    // 整体压暗（短暂、克制）
    push({ kind: "flash", x: 0, y: 0, color: draw ? "#0f172a" : (win ? "#1a1205" : "#0b1020"), alpha: win ? 0.34 : 0.42, dur: dur(760) });
    // 从胜利方半场向外扩散
    const side = o.side === 2 ? 2 : 1;
    const cx = win ? (side === 1 ? W * 0.28 : W * 0.72) : (side === 1 ? W * 0.72 : W * 0.28);
    const cy = H * 0.5;
    for (let i = 0; i < 3; i++) {
      push({ kind: "ring", x: cx, y: cy, r0: 12, r1: geo.cell * (2.4 + i * 1.15), color: c, width: 4 - i, dur: dur(900), delay: dur(i * 120), alpha: win ? 0.85 : 0.55 });
    }
    spawn(cx, cy, win ? 42 : 18, { color: c, speed: win ? 3.4 : 1.6, life: 900, size: win ? 2.3 : 1.8 });
    if (win) {
      // 斜向流光
      for (let i = 0; i < 5; i++) {
        push({ kind: "slash", x: W * (0.12 + Math.random() * 0.76), y: H * (0.18 + Math.random() * 0.64), angle: Math.random() * Math.PI, len: geo.cell * 2.6, width: 2, color: "#fde68a", dur: dur(520), delay: dur(i * 85), alpha: 0.45 });
      }
      push({ kind: "text", x: cx, y: cy - geo.cell * 1.2, text: "VICTORY", color: "#fde68a", size: 20, dur: dur(1100), rise: 18 });
    }
    // 主角专属姿态
    if (o.heroId && o.cell) victoryHeroPose(o.heroId, o.cell, kind);
  }

  /* 每名英雄的胜利/失败姿态（纯程序化，复用既有粒子与光效原语） */
  function victoryHeroPose(heroId, cell, kind) {
    if (!opts.enabled) return;
    const x = px(cell.c), y = py(cell.r);
    const s = geo.cell;
    const win = kind !== "lose";
    if (!win) {
      // 失败方：压暗 + 下沉的灰烬，不伪造角色动作
      push({ kind: "ghost", x, y, r: s * 0.34, color: "#64748b", dur: dur(900) });
      push({ kind: "ring", x, y, r0: s * 0.5, r1: s * 0.12, color: "#64748b", width: 2, dur: dur(800) });
      spawn(x, y - s * 0.2, 14, { color: "#94a3b8", speed: 0.8, life: 900, size: 1.6, angle: Math.PI / 2, spread: 0.9, grav: 0.02 });
      return;
    }
    switch (heroId) {
      case "cang":
        for (let i = 0; i < 3; i++) push({ kind: "ring", x, y, r0: s * 0.2, r1: s * (0.8 + i * 0.35), color: "#38bdf8", width: 2, dur: dur(800), delay: dur(i * 90), alpha: 0.7 });
        push({ kind: "ribbon", x: x - s, y: y + s * 0.2, x2: x + s, y2: y - s * 0.2, color: "#7dd3fc", width: 4, bend: 16, dur: dur(900) });
        push({ kind: "ribbon", x: x - s, y: y - s * 0.2, x2: x + s, y2: y + s * 0.2, color: "#38bdf8", width: 3, bend: -14, dur: dur(950), delay: dur(80) });
        spawn(x, y + s * 0.3, 22, { color: "#7dd3fc", speed: 1.4, life: 900, size: 2, grav: 0.02 });
        break;
      case "asura":
        push({ kind: "swords", x, y, count: 3, r: s * 0.55, color: "#e2e8f0", dur: dur(900) });
        push({ kind: "slash", x, y, angle: -0.7, len: s * 1.5, width: 4, color: "#f8fafc", dur: dur(420) });
        push({ kind: "slash", x, y, angle: 0.8, len: s * 1.4, width: 3, color: "#cbd5e1", dur: dur(460), delay: dur(70) });
        spawn(x, y, 24, { type: "line", color: "#fff7ed", speed: 3.8, life: 500, size: 1.6, angle: -0.7, spread: 1.1 });
        break;
      case "longren":
        push({ kind: "rune", x, y, r: s * 0.55, color: "#fbbf24", sides: 6, dur: dur(900) });
        for (let i = 0; i < 2; i++) push({ kind: "ring", x, y, r0: s * 0.3, r1: s * (1.0 + i * 0.4), color: "#f59e0b", width: 3, dur: dur(850), delay: dur(i * 120), alpha: 0.7 });
        spawn(x, y, 26, { color: "#fbbf24", speed: 1.8, life: 900, size: 2.1, angle: -Math.PI / 2, spread: 1.8, grav: -0.01 });
        break;
      case "thunder":
        push({ kind: "bolt", x, y: y - s * 1.4, x2: x, y2: y, color: "#facc15", width: 5, dur: dur(360) });
        push({ kind: "bolt", x: x - s * 0.8, y: y - s, x2: x, y2: y, color: "#a78bfa", width: 3, dur: dur(420), delay: dur(90) });
        push({ kind: "crack", x, y, r: s * 0.6, color: "#a78bfa", dur: dur(700), n: 7 });
        push({ kind: "ring", x, y, r0: s * 0.4, r1: s * 1.3, color: "#facc15", width: 3, dur: dur(650), delay: dur(120) });
        spawn(x, y, 24, { color: "#fde047", speed: 3, life: 650, size: 2 });
        break;
      case "lone":
        push({ kind: "ring", x, y, r0: s * 0.3, r1: s * 1.6, color: "#facc15", width: 5, dur: dur(780), alpha: 0.8 });
        push({ kind: "wave", x, y, r1: s * 1.5, color: "#eab308", dur: dur(780) });
        push({ kind: "rune", x, y, r: s * 0.5, color: "#fde68a", sides: 4, dur: dur(800) });
        spawn(x, y, 24, { color: "#facc15", speed: 2.4, life: 750, size: 2 });
        break;
      case "guardian":
        push({ kind: "rune", x, y, r: s * 0.62, color: "#fbbf24", sides: 6, dur: dur(900) });
        push({ kind: "ring", x, y, r0: s * 0.2, r1: s * 1.1, color: "#fde68a", width: 3, dur: dur(820), double: true });
        spawn(x, y, 20, { color: "#fde68a", speed: 1.6, life: 800, size: 1.9 });
        break;
      case "knight":
        push({ kind: "rune", x, y, r: s * 0.5, color: "#fde68a", sides: 6, dur: dur(800) });
        push({ kind: "ring", x, y, r0: s * 0.5, r1: s * 0.16, color: "#fde68a", width: 3, dur: dur(700) });
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          spawn(x + Math.cos(ang) * s * 0.4, y + Math.sin(ang) * s * 0.4, 1, { type: "line", color: "#fff7ed", speed: 2.4, life: 480, size: 1.4, angle: ang, spread: 0.2 });
        }
        break;
      case "cleric":
        push({ kind: "ring", x, y, r0: s * 0.55, r1: s * 0.16, color: "#86efac", width: 2.5, dur: dur(900) });
        push({ kind: "rune", x, y, r: s * 0.45, color: "#fde68a", sides: 4, dur: dur(900) });
        spawn(x, y + s * 0.25, 26, { color: "#bbf7d0", speed: 1.1, life: 950, size: 2, angle: -Math.PI / 2, spread: 0.8, grav: -0.02 });
        break;
      case "assassin":
        push({ kind: "portal", x, y, r: s * 0.3, color: "#22d3ee", dur: dur(500) });
        push({ kind: "slash", x, y, angle: 0.4, len: s * 1.3, width: 3, color: "#67e8f9", dur: dur(360), delay: dur(220) });
        push({ kind: "ghost", x: x - s * 0.4, y, r: s * 0.26, color: "#22d3ee", dur: dur(500), delay: dur(180) });
        spawn(x, y, 18, { color: "#67e8f9", speed: 2.6, life: 600, size: 1.8 });
        break;
      case "vampire":
        push({ kind: "wave", x, y, r1: s * 1.5, color: "#e11d48", dur: dur(800) });
        push({ kind: "ring", x, y, r0: s * 0.2, r1: s * 1.2, color: "#be123c", width: 3, dur: dur(800), double: true });
        spawn(x, y, 26, { color: "#e11d48", speed: 2.2, life: 850, size: 2.1, grav: 0.03 });
        break;
      case "jade":
        for (let i = 0; i < 3; i++) push({ kind: "ring", x, y, r0: s * 0.2, r1: s * (0.8 + i * 0.3), color: i % 2 ? "#a78bfa" : "#fbbf24", width: 2.5, dur: dur(850), delay: dur(i * 100), alpha: 0.8 });
        push({ kind: "rune", x, y, r: s * 0.55, color: "#e9d5ff", sides: 8, dur: dur(900) });
        spawn(x, y, 22, { color: "#fde68a", speed: 1.8, life: 850, size: 2 });
        break;
      case "xiangyu":
        push({ kind: "ring", x, y, r0: s * 0.3, r1: s * 1.8, color: "#f87171", width: 6, dur: dur(800), alpha: 0.85 });
        push({ kind: "wave", x, y, r1: s * 1.7, color: "#dc2626", dur: dur(800) });
        push({ kind: "text", x, y: y - s * 0.8, text: "力拔山兮", color: "#fde68a", size: 14, dur: dur(1000), rise: 20 });
        spawn(x, y, 28, { color: "#fbbf24", speed: 2.8, life: 800, size: 2.3, grav: 0.02 });
        break;
      case "tiandao":
        for (let i = 0; i < 3; i++) push({ kind: "ring", x, y, r0: s * (0.4 + i * 0.3), r1: s * (1.4 + i * 0.4), color: "#c084fc", width: 2.5, dur: dur(900), delay: dur(i * 90), alpha: 0.7 });
        push({ kind: "crack", x, y, r: s * 0.7, color: "#c084fc", dur: dur(700), n: 8 });
        spawn(x, y, 24, { color: "#e9d5ff", speed: 2.2, life: 800, size: 2 });
        break;
      case "huamulan":
        push({ kind: "slash", x, y, angle: -0.55, len: s * 1.6, width: 6, color: "#fde68a", dur: dur(420) });
        push({ kind: "slash", x, y, angle: 0.65, len: s * 1.4, width: 4, color: "#f43f5e", dur: dur(460), delay: dur(60) });
        push({ kind: "ring", x, y, r0: s * 0.3, r1: s * 1.5, color: "#fbbf24", width: 5, dur: dur(760), delay: dur(80) });
        push({ kind: "wave", x, y, r1: s * 1.5, color: "#f43f5e", dur: dur(760), delay: dur(80) });
        spawn(x, y, 26, { color: "#fbbf24", speed: 3, life: 750, size: 2.2 });
        break;
      case "berserker":
        push({ kind: "wave", x, y, r1: s * 1.5, color: "#f97316", dur: dur(760) });
        push({ kind: "ring", x, y, r0: s * 0.3, r1: s * 1.4, color: "#fb923c", width: 4, dur: dur(760) });
        spawn(x, y, 26, { color: "#fdba74", speed: 2.8, life: 750, size: 2.2 });
        break;
      case "mage":
      case "warlock":
        push({ kind: "rune", x, y, r: s * 0.5, color: "#a5f3fc", sides: 6, dur: dur(900) });
        push({ kind: "ring", x, y, r0: s * 0.2, r1: s * 1.2, color: "#67e8f9", width: 2.5, dur: dur(820), double: true });
        spawn(x, y, 22, { color: "#a5f3fc", speed: 1.6, life: 850, size: 1.9 });
        break;
      case "ranger":
        push({ kind: "line", x: x - s, y: y - s, x2: x + s, y2: y + s, color: "#34d399", width: 3, dur: dur(520) });
        push({ kind: "ring", x, y, r0: s * 0.2, r1: s * 0.9, color: "#6ee7b7", width: 2.5, dur: dur(760) });
        spawn(x, y, 18, { color: "#6ee7b7", speed: 2.2, life: 700, size: 1.8 });
        break;
      default:
        push({ kind: "ring", x, y, r0: s * 0.3, r1: s * 1.3, color: "#fbbf24", width: 3, dur: dur(800) });
        push({ kind: "rune", x, y, r: s * 0.45, color: "#fde68a", sides: 6, dur: dur(850) });
        spawn(x, y, 20, { color: "#fde68a", speed: 2, life: 800, size: 2 });
        break;
    }
  }

  /* 第三阶段：胜负标题 */
  function victoryTitle(o) {
    o = o || {};
    const kind = o.kind || "win";
    ensureVictoryEl();
    victoryEl.className = "bfx-victory " + kind;
    victoryMain.textContent = o.title || (kind === "win" ? "胜利！" : kind === "draw" ? "平局" : "失败");
    victorySub.textContent = o.sub || "";
    void victoryEl.offsetWidth;
    victoryEl.classList.add("show");
    clearTimeout(victoryTimer);
    victoryTimer = setTimeout(() => victoryEl.classList.remove("show"), kind === "win" ? 2000 : 1600);
  }
  function victoryHide() {
    clearTimeout(victoryTimer);
    if (victoryEl) victoryEl.classList.remove("show");
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
    clearTimeout(turnTimer);
    if (turnEl) turnEl.classList.remove("show");
    clearTimeout(cardTimer);
    if (cardEl) cardEl.className = "bfx-tcard";
    victoryHide();
  }

  window.BFX = {
    init, sync, setOptions, clear, banner, attack, hit, shieldAbsorb: shieldAbsorb,
    dodge, immune, death, move, knockback, grab, heal, shield: shieldFx, revive,
    swordSpawn, cast, drain, mark: addMark, shake, flash, hitstop, heroColor,
    turnTransition, talismanCast, talismanEffect, pillars, mist,
    victoryBurst, victoryTitle, victoryHeroPose, victoryHide,
    setOccupancy(fn) { occupancyFn = fn || null; },
    setTargeting(v) { targeting = !!v; },
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
