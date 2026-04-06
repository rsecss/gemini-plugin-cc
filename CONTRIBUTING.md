# Contributing to Gemini Plugin for Claude Code

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.18.0
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with plugin support

## Development Setup

```shell
git clone https://github.com/rsecss/gemini-plugin-cc.git
cd gemini-plugin-cc
npm install
npm test
```

## Project Structure

```
plugins/gemini/
├── commands/          # Slash command definitions (Markdown)
├── scripts/
│   ├── gemini-companion.mjs   # Main CLI entry point
│   └── lib/                   # Core modules (each < 400 lines)
└── prompts/           # Prompt templates
tests/                 # Unit tests (node:test)
```

## Code Style

- **ESM only** — `import`/`export`, no CommonJS
- **UTF-8 (no BOM)**, **LF line endings**
- Keep each `lib/` module under 400 lines, `gemini-companion.mjs` under 600 lines
- No external runtime dependencies — Node.js built-ins only
- Cross-platform: all file paths, process spawning, and signal handling must work on both Windows and Unix

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests in `tests/` if applicable
4. Run `npm test` and ensure all tests pass
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` new features
   - `fix:` bug fixes
   - `docs:` documentation changes
   - `refactor:` code restructuring
   - `test:` test additions or changes
   - `chore:` maintenance tasks
6. Open a Pull Request against `main`

## Testing

```shell
npm test              # Run all unit tests
```

Tests use Node.js built-in `node:test` runner. No external test framework needed.

## Pull Request Guidelines

- One logical change per PR — keep it focused
- Include a clear description of what and why
- Reference related issues if applicable
- CI must pass (Node.js 22, `npm test`)

## Security

- Never commit API keys, tokens, or credentials
- Never concatenate user input into shell commands
- State files must not store sensitive data

## Reporting Issues

Open an issue on [GitHub Issues](https://github.com/rsecss/gemini-plugin-cc/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- OS, Node.js version, Gemini CLI version

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
