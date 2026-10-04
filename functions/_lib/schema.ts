import type { Database } from './types'

const checks={
  catalog:["SELECT id,slug,name,category,description,city,logo_url,status,created_at FROM stores LIMIT 0",
    "SELECT id,store_id,slug,name,category,description,price_agorot,image_url,stock,variants_json,status,created_at FROM products LIMIT 0"],
  accounts:["SELECT id,email,name,role,store_id,password_salt,password_hash FROM users LIMIT 0",
    "SELECT user_id,token_hash,expires_at FROM sessions LIMIT 0","SELECT user_id,phone,email_verified,phone_verified FROM customer_profiles LIMIT 0"],
  auth:["SELECT id,target,name,salt,code_hash,purpose,user_id,consumed_at,attempts,expires_at FROM verification_challenges LIMIT 0",
    "SELECT provider,provider_subject,user_id FROM auth_identities LIMIT 0","SELECT identity_hash,count,reset_at FROM auth_rate_limits LIMIT 0",
    "SELECT state_hash,code_verifier,user_id,expires_at FROM oauth_states LIMIT 0"],
} as const
export async function schemaReady(db:Database,part:keyof typeof checks) {
  try{await Promise.all(checks[part].map(query=>db.prepare(query).all()));return true}catch{return false}
}
export function schemaFailure(cause:unknown) {
  return cause instanceof Error&&/no such (?:table|column)|has no column|schema|database binding/i.test(cause.message)
}
