import { execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const runToken = String(Date.now())
const driverPort = 55224
const nativeDriverPort = 55225
const driver =
  process.env.TAURI_DRIVER ?? resolve(homedir(), '.cargo/bin/tauri-driver')
const nativeDriver = process.env.WEBKIT_WEBDRIVER ?? '/usr/bin/WebKitWebDriver'
const application = resolve(root, 'src-tauri/target/debug/correo-boxplot')

function run(command, args, environment = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  })
}

async function createSession() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${driverPort}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capabilities: { alwaysMatch: { 'tauri:options': { application } } },
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

async function executeSession() {
  const session = await createSession()
  const sessionId = session.value?.sessionId ?? session.sessionId
  if (typeof sessionId !== 'string') throw new Error('No WebDriver session ID')
  try {
    await webdriver(sessionId, 'timeouts', { script: 120_000 })
    return await webdriver(sessionId, 'execute/async', {
      script: `
        const done = arguments[arguments.length - 1];
        const finish = () => done(window.__A08_RESULT__);
        if (window.__A08_RESULT__ !== undefined) finish();
        else window.addEventListener('persona-a-integration-complete', finish, { once: true });
      `,
      args: [],
    })
  } finally {
    await fetch(`http://127.0.0.1:${driverPort}/session/${sessionId}`, {
      method: 'DELETE',
    }).catch(() => undefined)
  }
}

run(
  'node_modules/.bin/vite',
  ['build', '--config', 'tests/persona-a-integration/vite.config.ts'],
  { A08_RUN_TOKEN: runToken },
)
run('node_modules/.bin/tauri', [
  'build',
  '--debug',
  '--no-bundle',
  '--config',
  'tests/persona-a-integration/tauri.persona-a.conf.json',
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

try {
  const initial = await executeSession()
  const reopen = await executeSession()
  process.stdout.write(`${JSON.stringify({ initial, reopen }, null, 2)}\n`)
  const initialPass =
    initial?.phase === 'initial' &&
    initial.invalidationVisible === true &&
    initial.pendingMutationPersisted === true &&
    initial.composerClearedAfterCommit === true &&
    initial.fakeSentEmailCreated === false &&
    initial.localStorageMailKeyPresent === false
  const reopenPass =
    reopen?.phase === 'reopen' &&
    reopen.pendingMutationPersisted === true &&
    reopen.invalidationVisible === true &&
    reopen.localStorageMailKeyPresent === false
  if (!initialPass || !reopenPass) process.exitCode = 1
} finally {
  driverProcess.kill('SIGTERM')
}
