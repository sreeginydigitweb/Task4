/**
 * THE VERCEL ENTRY POINT.
 *
 * Vercel does not run a long-lived HTTP server. It runs a function per
 * request, so `product-keywords/server.js` - which ends in `server.listen()` -
 * is never invoked there. This file is the other way in.
 *
 * It is deliberately the thinnest possible shim. Every decision the page makes
 * still belongs to `router.js`, which was already a pure function of a path
 * and a query:
 *
 *   route(pathname, query) -> { status, contentType, body, location? }
 *
 * That shape is what makes this small. Nothing about the SQL, the keyword
 * generation, the provenance matching, the category logic, the search, the
 * filtering, the paging or the nine-column table is touched or duplicated
 * here; this file converts a Vercel request into those two arguments and
 * writes back what comes out.
 *
 *   Vercel -> api/index.js -> router.route() -> source.js -> ledsone
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS RESPONSIBLE FOR
 *
 * Three things the local server also does, kept identical here rather than
 * reimplemented:
 *
 *   1. The same method policy - GET, HEAD and POST, nothing else.
 *   2. The same security headers, imported from http-headers.js so the two
 *      entry points cannot drift apart.
 *   3. The same read-only database check, which on the local server runs once
 *      at startup. See below - this is the part that needed real thought.
 */

import { checkConnection } from '../product-keywords/db.js';
import { SECURITY_HEADERS } from '../product-keywords/http-headers.js';
import { renderErrorPage, renderNotFoundPage } from '../product-keywords/render.js';
import { route, routeForm } from '../product-keywords/router.js';

/**
 * THE READ-ONLY SAFETY CHECK, KEPT.
 *
 * `server.js` calls checkConnection() once before it listens, and refuses to
 * start if the source is not read-only or if the role turns out to hold write
 * privileges on inventory.products. That check is not decoration: it is the
 * third of the three things that make "this application cannot write to
 * ledsone" true rather than merely intended.
 *
 * A serverless function has no startup to hang it on, and running it on every
 * request would add a round trip to every page. So it runs once per cold
 * start, and the PROMISE is cached rather than the result - concurrent first
 * requests then share one check instead of each issuing their own.
 *
 * A failed check is not cached. If the database was briefly unreachable, the
 * next request retries rather than being told "no" for the life of the
 * instance.
 *
 * @type {Promise<object>|null}
 */
let readOnlyCheck = null;

function verifyReadOnly() {
  if (readOnlyCheck === null) {
    readOnlyCheck = checkConnection().catch((error) => {
      readOnlyCheck = null;
      throw error;
    });
  }

  return readOnlyCheck;
}

/**
 * The path the visitor actually asked for.
 *
 * vercel.json rewrites every path to this function, and Vercel passes the
 * ORIGINAL path through in req.url, so normally this is just req.url. The
 * fallback covers the function being reached at its own address instead -
 * directly, or through a rewrite configured differently later. Stripping the
 * /api prefix then leaves '', which router.js already answers with the
 * redirect to /product-keywords, so even that case lands somewhere sensible
 * rather than on a 404.
 *
 * @param {string|undefined} requestUrl
 * @returns {URL}
 */
export function requestedUrl(requestUrl) {
  // The base is a placeholder: only the path and the query are ever read.
  const url = new URL(requestUrl ?? '/', 'http://localhost');

  if (url.pathname === '/api' || url.pathname === '/api/index' || url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.replace(/^\/api(\/index)?/, '') || '/';
  }

  return url;
}

/**
 * Handle one request.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export default async function handler(req, res) {
  // Reading is a GET or HEAD. A POST is accepted only to be answered with the
  // read-only page. Nothing else is accepted. Same policy as server.js.
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
    // Before anything is read, prove the connection is still read-only and
    // that this role cannot write to the source.
    await verifyReadOnly();

    const url = requestedUrl(req.url);

    if (req.method === 'POST') {
      // Nothing here accepts a submission. The body is not read at all: unlike
      // the local server there is no socket to drain, and the answer does not
      // depend on it.
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
    // The operator gets the detail in the function log; the page says nothing
    // technical. A failed read-only check arrives here too, which is the right
    // outcome: no page is served at all rather than one served from a
    // connection that could write.
    console.error('[product-keywords] failed to render:', error?.message);
    res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage());
  }
}
