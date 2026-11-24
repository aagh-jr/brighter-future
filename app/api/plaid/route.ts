import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { normalizeSnapshot, type PlaidAccount, type PlaidTransaction } from "@/lib/plaid-import";

export const runtime = "nodejs";

class PublicError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
class ProviderError extends Error {
  constructor(readonly code: string) { super("Plaid request failed"); }
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const environment = process.env.PLAID_ENV ?? "sandbox";
  const key = Buffer.from(process.env.PLAID_TOKEN_KEY ?? "", "base64");
  if (!url || !publicKey || !serviceKey || !clientId || !secret || key.length !== 32 ||
    !["sandbox","production"].includes(environment)) {
    throw new PublicError("Bank import is unavailable until Plaid and Supabase are configured. See the project README.",503);
  }
  return {url,publicKey,serviceKey,clientId,secret,environment,key};
}
type Config = ReturnType<typeof config>;

async function plaid<T>(cfg: Config, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://" + cfg.environment + ".plaid.com" + path,{
    method:"POST", headers:{"Content-Type":"application/json"}, cache:"no-store",
    body:JSON.stringify({...body,client_id:cfg.clientId,secret:cfg.secret}), signal:AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new ProviderError(data.error_code ?? "UNKNOWN");
  return data;
}
function encrypt(key: Buffer, token: string, owner: string, itemId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from(owner+":"+itemId));
  const ciphertext = Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString("base64");
}
function decrypt(key: Buffer, value: string, owner: string, itemId: string) {
  const bytes = Buffer.from(value,"base64");
  const cipher = createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(owner+":"+itemId));
  cipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString("utf8");
}
type SyncPage = {
  added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: {transaction_id:string}[];
  next_cursor: string; has_more: boolean; transactions_update_status?: string;
};
async function snapshot(cfg: Config, itemId: string, accessToken: string) {
  const {accounts} = await plaid<{accounts:PlaidAccount[]}>(cfg,"/accounts/get",{access_token:accessToken});
  // Replay from the start so a failed import needs no cursor rollback or client state repair.
  for (let attempt=0; attempt<3; attempt++) {
    const rows = new Map<string,PlaidTransaction>();
    let cursor: string | undefined;
    try {
      for (let page=0; page<100; page++) {
        const result: SyncPage = await plaid(cfg,"/transactions/sync",{access_token:accessToken,cursor,count:500});
        for (const row of [...result.added,...result.modified]) rows.set(row.transaction_id,row);
        for (const row of result.removed) rows.delete(row.transaction_id);
        if (!result.has_more) {
          if (result.transactions_update_status === "NOT_READY") {
            throw new PublicError("Your bank is connected and still preparing transactions. Try Refresh accounts in a moment.",409);
          }
          return normalizeSnapshot(itemId,accounts,[...rows.values()]);
        }
        cursor = result.next_cursor;
      }
      throw new PublicError("This connection has too much transaction history for an interactive refresh.",422);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || attempt===2) throw error;
    }
  }
  throw new PublicError("Account activity changed during import. Try again.",409);
}
function reply(body: unknown, status = 200) {
  return Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  try {
    const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) throw new PublicError("Sign in to your private workspace before importing accounts.",401);
    const cfg = config();
    const auth = createClient(cfg.url,cfg.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error} = await auth.auth.getUser(bearer);
    if (!user || error) throw new PublicError("Your session expired. Sign in and try again.",401);
    const body = await request.json().catch(()=>null);
    if (!body || typeof body !== "object") throw new PublicError("Invalid import request.");
    if (body.action === "link") {
      const data = await plaid<{link_token:string}>(cfg,"/link/token/create",{
        user:{client_user_id:user.id}, client_name:"Brighter Future", language:"en", country_codes:["US"],
        products:["transactions"], transactions:{days_requested:90},
        redirect_uri:process.env.PLAID_REDIRECT_URI || undefined,
      });
      return reply({linkToken:data.link_token});
    }
    const admin = createClient(cfg.url,cfg.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    if (body.action === "exchange") {
      if (typeof body.publicToken !== "string" || !/^public-(sandbox|production)-[a-zA-Z0-9_-]+$/.test(body.publicToken)) {
        throw new PublicError("Plaid Link did not return a valid connection. Open Import Accounts again.");
      }
      const {item_id,access_token} = await plaid<{item_id:string;access_token:string}>(cfg,"/item/public_token/exchange",{public_token:body.publicToken});
      const {error: saveError} = await admin.from("plaid_items").insert({
        owner:user.id,item_id,encrypted_token:encrypt(cfg.key,access_token,user.id,item_id),
      });
      if (saveError) {
        await plaid(cfg,"/item/remove",{access_token}).catch(()=>{});
        throw new PublicError("Couldn’t save the bank connection. Check the database migration and try again.",503);
      }
      return reply({snapshots:[await snapshot(cfg,item_id,access_token)]});
    }
    if (body.action === "refresh") {
      const {data:items,error: readError} = await admin.from("plaid_items").select("item_id,encrypted_token").eq("owner",user.id);
      if (readError) throw new PublicError("Couldn’t read bank connections. Check the database migration.",503);
      if (!items.length) throw new PublicError("No banks are linked yet. Use Import Accounts first.",404);
      const results = await Promise.allSettled(items.map(item => snapshot(cfg,item.item_id,decrypt(cfg.key,item.encrypted_token,user.id,item.item_id))));
      const snapshots = results.flatMap(result => result.status==="fulfilled" ? [result.value] : []);
      if (!snapshots.length) {
        const rejection = results.find(result=>result.status==="rejected");
        if (rejection) throw rejection.reason;
        throw new PublicError("No bank accounts could be refreshed.",502);
      }
      return reply({snapshots, skipped:results.length-snapshots.length});
    }
    throw new PublicError("Unknown import action.");
  } catch (error) {
    if (error instanceof PublicError) return reply({message:error.message},error.status);
    if (error instanceof ProviderError && error.code === "ITEM_LOGIN_REQUIRED") {
      return reply({message:"Your bank requires you to sign in again. This connection needs Plaid Link update mode."},409);
    }
    return reply({message:"Bank import couldn’t finish. Check Plaid configuration or try again shortly."},502);
  }
}
