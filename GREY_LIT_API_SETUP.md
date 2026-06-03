# Setting Up Grey Literature APIs

ALDA can search grey literature via Google Custom Search and Bing Web Search. Both require API keys. DuckDuckGo HTML scraping is also built in but is unreliable on managed networks — the paid APIs below are strongly recommended for consistent grey literature coverage.

---

## Google Custom Search Engine (CSE)

Google CSE requires two things: a **Search Engine ID** (identifies which search engine to use) and a **Google Cloud API key** (authenticates your requests). You set these up separately.

**Cost:** 100 free queries per day. $5 per 1,000 queries beyond that. A typical ALDA search uses around 10–20 Google queries (10 results per page × up to 10 pages), so the free tier covers roughly 5–10 ALDA searches per day.

---

### Step 1 — Create a Custom Search Engine

1. Go to [programmablesearchengine.google.com](https://programmablesearchengine.google.com/) and sign in with your Google account.

2. Click **Get started** or **Add** (the button label varies).

3. In the setup form:
   - **Name:** Give it any name, e.g. *ALDA Web Search*
   - **What to search:** Select **Search the entire web**
   - If you only see a field asking for specific sites to search, enter any site (e.g. `www.example.com`) for now — you can change it to whole-web in the next step

4. Click **Create**.

5. You will land on the control panel for your new search engine. Click **Customise** or **Edit search engine**.

6. Under **Basics**, confirm that **Search the entire web** is enabled. If you entered a specific site in step 3, delete it here and enable the whole-web option.

7. Still under **Basics**, copy your **Search engine ID** — it looks like:
   ```
   012345678901234567890:abcdefghijk
   ```
   Keep this — you will need it for ALDA.

---

### Step 2 — Create a Google Cloud API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and sign in with the same Google account.

2. At the top of the page, click the project selector (it shows the current project name or **Select a project**). Either create a new project or use an existing one.

3. In the left menu, go to **APIs & Services → Library**.

4. Search for **Custom Search API** and click on it.

5. Click **Enable**.

6. In the left menu, go to **APIs & Services → Credentials**.

7. Click **Create Credentials → API key**.

8. Your new API key will appear. Copy it now.

9. (Recommended) Click **Edit API key** (the pencil icon), then under **API restrictions**, select **Restrict key** and choose **Custom Search API**. This limits the key to only this service, reducing risk if the key is ever exposed.

10. Click **Save**.

---

### Step 3 — Enter your keys in ALDA

In the ALDA interface, open **Settings → API Keys** and enter:
- **Google CSE ID** — the Search engine ID from Step 1
- **Google API Key** — the API key from Step 2

Click **Save**. Google CSE will now appear as an active source in your next search.

---

### Troubleshooting Google CSE

**"Request contains an invalid argument"** — The CSE ID is wrong or the search engine has not finished creating. Wait a minute and try again.

**"API key not valid"** — The Custom Search API may not be enabled in your Cloud project. Go back to APIs & Services → Library and check.

**Results look unrelated** — Your search engine may be restricted to specific sites. Go to the CSE control panel and confirm **Search the entire web** is on.

**Quota exceeded** — You have used your 100 free daily queries. Either wait until the next day, or set up billing in your Google Cloud project to use the paid tier.

---

## Bing Web Search API

Bing Web Search requires an Azure account. Azure has a free tier, but Bing Search itself has a separate free tier of 1,000 transactions per month.

**Cost:**
| Tier | Price | Transactions |
|---|---|---|
| Free (F1) | $0 | 1,000/month |
| S1 | ~$7 per 1,000 | Pay per use |

A typical ALDA search uses around 100 Bing results (2 pages × 50 results). The free tier covers roughly 10 ALDA searches per month. For regular use, S1 is recommended.

---

### Step 1 — Create an Azure account

If you do not already have one, sign up at [azure.microsoft.com/free](https://azure.microsoft.com/free/). A credit card is required even for the free tier (it is not charged unless you exceed free limits).

---

### Step 2 — Create a Bing Search resource

1. Go to the [Azure Portal](https://portal.azure.com/) and sign in.

2. In the top search bar, type **Bing Search** and select **Bing Search** from the results (under Marketplace).

3. Click **Create**.

4. Fill in the form:
   - **Subscription** — select your Azure subscription
   - **Resource group** — create a new one (e.g. *alda-rg*) or use an existing one
   - **Name** — any name, e.g. *alda-bing-search*
   - **Region** — choose the region closest to you, or **Global**
   - **Pricing tier** — choose **F1 (1,000 calls per month)** for the free tier, or **S1** for pay-as-you-go

5. Click **Review + create**, then **Create**. Wait a minute for the resource to deploy.

---

### Step 3 — Get your API key

1. Once deployment is complete, click **Go to resource**.

2. In the left menu, click **Keys and Endpoint**.

3. Copy **Key 1**. This is your Bing API key.

> You can regenerate either key at any time without affecting the other, which is useful if a key is ever compromised.

---

### Step 4 — Enter your key in ALDA

In the ALDA interface, open **Settings → API Keys** and enter your key in the **Bing API Key** field. Click **Save**.

Bing will now appear as an active source in your next search.

---

### Troubleshooting Bing

**"Resource not found"** — The resource may still be deploying. Wait a minute and refresh the Azure Portal.

**401 Unauthorized** — The API key is wrong or has been regenerated. Go back to Keys and Endpoint in the Azure Portal and copy the current key.

**403 Forbidden** — Your subscription may be disabled or the Bing Search resource may have been deleted. Check the Azure Portal.

**Quota exceeded** — You have used your 1,000 free monthly transactions. Either upgrade to S1 in the Azure Portal or wait until the next calendar month.

---

## Confirming both are working

After entering your keys, run a search with Google CSE and Bing enabled. In the **source breakdown** table shown after the search completes:

- Both sources should appear with a non-zero **Found** count
- If either shows **⚠ blocked**, the API key is likely wrong — re-check it in Settings

You can also check the ALDA health endpoint directly: `http://localhost:8000/api/v1/health` will show `"google_cse": true` and `"bing": true` in `available_sources` when the keys are detected.
