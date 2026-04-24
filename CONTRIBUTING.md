# Contributing to AgentScore

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork the repo and clone it locally
2. Install dependencies: `bun install`
3. Create a branch from `main`
4. Make your changes
5. Run linting and tests: `bun run lint && bun run typecheck && bun run test`
6. Open a pull request

## Pull Requests

- All PRs require 1 approval before merging
- Squash merge to `main` is the standard
- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Make sure CI passes before requesting review

## Reporting Issues

Open an issue on GitHub with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, runtime version)

## Code Style

- ESLint handles formatting and style. Run `bun run lint` before committing.
- Match the conventions in the existing code.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
