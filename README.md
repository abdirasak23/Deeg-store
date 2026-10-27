# DEEG Store Panel

Standalone, mobile-friendly store panel. Store accounts are created by the ReturnRaad admin panel; there is no public registration. Sign in with the registered email and the store phone number. The phone number is checked against the existing bcrypt `password_hash` created by the admin panel.

## Run it

1. From this folder, run `npm install`.
2. Copy `.env.example` to `.env.local` and set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `STORE_PROXY_SECRET`. Use the same proxy secret for the `store-orders` Edge Function. All four are server-side; the service-role key must never be exposed to browser code. For local development, the panel can load the ignored project-root `.env.local` automatically.
3. Apply the required SQL migrations in timestamp order, including `20261010000000_store_auth.sql`, `20261013000000_store_phone_password.sql`, `20261014000000_delivery_partners_and_store_orders.sql`, `20261016000000_store_rejection_item_audit.sql`, `20261017000000_store_inventory.sql`, `20261018000000_product_preparation_time.sql`, `20261018010000_category_subcategory_hierarchy.sql`, and `20261020000000_store_order_alerts.sql`. The main app's `orders` and `order_items` tables must already exist.
4. Run `npm run dev` and open `http://localhost:3001`.

## What the panel does

- Email plus registered phone-number sign-in, rate limited through the existing database function.
- HttpOnly, seven-day store sessions. The browser never receives the service-role key.
- Store-scoped order list and detail, automatic 12-second refresh, item quantities and prices, payment details, and order totals.
- Products assigned by the admin, with per-store stock quantity controls and independent available/out-of-stock switches. Store users cannot create or assign products.
- Dashboard charts for 7-day orders and sales, 30-day order totals, order status, and inventory availability.
- Accept (`placed` â†’ `confirmed`), mark ready (`confirmed` â†’ `packed`), and reject with a reason. Unavailable order rows are recorded by the existing `store_transition_order` database function.
- Clear API errors include actionable migration/setup messages instead of the generic connection message.
- Server-sent live order updates with a polling fallback, persistent new-order warnings, and preparation countdown/overdue alerts.

The order API keeps the HttpOnly session in Next.js, then sends the order operation to one `store-orders` Edge Function using a short-lived HMAC-signed server-to-server request. The signature covers the exact JSON body, origin, client IP, and hash of the session token. The Edge Function independently validates the store session and scopes every query/transition to that store. The service-role key is never sent to the Edge Function caller or browser. The existing `notify-store` trigger remains separate.

## Edge Function source

The single order function source is at `../supabase/functions/store-orders/index.ts`. Deploy that one function after applying the SQL migrations. In Supabase Edge Function settings, set `STORE_PROXY_SECRET` to the same 32+ character value as the Next.js server. `STORE_PANEL_ORIGIN` can be set to the exact panel origin for CORS headers, but signed Next.js server-to-server calls are authenticated by HMAC and are not rejected by browser CORS rules. The function reads Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets.

## Store opening schedule

Apply `../supabase/migrations/20261024000000_store_operating_hours.sql` and `../supabase/migrations/20261024010000_store_east_africa_timezone.sql` in the Supabase SQL Editor. The Store Panel header then has an Open/Close control and an Opening schedule editor. Each weekday supports up to four windows, including a midday break; windows may cross midnight. Empty days are closed. Store hours, order timestamps and dashboard daily totals use East Africa Time (`Africa/Nairobi`), independent of the computer's timezone. The schedule timezone can still be changed per store in the editor.

Enable the Supabase `pg_cron` extension, then run this once in the SQL Editor to automatically apply opening and closing changes every minute (the database job keeps working when the panel is closed):

```sql
create extension if not exists pg_cron;
select cron.schedule(
  'deeg-refresh-store-open-status',
  '* * * * *',
  'select public.refresh_store_open_status();'
);
```

If that job already exists, update it instead of creating a duplicate:

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'deeg-refresh-store-open-status';
select cron.schedule('deeg-refresh-store-open-status', '* * * * *', 'select public.refresh_store_open_status();');
```

The manual Close store control stays closed until the next scheduled opening. Manual Open opens immediately and stays open until the next scheduled closing (or 24 hours when no hours are configured). The `store-hours-listener` Edge Function source is deliberately self-contained for pasting into the Supabase Dashboard editor; it does not import `_shared` files. Set `STORE_HOURS_SCHEDULER_SECRET` to a random secret of at least 32 characters in Edge Function secrets before deploying it. Send that value as `x-store-hours-scheduler-secret` on a POST request for a manual refresh. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function. The database cron job above is the automatic schedule runner and does not need this custom secret.

From the repository root, link the intended Supabase project once, set the two function secrets using your ignored local secrets file, then deploy only this order function:

```powershell
supabase functions deploy store-orders
```

Keep `verify_jwt = false` for this function in `../supabase/config.toml`: the function verifies the signed Next.js request and hashed store session itself. The Next.js caller retries the exact origins configured in `STORE_PANEL_ORIGIN`, supporting the older deployed origin gate; if all origins are rejected, update that Supabase secret to include `http://localhost:3001` for local use or your production HTTPS panel origin. Do not expose the service-role key or `STORE_PROXY_SECRET` to the browser.

Do not commit `.env.local`. If the panel is hosted outside local development, configure the same server-only Supabase URL and service role key in its hosting environment.
