import type { MediaBucket } from './types'
import { error, json, randomId } from './security'

const maxBytes=5*1024*1024
const mimeForExt:Record<string,string>={jpg:'image/jpeg',png:'image/png',webp:'image/webp'}

function actualType(bytes:Uint8Array) {
  if (bytes.length>3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'jpg'
  if (bytes.length>8 && bytes.slice(0,8).every((b,i)=>b===[137,80,78,71,13,10,26,10][i])) return 'png'
  if (bytes.length>12 && new TextDecoder().decode(bytes.slice(0,4))==='RIFF' &&
    new TextDecoder().decode(bytes.slice(8,12))==='WEBP') return 'webp'
  return null
}

export async function uploadMedia(request:Request,bucket:MediaBucket|undefined,storeId:string) {
  if (!bucket) return error('אחסון התמונות עדיין לא חובר ב־Cloudflare',503)
  if (Number(request.headers.get('content-length')||0)>maxBytes) return error('התמונה גדולה מ־5MB',413)
  const reader=request.body?.getReader()
  if (!reader) return error('יש לבחור תמונה')
  const chunks:Uint8Array[]=[];let length=0
  try {
    while (true) {
      const {done,value}=await reader.read()
      if (done) break
      length+=value.length
      if (length>maxBytes) {await reader.cancel();return error('התמונה גדולה מ־5MB',413)}
      chunks.push(value)
    }
  } finally {reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length}
  const ext=actualType(bytes)
  if (!ext || mimeForExt[ext]!==request.headers.get('content-type')) return error('ניתן להעלות JPG, PNG או WebP בלבד')
  const key=`${storeId}/${randomId()}.${ext}`
  await bucket.put(key,bytes,{httpMetadata:{contentType:mimeForExt[ext]}})
  return json({url:`/api/media/${key}`},201)
}

export async function getMedia(bucket:MediaBucket|undefined,path:string) {
  if (!bucket) return error('אחסון התמונות עדיין לא חובר',503)
  if (!/^[\w-]{8,70}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return error('התמונה לא נמצאה',404)
  const object=await bucket.get(path)
  if (!object) return error('התמונה לא נמצאה',404)
  const ext=path.split('.').pop()!
  return new Response(object.body,{headers:{'content-type':mimeForExt[ext],'cache-control':'public, max-age=31536000, immutable',
    'x-content-type-options':'nosniff',...(object.httpEtag?{'etag':object.httpEtag}:{})}})
}
