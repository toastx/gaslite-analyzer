import { App, createNodeMiddleware } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { createServer } from 'node:http';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OptimizeResponse {
  analysis: string;
  suggested_patterns: string[];
  optimized_code: string;
}

interface FileResult {
  file: string;
  status: 'optimized' | 'skipped' | 'error';
  patterns: string[];
  optimized_code: string;
  error?: string;
}

// ── Gaslite API ───────────────────────────────────────────────────────────────

const GASLITE_API_URL = 'https://gaslite.onrender.com';

async function callGaslite(contractSource: string): Promise<OptimizeResponse> {
  const response = await fetch(`${GASLITE_API_URL}/api/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_source: contractSource }),
  });
  if (!response.ok) {
    throw new Error(`Gaslite API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<OptimizeResponse>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shouldSkip(filename: string, content: string): boolean {
  return (
    filename.endsWith('.t.sol') ||
    filename.includes('/test/') ||
    filename.includes('/tests/') ||
    filename.includes('/mock/') ||
    filename.includes('Mock') ||
    (content.includes('interface I') && content.split('\n').length < 30)
  );
}

function formatComment(results: FileResult[], repoUrl: string, sha: string): string {
  const optimized = results.filter(r => r.status === 'optimized');
  const errors = results.filter(r => r.status === 'error');
  const skipped = results.filter(r => r.status === 'skipped');
  const totalPatterns = new Set(optimized.flatMap(r => r.patterns)).size;

  let comment = `## ⚡ Gaslite Gas Optimization Report\n\n`;

  if (optimized.length === 0) {
    comment += `> ✅ No optimization opportunities found — your code is already efficient!\n\n`;
  } else {
    comment += `> 🔥 Found **${optimized.length}** file(s) with optimization opportunities using **${totalPatterns}** unique patterns\n\n`;
  }

  comment += `| Metric | Value |\n|--------|-------|\n`;
  comment += `| Files analyzed | ${results.length} |\n`;
  comment += `| Files with optimizations | ${optimized.length} |\n`;
  comment += `| Files skipped | ${skipped.length} |\n`;
  comment += `| Unique patterns applied | ${totalPatterns} |\n`;
  comment += `| Commit | [\`${sha.slice(0, 7)}\`](${repoUrl}/commit/${sha}) |\n\n`;

  for (const result of optimized) {
    comment += `---\n\n### 📄 \`${result.file}\`\n\n`;
    if (result.patterns.length > 0) {
      comment += `**Patterns applied:** ${result.patterns.map(p => `\`${p}\``).join(', ')}\n\n`;
    }
    comment += `<details>\n<summary>View optimized code</summary>\n\n\`\`\`solidity\n${result.optimized_code}\n\`\`\`\n\n</details>\n\n`;
  }

  if (errors.length > 0) {
    comment += `---\n\n### ⚠️ Errors\n\n`;
    for (const result of errors) {
      comment += `- \`${result.file}\`: ${result.error}\n`;
    }
    comment += `\n`;
  }

  comment += `---\n\n<sub>Powered by [Gaslite](https://github.com/toastx/gaslite) — `;
  comment += `Autonomous gas optimization for Mantle L2</sub>\n`;

  return comment;
}

// ── GitHub App ────────────────────────────────────────────────────────────────

const app = new App({
  appId: process.env.APP_ID!,
  privateKey: process.env.PRIVATE_KEY!,
  webhooks: { secret: process.env.WEBHOOK_SECRET! },
});

app.webhooks.on(
  ['pull_request.opened', 'pull_request.synchronize'],
  async ({ octokit: octokitBase, payload }) => {
    // Cast to REST-enabled Octokit — @octokit/app installs the REST plugin at runtime
    const octokit = octokitBase as unknown as Octokit;

    const { pull_request: pr, repository } = payload;
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = pr.number;
    const sha = pr.head.sha;
    const repoUrl = repository.html_url;

    console.log(`[gaslite] PR #${prNumber} in ${owner}/${repo}`);

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    const solFiles = files.filter(
      (f: { filename: string; status: string }) =>
        f.filename.endsWith('.sol') && f.status !== 'removed'
    );

    if (solFiles.length === 0) {
      console.log(`[gaslite] No .sol files changed — skipping`);
      return;
    }

    const results: FileResult[] = [];

    for (const file of solFiles as Array<{ filename: string }>) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file.filename,
          ref: sha,
        });

        if (Array.isArray(data) || !('content' in data)) continue;
        const content = Buffer.from(data.content as string, 'base64').toString('utf8');

        if (shouldSkip(file.filename, content)) {
          console.log(`[gaslite] Skipping ${file.filename}`);
          results.push({ file: file.filename, status: 'skipped', patterns: [], optimized_code: '' });
          continue;
        }

        const response = await callGaslite(content);
        results.push({
          file: file.filename,
          status: 'optimized',
          patterns: response.suggested_patterns,
          optimized_code: response.optimized_code,
        });
        console.log(`[gaslite] ✅ ${file.filename}: ${response.suggested_patterns.join(', ')}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[gaslite] Error on ${file.filename}: ${errorMsg}`);
        results.push({ file: file.filename, status: 'error', patterns: [], optimized_code: '', error: errorMsg });
      }
    }

    const body = formatComment(results, repoUrl, sha);

    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    const existing = (comments as Array<{ id: number; body?: string }>)
      .find(c => c.body?.includes('Gaslite Gas Optimization Report'));

    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
      console.log(`[gaslite] Updated comment on PR #${prNumber}`);
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
      console.log(`[gaslite] Posted comment on PR #${prNumber}`);
    }
  }
);

app.webhooks.onError(error => {
  console.error('[gaslite] Webhook error:', String(error));
});

// ── Server ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3000');

createServer(createNodeMiddleware(app)).listen(port, () => {
  console.log(`[gaslite] Webhook server running on port ${port}`);
});
