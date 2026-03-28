// github.js — All GitHub API interactions

async function fetchPRDetails(octokit, { owner, repo, pull_number }) {
  const [pr, files] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number }),
    octokit.pulls.listFiles({ owner, repo, pull_number })
  ]);

  return {
    title:        pr.data.title,
    description:  pr.data.body || "(no description)",
    author:       pr.data.user.login,
    base_branch:  pr.data.base.ref,
    head_branch:  pr.data.head.ref,
    head_sha:     pr.data.head.sha,
    state:        pr.data.state,
    created_at:   pr.data.created_at,
    changed_files: files.data.map(f => ({
      filename:  f.filename,
      status:    f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch:     f.patch
    }))
  };
}

async function fetchPRDiff(octokit, { owner, repo, pull_number }) {
  const response = await octokit.pulls.get({
    owner, repo, pull_number,
    mediaType: { format: "diff" }
  });
  return { diff: response.data };
}

async function postReviewComment(octokit, { owner, repo, pull_number, body, commit_id, path, line }) {
  try {
    await octokit.pulls.createReviewComment({
      owner, repo, pull_number,
      body, commit_id, path, line,
      side: "RIGHT"
    });
    return { success: true, message: `Comment posted on ${path}:${line}` };
  } catch {
    // Fallback to general PR comment
    await octokit.issues.createComment({
      owner, repo,
      issue_number: pull_number,
      body: `**Review comment on \`${path}\` (line ${line}):**\n\n${body}`
    });
    return { success: true, message: "Fallback: posted as general comment" };
  }
}

async function approvePR(octokit, { owner, repo, pull_number, message }) {
  await octokit.issues.createComment({
    owner, repo,
    issue_number: pull_number,
    body: `## ✅ AI Code Review — Approved\n\n${message}\n\n---\n*Reviewed by AI PR Review Agent (GPT-4o) 🤖*`
  });

  await octokit.pulls.createReview({
    owner, repo, pull_number,
    event: "APPROVE",
    body: message
  });

  return { success: true, action: "approved" };
}

async function requestChanges(octokit, { owner, repo, pull_number, summary }) {
  await octokit.issues.createComment({
    owner, repo,
    issue_number: pull_number,
    body: `## 🔍 AI Code Review — Changes Requested\n\n${summary}\n\n---\n> Please address the issues above and push a new commit. The agent will re-review automatically.\n\n*Reviewed by AI PR Review Agent (GPT-4o) 🤖*`
  });

  await octokit.pulls.createReview({
    owner, repo, pull_number,
    event: "REQUEST_CHANGES",
    body: summary
  });

  return { success: true, action: "changes_requested" };
}

module.exports = { fetchPRDetails, fetchPRDiff, postReviewComment, approvePR, requestChanges };
