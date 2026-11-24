"use client";

import { cloneElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, BarChart3, ChevronDown, CircleHelp, CreditCard, Grid2X2, Landmark, Link2, List, Loader2, Package, Plus, Search, ShieldCheck, Target, Trash2, Upload, Wallet, X } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { affordableCount, accountTypes, categories, cents, empty, goalSaved, goalTarget, goalVaults, liability, money, monthsThrough, periodLabel, stats, sum, today, validDate, type Account, type Budget, type Goal, type GoalProduct, type Ledger, type Transaction } from "@/lib/finance";
import { cloud, loadWorkspace, saveWorkspace } from "@/lib/storage";
import { openBankLink, refreshBanks, ResumeBankLink } from "@/components/bank-import";
import { mergeBankSnapshots, type BankSnapshot } from "@/lib/plaid-import";

const nav = [
  {name:"Overview", icon:Grid2X2}, {name:"Transactions",icon:List}, {name:"Budgets",icon:BarChart3},
  {name:"Savings goals",icon:Target}, {name:"Accounts",icon:Wallet}, {name:"Credit Cards",icon:CreditCard},
] as const;
type View = typeof nav[number]["name"];
type Editor = {kind:"transaction"; row?:Transaction} | {kind:"account";row?:Account} | {kind:"budget";row?:Budget} | {kind:"goal";row?:Goal} | {kind:"import"} | {kind:"settings"};
const palette = ["#ed7142","#202422","#8d9e81","#eab39e","#bec4b5","#bbb5aa","#ce9671","#838781"];
const amountInput = (value?:number) => value === undefined ? undefined : (value / 100).toFixed(2);
const signedMoney = (n:number) => n < 0 ? "−" + money(-n) : "+" + money(n);
const glyph = {size:17,strokeWidth:1.7};
type DraftProduct = {id:string; name:string; price:string; url:string; image?:string; status?:"loading"|"error"; message?:string};
const blankProduct = ():DraftProduct => ({id:crypto.randomUUID(),name:"",price:"",url:""});
function Field({ label, children }: {label:string;children:ReactElement<{"aria-labelledby"?: string}>}) {
  const labelId = useId();
  return <label className="field"><span id={labelId}>{label}</span>{cloneElement(children, {"aria-labelledby": labelId})}</label>;
}
function Section({title, detail, action, children}:{title:string; detail?:string;action?:ReactNode;children:ReactNode}) {
  return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>{children}</section>;
}
function Progress({value, max}:{value:number; max:number}) {
  return <div className="progress" role="progressbar" aria-label="Progress" aria-valuenow={Math.min(value,max)} aria-valuemin={0} aria-valuemax={max}><div className={value>max?"over":""} style={{width:Math.min(100,value/max*100)+"%"}} /></div>;
}

