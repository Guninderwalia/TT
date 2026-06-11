/**
 * Web Server - Exposes IPC handlers as HTTP endpoints
 *
 * This allows the React web version to communicate with the same backend
 * as the Electron app, sharing the same database.
 *
 * Usage:
 *   const { wrapIpcMain, startServer } = require('./webServer');
 *   const wrappedIpcMain = wrapIpcMain(ipcMain);
 *   // Register handlers normally using wrappedIpcMain
 *   startServer(3002);
 */

const express = require('express');
const cors = require('cors');

// Storage for all registered handlers
const registeredHandlers = new Map();

/**
 * Wraps ipcMain so that when handle() is called, the handler is also
 * exposed as an HTTP endpoint.
 */
function wrapIpcMain(ipcMain) {
  const originalHandle = ipcMain.handle.bind(ipcMain);

  // Create a proxy that intercepts handle() calls
  const wrapped = new Proxy(ipcMain, {
    get(target, prop) {
      if (prop === 'handle') {
        return function (channel, handler) {
          // Store handler for HTTP bridge
          registeredHandlers.set(channel, handler);
          // Register normally with ipcMain
          return originalHandle(channel, handler);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  return wrapped;
}

/**
 * Monkey-patches ipcMain.handle so all handle() calls (including those
 * in nested handler files) automatically register HTTP endpoints too.
 *
 * Also gracefully handles duplicate channel registrations by replacing
 * the older handler instead of throwing - this fixes pre-existing
 * registration conflicts (e.g., handlers defined inline in main.js AND
 * in dedicated handler files).
 *
 * Call this ONCE at the top of main.js before any handlers register.
 */
function patchIpcMain(ipcMain) {
  if (ipcMain.__webServerPatched) return ipcMain;

  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalRemoveHandler = ipcMain.removeHandler
    ? ipcMain.removeHandler.bind(ipcMain)
    : null;

  ipcMain.handle = function (channel, handler) {
    // If this channel is already registered, remove it first to avoid
    // "Attempted to register a second handler" errors.
    if (registeredHandlers.has(channel) && originalRemoveHandler) {
      try {
        originalRemoveHandler(channel);
      } catch (e) {
        // Ignore - some Electron versions throw if not registered
      }
    }
    registeredHandlers.set(channel, handler);
    return originalHandle(channel, handler);
  };

  ipcMain.__webServerPatched = true;
  console.log('[WEB-SERVER] ✓ ipcMain patched - handlers will auto-register HTTP endpoints');
  return ipcMain;
}

/**
 * Starts the Express server that exposes the registered handlers
 * as HTTP POST endpoints.
 */
// v5.2 — Resolve the authenticated caller for an HTTP request.
// A valid, non-revoked session token (x-session-token) wins and yields the
// authoritative user_id from user_sessions. If no token is present, or it
// can't be validated, we fall back to the x-user-id header so existing
// sessions and the login request itself are never locked out.
async function resolveCallerId(req) {
  const headerId = req.headers['x-user-id'] || null;
  const token = req.headers['x-session-token'] || null;
  const db = global.__db;
  if (token && db) {
    try {
      const row = await db.get(
        `SELECT user_id FROM user_sessions WHERE token = ? AND revoked_at IS NULL`,
        [token]
      );
      if (row && row.user_id) {
        // Best-effort liveness stamp; never block the request on it.
        Promise.resolve(
          db.run(`UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?`, [token])
        ).catch(() => {});
        return row.user_id;
      }
    } catch (_) { /* fall through to header */ }
  }
  return headerId;
}

function startServer(port = 3002) {
  const app = express();
  const path = require('path');
  const fs = require('fs');

  // Enable CORS for the React dev server (port 3001) and any web client
  app.use(cors({
    origin: true,
    credentials: true
  }));

  app.use(express.json({ limit: '50mb' }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      handlersRegistered: registeredHandlers.size,
      channels: Array.from(registeredHandlers.keys())
    });
  });

  // ----------------------------------------------------------------------
  // Real-time chat — Server-Sent Events
  //
  // The client opens an EventSource at /api/chat/stream?userId=<uuid> and
  // keeps it open. The chat handlers push events here when a new message
  // arrives. SSE is intentionally one-way (server → client) — outgoing
  // messages still go through POST /api/invoke with chat:sendMessage,
  // which broadcasts the result over the SSE stream.
  // ----------------------------------------------------------------------
  app.get('/api/chat/stream', (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
      res.status(400).end('userId is required');
      return;
    }
    const chatHandlers = global.__chatHandlers;
    if (!chatHandlers) {
      res.status(503).end('chat handlers not ready');
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ userId })}\n\n`);
    chatHandlers.addSubscriber(userId, res);
    const heartbeat = setInterval(() => {
      try { res.write(`event: ping\ndata: {}\n\n`); }
      catch (_) { /* dead socket */ }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      chatHandlers.removeSubscriber(userId, res);
    });
  });

  // Serve the React production build as the web version (if it exists).
  // This lets users on the same network browse to http://<host>:3002/ and
  // get the full app without needing the Electron desktop binary.
  // Look in multiple locations: dev (project root), packaged (resources)
  const buildCandidates = [
    path.join(__dirname, '..', '..', 'build'),
    path.join(process.resourcesPath || '', 'build'),
    path.join(process.cwd(), 'build')
  ];
  const buildDir = buildCandidates.find(p => p && fs.existsSync(path.join(p, 'index.html')));
  if (buildDir) {
    console.log('[WEB-SERVER] ✓ Serving web UI from', buildDir);
    app.use(express.static(buildDir));
    // SPA fallback - serve index.html for any unmatched non-API GET routes
    app.get(/^(?!\/api|\/health).*$/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(buildDir, 'index.html'));
    });
  } else {
    console.log('[WEB-SERVER] No build/ folder found - web UI not served');
  }

  // List all available handlers
  app.get('/api/channels', (req, res) => {
    const channels = Array.from(registeredHandlers.keys());
    res.json({ channels });
  });

  // Generic handler that dispatches based on the channel name
  app.post('/api/invoke', async (req, res) => {
    const { channel, args } = req.body;

    if (!channel) {
      return res.status(400).json({ success: false, message: 'Channel name required' });
    }

    const handler = registeredHandlers.get(channel);

    if (!handler) {
      console.warn(`[WEB-SERVER] Handler not found for channel: ${channel}`);
      return res.status(404).json({
        success: false,
        message: `Handler not found: ${channel}`
      });
    }

    try {
      // v5.2 — Resolve the caller's identity. Prefer a VALIDATED session token
      // (x-session-token) over the client-claimed x-user-id header, which can
      // be spoofed. When a valid token is present its user_id is authoritative;
      // otherwise we fall back to the header so existing logged-in clients (and
      // the very first auth:login request, which has no token yet) keep working.
      const resolvedId = await resolveCallerId(req);

      // Create a mock event object similar to what IPC provides
      const mockEvent = {
        sender: {
          id: resolvedId,
          send: () => {} // No-op for HTTP
        }
      };

      // Handle both array and object args formats
      // If args is an array, spread it; if it's an object, pass it directly
      let handlerArgs = args || {};
      if (Array.isArray(args) && args.length > 0) {
        handlerArgs = args[0];
      }

      // v4.6 — inject the requester's IP into auth:login so the user's session
      // list shows the actual login IP, not just the browser's UA. The frontend
      // shim already fills in userAgent.
      if (channel === 'auth:login' && handlerArgs && typeof handlerArgs === 'object') {
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                || req.ip
                || req.socket?.remoteAddress
                || null;
        handlerArgs.clientInfo = { ...(handlerArgs.clientInfo || {}), ip };
      }

      // v4.6.3 — for the session-management handlers, pass the requester's
      // User-Agent + IP onto the mock event so the handler can lazily create
      // a session row for users who logged in before the user_sessions table
      // existed (or before V4.6 deployed).
      if (channel.startsWith('auth:listMySessions')
       || channel.startsWith('auth:revokeAllOtherSessions')
       || channel.startsWith('auth:revokeSession')) {
        mockEvent.requestInfo = {
          userAgent: req.headers['user-agent'] || null,
          ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || req.ip || req.socket?.remoteAddress || null
        };
      }

      const result = await handler(mockEvent, handlerArgs);
      res.json(result);
    } catch (error) {
      console.error(`[WEB-SERVER] Error handling ${channel}:`, error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  });

  // Start the server.
  // Bind to 0.0.0.0 so other machines on the LAN can reach the API.
  // Express's default also binds to all interfaces, but being explicit makes
  // intent clear and avoids any IPv4/IPv6 dual-stack edge cases on Windows.
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[WEB-SERVER] ✓ HTTP API server listening on 0.0.0.0:${port}`);
      console.log(`[WEB-SERVER] ✓ ${registeredHandlers.size} handlers exposed via HTTP`);
      // Print every non-internal IPv4 address so the host knows what URL to
      // give to LAN users.
      try {
        const os = require('os');
        const nets = os.networkInterfaces();
        const urls = [`http://localhost:${port}`];
        for (const name of Object.keys(nets)) {
          for (const ni of nets[name] || []) {
            if (ni.family === 'IPv4' && !ni.internal) {
              urls.push(`http://${ni.address}:${port}`);
            }
          }
        }
        console.log('[WEB-SERVER] ✓ Reachable at:');
        urls.forEach(u => console.log(`    ${u}`));
      } catch (_) {}
      resolve(server);
    });

    server.on('error', (err) => {
      console.error('[WEB-SERVER] Failed to start:', err);
      reject(err);
    });
  });
}

module.exports = { wrapIpcMain, patchIpcMain, startServer, registeredHandlers };
