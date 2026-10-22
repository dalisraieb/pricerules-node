// The built CommonJS package (dist/index.cjs, through the "exports" map) on this Node version.
const sdk = require("pricerules");

(async () => {
    const { checkRequests, smokeChecks, startServer } = await import("./server.mjs");
    const server = await startServer();
    try {
        const version = await smokeChecks(sdk, server.origin);
        checkRequests(server.seen, version, "node/");
        console.log(`smoke ok: CommonJS on node ${process.versions.node} (pricerules ${version})`);
    } finally {
        await server.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
