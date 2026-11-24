import { cents, validDate, type Account, type Ledger, type Transaction } from "./finance";

export type PlaidAccount = {
  account_id: string; name: string; mask: string | null; type: string; subtype: string | null;
  balances: { current: number | null; iso_currency_code: string | null };
};
export type PlaidTransaction = {
  transaction_id: string; account_id: string; name: string; merchant_name: string | null;
  pending: boolean; date: string; amount: number; iso_currency_code: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
};
export type BankSnapshot = { itemId: string; accounts: Account[]; transactions: Transaction[] };

function dollarsToCents(amount: number) {
  return cents(amount.toFixed(2), true);
}
function accountType(account: PlaidAccount): Account["type"] | undefined {
  if (account.type === "depository") return ["savings", "money market", "cd"].includes(account.subtype ?? "") ? "Savings" : "Checking";
  if (account.type === "credit") return "Credit card";
  if (account.type === "loan") return "Loan";
  if (account.type === "investment" || account.type === "brokerage") return "Investment";
}
function transactionCategory(row: PlaidTransaction) {
  const category = row.personal_finance_category?.primary;
  if (category === "INCOME") return "Income";
  const categories: Record<string,string> = {
    RENT_AND_UTILITIES:"Housing", FOOD_AND_DRINK:"Food & drink", GENERAL_MERCHANDISE:"Shopping",
    TRANSPORTATION:"Transport", MEDICAL:"Health", ENTERTAINMENT:"Subscriptions",
  };
  return categories[category ?? ""] ?? "Other";
}

export function normalizeSnapshot(itemId: string, rawAccounts: PlaidAccount[], rawRows: PlaidTransaction[]): BankSnapshot {
  const ids = new Map<string, string>();
  const accounts = rawAccounts.flatMap(account => {
    const type = accountType(account);
    const { current, iso_currency_code } = account.balances;
    if (!type || current === null || iso_currency_code !== "USD") return [];
    const id = "plaid-account:" + itemId + ":" + account.account_id;
    ids.set(account.account_id, id);
    return [{id, name:account.name + (account.mask ? " •" + account.mask : ""), type, balance:dollarsToCents(current), bankItemId:itemId}];
  });
  const transactions = rawRows.flatMap(row => {
    const accountId = ids.get(row.account_id);
    if (!accountId || row.pending || !row.amount || !validDate(row.date) || row.iso_currency_code !== "USD") return [];
    const amount = -dollarsToCents(row.amount);
    if (!amount) return [];
    const category = row.personal_finance_category?.primary;
    const movement = category === "TRANSFER_IN" || category === "TRANSFER_OUT" ||
      row.personal_finance_category?.detailed?.includes("CREDIT_CARD_PAYMENT");
    return [{
      id:"plaid-txn:" + itemId + ":" + row.transaction_id, accountId, amount, date:row.date,
      name:row.merchant_name || row.name, category:movement ? "Transfer" : transactionCategory(row),
      source:"bank" as const, externalId:row.transaction_id, bankItemId:itemId,
    }];
  });
  return {itemId, accounts, transactions};
}

export function mergeBankSnapshots(ledger: Ledger, snapshots: BankSnapshot[]): Ledger {
  const incoming = new Map(snapshots.flatMap(snapshot => snapshot.accounts.map(row => [row.id,row] as const)));
  const accounts = ledger.accounts.map(existing => {
    const update = incoming.get(existing.id);
    if (!update) return existing;
    incoming.delete(existing.id);
    return {...update, name:existing.name};
  });
  const syncedItems = new Set(snapshots.map(snapshot => snapshot.itemId));
  const prior = new Map(ledger.transactions.map(row => [row.id,row]));
  const replacement = snapshots.flatMap(snapshot => snapshot.transactions
    .filter(row => !ledger.hiddenBankTransactions?.includes(row.id))
    .map(row => {
      const existing = prior.get(row.id);
      return existing ? {...row, category:existing.category, name:existing.name} : row;
    }));
  return {
    ...ledger,
    accounts:[...accounts,...incoming.values()],
    transactions:[...ledger.transactions.filter(row => !row.bankItemId || !syncedItems.has(row.bankItemId)),...replacement],
  };
}
