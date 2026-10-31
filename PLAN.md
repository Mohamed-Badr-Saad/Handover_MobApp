# Plant Handover – mobile app (PWA) plan

Free option agreed: a **Progressive Web App** (one code base, installs on Android and iPhone from the browser) with **Supabase** (free plan) as the database. No app stores, no yearly fees.

The current shared-folder app stays as it is (backup: `backups/Plant_Handover_backup_2026-10-31_before_PWA.zip`). The mobile app lives in its own folder, `mobile-pwa/`.

---

## 1. How it fits together

```
 Phone / PC browser                         Supabase (free plan)
 ┌───────────────────────────┐   HTTPS     ┌──────────────────────────────┐
 │ Plant Handover PWA        │ ──────────▶ │ Auth   – one account / person│
 │  index.html, css, js      │             │ Postgres – handovers, staff, │
 │  service worker (offline  │ ◀────────── │   tags, actions, comments,   │
 │  app shell, cache)        │             │   notifications              │
 │  IndexedDB (list cache)   │             │ Row Level Security = who may │
 └───────────────────────────┘             │   see / change what          │
        ▲  hosted free on                   │ Storage – attachments/photos │
        │  Netlify / Cloudflare Pages /     └──────────────────────────────┘
        │  GitHub Pages
```

* **Front end**: plain HTML/CSS/JavaScript like today (no build step), reusing the existing screens and logic where possible, with a mobile-first layout.
* **Back end**: Supabase only – no server code of our own. All rules (managers-only database, who may edit, admin rights) are enforced **in the database** with Row Level Security, not just hidden in the app.
* **Keys**: the app contains only the project URL and the *publishable* key (safe to be public). The database password is never put in the app or the repository.

## 2. Supabase data model

| Table | Holds | Notes |
|---|---|---|
| `staff` | roster: name, job title, role (engineer / manager / supervisor / technician), active, is_admin, link to the person's login | Same roster as today |
| `areas` | plant areas | |
| `equipment_tags` | instrument register | 3,277 tags loaded by Administration |
| `handovers` | one row per handover: database (engineers / managers), title, description, status, area, tags, worked with, due date, author, dates, archive fields, version | Old Excel archives become rows marked *archived* |
| `handover_actions` | actions required: text, status (open / done / from old sheet), who/when added, who/when done, completing comment | |
| `handover_comments` | comments; may complete an action | adding a comment + closing the action is one database call |
| `handover_attachments` + Storage bucket `attachments` | files and photos | photos shrunk on the phone before upload (free plan: 1 GB) |
| `notifications`, `notification_reads`, `staff.read_all_at` | notification feed and what each person has read | read state follows the person to any device |
| `settings` | small app settings | |

Counters (comments, attachments, open actions) and `updated_at` are kept up to date by database triggers.

