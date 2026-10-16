/* =========================================================================
 * server/server.js —— 在线对战服务器（权威对局）
 * -------------------------------------------------------------------------
 * 运行：  cd server && npm install && npm start   （默认监听 3000 端口）
 * 作用：  创建/加入房间、准备、回合同步、以及【服务器端规则校验与执行】。
 *         服务器是对局规则的最终裁决者，客户端不能提交棋盘/伤害结果。
 *
 * 通信协议（JSON）：
 *   客户端 -> 服务器：
 *     { type:"create" }                     创建房间
 *     { type:"join", code }                 加入房间
 *     { type:"ready" }                      我准备好了
 *     { type:"action", action }             提交一个行动（服务器校验）
 *     { type:"state?" }                     主动请求当前状态（重连用）
 *   服务器 -> 客户端：
 *     { type:"joined", code, player, state, ready }
 *     { type:"peer", status:"joined"|"left" }
 *     { type:"start", state }               双方准备，开始对战
 *     { type:"state", state }               最新权威状态
 *     { type:"error", message }
 * ========================================================================= */
const path = require("path");
const os = require("os");
const http = require("http");
let WebSocketServer;
try {
  ({ WebSocketServer } = require("ws"));
} catch (e) {
  console.error("缺少依赖 ws，请先在 server/ 目录执行：npm install");
  process.exit(1);
}
const { createState, applyAction, SIZE, PER_PLAYER } = require("./rules");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
// 云平台（Render / Railway / Fly / Koyeb 等）会在环境里注入自己的标记；
// 此时“本机局域网地址”对客户端没有意义，hello 里就不再下发。
const IS_CLOUD = !!(process.env.RENDER || process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT ||
  process.env.KOYEB_APP_NAME || process.env.DEPLOY_ENV === "cloud");
const rooms = new Map(); // code -> room

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms.has(code));
  return code;
}
function send(ws, obj) {
  try { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (e) {}
}
function broadcast(room, obj) {
  for (const p of room.players.values()) send(p, obj);
}
/* 按接收者身份生成「可见状态」：隐藏对手的候选池 / 部署 / 锦囊（服务端隔离，前端拿不到隐藏数据） */
function publicStateFor(state, player) {
  const s = JSON.parse(JSON.stringify(state)); // 深拷贝，绝不改动权威状态
  const me = player === 1 ? 1 : 2;
  const opp = me === 1 ? 2 : 1;
  if (!player) { // 尚未入座的连接：不下发任何私密信息
    s.pools = { 1: null, 2: null };
    s.talisman = { 1: null, 2: null };
    s.talismanUsed = { 1: false, 2: false };
    return s;
  }
  // 1) 候选英雄池：只下发本人的
  s.pools = { 1: null, 2: null };
  s.pools[me] = state.pools && state.pools[me] ? state.pools[me].slice() : null;
  // 2) 锦囊：只下发本人的（对手的既不知道名称也不知道是否已用）
  s.talisman = { 1: null, 2: null };
  s.talisman[me] = state.talisman ? state.talisman[me] : null;
  s.talismanUsed = { 1: false, 2: false };
  s.talismanUsed[me] = !!(state.talismanUsed && state.talismanUsed[me]);
  // 3) 布阵阶段：对手的半场（英雄与位置）全部不可见
  if (state.phase === "placement") {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const u = s.board[r][c];
        if (u && !u.sword && u.player === opp) s.board[r][c] = null;
      }
    }
    s.placed = { 1: [], 2: [] };
    s.placed[me] = state.placed && state.placed[me] ? state.placed[me].slice() : [];
  }
  // 4) 双方部署完成状态（仅“是否完成”，不泄露选择）
  s.placementDone = { 1: false, 2: false };
  if (state.placed) {
    s.placementDone[1] = state.placed[1].length >= PER_PLAYER;
    s.placementDone[2] = state.placed[2].length >= PER_PLAYER;
  }
  return s;
}
/* 给房间内每位玩家分别发送“按身份过滤”的消息 */
function sendEach(room, make) {
  for (const [p, ws] of room.players) send(ws, make(p));
}
function publicRoom(room) {
  return {
    players: room.players.size,
    ready: { 1: room.ready[1], 2: room.ready[2] },
  };
}
/* 本机的局域网 IPv4 地址（供前端生成可分享的链接）
 * 排序：优先常见内网段（192.168 / 10 / 172.16-31），VPN 等其它地址靠后 */
function lanAddresses() {
  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return 2;
    return 3;
  };
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  out.sort((a, b) => score(a) - score(b));
  return out;
}

