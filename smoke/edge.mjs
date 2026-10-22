// The built package inside Vercel's edge runtime (edge-runtime: the Web APIs
// only; no process, no Node modules), making real requests to the local server.
import { readFileSync } from "node:fs";
import { EdgeRuntime } from "edge-runtime";
import { checkRequests, smokeChecks, startServer } from "./server.mjs";

const bundle = readFileSync(new URL("../dist/index.cjs", import.meta.url), "utf8");

const server = await startServer();
try {
    const runtime = new EdgeRuntime();
    if (runtime.evaluate("typeof process") !== "undefined") throw new Error("smoke: the edge context has `process`");

    // The CommonJS build needs no require(): zero dependencies, nothing from Node.
    runtime.evaluate(`globalThis.__sdk = (() => { const module = { exports: {} }; const exports = module.exports; ${bundle}\n; return module.exports; })();`);

    const missingKey = runtime.evaluate(`(() => { try { new globalThis.__sdk.PriceRules(); } catch (error) { return error.code; } })()`);
    if (missingKey !== "MISSING_API_KEY") throw new Error(`smoke: without process.env the key must be passed (got ${missingKey})`);

    const version = await runtime.evaluate(`(${smokeChecks.toString()})(globalThis.__sdk, ${JSON.stringify(server.origin)})`);
    checkRequests(server.seen, version, "edge");
    console.log(`smoke ok: edge-runtime (pricerules ${version})`);
} finally {
    await server.close();
}
