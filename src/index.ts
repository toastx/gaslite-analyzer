import * as core from '@actions/core';
import * as github from '@actions/github';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callGaslite(
  apiUrl: string,
  apiKey: string,
  contractSource: string
): Promise<OptimizeResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${apiUrl}/api/optimize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contract_source: contractSource }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gaslite API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<OptimizeResponse>;
}

function getChangedSolFiles(): string[] {
  try {
    // Get files changed in this PR compared to base branch
    const output = execSync(
      'git diff --name-only --diff-filter=AM HEAD~1 HEAD 2>/dev/null || git diff --name-only --diff-filter=AM origin/main HEAD 2>/dev/null || echo ""',
      { encoding: 'utf8' }
    );
    return output
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.endsWith('.sol') && fs.existsSync(f));
  } catch {
    core.warning('Could not detect changed files — scanning all .sol files');
    return getAllSolFiles();
  }
}

function getAllSolFiles(): string[] {
  const results: string[] = [];
  const ignoreDirs = ['node_modules', 'lib', 'out', 'cache', '.git', 'broadcast'];

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !ignoreDirs.includes(entry.name)) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.sol')) {
        results.push(fullPath);
      }
    }
  }

  scan('src');
  scan('contracts');
  return results;
}

function formatPRComment(results: FileResult[], repoUrl: string, sha: string): string {
  const optimized = results.filter(r => r.status === 'optimized');
  const errors = results.filter(r => r.status === 'error');
  const skipped = results.filter(r => r.status === 'skipped');

  const totalPatterns = new Set(optimized.flatMap(r => r.patterns)).size;

  let comment = `## ⚡ Gaslite Gas Optimization Report\n\n`;

  // Summary header
  if (optimized.length === 0) {
    comment += `> ✅ No optimization opportunities found — your code is already efficient!\n\n`;
  } else {
    comment += `> 🔥 Found **${optimized.length}** file(s) with optimization opportunities using **${totalPatterns}** unique patterns\n\n`;
  }

  comment += `| Metric | Value |\n`;
  comment += `|--------|-------|\n`;
  comment += `| Files analyzed | ${results.length} |\n`;
  comment += `| Files with optimizations | ${optimized.length} |\n`;
  comment += `| Files skipped | ${skipped.length} |\n`;
  comment += `| Unique patterns applied | ${totalPatterns} |\n`;
  comment += `| Commit | [\`${sha.slice(0, 7)}\`](${repoUrl}/commit/${sha}) |\n\n`;

  // Per-file results
  for (const result of optimized) {
    comment += `---\n\n`;
    comment += `### 📄 \`${result.file}\`\n\n`;

    if (result.patterns.length > 0) {
      comment += `**Patterns applied:** `;
      comment += result.patterns.map(p => `\`${p}\``).join(', ');
      comment += `\n\n`;
    }

    comment += `<details>\n<summary>View optimized code</summary>\n\n`;
    comment += `\`\`\`solidity\n${result.optimized_code}\n\`\`\`\n\n`;
    comment += `</details>\n\n`;
  }

  // Errors section
  if (errors.length > 0) {
    comment += `---\n\n`;
    comment += `### ⚠️ Errors\n\n`;
    for (const result of errors) {
      comment += `- \`${result.file}\`: ${result.error}\n`;
    }
    comment += `\n`;
  }

  // Footer
  comment += `---\n\n`;
  comment += `<sub>Powered by [Gaslite](https://github.com/gaslite) — `;
  comment += `Autonomous gas optimization for Mantle L2 · `;
  comment += `[Add to your repo](https://github.com/marketplace/actions/gaslite-gas-optimizer)</sub>\n`;

  return comment;
}

async function findExistingComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number | null> {
  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.data.find(c =>
    c.body?.includes('Gaslite Gas Optimization Report')
  );

  return existing?.id ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('gaslite-api-url', { required: true });
    const apiKey = core.getInput('gaslite-api-key');
    const token = core.getInput('github-token', { required: true });
    const minSavings = parseInt(core.getInput('min-gas-savings') || '100');
    const failOnUnoptimized = core.getInput('fail-on-unoptimized') === 'true';

    const octokit = github.getOctokit(token);
    const context = github.context;

    // Only run on PRs
    if (!context.payload.pull_request) {
      core.info('Not a PR event — skipping Gaslite analysis');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    const { owner, repo } = context.repo;
    const sha = context.payload.pull_request.head.sha;
    const repoUrl = `https://github.com/${owner}/${repo}`;

    core.info(`🔍 Gaslite analyzing PR #${prNumber}`);

    // Get changed Solidity files
    const solFiles = getChangedSolFiles();

    if (solFiles.length === 0) {
      core.info('No Solidity files changed in this PR — skipping');
      return;
    }

    core.info(`Found ${solFiles.length} Solidity file(s) to analyze: ${solFiles.join(', ')}`);

    // Analyze each file
    const results: FileResult[] = [];

    for (const file of solFiles) {
      core.info(`Analyzing ${file}...`);

      try {
        const source = fs.readFileSync(file, 'utf8');

        // Skip test files and interfaces
        if (
          file.includes('.t.sol') ||
          file.includes('/test/') ||
          file.includes('/tests/') ||
          file.includes('/mock/') ||
          file.includes('Mock') ||
          source.includes('interface I') && source.split('\n').length < 30
        ) {
          core.info(`Skipping ${file} (test/interface file)`);
          results.push({
            file,
            status: 'skipped',
            patterns: [],
            optimized_code: '',
          });
          continue;
        }

        const response = await callGaslite(apiUrl, apiKey, source);

        results.push({
          file,
          status: 'optimized',
          patterns: response.suggested_patterns,
          optimized_code: response.optimized_code,
        });

        core.info(`✅ ${file}: found patterns ${response.suggested_patterns.join(', ')}`);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        core.warning(`Error analyzing ${file}: ${errorMsg}`);
        results.push({
          file,
          status: 'error',
          patterns: [],
          optimized_code: '',
          error: errorMsg,
        });
      }
    }

    // Format and post PR comment
    const commentBody = formatPRComment(results, repoUrl, sha);

    // Update existing comment or create new one
    const existingCommentId = await findExistingComment(octokit, owner, repo, prNumber);

    if (existingCommentId) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingCommentId,
        body: commentBody,
      });
      core.info('Updated existing Gaslite comment on PR');
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: commentBody,
      });
      core.info('Posted Gaslite comment on PR');
    }

    // Set outputs
    const optimizedCount = results.filter(r => r.status === 'optimized').length;
    core.setOutput('optimized-files', optimizedCount);
    core.setOutput('total-files', solFiles.length);

    // Fail if configured and optimizations found
    if (failOnUnoptimized && optimizedCount > 0) {
      core.setFailed(
        `Gaslite found ${optimizedCount} file(s) with gas optimization opportunities. ` +
        `Review the PR comment and apply optimizations before merging.`
      );
    }

  } catch (error) {
    core.setFailed(`Gaslite Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run();