"use client";

import { useEffect, useRef } from "react";
import { cloud } from "@/lib/storage";
import type { BankSnapshot } from "@/lib/plaid-import";

type LinkHandler = {open():void; destroy():void};
type LinkSDK = {
  create(config:{
    token:string; receivedRedirectUri?:string;
    onSuccess(token:string):void; onExit(error:unknown):void;
  }):LinkHandler;
};
type LinkWindow=Window & {Plaid?:LinkSDK};
const TOKEN_KEY = "brighter-future-plaid-link";
let loadPromise: Promise<LinkSDK> | undefined;

function sdk() {
  const existing=(window as LinkWindow).Plaid;
  if (existing) return Promise.resolve(existing);
  loadPromise ??= new Promise<LinkSDK>((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.onload=()=>{
      const api=(window as LinkWindow).Plaid;
      if(api) resolve(api);
      else {loadPromise=undefined;script.remove();reject(Error("Plaid Link could not start."));}
    };
    script.onerror=()=>{loadPromise=undefined;script.remove();reject(Error("Couldn’t load Plaid Link. Check your connection."));};
    document.head.append(script);
  });
  return loadPromise;
}

type Result = {linkToken?:string; snapshots?:BankSnapshot[]; skipped?:number; message?:string};
async function request(action:"link"|"exchange"|"refresh", publicToken?:string):Promise<Result> {
  const token=(await cloud?.auth.getSession())?.data.session?.access_token;
  if (!token) throw Error("Sign in to your private workspace before importing accounts.");
  const response=await fetch("/api/plaid",{method:"POST",headers:{
    "Content-Type":"application/json",Authorization:"Bearer "+token,
  },body:JSON.stringify({action,publicToken})});
  const result=await response.json() as Result;
  if (!response.ok) throw Error(result.message??"Bank import failed.");
  return result;
}

async function launch(token:string, onToken:(token:string)=>void, onExit:(failed:boolean)=>void, receivedRedirectUri?:string) {
  const api=await sdk();
  const handler=api.create({
    token, receivedRedirectUri,
    onSuccess:publicToken=>{sessionStorage.removeItem(TOKEN_KEY);handler.destroy();onToken(publicToken);},
    onExit:error=>{sessionStorage.removeItem(TOKEN_KEY);handler.destroy();onExit(Boolean(error));},
  });
  handler.open();
}
type Callbacks = {
  start(): boolean;
  finish(message?:string):void;
  receive(result:Result):Promise<void>;
};
function explain(error:unknown) {
  return error instanceof Error ? error.message : "Bank import couldn’t finish.";
}

export async function openBankLink(callbacks:Callbacks) {
  if (!callbacks.start()) return;
  try {
    const {linkToken}=await request("link");
    if (!linkToken) throw Error("Plaid didn’t return a Link session. Try again.");
    sessionStorage.setItem(TOKEN_KEY,linkToken);
    await launch(linkToken, async publicToken=>{
      try {await callbacks.receive(await request("exchange",publicToken));}
      catch(error) {callbacks.finish(explain(error));}
    },failed=>callbacks.finish(failed?"Plaid Link couldn’t finish. Try Import Accounts again.":undefined));
  } catch(error) {
    sessionStorage.removeItem(TOKEN_KEY);
    callbacks.finish(explain(error));
  }
}
export async function refreshBanks(callbacks:Callbacks) {
  if (!callbacks.start()) return;
  try {await callbacks.receive(await request("refresh"));}
  catch(error) {callbacks.finish(explain(error));}
}
export function ResumeBankLink({enabled,callbacks}:{enabled:boolean;callbacks:Callbacks}) {
  const current=useRef(callbacks);
  const resumed=useRef(false);
  useEffect(()=>{current.current=callbacks;},[callbacks]);
  useEffect(()=>{
    if(!enabled || resumed.current) return;
    const url=new URL(window.location.href);
    if(!url.searchParams.has("oauth_state_id")) return;
    resumed.current=true;
    const token=sessionStorage.getItem(TOKEN_KEY);
    const clearQuery=()=>{url.searchParams.delete("oauth_state_id");window.history.replaceState(null,"",url);};
    const cb=current.current;
    if(!cb.start()) return;
    if(!token){clearQuery();cb.finish("Your Plaid session expired. Start again from Accounts.");return;}
    void launch(token,async publicToken=>{
      clearQuery();
      try {await cb.receive(await request("exchange",publicToken));}
      catch(error) {cb.finish(explain(error));}
    },failed=>{clearQuery();cb.finish(failed?"Plaid Link couldn’t resume. Try Import Accounts again.":undefined);},window.location.href)
      .catch(error=>{clearQuery();cb.finish(explain(error));});
  },[enabled]);
  return null;
}
