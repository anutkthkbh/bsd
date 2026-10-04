export interface Store {
  id: string; slug: string; name: string; category: string; description: string; city: string; logo_url: string; status?: string; product_count?: number
}
export interface Product {
  id: string; store_id: string; slug: string; name: string; category: string; description: string
  price_agorot: number; image_url: string; stock: number; status?: string; variants_json: string
  store_name?: string; store_slug?: string; selected_variant?: string
}
export interface Account { id:string; email:string; name:string; role:'admin'|'merchant'|'customer'; store_id:string|null }
export interface AuthCapabilities { email:boolean; sms:boolean; google:boolean; setup_required?:boolean }
export interface CustomerProfile { phone:string; email_verified:number; phone_verified:number; updated_at?:string }
export interface CustomerRequestItem {
  store_request_id:string; product_id:string; product_name:string; variant:string; quantity:number; unit_price_agorot:number
}
export interface CustomerStoreRequest {
  id:string; request_id:string; store_id:string; store_name:string; status:'new'|'contacted'|'closed'
  subtotal_agorot:number; created_at:string; items:CustomerRequestItem[]
}
export interface CustomerPurchaseRequest {
  id:string; status:'open'|'closed'; total_agorot:number; created_at:string; stores:CustomerStoreRequest[]
}
export interface CustomerAccountData { user:Account; profile:CustomerProfile|null; requests:CustomerPurchaseRequest[] }
export interface Notification {
  id:string; type:string; title:string; message:string; target_url:string; read_at:string|null; created_at:string
}
export interface NotificationsData { notifications:Notification[]; unread:number }
export interface Order { id:string; customer_name:string; total_agorot:number; payment_status:string; fulfillment_status:string; created_at:string }
export interface Entry { id:string; kind:string; amount_agorot:number; order_id:string|null; created_at:string }
export interface PurchaseRequest {
  id:string; request_id:string; status:'new'|'contacted'|'closed'; subtotal_agorot:number; created_at:string
  customer_name:string; customer_email:string; customer_phone:string
  items:Array<{product_name:string;variant:string;quantity:number;unit_price_agorot:number}>
}
export interface BasketQuote {
  groups:Array<{store_id:string;store_name:string;subtotal_agorot:number;items:Array<{
    product_id:string;name:string;variant:string;quantity:number;unit_price_agorot:number;line_total_agorot:number
  }>}>;total_agorot:number;currency:'ILS';payment_available:boolean;note:string
}
export interface MerchantData {
  store:Store; products:Product[]; orders:Order[]; ledger:Entry[]; requests:PurchaseRequest[]
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