// 用一层 HTTP 服务器承载 WebSocket：
// - 云平台（Render / Railway / Fly 等）需要对 HTTP 端口做健康检查，纯 WS 服务器会判为不健康；
// - 顺便提供一个 /health 探针。
// 显式绑定 0.0.0.0（IPv4 全部网卡）：只写 { port } 时 Node 会绑到 `::`（IPv6 双栈），
// 在部分 Windows 环境下 IPv4 客户端（好友浏览器）连不上主机的局域网 IP，只能走 localhost。
const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/" || req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "grid-battle-game", rooms: rooms.size, uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("grid-battle-game websocket server");
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("英雄战棋服务器已启动：" + (IS_CLOUD ? "云端 " : "") + "0.0.0.0:" + PORT);
  if (!IS_CLOUD) console.log("本机自测：ws://localhost:" + PORT);
});

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.lastMsg = 0;
  ws.budget = 40;          // 限流令牌桶初始满额
  ws.lastRefill = Date.now();
  ws.room = null;
  ws.player = 0;

  // 告诉客户端可用地址（本机时用于生成分享链接；云端下发空数组，链接会自动改用网页域名）
  send(ws, { type: "hello", addresses: IS_CLOUD ? [] : lanAddresses(), port: PORT, webPort: 8765, cloud: IS_CLOUD });

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    // 令牌桶限流：允许突发（如 join 后立刻 ready），长期速率约 20 条/秒
    const now = Date.now();
    ws.budget = Math.min(40, (ws.budget || 0) + (now - (ws.lastRefill || now)) * 0.02);
    ws.lastRefill = now;
    if (ws.budget < 1) return; // 超出限制，丢弃
    ws.budget -= 1;

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    handle(ws, msg);
  });

  ws.on("close", () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    room.players.delete(ws.player);
    broadcast(room, { type: "peer", status: "left" });
    if (room.players.size === 0) rooms.delete(ws.room);
  });
});

function handle(ws, msg) {
  switch (msg.type) {
    case "create": {
      if (ws.room) return send(ws, { type: "error", message: "你已经在房间中" });
      const code = makeCode();
      const room = { code, players: new Map(), state: createState(), ready: { 1: false, 2: false }, started: false };
      rooms.set(code, room);
      joinRoom(ws, room);
      break;
    }
    case "join": {
      const code = (msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: "error", message: "房间不存在" });
      if (room.players.size >= 2) return send(ws, { type: "error", message: "房间已满" });
      if (room.started) return send(ws, { type: "error", message: "对局已经开始" });
      joinRoom(ws, room);
      break;
    }
    case "ready": {
      const room = rooms.get(ws.room);
      if (!room) return send(ws, { type: "error", message: "不在房间中" });
      room.ready[ws.player] = true;
      sendEach(room, (p) => ({ type: "joined", code: room.code, player: p, state: publicStateFor(room.state, p), ready: room.ready, players: room.players.size }));
      if (room.ready[1] && room.ready[2] && !room.started) {
        room.started = true;
        sendEach(room, (p) => ({ type: "start", state: publicStateFor(room.state, p) }));
      }
      break;
    }
    case "action": {
      const room = rooms.get(ws.room);
      if (!room) return send(ws, { type: "error", message: "不在房间中" });
      if (!room.started) return send(ws, { type: "error", message: "对局尚未开始" });
      const talBefore = !!(room.state.talismanUsed && room.state.talismanUsed[ws.player]);
      const res = applyAction(room.state, ws.player, msg.action || {});
      if (!res.ok) return send(ws, { type: "error", message: res.error || "非法行动" });
      room.state = res.state; // 服务器权威状态
      sendEach(room, (p) => ({ type: "state", state: publicStateFor(room.state, p) }));
      // 锦囊使用：只通知对手“用了一张锦囊”，不泄露具体名称
      const talAfter = !!(room.state.talismanUsed && room.state.talismanUsed[ws.player]);
      if (!talBefore && talAfter) {
        const ows = room.players.get(ws.player === 1 ? 2 : 1);
        if (ows) send(ows, { type: "notice", message: "对手使用了一张锦囊" });
      }
      break;
    }
    case "state?": {
      const room = rooms.get(ws.room);
      if (room) send(ws, { type: "state", state: publicStateFor(room.state, ws.player) });
      break;
    }
    default:
      break;
  }
}

function joinRoom(ws, room) {
  const player = room.players.has(1) ? 2 : 1;
  ws.room = room.code;
  ws.player = player;
  room.players.set(player, ws);
  send(ws, { type: "joined", code: room.code, player, state: publicStateFor(room.state, player), ready: room.ready, players: room.players.size });
  broadcast(room, { type: "peer", status: "joined", players: room.players.size });
}

// 心跳，清理死连接
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);
