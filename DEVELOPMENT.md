# Development Guide

This guide covers development practices, architecture details, and contribution guidelines for FramerX.

## Table of Contents

- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Package Structure](#package-structure)
- [Adding New Features](#adding-new-features)
- [Debugging](#debugging)
- [Release Process](#release-process)

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 9.0.0
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/primasdevlabs/framerx.git
cd framerx

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Development Mode

```bash
# Start development mode with watch for all packages
pnpm dev

# Or develop a specific package
cd packages/compiler
pnpm dev
```

## Architecture

### High-Level Flow

```
Framer Project (.framer)
    ↓
Parser (@framer/compiler-parser)
    ↓
AST (@framer/compiler-ast)
    ↓
Compiler (@framer/compiler)
    ├─ Extractor (assets, components)
    ├─ Optimizer (tree shaking, dead code)
    └─ Validator (type checking, diagnostics)
    ↓
Generators (@framer/compiler-generators)
    ├─ React components
    ├─ Tailwind styles
    ├─ Motion animations
    └─ Asset bundles
    ↓
Formatter (@framer/compiler-formatter)
    ↓
Production React Application
```

### Package Dependencies

```
@framer/compiler-shared (base)
    ↓
@framer/compiler-ast
    ↓
@framer/compiler-parser ──→ @framer/compiler-zip
    ↓
@framer/compiler-formatter
@framer/compiler-generators
    ↓
@framer/compiler (orchestrator)
    ↓
@framer/plugin (Framer integration)
@framer/visual-regression (testing)
```

### Key Concepts

#### AST (Abstract Syntax Tree)

The AST represents the Framer project structure in a language-agnostic way. Key types:

- `Document`: Root node representing the entire project
- `Component`: Reusable UI components
- `Node`: Individual elements (frames, text, images)
- `Style`: Visual properties (colors, fonts, spacing)
- `Animation`: Motion and transitions
- `Interaction`: User interactions and events

#### Compilation Pipeline

1. **Parsing**: Convert Framer's JSON format to AST
2. **Extraction**: Separate assets, components, and styles
3. **Optimization**: Remove unused code, merge duplicates
4. **Validation**: Type checking and diagnostics
5. **Generation**: Emit target framework code
6. **Formatting**: Apply code style conventions

## Development Workflow

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the relevant package

3. Run tests and linting:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

4. Build the project:
   ```bash
   pnpm build
   ```

5. Test your changes:
   ```bash
   # Run demo if applicable
   pnpm demo
   ```

6. Commit with conventional commits:
   ```bash
   git commit -m "feat: add support for new animation type"
   ```

7. Push and create a pull request

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes
- `chore/` - Maintenance tasks

## Testing

### Unit Tests

Each package should have its own test suite:

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/compiler
pnpm test
```

### Visual Regression Tests

```bash
# Run visual regression suite
pnpm visual:regression
```

### Test Structure

```
packages/compiler/test/
├── unit/
│   ├── extractor.test.ts
│   └── optimizer.test.ts
├── integration/
│   └── full-compile.test.ts
└── __snapshots__/
    └── output.snap.ts
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { compile } from '@framer/compiler';

describe('Compiler', () => {
  it('should compile simple component', async () => {
    const result = await compile({
      source: testProject,
      options: {}
    });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain('export const Component');
  });
});
```

## Code Style

### ESLint

We use ESLint with TypeScript support:

```bash
# Check linting
pnpm lint

# Auto-fix (where possible)
pnpm lint --fix
```

### Prettier

Code formatting with Prettier:

```bash
# Check formatting
pnpm format:check

# Format code
npx prettier --write .
```

### TypeScript

Strict TypeScript configuration:

```bash
# Type check
pnpm typecheck
```

### Conventions

- Use **camelCase** for variables and functions
- Use **PascalCase** for classes, interfaces, and components
- Use **kebab-case** for file names (except React components)
- Use **UPPER_SNAKE_CASE** for constants
- Prefer **const** over **let**
- Use **arrow functions** for callbacks
- Add JSDoc comments for public APIs

## Package Structure

### Creating a New Package

1. Create the package directory:
   ```bash
   mkdir packages/new-package
   ```

2. Initialize package.json:
   ```json
   {
     "name": "@framer/compiler-new-package",
     "version": "0.1.0",
     "private": true,
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "scripts": {
       "build": "tsc -b",
       "dev": "tsc -b --watch",
       "typecheck": "tsc --noEmit",
       "lint": "eslint .",
       "format:check": "prettier --check . --ignore-path ../../.prettierignore",
       "clean": "rm -rf dist"
     }
   }
   ```

3. Create tsconfig.json:
   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "include": ["src"]
   }
   ```

4. Add to workspace dependencies in other packages as needed

### Package Responsibilities

- **`@framer/compiler-shared`**: Shared utilities, types, constants
- **`@framer/compiler-ast`**: AST node definitions and type guards
- **`@framer/compiler-parser`**: Framer format parsing
- **`@framer/compiler`**: Main compilation orchestration
- **`@framer/compiler-formatter`**: Code formatting utilities
- **`@framer/compiler-generators`**: Target code generation
- **`@framer/compiler-zip`**: ZIP archive handling
- **`@framer/plugin`**: Framer plugin integration
- **`@framer/visual-regression`**: Visual testing tools

## Adding New Features

### Adding a New Generator

1. Create generator in `packages/generators/src/`:
   ```typescript
   // packages/generators/src/new-generator/index.ts
   export function generateNewFeature(node: Node): string {
     // Implementation
   }
   ```

2. Export from main index:
   ```typescript
   // packages/generators/src/index.ts
   export * from './new-generator';
   ```

3. Add tests in `packages/generators/test/`

4. Update compiler to use the generator

### Adding a New AST Node

1. Define node type in `packages/ast/src/`:
   ```typescript
   export interface NewNode extends BaseNode {
     type: 'new-node';
     property: string;
   }
   ```

2. Add type guard:
   ```typescript
   export function isNewNode(node: Node): node is NewNode {
     return node.type === 'new-node';
   }
   ```

3. Update parser to recognize the node
4. Update generators to handle the node

### Adding Diagnostic Messages

1. Add to `packages/compiler/src/diagnostics.ts`:
   ```typescript
   export const DiagnosticMessages = {
     // ... existing messages
     NEW_ERROR: {
       code: 'FRX001',
       message: 'New error message',
       severity: 'error'
     }
   } as const;
   ```

2. Use in validation:
   ```typescript
   diagnostics.push({
     ...DiagnosticMessages.NEW_ERROR,
     location: node.location
   });
   ```

## Debugging

### VS Code Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.1.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Demo",
      "program": "${workspaceFolder}/node_modules/.bin/tsx",
      "args": [
        "packages/compiler/scripts/compile-demo.ts"
      ],
      "cwd": "${workspaceFolder}",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### Logging

Add debug logging:

```typescript
import { log } from '@framer/compiler-shared';

log.debug('Processing node', { id: node.id });
log.info('Compilation started');
log.warn('Deprecated feature used');
log.error('Compilation failed', { error });
```

### Common Issues

**Build fails with type errors:**
- Run `pnpm clean` then `pnpm build`
- Check TypeScript version consistency

**Tests fail after changes:**
- Update snapshots: `pnpm test -u`
- Check test isolation (no shared state)

**Package not found:**
- Run `pnpm install` to link workspace packages
- Check package.json workspace dependencies

## Release Process

### Versioning

We follow semantic versioning (SemVer):

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes

### Release Checklist

1. Update version numbers in package.json files
2. Update CHANGELOG.md
3. Run full test suite: `pnpm test`
4. Build all packages: `pnpm build`
5. Commit changes: `git commit -m "chore: release v0.2.0"`
6. Tag release: `git tag v0.2.0`
7. Push: `git push && git push --tags`
8. Create GitHub release

## Contributing

### Pull Request Guidelines

- Keep PRs focused and small
- Add tests for new features
- Update documentation
- Ensure all CI checks pass
- Add description of changes

### Code Review

- Be constructive and respectful
- Focus on the code, not the person
- Suggest improvements, don't just point out problems
- Ask questions to understand intent

## Resources

- [Framer API Documentation](https://www.framer.com/api/)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Turborepo Documentation](https://turbo.build/repo/docs)

## Support

For questions or issues:
- Open a GitHub issue
- Check existing issues and discussions
- Review documentation first

Thank you for contributing to FramerX!
