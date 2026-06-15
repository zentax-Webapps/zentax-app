# Zentax Work Flow — Supabase + Cloudflare Pages

A multi-role task & workflow web app for accounting/payroll offices and their clients. Backend is **Supabase** (Postgres + Auth + Row-Level Security + Realtime + Edge Functions). Frontend is a static PWA deployed for free on **Cloudflare Pages**. Stays logged in, installs as an app on Chrome and Android.

## Architecture at a glance

| Layer | Tool | Why |
|---|---|---|
| Database | Supabase Postgres | All app data, indexed |
| Auth | Supabase Auth (email + password) | Bcrypt-hashed passwords, JWT sessions, free for up to 50,000 monthly active users |
| Access control | Postgres Row Level Security | Server enforces who-sees-what — even if the browser is tampered with |
| Realtime chat | Supabase Realtime | Live task chat without polling |
| Privileged actions | Supabase Edge Functions (Deno) | Only the 3 Super-Admin actions (create user, reset password, activate) — the rest is direct DB |
| Hosting | Cloudflare Pages | Free static hosting, global CDN, HTTPS |

The browser never holds the service-role key. Only the Edge Functions do, and they're stored as Supabase secrets.

## What's in this folder

```
zentax-supabase/
├── public/                            ← the static site
│   ├── index.html
│   ├── manifest.json                  ← PWA manifest
│   ├── sw.js                          ← service worker
│   ├── css/styles.css
│   ├── icons/                         ← PWA icons
│   └── js/
│       ├── config.js                  ← ✏ EDIT: paste SUPABASE_URL + ANON key
│       ├── sb.js                      ← Supabase client + Edge Function caller
│       ├── auth.js                    ← signIn / signOut / profile cache
│       ├── router.js, ui.js, app.js   ← shell, router, UI helpers
│       └── views/                     ← login, dashboard, companies, company, tasks, task, users, account
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql              ← schema + RLS policies + triggers
│   └── functions/
│       ├── _shared/                   ← shared helpers (CORS, super-admin check)
│       ├── admin-create-user/
│       ├── admin-reset-password/
│       └── admin-set-active/
└── README.md
```

---

## End-to-end setup (≈ 15 minutes)

### 1. Create the Supabase project

1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. **New project** → name it `zentax-workflow`, set a strong DB password (save it somewhere safe), pick a region close to your office. Free tier is fine.
3. Wait ~2 minutes for the project to spin up.

### 2. Apply the schema + policies

Two ways — pick one.

**Easy way (Supabase Dashboard, no CLI):**

- Left sidebar → **SQL Editor** → **New query**.
- Open `supabase/migrations/0001_init.sql` in this repo, copy the entire contents, paste into the editor.
- Click **Run**. Should say "Success. No rows returned."

**Pro way (Supabase CLI):**

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>     # ref is in your project URL
supabase db push
```

### 3. Create your first Super Admin user

This is bootstrap — once it exists, all future user creation happens inside the app.

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email and a strong password. **Tick "Auto Confirm User"**. Click **Create user**. Copy the new user's UUID.
3. Left sidebar → **SQL Editor** → **New query**, paste this (with your UUID and email):

   ```sql
   insert into public.profiles (id, email, full_name, role, is_active)
   values (
     'PASTE-UUID-HERE',
     'you@example.com',
     'Your Name',
     'super_admin',
     true
   );
   ```

   Run it.

### 4. Deploy the three Edge Functions

You need the Supabase CLI for this step. Install if you haven't: `npm install -g supabase`.

```bash
cd zentax-supabase
supabase login                           # opens browser, authenticate once
supabase link --project-ref <your-ref>   # links this folder to your project

# Deploy each function
supabase functions deploy admin-create-user
supabase functions deploy admin-reset-password
supabase functions deploy admin-set-active
```

The `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars are **automatically injected** by Supabase for deployed functions — you don't have to set them.

Optionally, restrict CORS to your Pages URL once you have it (step 7):
```bash
supabase secrets set ALLOWED_ORIGIN=https://your-app.pages.dev
```

### 5. Get the API keys

Left sidebar → **Project Settings** → **API**. Copy:

- **Project URL** (e.g. `https://abcd1234.supabase.co`)
- **anon / public** key (the long JWT starting with `eyJ…`)

These two values are safe in browser code — RLS is what protects your data, not these keys.

⚠️ The **service_role** key on the same page is dangerous. Never paste it into `config.js`, never check it into git, never give it to anyone. It only lives in your Supabase project as an Edge Function env var (already set automatically).

### 6. Plug the keys into the frontend

Open `public/js/config.js` and paste:

```js
export const SUPABASE_URL  = "https://abcd1234.supabase.co";
export const SUPABASE_ANON = "eyJ...your anon key...";
```

### 7. Deploy to Cloudflare Pages (free)

