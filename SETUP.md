# Plant Handover mobile app – setup (one time)

The mobile app is a **PWA**: one set of files that installs on Android and iPhone from the browser. Data lives in your **Supabase** project `shqyrcdquakkavucahxl`.

The app holds only the project URL and the **publishable** key (`js/config.js`). Both are meant to be public. The database password is never put in the app.

---

## 1. Create the database (about 2 minutes)

In a terminal, inside the `mobile-pwa` folder:

```bash
supabase login
supabase init            # if it asks to overwrite anything, answer No – keep supabase/migrations
supabase link --project-ref shqyrcdquakkavucahxl     # asks for the database password
supabase db push         # creates tables, security rules, functions, storage, staff list and 3,277 tags
```

**Without the CLI:** in Supabase → *SQL Editor*, paste and run the three files from `supabase/migrations` in this order:

1. `20261031000001_schema.sql`
2. `20261031000002_seed.sql`
3. `20261031000003_tags.sql`

## 2. Two switches in Supabase

1. **Authentication → Sign In / Providers → Email** → turn **off "Confirm email"**.
   The app signs people in with private addresses like `staff-…@plant-handover.app` that never get mail.
2. Leave **"Allow new users to sign up"** on, because each person creates their own password the first time.

## 3. Put the app online (free, HTTPS)

You can use any of these (all free):

* **Netlify:** app.netlify.com → *Add new site → Deploy manually* → drag the `mobile-pwa` folder in. You get `https://<name>.netlify.app`.
* **Cloudflare Pages:** *Create → Pages → Upload assets* → the `mobile-pwa` folder.
* **GitHub Pages:** push the folder to a repository → *Settings → Pages*.

To release an update, upload the folder again and change `VERSION` at the top of `sw.js`. When phones next open the app, they show **"A new version is ready – Reload"**.

## 4. First sign-in = administrator

1. Open the site and pick your name. Choose a password.
   **The first account created becomes administrator.**
2. Go to **More → Administration → Move data from the shared-folder app**. Do this on a PC in Chrome or Edge.
3. Choose the `HandoverData` folder. This copies staff and roles, areas, tags, handovers with actions and comments, attachments, deleted handovers, and both old-sheet archives (≈21,400 entries). It is safe to run again.
4. Under **Staff**, use **Edit → "Administrator rights"** to give admin rights to anyone else who needs them.

## 5. Install on phones

* **Android (Chrome):** open the link → menu ⋮ → **Install app** (the app also offers an *Install* button).
* **iPhone (Safari):** open the link → **Share ↑ → Add to Home Screen** → open *Handover* from the new icon.
  Use Safari for this. Other iPhone browsers cannot add apps to the Home Screen.

## 6. After everything works

* **Reset the database password** (Project Settings → Database). It was shared in chat. The app does not use it. Anyone who runs `supabase link` again will need the new one.
* **Free plan:** the project pauses after about a week with no use. Daily use keeps it awake. There are no automatic backups, so use **Administration → Backup** now and then.
* **Company approval:** get it before you put real plant data on an external cloud service.

## What was tested

These checks ran on a local copy of the Supabase stack, using the real migrations, in Chromium emulating a Pixel 5, an iPhone 13 and an iPhone SE, plus desktop Chrome.

Accounts and roles:

* First account becomes administrator.
* Manager chooses which view to use. A managers-only handover cannot be read by an engineer, even with a direct database request.
* Engineers cannot edit other people's handovers or make themselves admin.
* Password change works.

Handovers and notifications:

* Actions required are closed by a comment.
* A camera photo of 7.8 MB is shrunk to 0.7 MB.
* Notification badge and read state work.
* Server search reaches old-sheet text.
* Excel import works.

Data and offline:

* The data move ran with the real HandoverData: 21 handovers, 15,979 + 5,417 old entries, and the attachment.
* Running the move a second time doubles nothing.
* With no signal, the app opens with the saved list.
* No sideways scrolling on any screen.

Not yet checked on a real device: Safari on an actual iPhone (WebKit could not run here). Please try sign-in, camera and Add to Home Screen once on a real iPhone.
