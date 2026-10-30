/* =========================================================================
 * net.js —— 在线对战客户端（WebSocket）
 * -------------------------------------------------------------------------
 * 连接 server/server.js（默认同主机 3000 端口）。
 * 服务器是权威：客户端只提交行动请求，收到 {type:"state"} 后整体替换本地棋盘。
 * 若未启动服务器，则 NET.available=false，在线模式会提示未连接（不影响单机/AI）。
 * ========================================================================= */
(function () {
  const KEY = "herochess.net.url";
  // 【可选】公网站点（如 GitHub Pages）上「在线真人对战」的默认服务器。
  // 留空 = 用「当前页面主机名:3000」；填入 wss://… 后，部署在公网的页面会自动连接它。
  // 注意：cloudflared 临时隧道地址每次重启都会变；变了改这一行（或直接在游戏里手填服务器地址）。
  const CLOUD_SERVER = "wss://wyoming-fit-context-drove.trycloudflare.com";
  function defaultUrl() {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname || "");
    // 只有「HTTPS 公网页面」才使用独立的云隧道服务器；
    // HTTP 页面（localhost / 局域网 IP）直接用同主机的 3000 端口，保证局域网联机始终可用。
    if (CLOUD_SERVER && !isLocal && location.protocol === "https:") return normalizeUrl(CLOUD_SERVER);
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + (location.hostname || "localhost") + ":3000";
  }
  /* 规范化服务器地址：
   * - 允许填 https://… / http://…，自动换算成 wss://… / ws://…
   * - HTTPS 页面下必须用 wss://（浏览器会拦截 ws:// 混合内容），自动升级 */
  function normalizeUrl(u) {
    let s = (u || "").trim();
    if (!s) return "";
    if (/^https:\/\//i.test(s)) s = "wss://" + s.slice(8);
    else if (/^http:\/\//i.test(s)) s = "ws://" + s.slice(7);
    if (location.protocol === "https:" && /^ws:\/\//i.test(s)) s = "wss://" + s.slice(5);
    return s;
  }
  let SERVER_URL = "";
  try { SERVER_URL = localStorage.getItem(KEY) || ""; } catch (e) {}
  // 兼容修正：忽略早期版本存错的「本页主机:3000」地址（那并不是真正的联机服务器），改用默认值
  if (SERVER_URL) {
    try {
      const u = new URL(SERVER_URL);
      if (u.hostname === location.hostname && /:3000\/?$/.test(SERVER_URL)) SERVER_URL = "";
    } catch (e) {}
  }
  if (!SERVER_URL) SERVER_URL = defaultUrl();

  const NET = {
    available: false,
    connected: false,
    code: null,
    myPlayer: 0,
    ready: { 1: false, 2: false },
    players: 0,
    addresses: [],          // 服务器报告的局域网地址
    _ws: null,
    _queue: [],

    get serverUrl() { return SERVER_URL; },
    defaultUrl,
    /* 设置服务器地址（留空恢复默认）；会保存并在重连后生效 */
    setUrl(u) {
      const val = normalizeUrl(u);
      SERVER_URL = val || defaultUrl();
      try { localStorage.setItem(KEY, val); } catch (e) {}
      this.available = false;
      this.connected = false;
      this.code = null;
      this.myPlayer = 0;
      if (this._ws) { try { this._ws.close(); } catch (e) {} }
      this._ws = null;
      notifyStatus();
      this.connect();
      return SERVER_URL;
    },

    connect() {
      if (this._ws) return;
      try {
        const ws = new WebSocket(SERVER_URL);
        this._ws = ws;
        // 用守卫避免旧 socket 的回调干扰新连接的状态
        ws.onopen = () => { if (this._ws !== ws) return; this.connected = true; this.available = true; notifyStatus(); };
        ws.onclose = () => { if (this._ws !== ws) return; this.connected = false; this.available = false; this._ws = null; notifyStatus(); };
        ws.onerror = () => { if (this._ws !== ws) return; this.connected = false; this.available = false; };
        ws.onmessage = (ev) => {
          if (this._ws !== ws) return;
          let msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          this._onMessage(msg);
        };
      } catch (e) {
        this.available = false;
      }
    },
    createRoom() { this._send({ type: "create" }); },
    joinRoom(code) { this._send({ type: "join", code }); },
    markReady() { this._send({ type: "ready" }); },
    sendAction(action) { this._send({ type: "action", action }); },
    requestState() { this._send({ type: "state?" }); },

    _send(obj) {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) this._ws.send(JSON.stringify(obj));
      else { this._queue.push(obj); this.connect(); }
    },
    _flush() {
      const q = this._queue.slice();
      this._queue.length = 0;
      q.forEach((o) => this._send(o));
    },
    _onMessage(msg) {
      if (msg.type === "hello") {
        this.addresses = msg.addresses || [];
        notifyStatus();
      } else if (msg.type === "joined") {
        this.code = msg.code;
        if (msg.player) this.myPlayer = msg.player; // 仅在服务端明确下发时更新，避免被广播消息清空
        this.ready = msg.ready || { 1: false, 2: false };
        this.players = msg.players || 1;
        if (window.onNetJoined) window.onNetJoined(); // 新房间/重连：重置日志去重游标，随后由 onNetState 按权威状态重建
        if (window.onNetState && msg.state) window.onNetState(msg.state);
        notifyStatus();
      } else if (msg.type === "peer") {
        this.players = msg.players || this.players;
        notifyStatus();
      } else if (msg.type === "state") {
        if (window.onNetState) window.onNetState(msg.state);
      } else if (msg.type === "start") {
        if (window.onNetState) window.onNetState(msg.state);
        if (window.onNetStart) window.onNetStart();
      } else if (msg.type === "error") {
        if (window.onNetError) window.onNetError(msg.message);
      } else if (msg.type === "notice") {
        if (window.onNetNotice) window.onNetNotice(msg.message);
      }
    },
  };

  function notifyStatus() {
    if (window.onNetStatus) window.onNetStatus(NET);
  }

  // 页面加载后尝试连接（连不上也不影响离线游玩）
  NET.connect();
  window.NET = NET;
})();
