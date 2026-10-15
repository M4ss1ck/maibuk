// Types for the plain-JavaScript bootstrap, so `tsc` can type-check its
// importers (the checkout-resolution test) without enabling `allowJs` and a
// sibling `.d.mts` keeps the tooling dependency-free at runtime.

/** The file a Plugin repo writes its checkout path to. */
export const LOCAL_CONFIG_FILE: string;

/** The key {@link LOCAL_CONFIG_FILE} holds the checkout path under. */
export const LOCAL_CONFIG_KEY: string;

/** A refused checkout, or a call that named no source at all (#455). */
export class MaibukCheckoutError extends Error {}

/** What `resolveMaibukCheckout` reads: the three sources, in precedence order. */
export interface ResolveMaibukCheckoutInput {
  /** The `--maibuk <path>` flag value, when given. */
  flag?: string;
  /** The `MAIBUK_CHECKOUT` environment variable value, when given. */
  env?: string;
  /** The Plugin repo's root, where `maibuk.local.json` lives. */
  pluginRoot: string;
}

/** The usable Maibuk checkout. */
export interface MaibukCheckout {
  /** The absolute checkout path. */
  path: string;
}

/** Resolves the Maibuk checkout, or throws {@link MaibukCheckoutError}. */
export function resolveMaibukCheckout(input: ResolveMaibukCheckoutInput): MaibukCheckout;

/** Launches the checkout's tooling CLI for one command; resolves with its exit code. */
export function runCli(command: string, pluginRoot: string, flag?: string): Promise<number>;

/** Runs one command line; `setup` delegates to `setup.mjs`. Resolves with the exit code. */
export function main(argv?: string[]): Promise<number>;
