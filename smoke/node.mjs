// The built ESM package (dist/index.js, through the "exports" map) on this Node version.
import * as sdk from "pricerules";
import { checkRequests, smokeChecks, startServer } from "./server.mjs";

const server = await startServer();
try {
    const version = await smokeChecks(sdk, server.origin);
    checkRequests(server.seen, version, "node/");
    console.log(`smoke ok: ESM on node ${process.versions.node} (pricerules ${version})`);
} finally {
    await server.close();
}
