import { defineConfig } from "tsup";

// ESM (dist/index.js) and CommonJS (dist/index.cjs), each with its own
// declarations (.d.ts / .d.cts), as the package.json "exports" map expects.
export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    target: "es2022",
    platform: "neutral",
    // No sourcemaps: they would point at src/, which isn't published.
    sourcemap: false,
    clean: true,
    treeshake: true,
});
