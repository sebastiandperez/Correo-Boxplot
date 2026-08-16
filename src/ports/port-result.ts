export type PortResult<T, E> =
  | Readonly<{
      ok: true
      value: T
    }>
  | Readonly<{
      ok: false
      error: E
    }>
