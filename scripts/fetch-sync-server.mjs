// Downloads the sync server the E2E Sync lane runs against (issue #222) into
// vendor/sync-server/, pinned by SHA-256. Never committed (vendor/ is
// git-ignored).
//   pnpm fetch:sync-server
// PocketBase 0.25.0 is the version the maibuk-sync Dockerfile deploys; the
// migrations come from maibuk-sync at a pinned commit, one file at a time, so
// each one is checked against its own digest (GitHub's tarballs are not
// byte-stable, raw files are).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const POCKETBASE_VERSION = "0.25.0";

/** `<process.platform>-<process.arch>` → release asset and its SHA-256 (the release's checksums.txt). */
export const POCKETBASE_ASSETS = {
  "linux-x64": {
    file: "pocketbase_0.25.0_linux_amd64.zip",
    sha256: "da9d2903e606ca20d4876c5d323818840bb9cbf155dc71e809052d7991b43140",
  },
  "linux-arm64": {
    file: "pocketbase_0.25.0_linux_arm64.zip",
    sha256: "a0a89992834a1ac45b643bd022e1333e9eab923c35ad7f179cf4b52321b2a81c",
  },
  "darwin-x64": {
    file: "pocketbase_0.25.0_darwin_amd64.zip",
    sha256: "0f0ee6afb2f27f5b1d790d64b9aae56f2350476e86c2c796917923d225423673",
  },
  "darwin-arm64": {
    file: "pocketbase_0.25.0_darwin_arm64.zip",
    sha256: "745376e5663e4f2cb873bcac387b5eb5c7616abe111e6dd0919558990ef431f1",
  },
  "win32-x64": {
    file: "pocketbase_0.25.0_windows_amd64.zip",
    sha256: "8cd5d31ed26d1c18000f907cf48ccb721a1ef95b8aef71bec48902d2a5a14a74",
  },
  "win32-arm64": {
    file: "pocketbase_0.25.0_windows_arm64.zip",
    sha256: "c46911d9bae71c3f1306437130b64577bad6c1db83b2f49cb2ae74e689cbb584",
  },
};

export const MAIBUK_SYNC_COMMIT = "793ce44cd82bde60ed5ef1fda28678f21d69db40";

/** Every file in maibuk-sync's pb_migrations/ at MAIBUK_SYNC_COMMIT, in order. */
export const MIGRATIONS = {
  "001_sync_items.js": "a2fdfed5ddfa0e24acf35e2bbedc857a5444a16ea5b1face5f3b46dea730f4f6",
  "002_version_items.js": "0fa54ba2eb3a614ae032a62ab9fc6bc3e3f91061a7003b0583bc656b8f01ab75",
  "003_metrics_events_rows.js": "18fddb06435b119443a081a7595c669a848ab0da27bbb4d82e2138a98b1f0b9a",
  "004_metrics_tombstones_rows.js":
    "dc1d3ac2baaff538d4b9308ce19de1f0f5af755ed93c5824300a822482f19d70",
  "005_version_items_word_count_optional.js":
    "142c991d83859f0e04973da8458e5edc3fec925e6378f890eb1d22c22d12c239",
  "006_note_items.js": "61eac8317f0c9f3f84f8a0a6d9b3fa757945ea4b72ead832b2a998b5945ffae3",
  "007_objects.js": "b74d7b688a760ae485d6e6eaaa05ea8d72773169f744ab50ca8922d2ada627f7",
  "008_drop_legacy_collections.js":
    "c63193573a03e1c2c109763dd9ee577b6ee69533b83d607420f0b88956473951",
  "009_objects_meta_max.js": "71ab74d138268b02b2cd483b74f740db21142872a09a0e4e4996ccee84c56fca",
};

export const SYNC_SERVER_DIR = "vendor/sync-server";

/** The release asset for a host, or an error naming the hosts that have one. */
export function pocketbaseAsset(platform, arch) {
  const asset = POCKETBASE_ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `PocketBase ${POCKETBASE_VERSION} has no build for ${platform}-${arch}; supported: ${Object.keys(POCKETBASE_ASSETS).join(", ")}`
    );
  }
  return {
    ...asset,
    url: `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/${asset.file}`,
  };
}

/** Where the binary and migrations land under `root`, whether or not they exist yet. */
export function syncServerPaths(root, platform = process.platform) {
  const base = join(root, SYNC_SERVER_DIR);
  return {
    binary: join(
      base,
      `pocketbase-${POCKETBASE_VERSION}`,
      platform === "win32" ? "pocketbase.exe" : "pocketbase"
    ),
    migrationsDir: join(base, `maibuk-sync-${MAIBUK_SYNC_COMMIT.slice(0, 12)}`, "pb_migrations"),
  };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Throws when `bytes` do not hash to `expected`; `label` names the file. */
export function verifyDigest(label, bytes, expected) {
  const digest = sha256(bytes);
  if (digest !== expected) throw new Error(`${label}: sha256 ${digest}, pinned ${expected}`);
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function unzip(zip, dir) {
  // unzip ships with macOS and most Linux; Windows 10+ tar (bsdtar) reads zip.
  if (process.platform === "win32") execFileSync("tar", ["-xf", zip, "-C", dir]);
  else execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
}

async function fetchPocketbase(root) {
  const asset = pocketbaseAsset(process.platform, process.arch);
  const { binary } = syncServerPaths(root);
  const dir = dirname(binary);
  const stamp = join(dir, ".sha256");
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, "utf8") === asset.sha256) {
    return false;
  }
  const bytes = await download(asset.url);
  verifyDigest(asset.file, bytes, asset.sha256);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, asset.file);
  writeFileSync(zip, bytes);
  unzip(zip, dir);
  rmSync(zip);
  if (!existsSync(binary)) throw new Error(`${asset.file} held no ${relative(dir, binary)}`);
  if (process.platform !== "win32") chmodSync(binary, 0o755);
  writeFileSync(stamp, asset.sha256);
  return true;
}

async function fetchMigrations(root) {
  const { migrationsDir } = syncServerPaths(root);
  const pinned = (name) => {
    const file = join(migrationsDir, name);
    return existsSync(file) && sha256(readFileSync(file)) === MIGRATIONS[name];
  };
  if (Object.keys(MIGRATIONS).every(pinned)) return false;
  rmSync(migrationsDir, { recursive: true, force: true });
  mkdirSync(migrationsDir, { recursive: true });
  for (const [name, digest] of Object.entries(MIGRATIONS)) {
    const url = `https://raw.githubusercontent.com/M4ss1ck/maibuk-sync/${MAIBUK_SYNC_COMMIT}/pb_migrations/${name}`;
    const bytes = await download(url);
    verifyDigest(`pb_migrations/${name}`, bytes, digest);
    writeFileSync(join(migrationsDir, name), bytes);
  }
  return true;
}

/** Fetches what is missing or stale and returns where it is. */
export async function fetchSyncServer(root) {
  const fetchedBinary = await fetchPocketbase(root);
  const fetchedMigrations = await fetchMigrations(root);
  const paths = syncServerPaths(root);
  for (const [what, fetched, path] of [
    [`PocketBase ${POCKETBASE_VERSION}`, fetchedBinary, paths.binary],
    [
      `maibuk-sync migrations @ ${MAIBUK_SYNC_COMMIT.slice(0, 12)}`,
      fetchedMigrations,
      paths.migrationsDir,
    ],
  ]) {
    console.log(`${fetched ? "fetched" : "cached "} ${what} -> ${relative(root, path)}`);
  }
  return paths;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  fetchSyncServer(root).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
