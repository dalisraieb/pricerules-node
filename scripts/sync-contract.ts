/**
 * Copies the app's API contract into contract/ and regenerates the typed
 * fixtures (see scripts/contract.ts). Needs the price repo checked out next
 * to this one, or PRICE_REPO pointing at it.
 *
 *   npm run sync:contract            refresh the copy and the fixtures
 *   npm run sync:contract -- --check fail if either differs from the app's contract
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_CONTRACT, CONTRACT_COPY, FIXTURES, fixturesSource, readText, type ApiContract } from "./contract";

const check = process.argv.includes("--check");

const appContract = readText(APP_CONTRACT);
if (appContract === null) {
    console.error(`The app's contract wasn't found at ${APP_CONTRACT}.\nCheck out the price repo next to this one, or set PRICE_REPO.`);
    process.exit(1);
}

const expected = new Map([
    [CONTRACT_COPY, appContract],
    [FIXTURES, fixturesSource(JSON.parse(appContract) as ApiContract)],
]);

const stale = [...expected].filter(([file, text]) => readText(file) !== text).map(([file]) => file);

if (check) {
    if (stale.length > 0) {
        console.error(
            `Out of sync with the app's API contract (${APP_CONTRACT}):\n  ${stale.join("\n  ")}\n` +
                "Run: npm run sync:contract, then update src/types.ts until `npm run typecheck` and `npm test` pass.",
        );
        process.exit(1);
    }
    console.log("The SDK's contract is in sync with the app.");
} else {
    for (const file of stale) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, expected.get(file)!);
    }
    console.log(stale.length > 0 ? `Updated:\n  ${stale.join("\n  ")}` : "Already in sync.");
}
