/**
 * HTTP server for the Product Keywords view.
 *
 * Node's built-in http module. No framework, no build step, and one runtime
 * dependency in the whole project (`pg`).
 *
 * This module is deliberately thin: it turns a request into a path and a
 * query, hands them to route(), and writes back what it gets. All the
 * decisions live in router.js.
 *
 * Everything on screen comes from `ledsone`, the existing business database,
 * READ-ONLY. The connection is checked once at startup - reachable, correct
 * database, read-only transaction mode in force, and no write privileges held
 * - so a misconfigured deployment fails here, with something readable, rather
 * than on the first page somebody opens.
 *
 * Start with:  npm start        (or: node product-keywords/server.js)
 */

import { createServer } from 'node:http';

import { route, routeForm } from './router.js';
import { renderErrorPage, renderNotFoundPage } from './render.js';
import { checkConnection, closePool, getPool } from './db.js';

/** Port used when PRODUCT_KEYWORDS_PORT is not set. */
export const DEFAULT_PORT = 3100;

/**
 * Largest request body accepted, in bytes.
 *
 * Nothing in this application submits a form, so any body is unexpected. It is
 * still read and discarded rather than left unconsumed, so the socket closes
 * cleanly - and the limit is enforced as it arrives, so nothing unbounded is
 * ever held in memory.
 */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * Read and discard a posted body.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<URLSearchParams>}
 */
function readForm(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(new URLSearchParams());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', () => resolve(new URLSearchParams()));
  });
}

/**
 * Security headers.
 *
 * default-src 'none' and no script-src at all: this application serves no
 * JavaScript, so the page is allowed to load nothing external and run nothing.
 * style-src allows the one inline stylesheet the layout carries. There is no
 * image, no font and no CDN.
 *
 * form-action 'none' because there is no form - nothing here is ever
 * submitted, as the source database is read-only to this application.
 */
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});

/**
 * Build the server.
 *
 * @returns {import('node:http').Server}
 */
export function createProductKeywordsServer() {
  return createServer(async (req, res) => {
    // Reading is a GET or HEAD. A POST is accepted only to be answered with
    // the read-only page. Nothing else is accepted.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      res.writeHead(405, {
        allow: 'GET, HEAD, POST',
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
      });
      res.end(renderNotFoundPage());
      return;
    }

    try {
      // The base is a placeholder: only the path and query are ever used.
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'POST') {
        await readForm(req);
        const result = await routeForm(url.pathname, new URLSearchParams());

        res.writeHead(result.status, { ...SECURITY_HEADERS, 'content-type': result.contentType });
        res.end(result.body);
        return;
      }

      const { status, contentType, body, location } = await route(url.pathname, url.searchParams);

      const headers = { ...SECURITY_HEADERS, 'content-type': contentType };
      if (location) headers.location = location;

      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      // The operator gets the detail; the page says nothing technical.
      console.error('[product-keywords] failed to render:', error?.message);
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' });
      res.end(renderErrorPage());
    }
  });
}

/* c8 ignore start - entry point, exercised by running the server */
async function main() {
  const port = Number(process.env.PRODUCT_KEYWORDS_PORT ?? DEFAULT_PORT);

  // Fail here, with something readable, rather than on the first page somebody
  // opens.
  let where;
  try {
    where = await checkConnection();
  } catch (error) {
    console.error('[product-keywords] cannot start:', error.message);
    // 53300: the database role's connection limit is already used up. This
    // application holds nothing at this point - it is other sessions on the
    // same role - so say so, rather than leaving it to look like a fault here.
    if (error.code === '53300') {
      console.error(
        '[product-keywords] Every connection allowed for this database role is in use by other ' +
          'sessions (for example open pgAdmin tabs or query tools). Close the ones that are no ' +
          'longer needed, then start again. This application needs at most ' +
          `${getPool().options.max} connections.`,
      );
    }
    process.exitCode = 1;
    await closePool();
    return;
  }

  const server = createProductKeywordsServer();

  server.listen(port, () => {
    console.log(`[product-keywords] running on http://localhost:${port}/product-keywords`);
    console.log(
      `[product-keywords] reading ${where.database} as ${where.user} - ` +
        `read-only connection: ${where.readOnly ? 'yes' : 'NO'}, no write privileges.`,
    );
  });

  const shutdown = () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('server.js')) {
  main();
}
/* c8 ignore stop */
