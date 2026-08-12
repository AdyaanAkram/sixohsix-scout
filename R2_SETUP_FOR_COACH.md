# Setting up permanent photo & video storage for 60'6" ID
### (Cloudflare R2 — about 15 minutes, free)

**Why you're doing this:** right now, player photos and videos uploaded to 60'6" ID would be
deleted whenever the app updates. This one-time setup gives the app a permanent, private storage
locker in the cloud. It's **free up to 10 GB** (roughly a full season of camp photos and video
clips), and there is no time limit on the free tier.

**What you'll need:** an email address and a credit card. The card is only for overage protection —
the free tier genuinely costs $0/month and you will not be charged unless we someday blow past
10 GB (and even then it's about $0.02/month per extra GB).

**What you're producing:** four values (like account numbers) that you'll send to Adyaan. He plugs
them into the app's settings and photos/videos become permanent. You never have to touch this
again.

---

## Step 1 — Create a free Cloudflare account (3 min)

1. Go to **https://dash.cloudflare.com/sign-up**
2. Enter your email and create a password. (Use a real email you keep — this account owns the
   storage.)
3. Check your inbox and click the **verify email** link.
4. If it asks you to add a website or offers paid plans — **skip all of that**. You only need the
   account itself.

## Step 2 — Turn on R2 storage (2 min)

1. After signing in, look at the **left-hand menu** and click **R2 Object Storage**.
2. Click the button to enable/get started with R2.
3. It will ask for a **credit card** here. This is the overage-protection card mentioned above —
   the plan you're on is the free one. Add the card and continue.

## Step 3 — Create the storage bucket (2 min)

A "bucket" is just the folder where the app keeps files.

1. Inside R2, click **Create bucket**.
2. Bucket name: type exactly → **`606-id-media`**
3. Location: leave on **Automatic**.
4. Leave everything else at its defaults — do **NOT** enable any "public access" option. The
   bucket must stay private (the app controls who sees each photo, including consent rules for
   minors).
5. Click **Create bucket**.

## Step 4 — Copy your Account ID (1 min)

1. Still on the R2 page, look for **Account ID** — it's usually shown on the right side of the R2
   overview page (a long string of letters and numbers, like `a1b2c3d4e5f6...`).
2. Copy it into the box at the bottom of this page. → This is **VALUE 1**.

## Step 5 — Create the app's access key (5 min)

This is like creating a key card that lets the 60'6" ID app (and only it) put files in the bucket.

1. On the R2 page, click **“Manage R2 API Tokens”** (usually top-right or under the API dropdown).
2. Click **Create API Token**.
3. Name it: `606-id-app`
4. Permissions: choose **Object Read & Write**.
5. If it lets you limit the token to a specific bucket, choose **`606-id-media`** (good practice;
   if you can't find that option, "all buckets" also works).
6. TTL / expiry: **Forever / no expiry**.
7. Click **Create API Token**.
8. The next screen shows your credentials. **⚠️ This screen appears ONCE — copy everything before
   closing it:**
   - **Access Key ID** → **VALUE 2**
   - **Secret Access Key** → **VALUE 3** (treat this like a password)

## Step 6 — Send Adyaan the four values

Fill this in and send it **privately** (text message or email directly to Adyaan — not in a group
chat, and don't post it anywhere, because Value 3 is effectively a password):

```
1. Account ID:         ____________________________
2. Access Key ID:      ____________________________
3. Secret Access Key:  ____________________________
4. Bucket name:        606-id-media
```

That's it. Adyaan takes it from here — after he plugs these in, every photo and video uploaded at
camps is stored permanently and privately, and nothing about how you use the app changes.

---

### FAQ

**Will I be charged?** Not at your scale. Free tier = 10 GB stored, unlimited viewing. A camp's
photos are megabytes; even hundreds of video clips fit. If the account ever approaches 10 GB,
you'd pay cents, not dollars.

**Is it safe for the kids' photos/videos?** Yes — the bucket is private. Files are only reachable
through the 60'6" ID app, which enforces the consent and privacy rules (nothing public without
approval, private items staff-only).

**What if I lose the Secret Access Key?** No problem — go back to "Manage R2 API Tokens," delete
the old token, create a new one, and send Adyaan the new values.

**Who owns the data?** You do — it's your Cloudflare account. Keep the login details somewhere
safe like any other account.
