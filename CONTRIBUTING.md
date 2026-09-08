# Contributing to FramerX

Thank you for your interest in contributing to FramerX! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Guidelines](#development-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md) in all interactions with the project.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 9.0.0
- Git

### Setup

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/framerx.git
cd framerx

# Install dependencies
pnpm install

# Build the project
pnpm build
```

For detailed development instructions, see [DEVELOPMENT.md](./DEVELOPMENT.md).

## How to Contribute

### Ways to Contribute

- **Report bugs**: Open an issue with detailed reproduction steps
- **Suggest features**: Open an issue with your proposal
- **Submit pull requests**: Fix bugs, add features, improve documentation
- **Improve documentation**: Fix typos, add examples, clarify concepts
- **Review pull requests**: Help review and test contributions
- **Answer questions**: Help others in issues and discussions

### What to Work On

Check the [Issues](https://github.com/primasdevlabs/framerx/issues) page for:
- Bugs labeled `bug` or `good first issue`
- Features labeled `enhancement` or `help wanted`
- Documentation tasks labeled `documentation`

## Development Guidelines

### Branch Strategy

- Create a new branch from `main` for each contribution
- Use descriptive branch names: `feature/your-feature`, `fix/your-fix`
- Keep branches focused on a single issue or feature

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for Vue framework
fix: resolve memory leak in parser
docs: update installation instructions
test: add unit tests for AST validator
chore: upgrade TypeScript to v5.5
```

### Code Quality

- Run tests: `pnpm test`
- Run linting: `pnpm lint`
- Type check: `pnpm typecheck`
- Format code: `npx prettier --write .`

### Testing

- Add tests for new features and bug fixes
- Ensure all tests pass before submitting
- Update snapshots if needed: `pnpm test -u`

## Pull Request Process

### Before Submitting

1. Update documentation if needed
2. Add or update tests
3. Ensure all CI checks pass
4. Update CHANGELOG.md (for significant changes)

### Submitting a PR

1. Push your branch to your fork
2. Open a pull request against `main`
3. Fill in the PR template
4. Link related issues
5. Request review from maintainers

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #123

## Testing
Describe testing performed

## Checklist
- [ ] Tests pass
- [ ] Linting passes
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
```

### Review Process

- Maintainers will review your PR
- Address feedback in a timely manner
- Keep discussions focused and constructive
- Be patient - review times may vary

## Reporting Bugs

### Bug Report Template

```markdown
## Description
Clear description of the bug

## Reproduction Steps
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: [e.g., Windows 11, macOS 14]
- Node version: [e.g., 18.17.0]
- FramerX version: [e.g., 0.1.0]

## Additional Context
Logs, screenshots, or other relevant info
```

## Suggesting Features

### Feature Request Template

```markdown
## Description
Clear description of the feature

## Problem Statement
What problem does this solve?

## Proposed Solution
How should it work?

## Alternatives
What alternatives have you considered?

## Additional Context
Examples, mockups, or references
```

## Recognition

Contributors are recognized in:
- [CONTRIBUTORS.md](./CONTRIBUTORS.md) - List of all contributors
- Release notes - Notable contributions
- Project README - Key contributors

## Questions?

- Open an issue for questions
- Join our [Discussions](https://github.com/primasdevlabs/framerx/discussions)
- Check [DEVELOPMENT.md](./DEVELOPMENT.md) for technical details

Thank you for contributing to FramerX! 🎉
