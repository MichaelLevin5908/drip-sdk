# Contributing to drip-sdk

Thank you for your interest in contributing to the Drip SDK!

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/MichaelLevin5908/drip-sdk.git
cd drip-sdk
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the SDK:
```bash
pnpm build
```

4. Run tests:
```bash
pnpm test
```

## Project Structure

```
src/
├── index.ts           # Core Drip client
├── next.ts            # Next.js adapter entry
├── express.ts         # Express adapter entry
├── middleware.ts      # Combined middleware entry
└── middleware/
    ├── core.ts        # Framework-agnostic logic
    ├── next.ts        # Next.js implementation
    ├── express.ts     # Express implementation
    └── types.ts       # Shared types
```

## Making Changes

1. Create a new branch:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes and ensure:
   - All tests pass (`pnpm test`)
   - TypeScript compiles (`pnpm typecheck`)
   - Build succeeds (`pnpm build`)

3. Commit your changes with a descriptive message

4. Open a Pull Request

## Code Style

- Use TypeScript strict mode
- No `any` types - use `unknown` with type guards
- Export all public types
- Add JSDoc comments for public APIs
- Follow existing patterns in the codebase

## Testing

- Write tests for new features
- Test both success and error paths
- Tests use Vitest

## Questions?

Open an issue or reach out to the maintainers.
