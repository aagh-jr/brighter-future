export const categories = ["Housing", "Food & drink", "Shopping", "Transport", "Subscriptions", "Health", "Pets", "Other", "Income", "Transfer"];
export const accountTypes = ["Checking", "Savings", "Investment", "Credit card", "Loan"] as const;
export type Account = { id: string; name: string; type: typeof accountTypes[number]; balance: number; bankItemId?: string };
export type Transaction = { id: string; date: string; name: string; category: string; accountId: string; amount: number; source: "manual" | "csv" | "bank"; externalId?: string; originKey?: string; bankItemId?: string };
export type Budget = { id: string; category: string; limit: number };
export type GoalProduct = { id: string; name: string; price: number; url?: string; image?: string };
// A goal can hold products (its target becomes their total) and be funded by accounts acting as its vault.
export type Goal = { id: string; name: string; target: number; saved: number; products?: GoalProduct[]; accountIds?: string[] };
export type Ledger = { accounts: Account[]; transactions: Transaction[]; budgets: Budget[]; goals: Goal[]; hiddenBankTransactions?: string[] };
export const empty: Ledger = { accounts: [], transactions: [], budgets: [], goals: [] };

export const liability = (a: Account) => a.type === "Credit card" || a.type === "Loan";
export const goalTarget = (g: Goal) => g.products?.length ? g.products.reduce((t, p) => t + p.price, 0) : g.target;
export const goalVaults = (g: Goal, accounts: Account[]) => accounts.filter(a => !liability(a) && g.accountIds?.includes(a.id));
// How many products the money covers, buying the cheapest first so the count is as high as possible.
export function affordableCount(products: GoalProduct[], saved: number) {
  let left = saved, count = 0;
  for (const price of products.map(p => p.price).sort((a, b) => a - b)) { if (price > left) break; left -= price; count++; }
  return count;
}
export function goalSaved(g: Goal, accounts: Account[]) {
  const vaults = goalVaults(g, accounts);
  return vaults.length ? vaults.reduce((t, a) => t + a.balance, 0) : g.saved;
}
export const money = (cents: number) => new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(cents / 100);
export function cents(input: string, signed = false) {
  const value = input.trim();
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(value) || (!signed && value.startsWith("-"))) throw Error("Enter a dollar amount with up to two decimal places.");
  const [dollars, fraction = ""] = value.replace("-", "").split(".");
  return (Number(dollars) * 100 + Number(fraction.padEnd(2, "0"))) * (value.startsWith("-") ? -1 : 1);
}
export function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
}
export const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
};
export const periodLabel = (month: string, long = false) => new Date(month+"-02T12:00:00").toLocaleDateString("en-US",{month: long ? "long" : "short", ...(long ? {year:"numeric"} : {})});
export function monthsThrough(month: string, count: number) {
  const [year, part] = month.split("-").map(Number);
  return Array.from({length:count}, (_,i) => new Date(Date.UTC(year,part-count+i,2)).toISOString().slice(0,7));
}
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
export const stats = (rows: Transaction[]) => ({ income: sum(rows.filter(r=>r.amount>0 && r.category!=="Transfer").map(r=>r.amount)), expenses: -sum(rows.filter(r=>r.amount<0 && r.category!=="Transfer").map(r=>r.amount)) });
