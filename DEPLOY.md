# Deploying Reentry Lab to Cloudflare

The hosted version runs on Cloudflare Workers, and the Workers Free plan is enough. How the pieces fit:

- **Static app:** the built front end in `dist/` is served as static assets.
- **The Worker** (`worker/`) handles three jobs:
  - sign-in with GitHub or Google
  - each user's notebook (saved runs, notes and chats), kept in a Durable Object with SQLite storage
  - a page fetcher the research agent uses to read web pages
- **The research agent** runs in the visitor's browser, with their own API key for Anthropic, OpenAI, xAI, Google Gemini or OpenRouter. Keys stay in the browser and go straight to the provider. The simulator also runs in the browser, so the Worker does almost no computing.

## 1. Sign in to Cloudflare

```bash
npm ci --ignore-scripts
npx wrangler login
```

## 2. Create the OAuth apps

You need at least one sign-in provider; offering both is friendlier. In the steps below, `<origin>` is where the app will live, for example `https://reentry-lab.<your-subdomain>.workers.dev`. The first deploy (step 4) prints that URL, so you can deploy first and fill these in after.

Both providers accept several callback URLs per app (GitHub: **Add redirect URI**), so one app can serve your workers.dev address, a custom domain and `http://localhost:8787` for testing real sign-in locally. The dev sign-in needs none of them.

**GitHub:** go to github.com → Settings → Developer settings → OAuth Apps → New OAuth App.
- Homepage URL: `<origin>`
- Authorization callback URL: `<origin>/auth/callback/github`
- Copy the Client ID, then generate and copy a client secret.

**Google:** in console.cloud.google.com, go to APIs & Services.
1. Configure the OAuth consent screen: External, app name "Reentry Lab". The scopes are `openid` and `profile` only.
2. Then go to Credentials → Create credentials → OAuth client ID, with application type Web application.
   - Authorized redirect URI: `<origin>/auth/callback/google`

The app requests no email address and no other data: GitHub gets `read:user`, and Google gets `openid profile`.

## 3. Set the secrets

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

`SESSION_SECRET` signs the session cookies. Rotating it signs everyone out.

## 4. Deploy

```bash
npm run deploy          # runs the tests, builds dist/, then wrangler deploy
```

`wrangler.jsonc` holds the rest of the configuration:
- the Durable Object and its migration
- three rate limiters, per user and per IP
- `SUPPORT_URL`, for the "Support this project" button
- `SOURCE_URL`, the link to this repository

**Custom domain.** The public site runs at `reentrylab.ai`. To use your own domain:
1. Add the domain to your Cloudflare account.
2. Replace the two `routes` entries in `wrangler.jsonc` with your domain.
3. Set `CANONICAL_HOST` to your domain, or to `""` for no redirects.
4. Deploy, then add `https://<your domain>/auth/callback/<provider>` to each OAuth app.

The Worker sends plain HTTP, `www.<domain>` and the workers.dev address to `https://<CANONICAL_HOST>`. Only set `CANONICAL_HOST` once the domain loads, or the workers.dev address will redirect to a site that doesn't work yet.

## Local testing of the hosted version

```bash
printf 'SESSION_SECRET=%s\nDEV_LOGIN=true\n' "$(openssl rand -hex 32)" > .dev.vars
npm run cf:dev          # builds dist/, then wrangler dev on http://localhost:8787
```

- **Dev sign-in:** `DEV_LOGIN=true` adds a "Dev sign-in" button that works only on localhost. A deployed Worker refuses it even if the variable is set.
- **Testing real OAuth:** add the OAuth secrets to `.dev.vars` too. `.dev.vars` is git-ignored.

## What's stored, and limits

- **Per user:** saved runs, notes and chat transcripts, keyed by the sign-in provider and account id, plus the display name.
- **Never stored:** email addresses and model API keys.
- **Account controls:** users can export or delete all of their data from Settings.
- **Caps:** 500 runs, 500 notes, 300 conversations and 50 MB per user.
- **Rate limits:**
  - 120 API requests per minute per user
  - 30 page fetches per minute per user
  - 20 sign-in attempts per minute per IP
- **Page fetcher:**
  - Fetches only public http(s) host names on standard ports. It refuses IP addresses, localhost and internal names, and re-checks every redirect.
  - Reads at most 2 MB of text, HTML, JSON or XML, with a 15-second timeout.
  - Returns pages as opaque bytes, never as HTML on the app's origin.
- **Security headers:** `public/_headers` sets a strict Content Security Policy:
  - Scripts load only from the site itself.
  - Network calls go only to the site and the five model providers.
  - Images can't load from other hosts.
