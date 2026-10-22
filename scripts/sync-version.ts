/**
 * Writes src/version.ts from package.json (the User-Agent's version). Run by
 * `npm version` through the "version" script, so the bump commit includes it;
 * tests/request.test.ts fails if they differ.
 */
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

writeFileSync(
    new URL("../src/version.ts", import.meta.url),
    `// GENERATED from package.json by \`npm run version:sync\` (run by \`npm version\`): do not edit.\nexport const VERSION = ${JSON.stringify(version)};\n`,
);
console.log(`src/version.ts: ${version}`);
