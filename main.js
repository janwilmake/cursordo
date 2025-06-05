export class CursorDO {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map();
    this.cursors = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/websocket") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      await this.handleSession(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    const sessionId = crypto.randomUUID();
    const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;

    this.sessions.set(sessionId, { webSocket, color });

    webSocket.send(
      JSON.stringify({
        type: "init",
        sessionId,
        cursors: Object.fromEntries(this.cursors),
      }),
    );

    webSocket.addEventListener("message", (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "cursor") {
          this.cursors.set(sessionId, { x: data.x, y: data.y, color });
          this.broadcast(sessionId, {
            type: "cursor",
            sessionId,
            x: data.x,
            y: data.y,
            color,
          });
        }
      } catch (err) {
        console.error("Error:", err);
      }
    });

    webSocket.addEventListener("close", () => {
      this.sessions.delete(sessionId);
      this.cursors.delete(sessionId);
      this.broadcast(sessionId, { type: "leave", sessionId });
    });
  }

  broadcast(senderSessionId, message) {
    const messageStr = JSON.stringify(message);
    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId !== senderSessionId) {
        try {
          session.webSocket.send(messageStr);
        } catch (err) {
          this.sessions.delete(sessionId);
          this.cursors.delete(sessionId);
        }
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room") || "default";
      const roomObject = env.CURSOR.get(env.CURSOR.idFromName(roomId));
      const newUrl = new URL(url);
      newUrl.pathname = "/websocket";
      return roomObject.fetch(new Request(newUrl, request));
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_CONTENT, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

const HTML_CONTENT = `<!DOCTYPE html>
<html>
<head>
<title>Multiplayer Cursors</title>
<style>
body{margin:0;background:#111;cursor:none;overflow:hidden;font-family:Arial}
header{position:fixed;top:10px;left:10px;color:white;background:rgba(0,0,0,.7);padding:10px;border-radius:5px;z-index:100}
aside{position:fixed;bottom:10px;right:10px;color:white;background:rgba(0,0,0,.7);padding:10px;border-radius:5px;z-index:100;min-width:200px}
.cursor{position:absolute;width:20px;height:20px;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);z-index:1000;transition:all .1s ease}
.cursor::after{content:'';position:absolute;top:50%;left:50%;width:6px;height:6px;background:white;border-radius:50%;transform:translate(-50%,-50%)}
.session{margin:2px 0;font-size:12px}
</style>
</head>
<body>
<header id="status">Connecting...</header>
<aside id="sessions"></aside>

<script>
class CursorApp {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.cursors = new Map();
    this.allCursors = new Map(); // Include own cursor
    this.statusEl = document.getElementById('status');
    this.sessionsEl = document.getElementById('sessions');
    this.connect();
    this.setupEventListeners();
  }
  
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws?room=main';
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      this.statusEl.textContent = 'Connected';
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onclose = () => {
      this.statusEl.textContent = 'Disconnected. Reconnecting...';
      setTimeout(() => this.connect(), 1000);
    };
  }
  
  handleMessage(message) {
    switch (message.type) {
      case 'init':
        this.sessionId = message.sessionId;
        this.statusEl.textContent = 'Connected (ID: ' + this.sessionId.slice(0,6) + '...)';
        for (const [id, cursor] of Object.entries(message.cursors)) {
          this.updateCursor(id, cursor.x, cursor.y, cursor.color);
          this.allCursors.set(id, cursor);
        }
        this.updateSessionsList();
        break;
      case 'cursor':
        this.updateCursor(message.sessionId, message.x, message.y, message.color);
        this.allCursors.set(message.sessionId, {x: message.x, y: message.y, color: message.color});
        this.updateSessionsList();
        break;
      case 'leave':
        this.removeCursor(message.sessionId);
        this.allCursors.delete(message.sessionId);
        this.updateSessionsList();
        break;
    }
  }
  
  updateCursor(sessionId, x, y, color) {
    let cursorEl = this.cursors.get(sessionId);
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'cursor';
      cursorEl.style.backgroundColor = color;
      document.body.appendChild(cursorEl);
      this.cursors.set(sessionId, cursorEl);
    }
    cursorEl.style.left = x + 'px';
    cursorEl.style.top = y + 'px';
  }
  
  removeCursor(sessionId) {
    const cursorEl = this.cursors.get(sessionId);
    if (cursorEl) {
      document.body.removeChild(cursorEl);
      this.cursors.delete(sessionId);
    }
  }
  
  updateSessionsList() {
    this.sessionsEl.innerHTML = '<strong>Connected Sessions:</strong><br>';
    for (const [id, cursor] of this.allCursors.entries()) {
      const isMe = id === this.sessionId ? ' (you)' : '';
      this.sessionsEl.innerHTML += 
        '<div class="session" style="color:' + cursor.color + '">' + 
        id.slice(0,6) + isMe + ': ' + Math.round(cursor.x) + ',' + Math.round(cursor.y) + 
        '</div>';
    }
  }
  
  setupEventListeners() {
    let lastSendTime = 0;
    const throttleDelay = 50;
    
    const sendCursorPosition = (x, y) => {
      const now = Date.now();
      if (now - lastSendTime > throttleDelay && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'cursor', x, y }));
        // Update own cursor in local state
        if (this.sessionId) {
          const myColor = this.allCursors.get(this.sessionId)?.color || '#fff';
          this.allCursors.set(this.sessionId, {x, y, color: myColor});
          this.updateSessionsList();
        }
        lastSendTime = now;
      }
    };
    
    document.addEventListener('mousemove', (e) => {
      sendCursorPosition(e.clientX, e.clientY);
    });
    
    document.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      sendCursorPosition(touch.clientX, touch.clientY);
    });
  }
}

new CursorApp();
</script>
</body>
</html>`;
