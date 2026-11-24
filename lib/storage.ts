import { createClient } from "@supabase/supabase-js";
import { empty, type Ledger } from "./finance";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const cloud = url && key ? createClient(url,key) : null;
export type Workspace = { ledger: Ledger; version: number };

export async function loadWorkspace(owner: string): Promise<Workspace> {
  if (!cloud) throw Error("Supabase is unavailable.");
  const {data,error} = await cloud.from("workspaces").select("ledger,version").eq("owner",owner).maybeSingle();
  if (error) throw Error(error.message);
  return data ?? {ledger:empty, version:0};
}

export async function saveWorkspace(owner: string, ledger: Ledger, version: number) {
  if (!cloud) throw Error("Supabase is unavailable.");
  const next = version + 1;
  const result = version === 0
    ? await cloud.from("workspaces").insert({owner,ledger,version:next}).select("version").single()
    : await cloud.from("workspaces").update({ledger,version:next}).eq("owner",owner).eq("version",version).select("version").maybeSingle();
  if (result.error || !result.data) throw Error("Couldn’t save. If another tab changed this workspace, reload before trying again.");
  return next;
}
