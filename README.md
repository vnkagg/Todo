# Smart Scratchpad

Text yourself tasks the way you do in WhatsApp. Tasks go into one ordered list: new ones land on top, repeats are merged and moved up, and tasks that sink below the visible rows come back to the top after a few untouched days. Shopping, notes, links, routines, snoozed and done items sit under a filter bar below the list.

Everything runs on your phone. There is no server and nothing to pay for.

## Put it online (GitHub Pages, free)

1. Sign in at github.com and create a new repository, for example `scratchpad`. Make it **Public** (GitHub Pages is free for public repos).
2. On the repo page, click **Add file → Upload files**, drag in everything from this folder (`index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `README.md` and the `icons` folder), then click **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, and click **Save**.
4. After a minute or two the page shows your link, like `https://YOUR-USERNAME.github.io/scratchpad/`.

Your notes are not in the repo. They stay in your phone's browser, so a public repo only exposes the app's code.

## Add it to your home screen

- **Android (Chrome):** open the link, tap **⋮ → Add to Home screen** (or **Install app**).
- **iPhone (Safari):** open the link, tap **Share → Add to Home Screen**.

It then opens full screen like a normal app and works offline. Sorting needs internet, but you can still add and tick items offline.

## Turn on smart sorting (free Gemini key)

1. Go to https://aistudio.google.com/apikey and sign in with your Google account.
2. Click **Create API key** and copy it.
3. In the app, tap the **gear icon → paste the key → Save key**. It tests itself right away.

The app asks Google which models your key can use and picks the fastest "Flash-Lite" or "Flash" one. If that model's free limit runs out, it tries the next one. If all of them are used up, or you're offline, it falls back to built-in rules, so adding notes never fails.

Things to know:
- The key is stored only on your phone and is sent only to Google.
- On the free tier, Google may use what you send to improve its products. Don't put passwords or very private details in notes.
- Optional extra safety: in Google Cloud Console → APIs & Services → Credentials, edit the key and restrict it to websites `https://YOUR-USERNAME.github.io/*`.

## Backups

Your items live in the browser on your phone. Clearing Chrome's site data or switching phones would lose them. In **Settings → Backup**, use **Save to Drive / share** (or **Download backup**) now and then. **Restore from file** merges a backup back in without deleting anything. The Lists tab reminds you if it's been more than a week.

## How to use it

| You type | What happens |
|---|---|
| `pay electricity bill by friday` | Task with a due date. It moves to the top on Friday. |
| `milk, eggs, atta` | Three items on the shopping list |
| `check schematics before ordering the PCB` | Two tasks. "Order PCB" waits until the check is done. |
| `waiting for Rahul to send the invoice` | Task marked "waiting on Rahul" |
| `gym every day` / `rent on the 5th every month` | A routine that shows up on the right days |
| a link | Saved under Read & watch |
| `idea: …` | Saved under Notes |
| `paid the rent` | Marks the matching task done |
| the same thing twice | Merged with the first one and moved to the top. Look-alikes get a "Same thing? Merge / Keep both" card. |

- **Swipe right:** done
- **Swipe left:** shows Snooze and Delete. Snoozed tasks come back to the top at the chosen time. On routines, Snooze skips today.
- **Drag the ⋮⋮ handle:** reorder the list
- **Tap:** edit the text, type, importance, date, repeat, "waiting on" or "do after"
- **Settings → Task list:** how many rows show before the list scrolls (default 7), after how many untouched days a task comes back (default 3), and how many come back per day (default 2)

Marking things done by typing (`paid the rent`) and merging differently worded repeats ("order whey" vs "buy protein powder") need the Gemini key. Without one, the built-in rules still handle dates, shopping lists, links, ideas, routines and near-exact repeats.

## Updating the app

Edit files in the repo (or upload new versions). The installed app picks up changes the next time it opens with internet. Your notes are not affected.
