/**
 * Next.js Instrumentation — runs once when the server starts, before any API routes.
 *
 * Patches Headers.prototype.append and .set to strip \r\n from values.
 * Fixes: @smithy/signature-v4 produces AWS SigV4 Authorization headers with
 * newline characters. Vercel's undici-based fetch rejects these in Headers.append().
 * The \n in the credential scope (e.g. KEY\n/DATE/REGION\n/SERVICE/aws4_request)
 * is erroneous — removing it produces the correct format that matches the signature.
 */
export function register() {
  if (typeof globalThis.Headers !== "undefined") {
    const origAppend = Headers.prototype.append;
    const origSet = Headers.prototype.set;

    Headers.prototype.append = function (name: string, value: string) {
      return origAppend.call(
        this,
        name,
        typeof value === "string" ? value.replace(/\r?\n/g, "") : value
      );
    };

    Headers.prototype.set = function (name: string, value: string) {
      return origSet.call(
        this,
        name,
        typeof value === "string" ? value.replace(/\r?\n/g, "") : value
      );
    };
  }
}
