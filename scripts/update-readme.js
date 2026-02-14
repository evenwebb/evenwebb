#!/usr/bin/env node

/**
 * GitHub Profile README Auto-Updater
 * Fetches data from GitHub API and updates README.md from template.
 * Usage: node scripts/update-readme.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'update-readme.config.json');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'README.md.tpl');
const OUTPUT_PATH = path.join(ROOT, 'README.md');

const FALLBACK = '*Unable to load — will retry on next run*';
const EMPTY_MSG = '*No recent activity*';

// --- Config ---
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load config:', err.message);
    process.exit(1);
  }
}

// --- GitHub API ---
async function ghFetch(url) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function ghFetchAllPages(baseUrl, maxPages = 5) {
  const results = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}&per_page=100`;
    const data = await ghFetch(url);
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
  }
  return results;
}

// --- Time formatting ---
function formatRelative(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAbsolute(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// --- Data fetching ---
async function fetchRepos(config) {
  const { username, excludeRepos = [], excludeForkedRepos, excludeArchivedRepos } = config;
  const all = await ghFetchAllPages(`https://api.github.com/users/${username}/repos?sort=updated`);
  return all.filter((r) => {
    if (r.private) return false;
    if (excludeRepos.includes(r.full_name)) return false;
    if (excludeForkedRepos && r.fork) return false;
    if (excludeArchivedRepos && r.archived) return false;
    return true;
  });
}

async function fetchRecentCommits(config, publicRepos) {
  const { username, maxRecentCommits, commitMessageMaxLength, timeFormat } = config;
  const reposToQuery = publicRepos.slice(0, 15);
  const allCommits = [];

  for (const repo of reposToQuery) {
    try {
      const commits = await ghFetch(
        `https://api.github.com/repos/${repo.full_name}/commits?author=${username}&per_page=5`
      );
      if (!Array.isArray(commits)) continue;
      for (const c of commits) {
        const msg = (c.commit?.message || '').split('\n')[0];
        const truncated =
          msg.length > commitMessageMaxLength
            ? msg.slice(0, commitMessageMaxLength) + '…'
            : msg;
        allCommits.push({
          repo: repo.name,
          fullName: repo.full_name,
          message: truncated,
          sha: c.sha,
          date: c.commit?.author?.date || c.commit?.committer?.date,
        });
      }
    } catch {
      // Skip repo on error
    }
  }

  allCommits.sort((a, b) => new Date(b.date) - new Date(a.date));
  const top = allCommits.slice(0, maxRecentCommits);
  const formatTime = timeFormat === 'absolute' ? formatAbsolute : formatRelative;

  if (top.length === 0) return EMPTY_MSG;
  return top
    .map(
      (c) =>
        `- [${c.repo}](${`https://github.com/${c.fullName}/commit/${c.sha}`}): ${c.message} · ${formatTime(c.date)}`
    )
    .join('\n');
}

function formatRecentlyUpdatedRepos(config, publicRepos) {
  const { maxRecentlyUpdatedRepos } = config;
  const top = publicRepos.slice(0, maxRecentlyUpdatedRepos);
  if (top.length === 0) return EMPTY_MSG;
  return top
    .map((r) => {
      const desc = (r.description || '').slice(0, 60);
      const descStr = desc ? (desc.length >= 60 ? desc + '…' : desc) : 'No description';
      return `- **[${r.name}](https://github.com/${r.full_name})** — ${descStr} · ⭐ ${r.stargazers_count} · ${r.language || 'N/A'}`;
    })
    .join('\n');
}

function formatRecentActivity(config, events) {
  const { maxRecentActivity } = config;
  const eventLabels = {
    PushEvent: (e) => `Pushed to [${e.repo.name}](https://github.com/${e.repo.name})`,
    CreateEvent: (e) =>
      e.payload?.ref_type === 'repository'
        ? `Created [${e.repo.name}](https://github.com/${e.repo.name})`
        : null,
    ForkEvent: (e) => `Forked [${e.payload?.forkee?.full_name}](https://github.com/${e.payload?.forkee?.full_name})`,
    PullRequestEvent: (e) =>
      `Opened PR in [${e.repo.name}](https://github.com/${e.repo.name})`,
    IssuesEvent: (e) => `Opened issue in [${e.repo.name}](https://github.com/${e.repo.name})`,
    WatchEvent: (e) => `Starred [${e.repo.name}](https://github.com/${e.repo.name})`,
    ReleaseEvent: (e) => `Released [${e.repo.name}](https://github.com/${e.repo.name})`,
  };

  const lines = [];
  const seen = new Set();
  for (const e of events) {
    if (lines.length >= maxRecentActivity) break;
    const fn = eventLabels[e.type];
    if (!fn) continue;
    const line = fn(e);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(`- ${line}`);
  }

  if (lines.length === 0) return EMPTY_MSG;
  return lines.join('\n');
}

function countContributionsThisWeek(events) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return events.filter((e) => e.type === 'PushEvent' && new Date(e.created_at) >= weekAgo).length;
}

// --- Main ---
async function main() {
  const config = loadConfig();
  const { username } = config;

  let publicRepos = [];
  let events = [];
  let totalStars = 0;
  let repoCount = 0;
  let recentCommits = FALLBACK;
  let recentlyUpdatedRepos = FALLBACK;
  let recentActivity = FALLBACK;
  let contributionsThisWeek = '0';
  const lastUpdated = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    publicRepos = await fetchRepos(config);
    repoCount = publicRepos.length;
    totalStars = publicRepos.reduce((s, r) => s + (r.stargazers_count || 0), 0);

    events = await ghFetch(
      `https://api.github.com/users/${username}/events?per_page=100`
    );
    if (!Array.isArray(events)) events = [];

    recentCommits = await fetchRecentCommits(config, publicRepos);
    recentlyUpdatedRepos = formatRecentlyUpdatedRepos(config, publicRepos);
    recentActivity = formatRecentActivity(config, events);
    contributionsThisWeek = String(countContributionsThisWeek(events));
  } catch (err) {
    console.error('Error fetching data:', err.message);
    process.exit(1);
  }

  let template;
  try {
    template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    console.error('Failed to read template:', err.message);
    process.exit(1);
  }

  const replacements = {
    '{{total_stars}}': String(totalStars),
    '{{repo_count}}': String(repoCount),
    '{{recent_commits}}': recentCommits,
    '{{recently_updated_repos}}': recentlyUpdatedRepos,
    '{{recent_activity}}': recentActivity,
    '{{last_updated}}': lastUpdated,
    '{{contributions_this_week}}': contributionsThisWeek,
  };

  let output = template;
  for (const [key, val] of Object.entries(replacements)) {
    output = output.split(key).join(val);
  }

  // Replace any remaining placeholders with fallback
  output = output.replace(/\{\{[^}]+\}\}/g, FALLBACK);

  if (DRY_RUN) {
    console.log(output);
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log('README.md updated successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
