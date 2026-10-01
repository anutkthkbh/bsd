import type { Database, User } from './types'
import { error, json, randomId } from './security'

type NotificationRow = {
  id:string
  type:string
  title:string
  message:string
  target_url:string
  read_at:string|null
  created_at:string
}

export async function notificationsForUser(db:Database,user:User) {
  const notifications=(await db.prepare(`SELECT id,type,title,message,target_url,read_at,created_at
    FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100`)
    .bind(user.id).all<NotificationRow>()).results
  const unread=notifications.reduce((count,item)=>count+(item.read_at?0:1),0)
  return {notifications,unread}
}

export async function notificationResponse(db:Database,user:User) {
  return json(await notificationsForUser(db,user))
}

export async function markNotificationRead(db:Database,user:User,id:string) {
  const result=await db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
    WHERE id=? AND user_id=?`).bind(id,user.id).run() as {meta?:{changes:number}}
  if (!result.meta?.changes) return error('ההתראה לא נמצאה',404)
  return json({ok:true})
}

export async function markAllNotificationsRead(db:Database,user:User) {
  await db.prepare(`UPDATE notifications SET read_at=CURRENT_TIMESTAMP
    WHERE user_id=? AND read_at IS NULL`).bind(user.id).run()
  return json({ok:true})
}

export function userNotificationStatement(db:Database,userId:string,input:{
  type:string;title:string;message:string;targetUrl?:string;dedupeKey:string
}) {
  return db.prepare(`INSERT OR IGNORE INTO notifications
    (id,user_id,type,title,message,target_url,dedupe_key) VALUES (?,?,?,?,?,?,?)`)
    .bind(randomId(),userId,input.type,input.title,input.message,input.targetUrl||'',input.dedupeKey)
}

export async function notifyStoreUsers(db:Database,storeId:string,input:{
  type:string;title:string;message:string;targetUrl?:string;dedupeKey:string
}) {
  const users=(await db.prepare('SELECT id FROM users WHERE store_id=?').bind(storeId).all<{id:string}>()).results
  for (const user of users) {
    await userNotificationStatement(db,user.id,{...input,dedupeKey:`${input.dedupeKey}:${user.id}`}).run()
  }
}