1. Push this folder to a GitHub repo. (If you don't use git: `cd zentax-supabase && git init && git add . && git commit -m "init" && gh repo create zentax-app --public --source=. --push`.)
2. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Pick your repo. On the build settings page:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
   - **Root directory:** *(leave at default)*
4. Click **Save and Deploy**. Wait ~1 minute. You'll get a URL like `https://zentax-app.pages.dev`.
5. (Recommended) Back in Supabase, run `supabase secrets set ALLOWED_ORIGIN=https://zentax-app.pages.dev` to lock the Edge Functions to your domain.

### 8. Sign in

Open your Pages URL. Sign in with the Super Admin email/password from step 3.
Then:

1. **Users → + New User** → create your Admin, Team Members, and any Client Owners / Executives.
2. **Companies → + New Company** → assign the Admin and Client Owner.
3. Open the company → **+ Add Member** to bring in Team Members and Client Executives.
4. Anyone in the company can now create and chat about tasks.

That's it.

---

## Custom domain (optional)

On Cloudflare Pages, click your project → **Custom domains** → **Set up a custom domain** → enter `tasks.yourdomain.com`. Cloudflare auto-issues HTTPS. Update the `ALLOWED_ORIGIN` secret in Supabase to match.

---

## What each piece of the system does

### Roles
- **Super Admin** — creates all users, sets passwords, resets passwords, creates companies, assigns admins. Sees everything.
- **Admin** — head of a team. Sees companies they're a member of, adds team members and client executives, creates/edits/closes tasks.
- **Team Member** — works in companies they're members of.
- **Client - Owner** — lead contact at the client side. Sees their company, creates tasks, assigns to anyone in their company. The app shows them a banner reminding them to request Executive accounts from us.
- **Client - Executive** — client team member, only sees tasks they created or are assigned to.

### Mutual-accept close
When someone marks a task as "Request Close", the other party (office vs client) must accept. Enforced at the database level by a trigger (`validate_close_transition`) — even if someone hacks the browser, Postgres rejects an invalid acceptance.

### Priority colors
Red / Orange / Yellow / Green dots on each task, sortable.

### Per-task chat
Stored in `task_messages`, scoped to the task. Realtime — when one party sends a message, the other party's open task page updates instantly via the Supabase Realtime channel.

### PWA install + stay-logged-in

**Install on Android:** Chrome shows a floating "Install Zentax as an app on your phone" bar after the user signs in. Tapping **Install** triggers the native Add-to-Home-Screen flow. The Account page also has a permanent **Install on Android** button — useful if the user dismisses the floating bar.

**Install on iPhone:** iOS Safari doesn't let websites trigger the install dialog, so the Account page shows step-by-step instructions ("Tap Share → Add to Home Screen") with platform-detection so iPhone users see iOS steps and Android users see Android steps.

**Install on desktop:** Chrome and Edge show an install icon in the address bar; the in-app button also works. The app then opens in its own window and pins to the dock/taskbar.

**Stay signed in:** Sessions live in `localStorage` and Supabase auto-rotates the access token in the background. The user is only signed out by:
- explicitly pressing **Sign Out**, or
- having a Super Admin **deactivate** their account, or
- clearing browser data.

Closing the browser, restarting the phone, losing connectivity, refreshing — none of these log the user out. The profile is also cached in `localStorage` so the UI boots instantly and survives transient network errors during background token refresh.

### Passwords never in scripts
- The seed Super Admin password is set by *you* in the Supabase Auth dashboard — not by the app.
- Every other password flows through Supabase Auth, which bcrypt-hashes server-side. The app never sees a stored password.
- The Edge Functions check the caller is a super_admin *before* calling the privileged Auth admin API.

---

## Operations

### Resetting your own Super Admin password if you forget it
Supabase Dashboard → **Authentication** → **Users** → click your user → **Send password reset email** (or **Reset password** if you've configured SMTP).

### Auditing what happened
Every task event is in the `task_events` table. Query in SQL Editor:
```sql
select te.created_at, p.full_name, te.event, t.title
  from task_events te
  join tasks t on t.id = te.task_id
  left join profiles p on p.id = te.user_id
  order by te.created_at desc limit 100;
```

### Backups
Supabase free tier includes daily backups (7-day retention). Upgrade if you need more.

### Costs
Free tier covers small offices easily. Expect to start paying ($25/month Pro) only if you exceed 50k MAU, 8 GB DB, or 250k Edge Function invocations/month.

---

## Troubleshooting

- **"Permission denied for table profiles"** — RLS is rejecting you. Make sure you're signed in *and* that the `profiles` row exists for your auth user (step 3).
- **Edge Function returns "Invalid token"** — your session expired. Sign out, sign back in.
- **Edge Function returns "Forbidden"** — you tried to create a user while not signed in as a super_admin.
- **PWA install banner doesn't appear** — Chrome requires HTTPS (Cloudflare gives you that) + valid manifest + service worker. The address-bar install icon always works as a fallback.
- **Realtime chat not live** — open the Supabase dashboard → **Database** → **Replication** → confirm `tasks` and `task_messages` are in the `supabase_realtime` publication. The migration adds them, but you can also toggle on the UI.

---

## License

Built for your office. Adapt and use freely.
