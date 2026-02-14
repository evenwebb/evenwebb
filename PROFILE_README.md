# Profile README Auto-Updater

This repository uses a GitHub Action to automatically update the profile README with:

- Recent commits (from public repos)
- Recently updated repos
- Recent activity (pushes, PRs, forks, etc.)
- Total stars and repo count
- Contributions this week

## How It Works

1. The workflow runs on a schedule (every 6 hours), on push to `main`, or manually via the Actions tab.
2. `scripts/update-readme.js` fetches data from the GitHub API.
3. Placeholders in `templates/README.md.tpl` are replaced with the fetched data.
4. The result is written to `README.md` and committed (if changed).

## Customization

Edit `update-readme.config.json` to:

- **excludeRepos** — Repos to never list (e.g. this profile repo)
- **excludeForkedRepos** / **excludeArchivedRepos** — Filter out forks and archived repos
- **maxRecentCommits**, **maxRecentlyUpdatedRepos**, **maxRecentActivity** — Limits per section
- **commitMessageMaxLength** — Truncate long commit messages
- **timeFormat** — `"relative"` (2d ago) or `"absolute"` (Feb 14, 2026)

## Local Preview

To preview changes without committing:

1. Create a [Personal Access Token](https://github.com/settings/tokens) with `repo` scope.
2. Run: `GITHUB_TOKEN=your_token node scripts/update-readme.js --dry-run`

The generated README will be printed to stdout.

## Files

- `templates/README.md.tpl` — Template with `{{placeholders}}`
- `scripts/update-readme.js` — Update script
- `update-readme.config.json` — Configuration
- `.github/workflows/update-readme.yml` — GitHub Action workflow
