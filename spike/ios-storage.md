# Spike: does saved data survive in an iOS home-screen app?

**Question:** when the app is added to the iPhone home screen, does data it saves in
IndexedDB (and `localStorage`) survive:
1. closing the app,
2. restarting the phone,
3. a week of not opening it?

**Why it matters:** from step 2 on, every answer and flag lives in IndexedDB. If
iOS clears it, the backup reminder has to be much more frequent (`REMINDER_DAYS`,
now 3) and the Data page has to say so more strongly.

**The test page:** `public/spike/storage.html`, deployed at
`https://bryany159.github.io/study-app/spike/storage.html`. It has its own small
manifest (`display: standalone`), so iOS opens it from the home screen as an app
with its own storage. Each time it opens, it saves one numbered visit in IndexedDB
and in `localStorage` and lists every visit it still has. Nothing is sent anywhere.

## Steps (on the iPhone)

Use **Safari**. Other iPhone browsers can add to the home screen too, but Safari is
what the app supports.

1. Open `https://bryany159.github.io/study-app/spike/storage.html` in Safari.
   It shows **Mode: browser tab** and visit 1. That visit is Safari's own copy, which
   is separate. Ignore it from now on.
2. Tap **Share → Add to Home Screen → Add**. If the sheet shows an "Open as Web App"
   switch, leave it on.
3. Open **Spike** from the home screen. Check:
   - **Mode** says **standalone (home screen)**. If it says "browser tab", stop and
     write down the iOS version: the manifest wasn't picked up.
   - The visit number is **1** (the home-screen app starts with empty storage).
   - Write down **Persisted before** and **persist() result**.
4. **Close it:** swipe up to the app switcher and swipe Spike away. Open it again from
   the home screen. Expect visit **2**, with visit 1 still listed in both tables.
5. **Restart the phone** (power off, power on). Open Spike from the home screen.
   Expect visit **3**, with 1–2 still listed.
6. **Leave it for 7 days.** Don't open Spike, and don't open the page in Safari.
   Using the phone normally otherwise is fine (that's the realistic case).
7. Open Spike from the home screen. Expect visit **4**, with 1–3 still listed in
   **both** tables, and no red message under the tables.
8. Tap **Copy results** and paste the text below, with the date.

If a table is empty or numbers are missing at any step, note which step and carry
on: the page keeps counting from what it still has.

## Results

| Step | Date | Visit shown | IndexedDB visits | localStorage visits | Notes |
|---|---|---|---|---|---|
| 3. first open from home screen | | | | | persisted before: … · persist(): … |
| 4. after closing | | | | | |
| 5. after restart | | | | | |
| 7. after 7 days | | | | | |

- iPhone model / iOS version:
- Free storage on the phone (Settings → General → iPhone Storage):
- Pasted "Copy results" text:

```
(paste here)
```

## Outcome

(filled in after the 7 days)

- **Holds:** keep `REMINDER_DAYS = 3`.
- **Doesn't hold:** set `REMINDER_DAYS = 1`, and make the Data page warn that this
  device may lose data that hasn't been exported.
