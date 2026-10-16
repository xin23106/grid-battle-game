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
let WebSocketServer;
try {
  ({ WebSocketServer } = require("ws"));
} catch (e) {
  console.error("缺少依赖 ws，请先在 server/ 目录执行：npm install");
  process.exit(1);
}
const { createState, applyAction } = require("./rules");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
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

// 显式绑定 0.0.0.0（IPv4 全部网卡）：
// 只写 { port } 时 Node 会绑到 `::`（IPv6 双栈），在部分 Windows 环境下
// IPv4 客户端（好友的浏览器）连不上本机的局域网 IP，只能走 localhost。
const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });
console.log("英雄战棋服务器已启动：ws://0.0.0.0:" + PORT + "（局域网/联机可用）");
console.log("本机自测：ws://localhost:" + PORT);

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.lastMsg = 0;
  ws.budget = 40;          // 限流令牌桶初始满额
  ws.lastRefill = Date.now();
  ws.room = null;
  ws.player = 0;

  // 告诉客户端本机可用的局域网地址（用于生成分享链接）
  send(ws, { type: "hello", addresses: lanAddresses(), port: PORT, webPort: 8765 });

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
      broadcast(room, { type: "joined", code: room.code, state: room.state, ready: room.ready, players: room.players.size });
      if (room.ready[1] && room.ready[2] && !room.started) {
        room.started = true;
        broadcast(room, { type: "start", state: room.state });
      }
      break;
    }
    case "action": {
      const room = rooms.get(ws.room);
      if (!room) return send(ws, { type: "error", message: "不在房间中" });
      if (!room.started) return send(ws, { type: "error", message: "对局尚未开始" });
      const res = applyAction(room.state, ws.player, msg.action || {});
      if (!res.ok) return send(ws, { type: "error", message: res.error || "非法行动" });
      room.state = res.state; // 服务器权威状态
      broadcast(room, { type: "state", state: room.state });
      break;
    }
    case "state?": {
      const room = rooms.get(ws.room);
      if (room) send(ws, { type: "state", state: room.state });
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
  send(ws, { type: "joined", code: room.code, player, state: room.state, ready: room.ready, players: room.players.size });
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
