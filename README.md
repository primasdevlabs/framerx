# FramerX

<div align="center">

**Framer-to-Code Compiler**

Convert Framer projects into production-ready React applications with one click.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Package Manager](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-red)](https://pnpm.io/)

</div>

## Overview

FramerX is a powerful compiler that transforms Framer design projects into clean, production-ready React code. It bridges the gap between design and development, enabling designers and developers to collaborate seamlessly.

### Key Features

- **One-Click Export**: Export entire Framer projects as React applications directly from the Framer interface
- **Clean Code Generation**: Generates well-structured, maintainable React components
- **Asset Management**: Automatically extracts and optimizes images, fonts, and other assets
- **Responsive Design**: Preserves responsive layouts and breakpoints
- **Animation Support**: Converts Framer animations to production-ready motion code
- **Tailwind CSS Integration**: Generates Tailwind utility classes for styling
- **Type Safety**: Full TypeScript support with generated type definitions
- **Visual Regression Testing**: Built-in tools to ensure visual fidelity

## Architecture

FramerX is organized as a monorepo using pnpm workspaces with Turborepo for efficient builds.

### Core Packages

- **`@framer/compiler-ast`**: Abstract Syntax Tree definitions for Framer projects
- **`@framer/compiler-parser`**: Parses Framer project files into AST
- **`@framer/compiler`**: Main compiler orchestrating the transformation pipeline
- **`@framer/compiler-formatter`**: Code formatting and pretty-printing
- **`@framer/compiler-generators`**: Code generators for React, Tailwind, assets, and more
- **`@framer/compiler-shared`**: Shared utilities and types
- **`@framer/compiler-zip`**: ZIP file handling for project exports
- **`@framer/plugin`**: Framer plugin for in-app export functionality
- **`@framer/visual-regression`**: Visual regression testing tools

## Installation

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 9.0.0

### Setup

```bash
# Clone the repository
git clone https://github.com/primasdevlabs/framerx.git
cd framerx

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Usage

### As a Compiler

```typescript
import { compile } from '@framer/compiler';

const result = await compile({
  source: './path/to/framer-project',
  output: './output-directory',
  options: {
    framework: 'react',
    styling: 'tailwind',
    optimize: true
  }
});
```

### As a Framer Plugin

1. Build the plugin: `pnpm build`
2. Load the plugin in Framer (plugin installation instructions coming soon)
3. Click "Export to React" in the Framer interface
4. Download the generated React application

### CLI Demo

```bash
# Run the demo compilation
pnpm demo
```

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed development guidelines, architecture documentation, and contribution guidelines.

### Available Scripts

- `pnpm build` - Build all packages
- `pnpm dev` - Start development mode with watch
- `pnpm lint` - Run ESLint across all packages
- `pnpm format:check` - Check code formatting with Prettier
- `pnpm typecheck` - Run TypeScript type checking
- `pnpm test` - Run tests across all packages
- `pnpm clean` - Clean build artifacts
- `pnpm demo` - Run demo compilation
- `pnpm visual:regression` - Run visual regression tests

## Roadmap

- [ ] VS Code extension for local compilation
- [ ] Support for additional frameworks (Vue, Svelte)
- [ ] Custom code generation templates
- [ ] Advanced optimization options
- [ ] CI/CD integration
- [ ] Component library extraction

## Contributing

We welcome contributions! Please see [DEVELOPMENT.md](./DEVELOPMENT.md) for guidelines.

## License

MIT © [PrimasDevLabs](https://github.com/primasdevlabs)

## Credits

**FramerX** is developed and maintained by [PrimasDevLabs](https://github.com/primasdevlabs).

This project builds upon the excellent work of the Framer team and the open-source community.

## Acknowledgments

- [Framer](https://www.framer.com) - The design platform that inspired this project
- [React](https://react.dev) - The UI library
- [Turborepo](https://turbo.build) - Build system for monorepos
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS framework
