# Brighter Future

A local personal finance app built with Next.js, React, TypeScript, Tailwind CSS, a shadcn/ui-style source component, Recharts, and Supabase/PostgreSQL. Every workspace starts empty. Entries are held in memory until reload unless you sign in to your own Supabase workspace.

## Run it locally

Use Node.js 22 LTS or newer and npm. Clone the repository and open Terminal in the folder containing `package.json`.

```sh
npm ci
npm run dev
```

Once Next.js shows **Ready**, open the Local address printed in Terminal. The default is [127.0.0.1:3000](http://127.0.0.1:3000). Leave that Terminal running while you use the app. If port 3000 is busy, run `npm run dev -- -p 3081` and open [127.0.0.1:3081](http://127.0.0.1:3081).

## Save personal data

1. Create a Supabase project or start a local Supabase stack. Apply the SQL migrations in `supabase/migrations/` in order using the SQL editor or your migration workflow.
2. Create an email/password user in **Authentication → Users**. This app signs in existing users. For a personal hosted workspace, disable public sign-ups after provisioning your user.
3. Copy `.env.example` to `.env.local`. Set the project URL and the **publishable** key (or legacy anon key). Keep the service-role key out of the app.
4. Restart Next.js. Click **Local session** or **Workspace settings**, then sign in. Your private workspace starts empty. Add an account before entering or importing transactions.

Postgres row-level security restricts reads and writes to the authenticated owner. An optimistic version check rejects stale writes from other tabs. Supabase Auth keeps the session in the browser, so use a trusted device and sign out when finished on a shared browser. Keep this development server on localhost. Use HTTPS for any hosted deployment.

## How the totals work

- Account balances are manually maintained snapshots. Transactions and CSV imports drive income, expenses and budgets without changing the snapshots. Update snapshots from account statements when needed.
- Enter debts as positive balances. Net worth subtracts credit card and loan balances from assets. The savings metric sums savings account balances. Goal balances track progress and do not add to net worth.
- All entries and aggregation use integer USD cents. Date filters use the recorded calendar date. The trend is net cash flow by month.
- Only enter income and expenses in the transaction ledger. Avoid entering movements between your own accounts or card repayments as expenses when the underlying purchase is already recorded.
- CSV headers are `date,description,amount,category`. Use ISO dates, positive income and negative expenses. Category is optional and must match an app category when supplied. Choose an account, preview, then import. Reimports skip matching CSV rows for the same account, with an occurrence counter for identical rows in a file. Review overlapping exports with identical transactions because those rows have no provider IDs.

```csv
date,description,amount,category
```

Future bank adapters can normalize posted records into the transaction type in `lib/finance.ts`, use a stable provider/account/transaction identifier for upserts, and write through the workspace persistence layer. The app currently uses manual and CSV entry.

Use `npm run check` for TypeScript and `npm run build` for the production build.

## Connect banks with Plaid

1. Complete the Supabase setup above and apply both SQL migrations. Create a private user workspace.
2. In the Plaid Dashboard, enable Transactions. Use Sandbox credentials to test with fictional institutions. For real banks, use credentials with access to the institution and set `PLAID_ENV=production`.
3. In `.env.local`, set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `PLAID_TOKEN_KEY`. Generate the encryption key once with `openssl rand -base64 32` and keep it stable. Keep these four values server-side and out of source control.
4. For OAuth institutions, follow [Plaid's OAuth setup](https://plaid.com/docs/link/oauth/). An embedded browser may require a redirect. Use the exact allowlisted app root as `PLAID_REDIRECT_URI` and open the app in a regular browser if bank popups are blocked. Use HTTPS for a production redirect.
5. Restart Brighter Future, sign in, and choose **Accounts → Import Accounts**. Complete Plaid Link to grant read access. Click **Refresh accounts** for later updates or if the bank is still preparing its first results. Each institution is linked separately.

The integration imports supported USD balances and posted transactions. Provider IDs let refresh replace imported activity without duplicating it. Brighter Future preserves your imported transaction descriptions and categories and keeps imported rows you delete hidden on refresh. Amounts and dates are refreshed from the provider. Plaid-classified transfers are visible in the ledger and excluded from income and expenses. Check any provider categories that look off. Apple Card syncing and scheduled bank refreshes are outside this integration.

Plaid access tokens are encrypted using AES-GCM and stored in a service-only table. The browser never receives them. The Plaid connection reads financial data and has no money movement scope.
