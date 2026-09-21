/**
 * Tests for the Vercel entry point and its configuration.
 *
 * None of this needs a database. The handler itself does - it proves the
 * connection is read-only before it serves anything - so what is tested here
 * is the part that decides WHAT to serve, plus the deployment configuration,
 * which is otherwise the one thing in the project that can be wrong without
 * anything failing until it is live.
 *
 * A broken vercel.json does not break a test, a build or a local page. It
 * breaks the deployed site, silently, and usually in a way that looks like an
 * application fault. That is exactly the kind of thing worth a test.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { requestedUrl } from '../api/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');

const vercelConfig = () => JSON.parse(readFileSync(join(PROJECT, 'vercel.json'), 'utf8'));

/** Remove block and line comments, so prose about code is not read as code. */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

// ---------------------------------------------------------------------------
// The path the visitor asked for.
// ---------------------------------------------------------------------------

test('an ordinary path is passed through untouched', () => {
  assert.equal(requestedUrl('/product-keywords').pathname, '/product-keywords');
  assert.equal(requestedUrl('/').pathname, '/');
});

test('the query string survives, because paging and filtering live in it', () => {
  const url = requestedUrl('/product-keywords?page=3&category=Door+Handle&search=brass');

  assert.equal(url.pathname, '/product-keywords');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('category'), 'Door Handle');
  assert.equal(url.searchParams.get('search'), 'brass');
});

test('the function reached at its own address still lands somewhere sensible', () => {
  // The rewrite normally hands over the original path. If the function is hit
  // directly instead, stripping /api leaves '', which router.js answers with
  // the redirect to /product-keywords rather than a 404.
  assert.equal(requestedUrl('/api').pathname, '/');
  assert.equal(requestedUrl('/api/index').pathname, '/');
  assert.equal(requestedUrl('/api/product-keywords').pathname, '/product-keywords');
});

test('a missing url is treated as the root, not as a crash', () => {
  assert.equal(requestedUrl(undefined).pathname, '/');
});

test('a path that merely starts with the letters api is left alone', () => {
  // "/apiary" is not the function's address, and truncating it would send a
  // visitor somewhere they did not ask for.
  assert.equal(requestedUrl('/apiary').pathname, '/apiary');
});

// ---------------------------------------------------------------------------
// The deployment configuration.
// ---------------------------------------------------------------------------

test('vercel.json is valid JSON', () => {
  assert.doesNotThrow(vercelConfig, 'vercel.json must parse');
});

test('every request is routed to the function', () => {
  const { rewrites } = vercelConfig();

  assert.ok(Array.isArray(rewrites) && rewrites.length > 0, 'a rewrite is configured');
  const all = rewrites.find((rule) => rule.source === '/(.*)');
  assert.ok(all, 'every path is rewritten, so /product-keywords reaches the function');
  assert.equal(all.destination, '/api');
});

test('page.html is shipped with the function', () => {
  // render.js reads page.html from disk when it loads. Vercel traces imports,
  // not files read at runtime, so without this the deployed function throws
  // ENOENT on its first request and every page is a 500.
  const config = vercelConfig();
  const fn = config.functions?.['api/index.js'];

  assert.ok(fn, 'the function is configured');
  assert.match(String(fn.includeFiles), /page\.html/, 'page.html is included');
});

test('the function is allowed longer than a page actually takes', () => {
  // A cold start pays for the TLS handshake, the connection, the read-only
  // check and a full rebuild of the category index on top of the page itself.
  const fn = vercelConfig().functions?.['api/index.js'];

  assert.ok(Number.isInteger(fn.maxDuration), 'a duration is set rather than left to the default');
  assert.ok(fn.maxDuration >= 30, 'and it leaves room for a cold start');
});

test('the entry point the configuration names is the one that exists', () => {
  // A rename here is silent until it is deployed.
  const config = vercelConfig();

  for (const name of Object.keys(config.functions ?? {})) {
    assert.doesNotThrow(
      () => readFileSync(join(PROJECT, name), 'utf8'),
      `vercel.json names ${name}, which must exist`,
    );
  }
});

test('no credential is written into the deployment configuration', () => {
  // Credentials come from the platform's environment variables. Anything that
  // looks like one here would be committed to the repository.
  const raw = readFileSync(join(PROJECT, 'vercel.json'), 'utf8');

  for (const secret of ['DB_PASSWORD', 'DB_HOST', 'DB_USER', 'password', 'ledsone']) {
    assert.ok(!raw.includes(secret), `vercel.json must not carry ${secret}`);
  }
});

test('the local server still has its port, and the function does not need one', () => {
  // npm start must keep working on 3100; a serverless function never listens.
  const server = readFileSync(join(HERE, 'server.js'), 'utf8');
  const entry = readFileSync(join(PROJECT, 'api', 'index.js'), 'utf8');

  assert.match(server, /export const DEFAULT_PORT = 3100;/, 'the local port is unchanged');
  assert.match(server, /server\.listen\(port/, 'the local server still listens');
  // Comments stripped: the entry point's own documentation legitimately
  // explains that server.listen() is the thing Vercel never invokes.
  assert.ok(!/\.listen\(/.test(stripComments(entry)), 'the function must not try to listen');
});

test('the function serves the page through the existing router, not its own copy', () => {
  // The whole point of the entry point is that it decides nothing. If it ever
  // grew its own SQL or its own keyword logic, the deployed page and the local
  // page could disagree about what the database says.
  const entry = readFileSync(join(PROJECT, 'api', 'index.js'), 'utf8');

  assert.match(entry, /import \{ route, routeForm \} from '\.\.\/product-keywords\/router\.js'/);
  assert.match(entry, /await route\(url\.pathname, url\.searchParams\)/);
  assert.ok(!/SELECT|FROM\s+inventory|keywordTermSources/i.test(entry), 'no application logic here');
});

test('the read-only check is kept on the serverless path', () => {
  // server.js runs it once before it listens. A function has no startup, so it
  // has to run per cold start - but it must still run.
  const entry = readFileSync(join(PROJECT, 'api', 'index.js'), 'utf8');

  assert.match(entry, /checkConnection/, 'the check is imported');
  assert.match(entry, /await verifyReadOnly\(\)/, 'and awaited before anything is served');
});
