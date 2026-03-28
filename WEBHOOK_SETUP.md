# GitHub PR Review Agent Setup Guide

This guide covers the complete setup for running this project locally and connecting it to GitHub webhooks so pull requests trigger the review agent automatically.

## 1. What this project does

This app starts a local Express server and exposes a webhook endpoint:

- `POST /webhook` receives GitHub pull request events
- `GET /health` is a health-check route

When GitHub sends a supported pull request event, the app:

1. Verifies the webhook signature using `GITHUB_WEBHOOK_SECRET`
2. Reads the PR details and diff using `GITHUB_TOKEN`
3. Sends the diff to OpenAI using `OPENAI_API_KEY`
4. Posts review comments and an approve/request-changes review back to GitHub

Relevant files:

- [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js)
- [agent.js](/d:/Projects%20AI%20AGENT/git_agent/agent.js)
- [github.js](/d:/Projects%20AI%20AGENT/git_agent/github.js)
- [analyzer.js](/d:/Projects%20AI%20AGENT/git_agent/analyzer.js)

## 2. Requirements

Install these first:

- Node.js 18+ recommended
- npm
- A GitHub account with access to the target repository
- An OpenAI API key
- `cloudflared` installed on Windows for public webhook forwarding

## 3. Install dependencies

From the project folder:

```powershell
npm install
```

## 4. Configure `.env`

Create or update [.env](/d:/Projects%20AI%20AGENT/git_agent/.env) with:

```env
OPENAI_API_KEY=your_openai_api_key
GITHUB_TOKEN=your_github_token
GITHUB_WEBHOOK_SECRET=your_webhook_secret
PORT=3000
AUTO_MERGE_ON_APPROVAL=false
GITHUB_MERGE_METHOD=squash
```

Notes:

