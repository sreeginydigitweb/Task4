/**
 * The response headers every entry point sends.
 *
 * There are two ways into this application and they must answer identically:
 *
 *   product-keywords/server.js   the long-running local server (npm start)
 *   api/index.js                 the Vercel function
 *
 * These headers used to live inside server.js, which was correct while that
 * was the only way in. It is not any more, and a copy in the function would be
 * a copy that could drift - a deployed page quietly served without a CSP while
 * the local one kept it. So they live here, in one place, and both import them.
 *
 * Nothing about the policy itself changed when it moved.
 */

/**
 * Where product images are allowed to be loaded from.
 *
 * The Product Image column shows pictures the ledsone database already points
 * at, and those addresses live on the business's own storage. Rather than
 * opening img-src to the whole web, only the hosts the data actually uses are
 * allowed - so a stray or tampered URL in a database row cannot make the page
 * fetch from somewhere else.
 *
 * Checked against the data: inventory.product_images and
 * inventory.product_media together hold 79,934 non-empty image URLs, on
 * sin1.contabostorage.com (79,934 less 162) and dashboard.digitweblk.com
 * (162, some of them http).
 *
 * IF THE BUSINESS MOVES ITS IMAGE STORAGE, ADD THE NEW HOST HERE. Images will
 * otherwise stop appearing, visibly and without any other symptom.
 */
export const IMAGE_HOSTS = Object.freeze([
  'https://sin1.contabostorage.com',
  'https://dashboard.digitweblk.com',
  'http://dashboard.digitweblk.com',
]);

/**
 * Security headers.
 *
 * default-src 'none' and no script-src at all: this application serves no
 * JavaScript, so the page runs nothing and may load nothing except what is
 * named below. style-src allows the one inline stylesheet the layout carries.
 *
 * img-src names the product-image hosts and nothing else. It is the only
 * outbound request this page can make. Note that loading an image does tell
 * that host a viewer opened the page; referrer-policy: no-referrer keeps the
 * URL of this page out of it.
 *
 * form-action 'self' for the category filter, which is an ordinary GET form
 * pointing back at this application. It was 'none' while the page had no form
 * at all; 'self' still refuses to let a form here submit anywhere else. The
 * filter changes nothing - it selects which rows are read - and the source
 * database remains read-only to this application, which is why a POST is still
 * answered with the read-only explanation.
 */
export const SECURITY_HEADERS = Object.freeze({
  'content-security-policy':
    "default-src 'none'; " +
    "style-src 'unsafe-inline'; " +
    `img-src ${IMAGE_HOSTS.join(' ')}; ` +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});
