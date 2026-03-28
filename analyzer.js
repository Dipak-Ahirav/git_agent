// analyzer.js — AI-powered code analysis using OpenAI

async function analyzeCodeWithAI(
  openai,
  { code, language = "unknown", context = "" },
) {
  const prompt = `You are a senior code reviewer. Analyze the following ${language} code/diff and identify ALL issues.

${context ? `Context: ${context}\n` : ""}

Code to review:
\`\`\`${language}
${code}
\`\`\`

Return a JSON object with this exact structure (no markdown, just raw JSON):
{
  "critical": [
    {
      "title": "Short issue title",
      "description": "Detailed explanation of the problem",
      "fix": "Concrete suggestion to fix it",
      "line_hint": 42
    }
  ],
  "medium": [],
  "low": [],
  "summary": "One paragraph overall assessment"
}

Severity guide:
- critical: Security holes, crashes, data loss, SQL injection, XSS, broken auth
- medium: Performance bugs, missing error handling, race conditions, memory leaks
- low: Style issues, naming, missing comments, minor refactors

Be specific — reference actual variable names and line numbers when possible.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are a code security and quality expert. Always respond with valid JSON only, no markdown.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" }, // GPT-4o enforces JSON output
  });

  const text = response.choices[0].message.content.trim();

  try {
    return JSON.parse(text);
  } catch {
    return {
      critical: [],
      medium: [],
      low: [],
      summary: text,
      parse_error: true,
    };
  }
}

module.exports = { analyzeCodeWithAI };