- `OPENAI_API_KEY` is used by [agent.js](/d:/Projects%20AI%20AGENT/git_agent/agent.js)
- `GITHUB_TOKEN` is used for GitHub API calls in [github.js](/d:/Projects%20AI%20AGENT/git_agent/github.js)
- `GITHUB_WEBHOOK_SECRET` is used in [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js#L13)
- `PORT` defaults to `3000`
- `AUTO_MERGE_ON_APPROVAL=true` makes the agent merge clean PRs after approval
- `GITHUB_MERGE_METHOD` can be `merge`, `squash`, or `rebase`

Do not add quotes unless the value itself requires them. Avoid spaces before or after the `=`.

## 5. Generate `GITHUB_WEBHOOK_SECRET`

`GITHUB_WEBHOOK_SECRET` is free. You generate it yourself.

Use PowerShell:

```powershell
$rng = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rng)
[Convert]::ToBase64String($rng)
```

Or generate a hex string:

```powershell
$rng = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rng)
($rng | ForEach-Object { $_.ToString("x2") }) -join ""
```

Or generate the same kind of hex secret with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into:

```env
GITHUB_WEBHOOK_SECRET=your_generated_secret
```

Important:

- The exact same secret must also be entered in GitHub webhook settings
- If the two values do not match exactly, webhook verification fails with `401 Invalid signature`

## 6. Generate `GITHUB_TOKEN`

Use a GitHub fine-grained personal access token.

Path in GitHub:

1. Profile picture
2. `Settings`
3. `Developer settings`
4. `Personal access tokens`
5. `Fine-grained tokens`
6. `Generate new token`

Recommended token settings:

- Token name: `pr-review-agent`
- Repository access: `Only select repositories`
- Select the repo this bot will review

Repository permissions:

- `Pull requests`: `Read and write`
- `Issues`: `Read and write`
- `Contents`: `Read and write` if you want the bot to merge PRs automatically

Why those permissions are needed:

- Read PR metadata and changed files
- Post review comments
- Approve PRs or request changes
- Post fallback PR comments through the Issues API
- Merge the PR after approval when auto-merge is enabled

Then set:

```env
GITHUB_TOKEN=github_pat_xxxxx
```

## 7. Start the local server

Run:

```powershell
npm start
```

Expected output includes:

```text
PR Review Agent (OpenAI) running on port 3000
POST /webhook - GitHub webhook
GET  /health  - Health check
```

The server file is [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js).

## 8. Test the local server

Open this in a browser:

```text
http://localhost:3000/health
```

You should get JSON with status `ok`.

Do not test `/webhook` in the browser. A browser sends `GET /webhook`, but this app only defines `POST /webhook`.

That is why this is expected:

```text
Cannot GET /webhook
```

## 9. Install and run Cloudflare tunnel

Install `cloudflared` if needed:

```powershell
winget install --id Cloudflare.cloudflared
```

If `cloudflared` is installed but not on your `PATH`, use the full executable path.

Example:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3000
```

Use `127.0.0.1` instead of `localhost` to avoid IPv6 `[::1]` connection issues.

Cloudflare prints a public URL like:

```text
https://example-name.trycloudflare.com
```

Keep this terminal open.

## 10. Configure the GitHub webhook

Go to your GitHub repository:

1. `Settings`
2. `Webhooks`
3. `Add webhook`

Set these values:

- Payload URL: `https://your-trycloudflare-url/webhook`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`
- Events: `Let me select individual events`
- Select `Pull requests`
- Active: enabled

Example:

```text
https://example-name.trycloudflare.com/webhook
```

Important:

- Always include `/webhook`
- If you restart `cloudflared`, the `trycloudflare.com` URL usually changes
- When the tunnel URL changes, update the webhook Payload URL in GitHub

## 11. Trigger the automation

This app responds only to specific pull request actions in [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js#L75):

- `opened`
- `reopened`
- `synchronize`

That means the agent runs when:

- you open a new PR
- you reopen a closed PR
- you push a new commit to an open PR

If the PR was already open before webhook setup, pushing a new commit is the simplest way to trigger the flow.

### Auto-merge behavior

If you want the agent to merge a PR after a clean review, set:

```env
AUTO_MERGE_ON_APPROVAL=true
GITHUB_MERGE_METHOD=squash
```

Behavior:

- If critical or medium issues are found, the bot requests changes
- If only low-severity or no issues are found, the bot approves the PR
- If approval succeeds and `AUTO_MERGE_ON_APPROVAL=true`, the bot then attempts to merge the PR

Allowed merge methods:

- `merge`
- `squash`
- `rebase`

Notes:

- Merge can still fail if branch protection rules block it
- Merge requires the GitHub token to have `Contents: Read and write`

## 12. How the webhook flow works

1. GitHub sends a `POST` request to `/webhook`
2. [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js#L53) captures the raw request body
3. [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js#L13) verifies `x-hub-signature-256`
4. If valid, the webhook payload is parsed
5. PR owner, repo, and number are extracted
6. [agent.js](/d:/Projects%20AI%20AGENT/git_agent/agent.js) runs the review workflow
7. [github.js](/d:/Projects%20AI%20AGENT/git_agent/github.js) reads PR details and posts results

## 13. Common errors and fixes

### Error: `cloudflared : The term 'cloudflared' is not recognized`

Cause:

- `cloudflared` is not installed, or Windows cannot find it in `PATH`

Fix:

```powershell
winget install --id Cloudflare.cloudflared
where.exe cloudflared
```

If needed, run the full path:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3000
```

### Error: `Unable to reach the origin service`

Cause:

- your app is not actually running on port `3000`
- or `cloudflared` is forwarding to the wrong place

Fix:

1. Start the app:

```powershell
npm start
```

2. Confirm:

```text
http://localhost:3000/health
```

3. Start the tunnel using:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3000
```

### Error: `Cannot GET /webhook`

Cause:

- you opened `/webhook` in a browser

Fix:

- This is expected
- `/webhook` is `POST` only
- Use `/health` for browser checks

### Error: `Invalid webhook signature`

Cause:

- `GITHUB_WEBHOOK_SECRET` in `.env` does not exactly match the Secret in GitHub webhook settings
- or server was not restarted after `.env` changes
- or webhook content type is not `application/json`

Fix:

1. Verify `.env`:

```env
GITHUB_WEBHOOK_SECRET=exact_same_secret_as_github
```

2. Verify GitHub webhook settings:

- Secret matches exactly
- Content type is `application/json`

3. Restart the app:

```powershell
npm start
```

4. In GitHub webhook page, open `Recent Deliveries` and click `Redeliver`

### Why `req.rawBody` was undefined

Old behavior:

- `req.rawBody` depended on `express.json({ verify })`
- that only works reliably when Express decides the request is JSON

Current fix in [server.js](/d:/Projects%20AI%20AGENT/git_agent/server.js#L53):

- `/webhook` now uses `express.raw({ type: "*/*" })`
- raw bytes are captured first
- signature verification uses the original request bytes
- payload parsing happens after verification

This is the correct pattern for GitHub signature validation.

### Error in GitHub Recent Deliveries

Use GitHub:

1. `Settings`
2. `Webhooks`
3. Select your webhook
4. Open `Recent Deliveries`

Interpret the status:

- `200` or `202`: webhook reached your app
- `401`: secret mismatch
- `404`: wrong URL or missing `/webhook`
- timeout / connection refused: tunnel or local app is down

## 14. Recommended testing sequence

Use this exact order:

1. Set `.env`
2. Run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000/health`
5. Start `cloudflared` with `http://127.0.0.1:3000`
6. Copy the current `https://...trycloudflare.com` URL
7. Set GitHub webhook Payload URL to `https://...trycloudflare.com/webhook`
8. Confirm GitHub Secret matches `.env`
9. Open or update a PR
10. Watch the `npm start` terminal
11. If nothing happens, inspect GitHub `Recent Deliveries`

## 15. What success looks like

When the webhook is correct and the app can review the PR:

- GitHub successfully delivers the webhook
- the `npm start` terminal logs the PR action
- the app fetches PR metadata and diff
- the agent analyzes the diff
- the bot posts comments or a review on the PR

## 16. Security notes

Do not commit real secrets.

Your `.gitignore` already ignores [.env](/d:/Projects%20AI%20AGENT/git_agent/.env), which is correct.

If you accidentally exposed real credentials while testing:

- rotate the OpenAI API key
- rotate the GitHub token
- generate a new webhook secret

## 17. Useful commands

Install dependencies:

```powershell
npm install
```

Run the app:

```powershell
npm start
```

Run in dev mode:

```powershell
npm run dev
```

Start Cloudflare tunnel:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3000
```

Check health:

```text
http://localhost:3000/health
```

Check whether port `3000` is listening:

```powershell
netstat -ano | findstr :3000
```

Find `cloudflared`:

```powershell
where.exe cloudflared
```

## 18. Final checklist

Before expecting PR reviews to work, confirm all of these:

- `.env` exists
- `OPENAI_API_KEY` is valid
- `GITHUB_TOKEN` is valid
- `GITHUB_WEBHOOK_SECRET` is set
- `npm start` is running
- `http://localhost:3000/health` works
- `cloudflared` is running
- GitHub webhook URL uses the current `trycloudflare.com` URL
- GitHub webhook URL ends with `/webhook`
- GitHub webhook Secret exactly matches `.env`
- GitHub webhook Content type is `application/json`
- PR event is one of `opened`, `reopened`, or `synchronize`

If all of those are correct, the automation should work end to end.
