import { getUserSession } from '../user-auth';
interface Env { DB:D1Database; STRIPE_SECRET_KEY?:string; STRIPE_PRICE_INITIAL_25?:string }
export const onRequestPost: PagesFunction<Env> = async ({request,env}) => {
  const user=await getUserSession(request,env.DB);
  if(!user)return Response.json({error:'Authentication required'},{status:401});
  if(!env.STRIPE_SECRET_KEY||!env.STRIPE_PRICE_INITIAL_25)return Response.json({error:'Billing is not configured'},{status:503});
  const origin=new URL(request.url).origin;
  const form=new URLSearchParams({mode:'payment',success_url:`${origin}/account?checkout=success`,cancel_url:`${origin}/account?checkout=cancelled`,'line_items[0][price]':env.STRIPE_PRICE_INITIAL_25,'line_items[0][quantity]':'1','metadata[user_id]':user.id,'metadata[kind]':'topup'});
  if(user.stripeCustomerId)form.set('customer',user.stripeCustomerId);else form.set('customer_email',user.email);
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`topup-${user.id}-${Math.floor(Date.now()/600000)}`},body:form});
  const session=await response.json<Record<string,unknown>>();
  if(!response.ok||!session.url)return Response.json({error:'Unable to create top-up checkout'},{status:502});
  return Response.json({ok:true,url:session.url});
};
