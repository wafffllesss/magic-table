# Contributing

Thank you for helping improve Meu Magic. Start by opening an issue for substantial changes, then fork the repository and submit a pull request against `main`. Small fixes may go directly to a pull request.

## Development setup

Use Node.js 24, pnpm 11.22.0 and Java 21 or newer. Install dependencies with `pnpm install --frozen-lockfile`, and Chromium with `pnpm exec playwright install chromium`. See the [README](README.md) for local development, the optional Firebase emulators, and the full verification commands. Functions use Node.js 22 and their own npm lockfile: `cd functions && npm ci && npm run build`.

Use the `demo-magic-table` emulators and controlled test fixtures. Do not use the maintainers' production Firebase project, publish services, or include secrets in a pull request. If you need a real Firebase project, create and configure your own.

Browser tests normally use port 5173 and may reuse an existing development server. Set `PLAYWRIGHT_PORT` to an unused port to use a separate server, for example `PLAYWRIGHT_PORT=5189 pnpm test:e2e --workers=1` on Unix shells or `$env:PLAYWRIGHT_PORT='5189'; pnpm test:e2e --workers=1` in PowerShell. Do not run the standard and Firebase browser suites concurrently: both use Playwright's default output directory.

Describe the problem, the change, and the checks you ran in the pull request. Add focused tests where behavior changes, keep the change scoped, and update relevant documentation. Maintainers review contributions; automated checks must pass before merge.

By submitting a contribution, you confirm that you have the right to submit it and agree to license your original contribution under the [PolyForm Noncommercial License 1.0.0](LICENSE). Identify any third-party content and its license, and do not submit artwork or other material without redistribution rights. Contributions are subject to the [Code of Conduct](CODE_OF_CONDUCT.md).
