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
export interface MediaBucket {
  put(key:string,value:ArrayBuffer | Uint8Array,options?:{httpMetadata?:{contentType:string}}):Promise<unknown>
  get(key:string):Promise<{body:ReadableStream;httpEtag?:string}|null>
}
export interface Env {
  DB?: Database; MEDIA?: MediaBucket
  RESEND_API_KEY?:string; EMAIL_FROM?:string
  TWILIO_ACCOUNT_SID?:string; TWILIO_AUTH_TOKEN?:string; TWILIO_FROM?:string
  GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string
}
export interface Context {
  request: Request
  env: Env
  params: Record<string, string | string[]>
}
export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'merchant' | 'customer'
  store_id: string | null
}
