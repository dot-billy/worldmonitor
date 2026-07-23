import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('root installs do not implicitly execute a nested blog install', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.match(pkg.scripts['install:blog'], /npm ci --prefix blog-site/);
  assert.match(pkg.scripts['install:blog'], /--ignore-scripts/);
  assert.match(pkg.scripts['build:blog'], /npm run install:blog/);
});

test('Docker build context excludes local secrets', () => {
  const dockerignore = read('.dockerignore').split(/\r?\n/);
  for (const entry of ['.env', '.env.*', 'secrets/', '**/node_modules', '**/dist']) {
    assert.ok(dockerignore.includes(entry), `.dockerignore must contain ${entry}`);
  }
});

test('Compose is loopback-only, wires relay auth, and drops container privileges', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /\$\{WM_BIND_ADDRESS:-127\.0\.0\.1\}:\$\{WM_PORT:-3000\}:8080/);
  assert.equal((compose.match(/RELAY_SHARED_SECRET:\s*"\$\{RELAY_SHARED_SECRET:\?/g) ?? []).length, 2);
  assert.ok((compose.match(/no-new-privileges:true/g) ?? []).length >= 4);
  assert.ok((compose.match(/cap_drop:/g) ?? []).length >= 3);
  assert.match(compose, /UPSTASH_REDIS_REST_URL:\s*"http:\/\/redis-rest:8080"/);
});

test('Docker nginx blocks desktop-only environment mutation routes', () => {
  const nginx = read('docker/nginx.conf');
  assert.match(nginx, /location = \/api\/local-env-update \{/);
  assert.match(nginx, /location = \/api\/local-env-update-batch \{/);
  assert.match(nginx, /Runtime configuration updates are disabled in Docker mode/);
});

test('desktop CSP executes only application-bundled scripts', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const csp = config.app.security.csp;
  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? '';
  assert.equal(scriptSrc, "'self' 'wasm-unsafe-eval'");
  assert.doesNotMatch(scriptSrc, /https?:/);
});

test('desktop release windows reject external content and AppImage keeps its sandbox by default', () => {
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /if !cfg!\(debug_assertions\)/);
  assert.match(main, /restricted to credential-free localhost URLs in development/);
  assert.match(main, /WM_DISABLE_WEBKIT_SANDBOX/);
  assert.match(main, /WM_DISABLE_WEBKIT_SANDBOX=1: WebKit sandbox disabled/);
  assert.doesNotMatch(main, /AppImage itself already provides isolation/);
});

test('advisory-fixed desktop dependency floors remain pinned', () => {
  const manifest = read('src-tauri/Cargo.toml');
  const lock = read('src-tauri/Cargo.lock');
  assert.match(manifest, /tauri = \{ version = "2\.11\.1"/);
  assert.match(lock, /name = "tauri"\nversion = "2\.11\.1"/);
  assert.match(lock, /name = "openssl"\nversion = "0\.10\.81"/);
  assert.match(lock, /name = "quick-xml"\nversion = "0\.41\.0"/);
});

test('container dependency installs are locked and lifecycle scripts are disabled', () => {
  const redisDockerfile = read('docker/Dockerfile.redis-rest');
  const relayDockerfile = read('Dockerfile.relay');
  const appDockerfile = read('Dockerfile');
  assert.match(redisDockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(redisDockerfile, /USER node/);
  assert.match(relayDockerfile, /USER node/);
  assert.match(appDockerfile, /--chmod=0644 docker\/nginx\.conf/);
  assert.match(appDockerfile, /--chmod=0644 docker\/supervisord\.conf/);
  assert.doesNotMatch(redisDockerfile, /npm install/);
});
