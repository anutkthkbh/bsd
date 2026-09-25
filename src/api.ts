export interface Store {
  id: string; slug: string; name: string; category: string; description: string; city: string; logo_url: string; status?: string; product_count?: number
}
export interface Product {
  id: string; store_id: string; slug: string; name: string; category: string; description: string
  price_agorot: number; image_url: string; stock: number; status?: string; variants_json: string
  store_name?: string; store_slug?: string; selected_variant?: string
}
export interface Account { id:string; email:string; name:string; role:'admin'|'merchant'; store_id:string|null }
export interface Order { id:string; customer_name:string; total_agorot:number; payment_status:string; fulfillment_status:string; created_at:string }
export interface Entry { id:string; kind:string; amount_agorot:number; order_id:string|null; created_at:string }
export interface MerchantData {
  store:Store; products:Product[]; orders:Order[]; ledger:Entry[]
  profile:Record<string,string>|null; payment:Record<string,string|number>|null; invoice:Record<string,string>|null
}
export interface AdminData { stores:Store[]; users:Array<{id:string;email:string;store_id:string}> }
export async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  const response = await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...options.body?{'content-type':'application/json'}:{},...options.headers}})
  const data = await response.json().catch(()=>({error:'לא התקבלה תשובה מהשרת'}))
  if(!response.ok) throw new Error(data.error || 'הבקשה נכשלה')
  return data as T
}
export const send = <T,>(path:string, method:string, data?:unknown)=>api<T>(path,{method,body:data===undefined?undefined:JSON.stringify(data)})
export const ils = (agorot:number) => new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:agorot%100?2:0}).format(agorot/100)
