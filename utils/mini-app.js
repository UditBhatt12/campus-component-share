// Uses Express 5 when node_modules is installed, with a seamless built-in Node HTTP fallback
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let express = null;
try {
  express = require('express');
} catch {
  express = null;
}

function compilePattern(pattern) {
  if (!pattern || pattern === '/') return { regex: /^\/?$/, keys: [], prefixRegex: /^/ };
  const keys = [];
  const clean = pattern.replace(/\/+$/, '');
  const regexStr = clean.replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  return {
    regex: new RegExp(`^${regexStr}\/?$`),
    prefixRegex: new RegExp(`^${regexStr}(?=\/|$)`),
    keys,
  };
}

function createFallbackRouter() {
  const stack = [];
  const router = {
    _isFallbackRouter: true,
    stack,
    use(arg1, ...rest) {
      if (typeof arg1 === 'string') {
        stack.push({ type: 'use', prefix: arg1, handlers: rest });
      } else {
        stack.push({ type: 'use', prefix: '', handlers: [arg1, ...rest] });
      }
    },
    get(p, ...h) { stack.push({ type: 'route', method: 'GET', path: p, handlers: h }); },
    post(p, ...h) { stack.push({ type: 'route', method: 'POST', path: p, handlers: h }); },
    put(p, ...h) { stack.push({ type: 'route', method: 'PUT', path: p, handlers: h }); },
    patch(p, ...h) { stack.push({ type: 'route', method: 'PATCH', path: p, handlers: h }); },
    delete(p, ...h) { stack.push({ type: 'route', method: 'DELETE', path: p, handlers: h }); },
  };
  return router;
}

function createRouter() {
  if (express) return express.Router();
  return createFallbackRouter();
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function createApp() {
  if (express) {
    const app = express();
    try { app.use(require('helmet')()); } catch { /* optional */ }
    try { app.use(require('cors')()); } catch { /* optional */ }
    app.use(express.json({ limit: '50kb' }));
    try {
      const rateLimit = require('express-rate-limit');
      app._authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
    } catch {
      app._authLimiter = (req, res, next) => next();
    }
    app.serveStatic = (dir) => app.use(express.static(dir));
    return app;
  }

  // Fallback HTTP application when node_modules is not installed
  const rootRouter = createFallbackRouter();
  let errorHandler = null;
  let staticDir = null;

  async function runHandlers(handlers, req, res) {
    for (const h of handlers) {
      if (res.writableEnded) return true;
      let nextCalled = false;
      let passedErr = null;
      const next = (err) => {
        nextCalled = true;
        passedErr = err;
      };
      await h(req, res, next);
      if (passedErr) throw passedErr;
      if (res.writableEnded) return true;
      if (!nextCalled) return true;
    }
    return false;
  }

  async function dispatch(router, currentPath, req, res) {
    for (const layer of router.stack) {
      if (res.writableEnded) return true;
      if (layer.type === 'use') {
        const prefix = layer.prefix || '';
        const { prefixRegex } = compilePattern(prefix);
        if (!prefix || prefixRegex.test(currentPath)) {
          const subPath = prefix ? currentPath.slice(prefix.length) || '/' : currentPath;
          for (const h of layer.handlers) {
            if (res.writableEnded) return true;
            if (h && h._isFallbackRouter) {
              const handled = await dispatch(h, subPath.startsWith('/') ? subPath : '/' + subPath, req, res);
              if (handled && res.writableEnded) return true;
            } else if (typeof h === 'function' && h.length === 4) {
              errorHandler = h;
            } else if (typeof h === 'function') {
              let nextCalled = false;
              let passedErr = null;
              await h(req, res, (err) => { nextCalled = true; passedErr = err; });
              if (passedErr) throw passedErr;
              if (res.writableEnded) return true;
            }
          }
        }
      } else if (layer.type === 'route') {
        if (layer.method !== req.method) continue;
        const { regex, keys } = compilePattern(layer.path);
        const m = regex.exec(currentPath);
        if (!m) continue;
        req.params = { ...req.params };
        keys.forEach((k, idx) => { req.params[k] = decodeURIComponent(m[idx + 1]); });
        await runHandlers(layer.handlers, req, res);
        return true;
      }
    }
    return false;
  }

  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, 'http://localhost');
    req.path = parsedUrl.pathname;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.params = {};

    let statusCode = 200;
    res.status = (code) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      if (!res.headersSent) {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(data));
    };

    try {
      // Parse JSON body if present
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 55000) {
            const err = new Error('Payload too large');
            err.status = 413;
            throw err;
          }
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (raw) {
          try {
            req.body = JSON.parse(raw);
          } catch {
            const err = new Error('Invalid JSON payload');
            err.type = 'entity.parse.failed';
            err.status = 400;
            throw err;
          }
        } else {
          req.body = {};
        }
      } else {
        req.body = {};
      }

      await dispatch(rootRouter, req.path, req, res);

      if (!res.writableEnded && staticDir && req.method === 'GET') {
        const rel = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
        const safePath = path.normalize(path.join(staticDir, rel));
        if (safePath.startsWith(staticDir) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
          const ext = path.extname(safePath).toLowerCase();
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
          res.end(fs.readFileSync(safePath));
          return;
        }
      }

      if (!res.writableEnded) {
        res.status(404).json({ error: 'Not found' });
      }
    } catch (err) {
      if (errorHandler) {
        errorHandler(err, req, res, () => {});
      } else {
        const st = err.status || 500;
        res.status(st).json({ error: st >= 500 ? 'Something went wrong' : err.message });
      }
    }
  };

  const app = {
    _authLimiter: (req, res, next) => next(),
    use: (...args) => rootRouter.use(...args),
    get: (...args) => rootRouter.get(...args),
    post: (...args) => rootRouter.post(...args),
    put: (...args) => rootRouter.put(...args),
    patch: (...args) => rootRouter.patch(...args),
    delete: (...args) => rootRouter.delete(...args),
    serveStatic: (dir) => { staticDir = dir; },
    listen(port, cb) {
      const srv = http.createServer(handler);
      return srv.listen(port, cb);
    },
  };
  return app;
}

module.exports = { createApp, createRouter };
