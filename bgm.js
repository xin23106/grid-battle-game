/* =========================================================================
 * bgm.js —— 原创背景音乐（用 Web Audio 实时合成，100% 原创、无版权风险）
 * -------------------------------------------------------------------------
 * 一段舒缓的中国风五声音阶循环，适合战棋 / 武侠氛围。
 * 不依赖任何外部音频文件；点游戏里的「🎵 音乐」按钮即可播放 / 停止。
 * 若游戏目录下放了 bgm.mp3，则优先播放该文件（见 game.js 的按钮逻辑）。
 * ========================================================================= */
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    window.BGM = null;
    return;
  }

  const BPM = 82;
  const STEP = 60 / BPM / 2; // 八分音符时长（秒）
  const MASTER = 0.14;

  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI 音高 -> Hz

  // D 小调五声音阶（宫商角徵羽）：D F G A C
  const LEAD = [
    62, -1, 65, -1, 67, -1, 69, -1,
    67, -1, 65, -1, 62, -1, -1, -1,
    62, -1, 65, -1, 69, -1, 72, -1,
    69, -1, 67, -1, 65, -1, 62, -1,
  ];
  const BASS = [38, 38, 41, 43, 45, 45, 41, 38]; // 每 4 个八分音符换一次根音

  let ctx = null;
  let master = null;
  let timer = null;
  let playing = false;
  let step = 0;
  let nextTime = 0;

  function ensure() {
    if (ctx) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
  }

  function voice(freq, time, dur, peak, type) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "triangle";
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function schedule(seqStep, time) {
    const i = ((seqStep % 32) + 32) % 32;
    if (i % 4 === 0) voice(hz(BASS[(i / 4) % BASS.length]), time, 1.0, 0.5, "sine");
    const note = LEAD[i];
    if (note > 0) voice(hz(note), time, 0.55, 0.22, "triangle");
    if (i === 0 || i === 16) {
      // 每半段一次柔和铺底和音
      voice(hz(50), time, 2.2, 0.06, "sine");
      voice(hz(57), time, 2.2, 0.05, "sine");
      voice(hz(62), time, 2.2, 0.05, "sine");
    }
  }

  function tick() {
    while (nextTime < ctx.currentTime + 0.3) {
      schedule(step, nextTime);
      step++;
      nextTime += STEP;
    }
  }

  window.BGM = {
    get playing() {
      return playing;
    },
    start() {
      ensure();
      if (ctx.state === "suspended") ctx.resume();
      if (playing) return;
      playing = true;
      step = 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(MASTER, ctx.currentTime);
      nextTime = ctx.currentTime + 0.08;
      tick();
      timer = setInterval(tick, 80);
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      timer = null;
      if (master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      }
    },
  };
})();
