type Hook = () => void | Promise<void>
type TestBody = () => void | Promise<void>

type Suite = {
  readonly name: string
  readonly parent: Suite | null
  readonly beforeEach: Hook[]
  readonly afterEach: Hook[]
}

type RegisteredTest = {
  readonly name: string
  readonly suite: Suite
  readonly body: TestBody
}

export type BrowserTestFailure = Readonly<{
  name: string
  error: string
}>

export type BrowserTestResult = Readonly<{
  defined: number
  executed: number
  passed: number
  failed: readonly BrowserTestFailure[]
  groups: Readonly<
    Record<
      string,
      Readonly<{ defined: number; executed: number; passed: number }>
    >
  >
}>

const root: Suite = {
  name: '',
  parent: null,
  beforeEach: [],
  afterEach: [],
}
let currentSuite = root
const tests: RegisteredTest[] = []

export function describe(name: string, define: () => void): void {
  const parent = currentSuite
  currentSuite = { name, parent, beforeEach: [], afterEach: [] }
  try {
    define()
  } finally {
    currentSuite = parent
  }
}

export function beforeEach(hook: Hook): void {
  currentSuite.beforeEach.push(hook)
}

export function afterEach(hook: Hook): void {
  currentSuite.afterEach.push(hook)
}

export function it(name: string, body: TestBody): void {
  tests.push({ name, suite: currentSuite, body })
}

function suiteChain(suite: Suite): Suite[] {
  const chain: Suite[] = []
  let current: Suite | null = suite
  while (current !== null && current !== root) {
    chain.unshift(current)
    current = current.parent
  }
  return chain
}

function format(value: unknown): string {
  if (value instanceof Set) return `Set(${format([...value])})`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Set && right instanceof Set) {
    if (left.size !== right.size) return false
    return [...left].every((candidate) =>
      [...right].some((value) => equal(candidate, value)),
    )
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]))
    )
  }
  if (
    typeof left === 'object' &&
    left !== null &&
    typeof right === 'object' &&
    right !== null
  ) {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord)
    const rightKeys = Object.keys(rightRecord)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(rightRecord, key) &&
          equal(leftRecord[key], rightRecord[key]),
      )
    )
  }
  return false
}

function assertion(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function matchers(actual: unknown, negate: boolean) {
  const verify = (condition: boolean, message: string) =>
    assertion(negate ? !condition : condition, message)
  return {
    toBe(expected: unknown): void {
      verify(
        Object.is(actual, expected),
        `${format(actual)} is not ${format(expected)}`,
      )
    },
    toEqual(expected: unknown): void {
      verify(
        equal(actual, expected),
        `${format(actual)} does not equal ${format(expected)}`,
      )
    },
    toHaveLength(expected: number): void {
      const length = (actual as { length?: unknown } | null)?.length
      verify(length === expected, `length ${format(length)} is not ${expected}`)
    },
    toContainEqual(expected: unknown): void {
      verify(
        Array.isArray(actual) && actual.some((value) => equal(value, expected)),
        `${format(actual)} does not contain ${format(expected)}`,
      )
    },
    toBeGreaterThan(expected: number): void {
      verify(
        typeof actual === 'number' && actual > expected,
        `${format(actual)} is not greater than ${expected}`,
      )
    },
    toBeNull(): void {
      verify(actual === null, `${format(actual)} is not null`)
    },
    toThrow(): void {
      let threw = false
      try {
        ;(actual as () => void)()
      } catch {
        threw = true
      }
      verify(threw, 'function did not throw')
    },
  }
}

export function expect(actual: unknown) {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
  }
}

export async function runRegisteredTests(): Promise<BrowserTestResult> {
  const failures: BrowserTestFailure[] = []
  let executed = 0
  const groups = new Map<
    string,
    { defined: number; executed: number; passed: number }
  >()

  for (const test of tests) {
    const rootName = suiteChain(test.suite)[0]?.name ?? 'unknown'
    const group = rootName.startsWith('ReadRepository')
      ? 'P-01'
      : rootName.startsWith('SyncPort')
        ? 'P-02'
        : rootName.startsWith('LocalChangeSource')
          ? 'P-03'
          : 'System'
    const counts = groups.get(group) ?? { defined: 0, executed: 0, passed: 0 }
    counts.defined += 1
    groups.set(group, counts)
  }

  for (const test of tests) {
    const chain = suiteChain(test.suite)
    const rootName = chain[0]?.name ?? 'unknown'
    const group = rootName.startsWith('ReadRepository')
      ? 'P-01'
      : rootName.startsWith('SyncPort')
        ? 'P-02'
        : rootName.startsWith('LocalChangeSource')
          ? 'P-03'
          : 'System'
    const fullName = [...chain.map((suite) => suite.name), test.name].join(
      ' > ',
    )
    let failure: unknown
    try {
      for (const suite of chain) {
        for (const hook of suite.beforeEach) await hook()
      }
      await test.body()
    } catch (error) {
      failure = error
    } finally {
      for (const suite of [...chain].reverse()) {
        for (const hook of suite.afterEach) {
          try {
            await hook()
          } catch (error) {
            failure ??= error
          }
        }
      }
    }
    executed += 1
    const counts = groups.get(group)
    if (counts !== undefined) counts.executed += 1
    if (failure !== undefined) {
      failures.push({
        name: fullName,
        error:
          failure instanceof Error
            ? `${failure.name}: ${failure.message}`
            : String(failure),
      })
    } else if (counts !== undefined) {
      counts.passed += 1
    }
  }

  return {
    defined: tests.length,
    executed,
    passed: executed - failures.length,
    failed: failures,
    groups: Object.fromEntries(groups),
  }
}
