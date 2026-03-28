// server.js — Webhook server to auto-trigger the OpenAI PR Review Agent

const express = require("express");
const crypto = require("crypto");
const querystring = require("querystring");
const { runPRReviewAgent } = require("./agent");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

function verifyGitHubSignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !req.rawBody) return false;

  try {
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const actualBuffer = Buffer.from(String(signature), "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return false;
  }
}

function parseWebhookBody(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const rawText = req.rawBody.toString("utf8");

  if (contentType.includes("application/json")) {
    return JSON.parse(rawText);
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const parsed = querystring.parse(rawText);
    return parsed.payload ? JSON.parse(parsed.payload) : parsed;
  }

  throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
}

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const event = req.headers["x-github-event"];
  let payload;

  if (!verifyGitHubSignature(req)) {
    console.warn("⚠️  Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    payload = parseWebhookBody(req);
  } catch (error) {
    console.warn("Invalid webhook payload:", error.message);
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  if (event !== "pull_request") {
    return res.status(200).json({ message: `Ignored: ${event}` });
  }

  const { action, pull_request, repository } = payload;
  const triggerActions = ["opened", "reopened", "synchronize"];

  if (!triggerActions.includes(action)) {
    return res.status(200).json({ message: `Ignored PR action: ${action}` });
  }

  const owner = repository.owner.login;
  const repo = repository.name;
  const pull_number = pull_request.number;

  console.log(`\n🚀 PR #${pull_number} ${action} → starting review`);

  res.status(202).json({ message: "Review started", pr: pull_number });

  runPRReviewAgent({ owner, repo, pull_number })
    .then(() => console.log(`✅ Review done for PR #${pull_number}`))
    .catch((err) => console.error(`❌ Review failed:`, err.message));
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agent: "PR Review Agent (GPT-4o)",
    time: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`\n🤖 PR Review Agent (OpenAI) running on port ${PORT}`);
  console.log(`   POST /webhook  — GitHub webhook`);
  console.log(`   GET  /health   — Health check\n`);
});
