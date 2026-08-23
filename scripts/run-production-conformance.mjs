import { execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const driverPort = 55222
const nativeDriverPort = 55223
const driver =
  process.env.TAURI_DRIVER ?? resolve(homedir(), '.cargo/bin/tauri-driver')
const nativeDriver = process.env.WEBKIT_WEBDRIVER ?? '/usr/bin/WebKitWebDriver'
const application = resolve(root, 'src-tauri/target/debug/correo-boxplot')

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

async function createSession() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${driverPort}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capabilities: {
            alwaysMatch: {
              'tauri:options': { application },
            },
          },
        }),
      })
      if (response.ok) return response.json()
    } catch {
      // The driver process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('tauri-driver did not accept a session')
}

async function webdriver(sessionId, endpoint, body) {
  const response = await fetch(
    `http://127.0.0.1:${driverPort}/session/${sessionId}/${endpoint}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const result = await response.json()
  if (!response.ok || result.value?.error) {
    throw new Error(`WebDriver ${endpoint} failed: ${JSON.stringify(result)}`)
  }
  return result.value
}

run('node_modules/.bin/vite', [
  'build',
  '--config',
  'tests/production-conformance/vite.config.ts',
])
run('node_modules/.bin/tauri', [
  'build',
  '--debug',
  '--no-bundle',
  '--features',
  'conformance',
  '--config',
  'tests/production-conformance/tauri.conformance.conf.json',
])

const driverProcess = spawn(
  driver,
  [
    '--port',
    String(driverPort),
    '--native-port',
    String(nativeDriverPort),
    '--native-driver',
    nativeDriver,
  ],
  { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
)

let sessionId
try {
  const session = await createSession()
  sessionId = session.value?.sessionId ?? session.sessionId
  if (typeof sessionId !== 'string') {
    throw new Error(
      `WebDriver returned no session ID: ${JSON.stringify(session)}`,
    )
  }
  await webdriver(sessionId, 'timeouts', { script: 900_000 })
  const result = await webdriver(sessionId, 'execute/async', {
    script: `
      const done = arguments[arguments.length - 1];
      const finish = () => done(window.__PROD_CONFORMANCE_RESULT__);
      if (window.__PROD_CONFORMANCE_RESULT__ !== undefined) finish();
      else window.addEventListener('prod-conformance-complete', finish, { once: true });
    `,
    args: [],
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  const contractsPass =
    result?.contracts?.defined === 179 &&
    result.contracts.executed === 179 &&
    result.contracts.passed === 179 &&
    result.contracts.failed?.length === 0 &&
    result.contracts.groups?.['P-01']?.passed === 45 &&
    result.contracts.groups?.['P-02']?.passed === 91 &&
    result.contracts.groups?.['P-03']?.passed === 23 &&
    result.contracts.groups?.System?.passed === 20
  const smokePass =
    Array.isArray(result?.smoke) &&
    result.smoke.length === 5 &&
    result.smoke.every((value) => value.passed)
  if (!contractsPass || !smokePass || result.productionCommandCount !== 25) {
    process.exitCode = 1
  }
} finally {
  if (sessionId !== undefined) {
    await fetch(`http://127.0.0.1:${driverPort}/session/${sessionId}`, {
      method: 'DELETE',
    }).catch(() => undefined)
  }
  driverProcess.kill('SIGTERM')
}