export default function Page() {
  const [ledger,setLedger] = useState<Ledger>(empty);
  const [view,setView] = useState<View>("Overview");
  const [month,setMonth] = useState(() => today().slice(0,7));
  const [owner,setOwner] = useState("");
  const [version,setVersion] = useState(0);
  const [loading,setLoading] = useState(Boolean(cloud));
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [editor,setEditor] = useState<Editor>();
  const [search,setSearch] = useState("");
  const [category,setCategory] = useState("");
  const [accountFilter,setAccountFilter] = useState("");
  const [direction,setDirection] = useState("");
  const [trend,setTrend] = useState(false);
  const [periodOnly,setPeriodOnly] = useState(false);
  const [csvRows,setCsvRows] = useState<Transaction[]>([]);
  const [confirmDelete,setConfirmDelete] = useState(false);
  const [draftProducts,setDraftProducts] = useState<DraftProduct[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileSequence = useRef(0);
  const writeLock = useRef(false);

  useEffect(() => {
    if (!cloud) return;
    const client = cloud;
    let alive = true;
    let sequence = 0;
    const install = async (id: string) => {
      const current = ++sequence;
      setLoading(true);
      setLedger(empty);
      setOwner(id);
      setVersion(0);
      setMonth(today().slice(0,7));
      try {
        if (id) {
          const loaded = await loadWorkspace(id);
          if (!alive || current !== sequence) return;
          setLedger(loaded.ledger);
          setVersion(loaded.version);
        }
      } catch (problem) {
        if (alive && current === sequence) setNotice(problem instanceof Error ? problem.message : "Workspace failed to load.");
      } finally {
        if (alive && current === sequence) setLoading(false);
      }
    };
    const {data:{subscription}} = client.auth.onAuthStateChange((event,session) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
        queueMicrotask(()=>{if(alive) void install(session?.user.id ?? "");});
      }
    });
    return () => {alive=false; subscription.unsubscribe();};
  }, []);

  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
    if (!editor && dialog.current?.open) dialog.current.close();
  }, [editor]);

  function open(next: Editor) {
    fileSequence.current++;
    setEditor(next);setError("");setCsvRows([]);setConfirmDelete(false);
    setDraftProducts(next.kind==="goal" ? (next.row?.products??[]).map(p=>({id:p.id,name:p.name,price:amountInput(p.price)!,url:p.url??"",image:p.image})) : []);
  }
  function close() { if (!writeLock.current) {fileSequence.current++;setEditor(undefined);} }
  async function commit(next: Ledger, message: string) {
    if (writeLock.current || loading) return;
    writeLock.current=true;setBusy(true);setError("");
    try {
      if (owner) setVersion(await saveWorkspace(owner,next,version));
      setLedger(next);
      setNotice(message);
      setEditor(undefined);
    } catch(e) {setError(e instanceof Error?e.message:"Couldn’t save changes.");}
    finally {writeLock.current=false;setBusy(false);}
  }
  async function signIn(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cloud || writeLock.current) return;
    const data = new FormData(event.currentTarget);
    writeLock.current=true;setBusy(true);setError("");
    try {
      const {error: issue} = await cloud.auth.signInWithPassword({email:String(data.get("email")),password:String(data.get("password"))});
      if (issue) throw issue;
      window.location.reload();
    } catch(e) {setError(e instanceof Error?e.message:"Sign-in failed.");}
    finally {writeLock.current=false;setBusy(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key:string) => String(data.get(key) ?? "").trim();
    const name = value("name");
    setError("");
    try {
      switch (editor?.kind) {
        case "transaction": {
          const amount = cents(value("amount"));
          if (!name || !amount || !validDate(value("date")) || !ledger.accounts.some(a=>a.id===value("account"))) throw Error("Enter a description, date, account, and an amount above zero.");
          const row:Transaction = {...editor.row,id:editor.row?.id??crypto.randomUUID(),name,date:value("date"),category:value("category"),accountId:value("account"),amount:value("direction")==="income"?amount:-amount,source:editor.row?.source??"manual"};
          await commit({...ledger,transactions:[...ledger.transactions.filter(t=>t.id!==row.id),row]},"Transaction saved.");
          break;
        }
        case "account": {
          const type=value("type") as Account["type"];
          if(!name || !accountTypes.includes(type)) throw Error("Enter a name and account type.");
          const row:Account={id:editor.row?.id||crypto.randomUUID(),name,type,balance:cents(value("amount"),!liability({type} as Account))};
          await commit({...ledger,accounts:editor.row?.id ? ledger.accounts.map(a=>a.id===row.id?row:a) : [...ledger.accounts,row]},"Account balance saved.");
          break;
        }
        case "budget": {
          const category=value("category"), limit=cents(value("amount"));
          if (!limit) throw Error("Enter a monthly limit above zero.");
          if (ledger.budgets.some(b=>b.category===category && b.id!==editor.row?.id)) throw Error("This category already has a budget. Edit its existing limit.");
          const row={id:editor.row?.id??crypto.randomUUID(),category,limit};
          await commit({...ledger,budgets:[...ledger.budgets.filter(b=>b.id!==row.id),row]},"Budget saved.");
          break;
        }
        case "goal": {
          const products:GoalProduct[]=draftProducts.filter(p=>p.name.trim()||p.price.trim()||p.url.trim()).map((p,i)=>{
            if(!p.name.trim()) throw Error("Name product "+(i+1)+" or remove it.");
            let price:number;
            try {price=cents(p.price);} catch {throw Error("Enter a price for "+p.name.trim()+".");}
            if(!price) throw Error("Enter a price above zero for "+p.name.trim()+".");
            let url:string|undefined;
            if(p.url.trim()) { try {url=new URL(p.url.trim()).href;} catch {throw Error("Check the link for "+p.name.trim()+".");} }
            return {id:p.id,name:p.name.trim().slice(0,100),price,...(url?{url}:{}),...(p.image?{image:p.image}:{})};
          });
          const accountIds=data.getAll("accounts").map(String).filter(id=>ledger.accounts.some(a=>a.id===id&&!liability(a)));
          const target=products.length?0:cents(value("amount")), saved=accountIds.length?0:cents(value("saved")||"0");
          if(!name) throw Error("Enter a goal name.");
          if(!products.length && !target) throw Error("Add a product or enter a target above zero.");
          const row:Goal={id:editor.row?.id??crypto.randomUUID(),name,target,saved,...(products.length?{products}:{}),...(accountIds.length?{accountIds}:{})};
          await commit({...ledger,goals:[...ledger.goals.filter(g=>g.id!==row.id),row]},"Savings goal saved.");
          break;
        }
      }
    } catch(e) {setError(e instanceof Error?e.message:"Check your entries.");}
  }

  async function readCsv(file:File | undefined, accountId: string) {
    const current = ++fileSequence.current;
    setCsvRows([]);setError("");
    if (!file) return;
    if (file.size>2_000_000) {setError("Choose a CSV under 2 MB.");return;}
    if (!ledger.accounts.some(a=>a.id===accountId)) {setError("Choose a destination account.");return;}
    try {
      const parsed=Papa.parse<Record<string,string>>(await file.text(),{header:true,skipEmptyLines:"greedy",transformHeader:h=>h.trim().toLowerCase()});
      if(parsed.errors.length || !["date","description","amount"].every(h=>parsed.meta.fields?.includes(h))) throw Error("Use CSV headers date, description, amount, and optional category.");
      const existing = new Set(ledger.transactions.flatMap(r=>r.originKey?[r.originKey]:[]));
      const occurrences = new Map<string,number>();
      const rows:Transaction[] = [];
      parsed.data.forEach((row,i)=>{
        const date=row.date?.trim(), name=row.description?.trim(), category=row.category?.trim()||"Other";
        let amount:number;
        try {amount=cents(row.amount??"",true);} catch {throw Error("Check the amount on CSV row "+(i+2)+".");}
        if(!validDate(date) || !name || name.length>100 || !amount || !categories.includes(category)) throw Error("Check the date, description, amount and category on CSV row "+(i+2)+".");
        const key=JSON.stringify([accountId,date,name.toLowerCase(),amount]);
        const occurrence=(occurrences.get(key)??0)+1;
        occurrences.set(key,occurrence);
        const originKey=key+":"+occurrence;
        if(!existing.has(originKey)) rows.push({id:crypto.randomUUID(),date,name,category,accountId,amount,source:"csv",originKey});
      });
      if (current!==fileSequence.current) return;
      if (!rows.length) throw Error("No new transactions found in this file.");
      setCsvRows(rows);
    } catch(e) {if(current===fileSequence.current) setError(e instanceof Error?e.message:"Couldn’t read the CSV.");}
  }

  const bankCallbacks = {
    start() {
      if (writeLock.current || loading) return false;
      writeLock.current=true;setBusy(true);setNotice("");
      return true;
    },
    finish(message?:string) {
      writeLock.current=false;setBusy(false);
      if(message) setNotice(message);
    },
    async receive(result:{snapshots?:BankSnapshot[]; skipped?:number}) {
      if (!owner || !result.snapshots?.length) throw Error("No bank data was returned.");
      const next=mergeBankSnapshots(ledger,result.snapshots);
      const updated=await saveWorkspace(owner,next,version);
      setVersion(updated);setLedger(next);setView("Accounts");
      const accounts=sum(result.snapshots.map(snapshot=>snapshot.accounts.length));
      const transactions=sum(result.snapshots.map(snapshot=>snapshot.transactions.length));
      this.finish("Received "+accounts+" accounts and "+transactions+" posted transactions."
        +(result.skipped?" "+result.skipped+" connections could not refresh.":""));
    },
  };

  const transactions=[...ledger.transactions].sort((a,b)=>b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const monthRows=transactions.filter(t=>t.date.startsWith(month));
  const {income,expenses}=stats(monthRows);
  const savings=sum(ledger.accounts.filter(a=>a.type==="Savings").map(a=>a.balance));
  const netWorth=sum(ledger.accounts.map(a=>liability(a)?-a.balance:a.balance));
  const cash=sum(ledger.accounts.filter(a=>a.type==="Checking" || a.type==="Savings").map(a=>a.balance));
  const chart=monthsThrough(month,6).map(m=>{
    const totals=stats(transactions.filter(r=>r.date.startsWith(m)));
    return {month: periodLabel(m), income:totals.income/100, expenses:totals.expenses/100, net:(totals.income-totals.expenses)/100};
  });
  const breakdown=categories.filter(c=>c!=="Transfer").map((name,i)=>({name,value:-sum(monthRows.filter(t=>t.amount<0&&t.category===name).map(t=>t.amount)),color:palette[i%palette.length]})).filter(c=>c.value>0).sort((a,b)=>b.value-a.value);
  const visible=transactions.filter(t=>(!periodOnly||t.date.startsWith(month)) && (!category||t.category===category) && (!accountFilter||t.accountId===accountFilter) && (!direction||(direction==="income"?t.amount>0:t.amount<0)) && [t.name,t.category,t.date].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  const availableMonths=Array.from(new Set([month,today().slice(0,7),...transactions.map(t=>t.date.slice(0,7)),...monthsThrough(month,12)])).sort().reverse();
  const creditCards=ledger.accounts.filter(a=>a.type==="Credit card");
  const cardIds=new Set(creditCards.map(a=>a.id));
  const cardTransactions=transactions.filter(t=>cardIds.has(t.accountId));
  const title = view==="Overview"?"Financial overview":view;
  const edit = editor && "row" in editor && editor.row?.id ? editor.row : undefined;
  const t = editor?.kind==="transaction" ? editor.row : undefined;
  const a = editor?.kind==="account" ? editor.row : undefined;
  const b = editor?.kind==="budget" ? editor.row : undefined;
  const g = editor?.kind==="goal" ? editor.row : undefined;
  const editorTitle = editor?.kind==="settings" ? "Workspace" : editor?.kind==="import" ? "Import transactions" : editor?.kind==="goal" ? (edit?"Edit goal":"New goal") : (edit?"Edit ":"Add ")+(editor?.kind??"");

  function table(rows:Transaction[], compact=false) {
    return <div className="table-wrap"><table><thead><tr><th>Description</th><th>Category</th><th>Date</th><th className="number">Amount</th>{!compact&&<th><span className="sr-only">Actions</span></th>}</tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}><td><div className="description"><span className={"tx-icon "+(r.amount>0?"income":"")}>{r.amount>0?<ArrowDownLeft {...glyph}/>:<ArrowUpRight {...glyph}/>}</span><div><strong>{r.name}</strong><small>{ledger.accounts.find(a=>a.id===r.accountId)?.name??"Unassigned"}{r.source==="csv"?" · CSV":""}</small></div></div></td><td><span className="category">{r.category}</span></td><td className="mono">{new Date(r.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",...(!compact?{year:"numeric"}:{})})}</td><td className={"number mono "+(r.amount>0?"positive":"")}>{signedMoney(r.amount)}</td>{!compact&&<td className="number"><Button variant="ghost" aria-label={"Edit "+r.name} onClick={()=>open({kind:"transaction",row:r})}>Edit</Button></td>}</tr>)}</tbody></table>
    {!rows.length&&<p className="empty">No transactions match this view.</p>}</div>;
  }
  function goals() {
    return <div className="item-list">{ledger.goals.length?ledger.goals.map(g=>{
      const target=goalTarget(g), saved=goalSaved(g,ledger.accounts), vaults=goalVaults(g,ledger.accounts);
      const products=g.products??[], canBuy=affordableCount(products,saved), ready=saved>=target;
      const status=ready?(products.length>1?"Enough for all "+products.length+" products":"Enough to buy it"):products.length>1?(canBuy?"Can buy up to "+canBuy+" of "+products.length+" products":"Not enough for any product yet")+" · "+money(target-saved)+" left":money(target-saved)+" left";
      return <div className="progress-item" key={g.id}><div className="item-line"><strong>{g.name}</strong><Button variant="ghost" onClick={()=>open({kind:"goal",row:g})}>Edit</Button></div>
        {products.length?<ul className="goal-products">{[...products].sort((x,y)=>x.price-y.price).map(p=><li key={p.id}>
          <span className="goal-thumb">{p.image?<img src={p.image} alt="" referrerPolicy="no-referrer" loading="lazy" onError={e=>{e.currentTarget.style.display="none";}}/>:null}<Package size={15} strokeWidth={1.7}/></span>
          <span className="goal-product-name">{p.url?<a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>:p.name}</span>
          <span className="mono">{money(p.price)}</span></li>)}</ul>:null}
        <Progress value={saved} max={target}/>
        <p className={"goal-status"+(ready?" ready":"")}>{status}</p>
        <div className="item-line"><span>{money(saved)} of {money(target)}{vaults.length?" · in "+vaults.map(a=>a.name).join(", "):""}</span><span className="mono">{Math.min(100,Math.floor(saved/target*100))}%</span></div></div>;
    }):<p className="empty">Create a goal, paste links to the products you’re saving for, and pick the account that holds the money.</p>}</div>;
  }
  function budgets() {
    return <div className="item-list">{ledger.budgets.length?ledger.budgets.map(b=>{
      const spent=-sum(monthRows.filter(t=>t.amount<0&&t.category===b.category).map(t=>t.amount));
      return <div className="progress-item" key={b.id}><div className="item-line"><strong>{b.category}</strong><Button variant="ghost" onClick={()=>open({kind:"budget",row:b})}>Edit</Button></div><Progress value={spent} max={b.limit}/><div className="item-line"><span>{money(spent)} of {money(b.limit)} spent</span><span className="mono">{money(Math.abs(b.limit-spent))} {spent>b.limit?"over":"left"}</span></div></div>;
    }):<p className="empty">Add a category budget to see what remains each month.</p>}</div>;
  }

  async function lookupProduct(id:string, link:string) {
    const url=link.trim();
    if(!url) return;
    setDraftProducts(rows=>rows.map(r=>r.id===id?{...r,url,status:"loading",message:undefined}:r));
    try {
      const response=await fetch("/api/product-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
      const found=await response.json() as {name?:string;image?:string;price?:string;error?:string};
      if(!response.ok) throw Error(found.error??"Couldn’t read that page.");
      setDraftProducts(rows=>rows.map(r=>r.id!==id?r:{...r,name:r.name||found.name||"",price:r.price||found.price||"",image:found.image??r.image,status:undefined,
        message:found.price?undefined:"No price on that page. Enter it yourself."}));
    } catch(e) {
      setDraftProducts(rows=>rows.map(r=>r.id===id?{...r,status:"error",message:e instanceof Error?e.message:"Couldn’t read that page."}:r));
    }
  }
  function goalFields() {
    const vaultOptions=ledger.accounts.filter(a=>!liability(a));
    const productTotal=sum(draftProducts.map(p=>{try {return cents(p.price);} catch {return 0;}}));
    const setProduct=(id:string,patch:Partial<DraftProduct>)=>setDraftProducts(rows=>rows.map(r=>r.id===id?{...r,...patch}:r));
    const addFromLink=(link:string)=>{const row={...blankProduct(),url:link.trim()};setDraftProducts(rows=>[...rows,row]);void lookupProduct(row.id,link);};
    const droppedLink=(e:React.DragEvent)=>(e.dataTransfer.getData("text/uri-list").split("\n").find(l=>l&&!l.startsWith("#"))||e.dataTransfer.getData("text/plain")).trim();
    return <>
      <fieldset className="goal-group goal-drop" onDragOver={e=>{if(e.dataTransfer.types.includes("text/uri-list")||e.dataTransfer.types.includes("text/plain")){e.preventDefault();e.currentTarget.classList.add("over");}}} onDragLeave={e=>e.currentTarget.classList.remove("over")}
        onDrop={e=>{e.currentTarget.classList.remove("over");const link=droppedLink(e);if(/^https?:\/\//i.test(link)){e.preventDefault();addFromLink(link);}}}><legend>Products</legend>
        <label className="goal-paste"><Link2 size={16}/><input aria-label="Paste a product link" placeholder="Paste or drop a store link" onPaste={e=>{const link=e.clipboardData.getData("text").trim();if(/^https?:\/\//i.test(link)){e.preventDefault();addFromLink(link);}}}
          onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();const link=e.currentTarget.value.trim();if(link){addFromLink(link);e.currentTarget.value="";}}}}/></label>
        {draftProducts.map((p,i)=><div className="goal-product-card" key={p.id}>
          <span className="goal-thumb large">{p.status==="loading"?<Loader2 className="spin" size={18}/>:p.image?<img src={p.image} alt="" referrerPolicy="no-referrer" onError={()=>setProduct(p.id,{image:undefined})}/>:<Package size={18} strokeWidth={1.7}/>}</span>
          <div className="goal-product-fields">
            <div className="goal-product-row">
              <input aria-label={"Product "+(i+1)+" name"} placeholder={p.status==="loading"?"Reading the store page…":"Product name"} maxLength={100} value={p.name} onChange={e=>setProduct(p.id,{name:e.target.value})}/>
              <input aria-label={"Product "+(i+1)+" price (USD)"} placeholder="0.00" inputMode="decimal" value={p.price} onChange={e=>setProduct(p.id,{price:e.target.value})}/>
              <Button variant="ghost" aria-label={"Remove product "+(i+1)} onClick={()=>setDraftProducts(rows=>rows.filter(r=>r.id!==p.id))}><Trash2 size={16}/></Button>
            </div>
            <input aria-label={"Product "+(i+1)+" link"} placeholder="Store link (optional)" value={p.url} onChange={e=>setProduct(p.id,{url:e.target.value,message:undefined})} onBlur={e=>{if(e.target.value.trim()&&!p.image&&p.status!=="loading")void lookupProduct(p.id,e.target.value);}}/>
            {p.message&&<p className={"form-note"+(p.status==="error"?" warn":"")}>{p.message}</p>}
          </div>
        </div>)}
        <Button variant="outline" onClick={()=>setDraftProducts(rows=>[...rows,blankProduct()])}><Plus size={16}/> Add product manually</Button>
        {draftProducts.length>0&&<p className="form-note">Target is the product total: {money(productTotal)}.</p>}
      </fieldset>
      {!draftProducts.length&&<Field label="Target (USD)"><input name="amount" inputMode="decimal" defaultValue={amountInput(g?.target||undefined)} placeholder="0.00"/></Field>}
      <fieldset className="goal-group"><legend>Where the money is held</legend>
        {vaultOptions.length?vaultOptions.map(acc=><label className="checkbox" key={acc.id}><input type="checkbox" name="accounts" value={acc.id} defaultChecked={g?.accountIds?.includes(acc.id)}/> {acc.name} <span className="form-note">{acc.type} · {money(acc.balance)}</span></label>):<p className="form-note">Add a checking, savings or investment account to link it as this goal’s vault.</p>}
        <p className="form-note">Linked accounts count toward this goal automatically. Leave all unchecked to track the amount yourself.</p>
      </fieldset>
      <Field label="Saved so far, if no account is linked (USD)"><input name="saved" inputMode="decimal" defaultValue={amountInput(g?.saved??0)}/></Field>
    </>;
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">Brighter Future</div>
      <div className="sidebar-label">Workspace</div>
      <nav aria-label="Workspace">{nav.map(({name,icon:Icon})=><button key={name} className={view===name?"active":""} aria-current={view===name?"page":undefined} onClick={()=>setView(name)}><Icon {...glyph}/><span>{name}</span></button>)}</nav>
      <button className="side-settings" onClick={()=>open({kind:"settings"})}><CircleHelp {...glyph}/> Workspace settings</button>
      <div className="side-footer"><span className="avatar">P</span><div><strong>{owner?"Personal workspace":"Local session"}</strong><small>{owner?"Private account":"Unsaved on reload"}</small></div></div>
    </aside>
    <main>
      <ResumeBankLink enabled={!loading && Boolean(owner)} callbacks={bankCallbacks}/>
      <div className="topbar"><span><Grid2X2 size={14}/> Workspace <span className="slash">/</span> {view}</span><button className="status" onClick={()=>open({kind:"settings"})}><ShieldCheck size={15}/>{owner?"Private workspace":"Local session"}</button></div>
      <div className="content">
      <header className="page-heading"><div><h1>{title}</h1><p>{view==="Overview"?"Your accounts, activity, and plans in one place.":view==="Transactions"?"Search, categorize, and manage your activity.":view==="Budgets"?"Track monthly spending against category limits.":view==="Accounts"?"Manage the balances you use to calculate net worth.":view==="Credit Cards"?"See what you owe and review recent card activity.":"Set targets and update what you’ve saved."}</p></div>
        <div className="actions">
          {(view==="Overview"||view==="Budgets"||view==="Transactions")&&<div className="select-wrap"><select aria-label="Reporting month" value={month} onChange={e=>{setMonth(e.target.value);if(view==="Transactions")setPeriodOnly(true);}}>{availableMonths.map(m=><option key={m} value={m}>{periodLabel(m,true)}</option>)}</select><ChevronDown size={14}/></div>}
          {view==="Accounts"&&<>
            <Button variant="outline" disabled={loading||busy} onClick={()=>{
              if (!owner) open({kind:"settings"}); else void openBankLink(bankCallbacks);
            }}><Upload size={16}/> Import Accounts</Button>
            {owner&&<Button variant="outline" disabled={loading||busy} onClick={()=>void refreshBanks(bankCallbacks)}>Refresh accounts</Button>}
          </>}
          <Button disabled={loading||busy} onClick={()=>open(view==="Credit Cards"?{kind:"account",row:{id:"",name:"",type:"Credit card",balance:0}}:{kind:view==="Accounts"?"account":view==="Budgets"?"budget":view==="Savings goals"?"goal":"transaction"})}><Plus size={17}/>{view==="Credit Cards"?"Add card":view==="Accounts"?"Add account":view==="Budgets"?"Add budget":view==="Savings goals"?"New goal":"Add transaction"}</Button>
        </div>
      </header>
      <div className="sr-only" role="status">{notice}</div>
      {notice&&<div className="notice">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice("")}><X size={16}/></button></div>}
      {loading ? <p className="empty">Loading workspace…</p> : view==="Overview"?<>
        <div className="metrics">
          <div className="metric featured"><div className="metric-label"><Landmark {...glyph}/> Net worth</div><strong>{money(netWorth)}</strong><small>Assets less debts</small><span className="beam" aria-hidden="true"/></div>
          <div className="metric"><div className="metric-label"><ArrowDownLeft {...glyph}/> Income</div><strong>{money(income)}</strong><small>{periodLabel(month,true)}</small></div>
          <div className="metric"><div className="metric-label"><ArrowUpRight {...glyph}/> Expenses</div><strong>{money(expenses)}</strong><small>{periodLabel(month,true)}</small></div>
          <div className="metric"><div className="metric-label"><Wallet {...glyph}/> Savings</div><strong>{money(savings)}</strong><small>Across savings accounts</small></div>
        </div>
        <div className="charts">
        <Section title={trend?"Net cash flow trend":"Cash flow"} detail="Last six months" action={<div className="toggle" aria-label="Chart display"><button aria-pressed={!trend} onClick={()=>setTrend(false)}>Monthly</button><button aria-pressed={trend} onClick={()=>setTrend(true)}>Trend</button></div>}>
          <div className="chart" role="img" aria-label={chart.map(d=>d.month+" income $"+d.income+", expenses $"+d.expenses).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">{trend?<AreaChart data={chart} margin={{top:8,right:10,left:0,bottom:0}}><CartesianGrid vertical={false} stroke="#e9e7df" strokeDasharray="4 4"/><XAxis dataKey="month" tickLine={false} axisLine={false}/><YAxis tickFormatter={v=>"$"+v} tickLine={false} axisLine={false} width={54}/><Tooltip formatter={v=>money(Math.round(Number(v)*100))}/><Area type="monotone" dataKey="net" name="Net cash flow" stroke="#d75c32" fill="#f8d9c8" isAnimationActive={false}/></AreaChart>:<BarChart data={chart} barGap={5} barCategoryGap="24%" margin={{top:8,right:10,left:0,bottom:0}}><CartesianGrid vertical={false} stroke="#e9e7df" strokeDasharray="4 4"/><XAxis dataKey="month" tickLine={false} axisLine={false}/><YAxis tickFormatter={v=>v===0?"$0":v>=1000?"$"+v/1000+"k":"$"+v} tickLine={false} axisLine={false} width={52}/><Tooltip formatter={v=>money(Math.round(Number(v)*100))} cursor={{fill:"#f5f3ed"}}/><Bar dataKey="income" name="Income" fill="#262a27" radius={[4,4,0,0]} isAnimationActive={false}/><Bar dataKey="expenses" name="Expenses" fill="#ef8057" radius={[4,4,0,0]} isAnimationActive={false}/></BarChart>}</ResponsiveContainer>
          </div>
          <div className="chart-key">{trend?<span><i style={{background:"#d75c32"}}/>Net cash flow</span>:<><span><i style={{background:"#262a27"}}/>Income</span><span><i style={{background:"#ef8057"}}/>Expenses</span></>}</div>
        </Section>
        <Section title="Spending by category" detail={periodLabel(month,true)}>
          {breakdown.length?<div className="spending"><div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="96%" paddingAngle={3} stroke="none" isAnimationActive={false}>{breakdown.map(c=><Cell key={c.name} fill={c.color}/>)}</Pie><Tooltip formatter={v=>money(Number(v))}/></PieChart></ResponsiveContainer><div className="donut-label"><small>Total spent</small><strong>{money(expenses)}</strong></div></div>
          <div className="category-key">{breakdown.map(c=><div key={c.name}><span><i style={{background:c.color}}/>{c.name}</span><strong>{Math.round(c.value/expenses*100)}%</strong></div>)}</div></div>:<p className="empty">No expenses for this month.</p>}
        </Section>
        </div>
        <div className="below">
          <Section title="Recent transactions" detail="Latest recorded activity" action={<Button variant="outline" onClick={()=>setView("Transactions")}>View all</Button>}>{table(transactions.slice(0,5),true)}</Section>
          <Section title="Account balances" detail={money(cash)+" in checking and savings"} action={<Button variant="outline" onClick={()=>setView("Accounts")}>Manage</Button>}>
            <div className="item-list accounts-mini">{ledger.accounts.length?ledger.accounts.map(a=><div className="account-mini" key={a.id}><span className="tx-icon">{liability(a)?<CreditCard {...glyph}/>:<Landmark {...glyph}/>}</span><div><strong>{a.name}</strong><small>{a.type}</small></div><strong className="mono">{money(liability(a)?-a.balance:a.balance)}</strong></div>):<p className="empty">Add an account to see its balance.</p>}</div>
          </Section>
        </div>
        <div className="below"><Section title="Monthly budgets" detail={periodLabel(month,true)} action={<Button variant="outline" onClick={()=>setView("Budgets")}>Manage</Button>}>{budgets()}</Section><Section title="Savings goals" action={<Button variant="outline" onClick={()=>setView("Savings goals")}>Manage</Button>}>{goals()}</Section></div>
      </>:view==="Transactions"?<Section title="Transaction ledger" detail={visible.length+" transactions"} action={<Button variant="outline" onClick={()=>open({kind:"import"})}><Upload size={16}/> Import CSV</Button>}>
        <div className="filters"><label className="search"><Search size={16}/><input aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={e=>setSearch(e.target.value)}/></label>
          <select aria-label="Category filter" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
          <select aria-label="Account filter" value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">All accounts</option>{ledger.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select aria-label="Direction filter" value={direction} onChange={e=>setDirection(e.target.value)}><option value="">All types</option><option value="income">Income</option><option value="expense">Expense</option></select>
          <label className="checkbox"><input type="checkbox" checked={periodOnly} onChange={e=>setPeriodOnly(e.target.checked)}/> Selected month only</label></div>{table(visible)}</Section>
        :view==="Budgets"?<Section title="Category budgets" detail={periodLabel(month,true)}>{budgets()}</Section>
        :view==="Savings goals"?<Section title="Goal progress" detail="Goals linked to an account track its balance. Others use the saved amount you enter." action={<Button variant="outline" disabled={loading||busy} onClick={()=>open({kind:"goal"})}><Plus size={16}/> New goal</Button>}>{goals()}</Section>
        :view==="Credit Cards"?<>
          <Section title="Card balances" detail={money(sum(creditCards.map(a=>a.balance)))+" total owed"}>
            <div className="item-list accounts-mini">{creditCards.length?creditCards.map(card=><div className="account-mini" key={card.id}><span className="tx-icon"><CreditCard {...glyph}/></span><div><strong>{card.name}</strong><small>Recorded balance</small></div><strong className="mono">{money(card.balance)}</strong><Button variant="outline" aria-label={"Edit "+card.name} onClick={()=>open({kind:"account",row:card})}>Edit</Button></div>):<p className="empty">Add a credit card to track its balance.</p>}</div>
          </Section>
          <div className="card-activity"><Section title="Recent card transactions">{table(cardTransactions.slice(0,10),true)}</Section></div>
        </>
        :<Section title="Your accounts" detail="Balances are snapshots. Refresh linked banks with Plaid or update manual accounts yourself."><div className="item-list accounts-mini">{ledger.accounts.length?ledger.accounts.map(a=><div className="account-mini" key={a.id}><span className="tx-icon">{liability(a)?<CreditCard {...glyph}/>:<Landmark {...glyph}/>}</span><div><strong>{a.name}</strong><small>{a.type}{a.bankItemId?" · Plaid":""}</small></div><strong className="mono">{money(liability(a)?-a.balance:a.balance)}</strong><Button variant="outline" onClick={()=>open({kind:"account",row:a})}>Edit</Button></div>):<p className="empty">Add your first account to get started.</p>}</div></Section>}
      </div>
    </main>
    <dialog ref={dialog} aria-labelledby="editor-title" onCancel={e=>{e.preventDefault();close();}}>
      {editor&&<><div className="dialog-head"><h2 id="editor-title">{editorTitle}</h2><Button variant="ghost" aria-label="Close" disabled={busy} onClick={close}><X size={19}/></Button></div>
      {editor.kind==="settings"?<div className="dialog-body">{owner?<><p>Your entries are saved in your private Supabase workspace.</p><Button disabled={busy} onClick={async()=>{if(!cloud||writeLock.current)return;writeLock.current=true;setBusy(true);const {error}=await cloud.auth.signOut();writeLock.current=false;setBusy(false);if(error)setError(error.message);else {setLedger(empty);setOwner("");setEditor(undefined);setView("Overview");setNotice("");}}}>Sign out</Button></>:<><p>This workspace starts empty. Changes made without signing in reset on reload. {cloud?"Sign in to start a private workspace.":"Connect Supabase to save your own financial information."}</p>{cloud&&<form className="dialog-form" onSubmit={signIn}><Field label="Email"><input type="email" name="email" autoComplete="username" required/></Field><Field label="Password"><input type="password" name="password" autoComplete="current-password" required/></Field><Button type="submit" disabled={busy}>Sign in</Button></form>}</>}</div>:
      editor.kind==="import"?<div className="dialog-body dialog-form"><p>Use date (YYYY-MM-DD), description, amount, and optional category headers. Positive amounts are income, negative amounts are expenses.</p>
        {ledger.accounts.length?<><Field label="Destination account"><select id="csv-account" onChange={()=>{fileSequence.current++;setCsvRows([]);setError("");const input=document.getElementById("csv-file") as HTMLInputElement;input.value="";}}>{ledger.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="CSV file"><input type="file" id="csv-file" accept=".csv,text/csv" onChange={e=>void readCsv(e.target.files?.[0],(document.getElementById("csv-account") as HTMLSelectElement).value)}/></Field>{csvRows.length>0&&<p>{csvRows.length} new transactions ready. First entry: {csvRows[0].name}, {signedMoney(csvRows[0].amount)}.</p>}<Button disabled={!csvRows.length||busy} onClick={()=>void commit({...ledger,transactions:[...ledger.transactions,...csvRows]},csvRows.length+" transactions imported.")}>Import transactions</Button></>:<p>Add an account before importing.</p>}</div>:
      <form className="dialog-body dialog-form" onSubmit={submit}>
        {editor.kind!=="budget"&&<Field label={t||editor.kind==="transaction"?"Description":"Name"}><input name="name" defaultValue={t?.name??a?.name??g?.name} maxLength={100} required/></Field>}
        {editor.kind==="transaction"&&<><div className="form-grid"><Field label="Date"><input type="date" name="date" defaultValue={t?.date??today()} required/></Field><Field label="Type"><select name="direction" defaultValue={t&&t.amount>0?"income":"expense"}><option value="expense">Expense</option><option value="income">Income</option></select></Field></div><Field label="Account"><select name="account" required defaultValue={t?.accountId??""}><option value="" disabled>Choose an account</option>{ledger.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>{!ledger.accounts.length&&<p><Button variant="outline" onClick={()=>open({kind:"account"})}>Add an account first</Button></p>}</>}
        {(editor.kind==="transaction"||editor.kind==="budget")&&<Field label="Category"><select name="category" defaultValue={t?.category??b?.category??"Other"}>{categories.filter(c=>editor.kind!=="budget"||c!=="Income"&&c!=="Transfer").map(c=><option key={c}>{c}</option>)}</select></Field>}
        {editor.kind==="account"&&<Field label="Account type"><select name="type" defaultValue={a?.type}>{accountTypes.map(c=><option key={c}>{c}</option>)}</select></Field>}
        {editor.kind==="goal"?goalFields():<Field label={editor.kind==="budget"?"Monthly limit (USD)":editor.kind==="account"?"Current balance (USD)":"Amount (USD)"}><input name="amount" inputMode="decimal" defaultValue={amountInput(t?Math.abs(t.amount):a?.balance??b?.limit)} placeholder="0.00" required/></Field>}
        {editor.kind==="transaction"&&<p className="form-note">Transactions update reports. Update account balances separately.</p>}
        <div className="dialog-actions">{t&&<Button className="delete" variant="ghost" disabled={busy} onClick={()=>{if(confirmDelete)void commit({...ledger,transactions:ledger.transactions.filter(r=>r.id!==t.id),hiddenBankTransactions:t.bankItemId?[...(ledger.hiddenBankTransactions??[]),t.id]:ledger.hiddenBankTransactions},"Transaction deleted.");else setConfirmDelete(true);}}>{confirmDelete?"Confirm delete":"Delete"}</Button>}{g?.id&&<Button className="delete" variant="ghost" disabled={busy} onClick={()=>{if(confirmDelete)void commit({...ledger,goals:ledger.goals.filter(r=>r.id!==g.id)},"Goal deleted.");else setConfirmDelete(true);}}>{confirmDelete?"Confirm delete":"Delete"}</Button>}<Button variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy||loading||draftProducts.some(p=>p.status==="loading")}>{busy?"Saving…":"Save changes"}</Button></div>
      </form>}
      {error&&<p className="error" role="alert">{error}</p>}</>}
    </dialog>
  </div>;
}
