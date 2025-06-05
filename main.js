// main.js - Complete implementation with embedded frontend

// Durable Object class for cursor tracking
export class CursorDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.cursors = new Map(); // Store cursor positions
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/websocket") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      await this.handleSession(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async handleSession(webSocket) {
    webSocket.accept();

    const sessionId = crypto.randomUUID();
    const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;

    this.sessions.set(sessionId, { webSocket, color });

    // Send existing cursors to new client
    webSocket.send(
      JSON.stringify({
        type: "init",
        sessionId: sessionId,
        cursors: Object.fromEntries(this.cursors),
      }),
    );

    webSocket.addEventListener("message", (msg) => {
      try {
        const data = JSON.parse(msg.data);

        if (data.type === "cursor") {
          // Update cursor position in DO state
          this.cursors.set(sessionId, {
            x: data.x,
            y: data.y,
            color: color,
          });

          // Broadcast to all other clients
          this.broadcast(sessionId, {
            type: "cursor",
            sessionId: sessionId,
            x: data.x,
            y: data.y,
            color: color,
          });
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
    });

    webSocket.addEventListener("close", () => {
      this.sessions.delete(sessionId);
      this.cursors.delete(sessionId);

      // Notify others that this cursor is gone
      this.broadcast(sessionId, {
        type: "leave",
        sessionId: sessionId,
      });
    });
  }

  broadcast(senderSessionId, message) {
    const messageStr = JSON.stringify(message);

    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId !== senderSessionId) {
        try {
          session.webSocket.send(messageStr);
        } catch (err) {
          console.error(`Error sending to session ${sessionId}:`, err);
          this.sessions.delete(sessionId);
          this.cursors.delete(sessionId);
        }
      }
    }
  }
}

// Main worker
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // WebSocket endpoint
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room") || "default";
      const roomObject = env.CURSOR.get(env.CURSOR.idFromName(roomId));

      const newUrl = new URL(url);
      newUrl.pathname = "/websocket";

      return roomObject.fetch(new Request(newUrl, request));
    }

    // Serve the frontend
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_CONTENT, {
        headers: {
          "Content-Type": "text/html",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

// Embedded HTML frontend
const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <title>Multiplayer Cursors</title>
    <style>
        body {
            margin: 0;
            background: #111;
            cursor: none;
            overflow: hidden;
            font-family: Arial, sans-serif;
        }
        
        .cursor {
            position: absolute;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            pointer-events: none;
            transform: translate(-50%, -50%);
            z-index: 1000;
            transition: all 0.1s ease;
        }
        
        .cursor::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 6px;
            height: 6px;
            background: white;
            border-radius: 50%;
            transform: translate(-50%, -50%);
        }
        
        #status {
            position: fixed;
            top: 20px;
            left: 20px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 10px;
            border-radius: 5px;
            z-index: 100;
        }
        
        #info {
            position: fixed;
            bottom: 20px;
            left: 20px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 10px;
            border-radius: 5px;
            z-index: 100;
        }
    </style>
</head>
<body>
    <div id="status">Connecting...</div>
    <div id="info">Move your mouse to see your cursor. Others will see it too!</div>
    
    <script>
        class CursorApp {
            constructor() {
                this.ws = null;
                this.sessionId = null;
                this.cursors = new Map();
                this.myColor = null;
                this.reconnectAttempts = 0;
                this.maxReconnectAttempts = 5;
                
                this.statusEl = document.getElementById('status');
                
                this.connect();
                this.setupEventListeners();
            }
            
            connect() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = protocol + '//' + window.location.host + '/ws?room=main';
                
                this.ws = new WebSocket(wsUrl);
                
                this.ws.onopen = () => {
                    this.statusEl.textContent = 'Connected';
                    this.reconnectAttempts = 0;
                };
                
                this.ws.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                };
                
                this.ws.onclose = () => {
                    this.statusEl.textContent = 'Disconnected. Reconnecting...';
                    this.attemptReconnect();
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.statusEl.textContent = 'Connection error';
                };
            }
            
            attemptReconnect() {
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    const timeout = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
                    this.reconnectAttempts++;
                    
                    setTimeout(() => this.connect(), timeout);
                } else {
                    this.statusEl.textContent = 'Failed to reconnect. Please refresh.';
                }
            }
            
            handleMessage(message) {
                switch (message.type) {
                    case 'init':
                        this.sessionId = message.sessionId;
                        this.statusEl.textContent = 'Connected (ID: ' + this.sessionId.slice(0, 6) + '...)';
                        
                        // Add existing cursors
                        for (const [id, cursor] of Object.entries(message.cursors)) {
                            this.updateCursor(id, cursor.x, cursor.y, cursor.color);
                        }
                        break;
                        
                    case 'cursor':
                        if (message.sessionId !== this.sessionId) {
                            this.updateCursor(message.sessionId, message.x, message.y, message.color);
                        }
                        break;
                        
                    case 'leave':
                        this.removeCursor(message.sessionId);
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
            
            setupEventListeners() {
                let lastSendTime = 0;
                const throttleDelay = 50; // 50ms throttle
                
                const sendCursorPosition = (x, y) => {
                    const now = Date.now();
                    if (now - lastSendTime > throttleDelay && this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({
                            type: 'cursor',
                            x: x,
                            y: y
                        }));
                        lastSendTime = now;
                    }
                };
                
                // Mouse events
                document.addEventListener('mousemove', (e) => {
                    sendCursorPosition(e.clientX, e.clientY);
                });
                
                // Touch events for mobile
                document.addEventListener('touchmove', (e) => {
                    e.preventDefault();
                    const touch = e.touches[0];
                    sendCursorPosition(touch.clientX, touch.clientY);
                });
            }
        }
        
        // Start the app
        new CursorApp();
    </script>
</body>
</html>
`;