### Security (Row Level Security)
* **Sign-in**: everyone with role engineer or manager (or an admin) has their own Supabase login. First time: pick your name, choose a password (as today). Behind the scenes the login is a private address made from the staff id; e-mail confirmation is switched off.
* **Engineers' database**: visible to every signed-in person. **Managers' database**: visible to managers only – enforced by the database.
* **Edit / delete**: author or administrator. Archived (old-sheet) entries: administrator only.
* **Comments, attachments, actions required**: anyone who can see the handover.
* **Administration** (staff, roles, areas, tags, imports, restore, password reset): staff marked *administrator* (replaces today's shared admin password). The first account created becomes administrator automatically.
* **Password reset**: an administrator clears a person's login; they choose a new password at next sign-in (same as today).

## 3. Screens (mobile-first)

Bottom tab bar on phones (Dashboard · Handovers · **+ New** · Notifications · More); side menu on tablets/PCs.

1. **Sign in** – pick name, password (eye button), first-time password set-up. Managers then choose Managers' / Engineers' handovers.
2. **Dashboard** – same cards as today (submitted today, last 7 days, Info & Follow-up, with open actions, my submitted, my drafts, not seen yet), per database.
3. **Handovers list** – search, filters (status incl. *Not seen yet* and *With open actions*, area, worked on by, dates, tag, records), infinite scroll, CSV export.
4. **New / edit handover** – title, description, actions required, area, due date, status cards, worked with, tags with register suggestions, *Who can see it* for managers in the engineers' view, save draft.
5. **Handover page** – details, actions required (add, *Mark done…*), comments, attachments (**camera** on phones), change status, delete, activity.
6. **Equipment** – tag search and full history per tag.
7. **Notifications** – feed, unread count on the tab, mark all read.
8. **Profile** – change password, switch user, my handovers.
9. **Administration** (admins) – staff & roles & admin flag & password reset, areas, equipment tags (load register / import / bulk area), deleted handovers & restore, backup export, imports per database (bulk template, old sheets with name matching), move data from the shared-folder app.

## 4. Android and iPhone specifics
* `manifest.webmanifest` (name, icons 192/512 + maskable, standalone, theme colour) and `apple-touch-icon` + Apple meta tags.
* Service worker: caches the app shell so it opens instantly and offline shows a clear "no connection" state; data always comes fresh from Supabase.
* iPhone notch / home bar: `viewport-fit=cover` and safe-area padding; inputs at 16 px so iOS does not zoom; touch targets ≥ 44 px.
* Camera and photo library through the normal file input (works in both); large photos resized before upload.
* Install: Android Chrome → *Install app*; iPhone Safari → Share → *Add to Home Screen*. An in-app hint explains this.
* Push notifications to the lock screen are **phase 2** (needs a small Supabase Edge Function and, on iPhone, iOS 16.4+ with the app added to the home screen). Phase 1: unread badge inside the app, refreshed every minute and when the app is opened.

## 5. Moving the data
Administration → **Move data from the shared-folder app** (on a PC in Chrome/Edge): choose the existing `HandoverData` folder; the app reads staff & roles, areas, tags, handovers with comments/actions, attachments and both old-sheet archives and uploads them. Can be repeated safely (rows are matched by their old ids).

## 6. Hosting (free)
Any static host: **Netlify** (drag-and-drop the `mobile-pwa` folder), **Cloudflare Pages** or **GitHub Pages**. HTTPS is included (required for install and the camera). Updates = upload the folder again; phones pick the new version on next open.

## 7. Phases
| Phase | Content | Status |
|---|---|---|
| 0 | Backup of the shared-folder app, `mobile-pwa` folder, this plan | done |
| 1 | Supabase schema, security rules, functions, storage, seed data (`supabase/migrations`) | done – tested locally |
| 2 | PWA shell, sign-in, dashboard, list, form, handover page, actions, comments, attachments/camera, notifications, manager views, profile | done – tested (Android/iPhone emulation) |
| 3 | Administration incl. imports per database and old-sheet name matching | done |
| 4 | Data move from HandoverData, CSV export, Excel templates, offline opening | done – tested with the real HandoverData |
| 5 | Push notifications, offline drafts, real-iPhone check | next |

## 8. One-time setup on Supabase (by you)
1. Run the migrations: `supabase link --project-ref shqyrcdquakkavucahxl` then `supabase db push` (or paste the SQL files into *SQL Editor* in order).
2. Authentication → Providers → Email: **turn off "Confirm email"** (logins use private addresses that never receive mail).
3. After everything works: **reset the database password** (Project Settings → Database), because it was shared in chat. The app does not use it.

## 9. Free-plan limits to keep in mind
* Database 500 MB (all handovers incl. 21,000 old ones use a small part), file storage 1 GB (attachments – photos are shrunk), project pauses after ~1 week without any use (daily use keeps it awake), no automatic backups on free plan → use *Administration → Backup* regularly.
* Company approval is still needed to keep plant handover data on an external cloud service.

## 10. Setup
See `SETUP.md` (database, two Supabase switches, hosting, first admin, data move, installing on phones).
