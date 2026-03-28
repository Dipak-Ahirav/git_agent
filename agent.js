const OpenAI = require("openai");
const { Octokit } = require("@octokit/rest");
const {
  fetchPRDetails,
  fetchPRDiff,
  postReviewComment,
  approvePR,
  requestChanges,
} = require("./github");
const { analyzeCodeWithAI } = require("./analyzer");

require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// ─── Tool Definitions (OpenAI function calling format) ───────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "fetch_pr_details",
      description:
        "Fetch PR metadata: title, description, author, branches, and list of changed files with their diffs.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "GitHub repo owner/org" },
          repo: { type: "string", description: "GitHub repo name" },
          pull_number: { type: "integer", description: "Pull request number" },
        },
        required: ["owner", "repo", "pull_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_pr_diff",
      description:
        "Fetch the full unified diff of the pull request to see exactly what code changed.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          pull_number: { type: "integer" },
        },
        required: ["owner", "repo", "pull_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_code",
      description:
        "Analyze a code snippet or diff for bugs, security issues, and code quality problems. Returns structured findings by severity.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The code or diff to analyze" },
          language: {
            type: "string",
            description: "Programming language (js, py, ts, go, etc.)",
          },
          context: {
            type: "string",
            description: "What this code is supposed to do",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_review_comment",
      description:
        "Post an inline review comment on a specific file and line in the PR.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          pull_number: { type: "integer" },
          body: {
            type: "string",
            description: "The review comment text (markdown supported)",
          },
          commit_id: {
            type: "string",
            description: "The head commit SHA of the PR",
          },
          path: { type: "string", description: "File path to comment on" },
          line: {
            type: "integer",
            description: "Line number to attach the comment to",
          },
        },
        required: [
          "owner",
          "repo",
          "pull_number",
          "body",
          "commit_id",
          "path",
          "line",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_pr",
      description:
        "Approve the pull request when no critical or medium issues are found. If AUTO_MERGE_ON_APPROVAL=true, this also attempts to merge the PR after approval.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          pull_number: { type: "integer" },
          message: {
            type: "string",
            description: "Approval message to the PR author",
          },
        },
        required: ["owner", "repo", "pull_number", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_changes",
      description:
        "Request changes on the PR when critical or medium issues are found.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          pull_number: { type: "integer" },
          summary: {
            type: "string",
            description: "Full summary of all issues found across all files",
          },
        },
        required: ["owner", "repo", "pull_number", "summary"],
      },
    },
  },
];

// ─── Tool Executor ───────────────────────────────────────────────────────────

async function executeTool(name, args) {
  console.log(`\n🔧 Tool: ${name}`);
  console.log("   Args:", JSON.stringify(args, null, 2));

  switch (name) {
    case "fetch_pr_details":
      return await fetchPRDetails(octokit, args);

    case "fetch_pr_diff":
      return await fetchPRDiff(octokit, args);

    case "analyze_code":
      return await analyzeCodeWithAI(openai, args);

    case "post_review_comment":
      return await postReviewComment(octokit, args);

    case "approve_pr":
      return await approvePR(octokit, args);

    case "request_changes":
      return await requestChanges(octokit, args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Agentic Loop ────────────────────────────────────────────────────────────

async function runPRReviewAgent({ owner, repo, pull_number }) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🤖 PR Review Agent Starting (OpenAI GPT-4o)`);
  console.log(`   Repo: ${owner}/${repo}  |  PR #${pull_number}`);
  console.log(`${"═".repeat(60)}\n`);

  const systemPrompt = `You are an expert AI code reviewer agent. Your job is to thoroughly review GitHub Pull Requests and provide actionable, constructive feedback.

Your step-by-step review process:
1. Call fetch_pr_details to get the PR metadata and list of changed files
2. Call fetch_pr_diff to get the full code diff
3. Call analyze_code on the diff (or per-file if needed) to find issues
4. For EACH issue found, call post_review_comment on the relevant file and line
5. After posting all comments, decide the final verdict:
   - If CRITICAL or MEDIUM issues exist → call request_changes with a full summary
   - If only LOW or no issues → call approve_pr with an encouraging message

Severity definitions:
- 🔴 CRITICAL: Security vulnerabilities, data loss, crashes, broken auth, injections
- 🟡 MEDIUM: Performance bugs, missing error handling, race conditions, bad patterns
- 🟢 LOW: Style issues, naming, missing docs, minor refactor suggestions

Always be specific: reference exact variable names, line numbers, and provide concrete fix suggestions.`;

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Please review PR #${pull_number} in the repository ${owner}/${repo}. Perform a complete review: fetch details, analyze the diff, post inline comments for every issue, then approve or request changes.`,
    },
  ];

  let iteration = 0;
  const maxIterations = 20;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n📍 Agent Iteration ${iteration}`);

    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages,
      tools,
      tool_choice: "auto", // Agent decides when to call tools
      temperature: 0.2, // Lower = more deterministic reviews
    });

    const message = response.choices[0].message;
    const finishReason = response.choices[0].finish_reason;

    console.log(`   Finish reason: ${finishReason}`);

    // Add assistant message to history
    messages.push(message);

    // Done — no more tool calls needed
    if (finishReason === "stop") {
      console.log(`\n✅ Agent completed review.\n`);
      if (message.content) console.log(message.content);
      return { success: true, summary: message.content };
    }

    // Process tool calls
    if (finishReason === "tool_calls" && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const name = toolCall.function.name;
        let args;

        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        let result;
        try {
          result = await executeTool(name, args);
          console.log(`   ✓ ${name} succeeded`);
        } catch (err) {
          console.error(`   ✗ ${name} failed: ${err.message}`);
          result = { error: err.message };
        }

        // Feed result back into the conversation
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
    }
  }

  throw new Error("Agent exceeded maximum iterations");
}

// ─── Exports & CLI ───────────────────────────────────────────────────────────

module.exports = { runPRReviewAgent };

if (require.main === module) {
  const [owner, repo, prNum] = process.argv.slice(2);
  if (!owner || !repo || !prNum) {
    console.error("Usage: node agent.js <owner> <repo> <pr_number>");
    process.exit(1);
  }
  runPRReviewAgent({ owner, repo, pull_number: parseInt(prNum) })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
