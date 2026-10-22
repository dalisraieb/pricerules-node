/*
 * What the SDK needs to know about where it runs, without depending on any
 * runtime's types: Node, Bun, Deno, edge runtimes and browsers each expose a
 * different set of globals.
 */

type Globals = {
    process?: { env?: Record<string, string | undefined>; versions?: { node?: string } };
    window?: { document?: unknown };
    Bun?: { version?: string };
    Deno?: { version?: { deno?: string } };
    EdgeRuntime?: unknown;
    navigator?: { userAgent?: string };
};

const globals = globalThis as unknown as Globals;

/** An environment variable, or undefined where there is no `process.env` (Workers without nodejs_compat). */
export function readEnv(name: string): string | undefined {
    try {
        const value = globals.process?.env?.[name];
        return value === undefined || value === "" ? undefined : value;
    } catch {
        // Deno without --allow-env throws on access.
        return undefined;
    }
}

/**
 * A browser page: a window with a document. Deno 2, Bun, Node, edge
 * runtimes and Web Workers have no `window.document`.
 */
export function isBrowser(): boolean {
    return typeof globals.window === "object" && globals.window !== null && typeof globals.window.document === "object";
}

/** The runtime and its version, for the User-Agent: "node/24.3.0", "bun/1.2.0", "edge"… */
export function runtimeTag(): string {
    if (typeof globals.EdgeRuntime === "string") return "edge";
    if (globals.Bun?.version) return `bun/${globals.Bun.version}`;
    if (globals.Deno?.version?.deno) return `deno/${globals.Deno.version.deno}`;
    if (globals.navigator?.userAgent === "Cloudflare-Workers") return "workerd";
    if (globals.process?.versions?.node) return `node/${globals.process.versions.node}`;
    return "unknown";
}
