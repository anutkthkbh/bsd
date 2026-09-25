import type { Database, User } from './types'

const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
export const randomId = () => crypto.randomUUID()
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)))
export async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))) }
export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256))
}
export async function verifyPassword(password: string, salt: string, expected: string) {
  const actual = await passwordHash(password, salt)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
export async function getUser(request: Request, db: Database): Promise<User | null> {
  const token = /(?:^|;\s*)madarom_session=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1]
  if (!token) return null
  return db.prepare(`SELECT users.id,users.email,users.name,users.role,users.store_id FROM sessions
    JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>datetime('now')`)
    .bind(await sha256(token)).first<User>()
}
export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...headers,
  } })
}
export const error = (message: string, status = 400) => json({ error: message }, status)
export function safeText(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
export function validUrl(value: unknown): string {
  const text = safeText(value, 1200)
  if (!text) return ''
  try { const url = new URL(text); return url.protocol === 'https:' ? url.href : '' } catch { return '' }
}
export function money(value: unknown) { const n = Number(value); return Number.isSafeInteger(n) && n >= 0 && n <= 100000000 ? n : null }
export function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, '-').slice(0, 80)
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('נתונים לא תקינים')
  if (Number(request.headers.get('content-length') || 0) > 25000) throw new Error('הבקשה גדולה מדי')
  const text = await request.text()
  if (text.length > 25000) throw new Error('הבקשה גדולה מדי')
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('נתונים לא תקינים')
  return parsed as Record<string, unknown>
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}
