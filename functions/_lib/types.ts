export interface D1Result<T> { results: T[] }
export interface Statement {
  bind(...values: unknown[]): Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}
export interface Database {
  prepare(query: string): Statement
  batch(statements: Statement[]): Promise<unknown[]>
}
export interface Env { DB?: Database }
export interface Context {
  request: Request
  env: Env
  params: Record<string, string | string[]>
}
export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'merchant'
  store_id: string | null
}
