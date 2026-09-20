# Coding standard

## Language

- Use TypeScript for application code, tests, scripts and tool configuration wherever
  the runtime or tool supports it.
- Use JavaScript only when TypeScript is not supported or a generator requires
  JavaScript output, such as Paraglide's generated files. Document tooling exceptions
  in the owning project's README, and do not manually convert generated output.

## Code organization

- Application behavior lives under `{apps,packages,services}/*/src/contexts/<bounded-context>/<concept>`.
  Add concept folders such as `models`, `services`, `use-cases`, `guards`, `types`, `utils`, `components`,
  `hooks`, etc as needed.
- Keep bounded contexts inside projects. Do not create a package for each bounded context.
  Use the names and ownership defined in the [context map](docs/context/map.md).
- Use the lexical contained in the files inside `docs/context/<bounded-context>.md`.
- Every application has a `src/contexts/shared/` folder for elements used by several
  bounded contexts, organized by concept. For example, reusable UI primitives belong
  in `shared/components`, helpers in `shared/lib`, and shared API models, clients and
  handlers in the corresponding `models` or `services` folders. This is a technical
  sharing folder, not an additional business bounded context.
- We use ports and adapters architecture. Use cases depend on ports, and adapters implement those ports.
- Define ports as interfaces or Effect service definitions, such as `UserRepository`
  or `EmailService`.
- Name adapters by their implementation, such as `InMemoryUserRepository`,
  `SQLiteUserRepository` or `CloudflareEmailService`.
- Use `Repository` for data access and `Service` for other capabilities.
- Group files for a specific service under `services/<service-name>/`. Keep its
  port, production adapters and service-specific support files together; for
  example, `services/roundtrip/` contains the round-trip service and HTTP adapter.
  Test-only adapters and fixtures belong under `tests/`, not `src/`.
- Keep `routes`, `i18n` and `styles` outside `contexts`.
- Import symbols through their deep paths. Do not create barrel files.
- Define internal aliases with `package.json` subpath imports (`#...`) in the owning
  project. Keep relative imports for neighboring files; use workspace package names
  and their deep exports across projects. Do not duplicate these mappings in
  TypeScript `paths` or Vite aliases.

## Frontend components

- For Solid components that wrap an HTML element, derive props from that element's
  `ComponentProps`, for example `ComponentProps<"section">`, instead of using only
  `ParentProps` or a custom props object. Intersect with component-specific props
  when needed.
- Use `splitProps` to separate `class`, explicitly rendered `children`, and
  component-specific props from the remaining native attributes. Keep access through
  the returned objects reactive; do not destructure Solid props into plain values.
- Merge default styles with caller styles using `cn("default classes", local.class)`
  from `@delimoov/design-system/lib/utils`, placing caller classes last. If there
  are no default classes, use `cn(local.class)`.
- Spread the remaining props onto the root element so callers can supply IDs,
  attributes, event handlers and refs. Put the spread after default attributes
  when callers should be able to override them. Never forward component-specific
  props such as `run`, `retry` or `busy` to the DOM.
- Preserve children as a caller-controlled slot. For components with default
  content, use `local.children ?? defaultContent` when callers should be able to
  replace it; wrappers render `local.children` in their content slot.

## Frontend dependencies and API access

- Keep application-context factories, types and providers in
  `src/contexts/shared/context/`, alongside `hooks/`, `components/`, `queries/`
  and `mutations/`.

- Each frontend owns an Effect `ManagedRuntime` that assembles its service layers
  at application startup. Run API effects through that runtime.
- Build effects passed to `ManagedRuntime.runPromise` with `Effect.gen(function* ()
  { ... })`, resolving services and calling their operations with `yield*`, as in
  the old admin app.
- Web apps expose the runtime, query client and other application dependencies
  through typed TanStack Router context. Create a fresh query client per router.
  Console uses an imported, shared `consoleRuntime` for its SPA application
  lifetime, following the old admin app. SSR applications keep runtimes scoped
  per router/request.
- Companion exposes its dependencies through a root React context alongside Expo
  Router. Keep the context stable across renders.
- Dispose managed runtimes when their owning scope ends. A shared SPA runtime
  outlives router instances and is disposed on module replacement during HMR.
- Use TanStack Query for API reads and mutations. Define reusable query and
  mutation factories in the owning context. In Console, query options import
  `consoleRuntime` and use TanStack Query's supplied cancellation signal; they
  remain callable from both loaders and components. Mutation factories obtain
  the query client through `useQueryClient`, import the runtime, and return
  `useMutation` directly. Let mutations finish independently of component
  unmounting; do not add per-component abort controllers by default. Runtime
  disposal interrupts its running effects. Call those factories once during
  component setup, without passing context or abort signals.
- For page data, preload with `context.queryClient.query(...)` in the route
  `loader`, using the same query options as the consuming component. Use a
  loader-only `staleTime: "static"` override when cached data should be returned
  immediately and the component should handle revalidation. Keep that override
  out of shared options for queries that need polling or invalidation.
  Loaders call query-client methods; query hooks belong in components.
- Wrap query-consuming components in Solid `Suspense` with a loading fallback.
  Handle failures with an error boundary and `throwOnError: true` for those
  queries, or explicit error UI. Suspense handles loading; it does not guarantee
  data for disabled queries or failed requests.
- Keep user-triggered writes in mutations. A route loader must not create or
  retry a write merely because the user visits or preloads a page.
- Select real or in-memory service layers at the application composition boundary.
  UI hooks consume the configured services rather than constructing adapters.

## Testing strategy

### In-memory services and repositories

- Keep in-memory adapters and fixtures in the owning project's
  `tests/support/<bounded-context>/services/<service-name>/`, grouped by service.
  Use a project-local `#test-support/*` subpath import when needed. Browser-test
  composition may load these behind a test-mode guard; production builds must
  exclude them.

- Implement in-memory adapters as simple, configurable test doubles with
  deterministic default return values.
- Expose those values directly so each test can set its required results or
  failures during context setup. Adapter methods return the configured values;
  tests do not need to call write methods to seed a simulated store.
- Do not replicate the real adapter's storage with maps, indexed collections,
  CRUD behavior or persistence rules. Storage behavior belongs in integration
  tests of the real adapter.

### Backend unit tests

- Exercise use cases and domain invariants through in-memory adapters.
- Do not use real infrastructure adapters in unit tests.
- Mirror source context paths under `tests/unit/<bounded-context>`.

### Backend integration tests

- Exercise real adapter implementations, not in-memory substitutes.
- Use local Cloudflare emulation where applicable. For example, notification
  integration tests exercise the real email adapter against the local binding;
  ordinary local email rendering does not send through the provider.
- Mirror source context paths under `tests/integration/<bounded-context>`.

### Backend test tooling

- Use `@effect/vitest` for Effect-based unit and integration tests.
- Keep unit and integration tests in separate Vitest projects and Moon tasks.

### Frontend tests

- We use `agent-browser` to test the UI during development.
- We use Playwright to write UI test for critical user flows.
- We use in-memory adapters when testing UI through playwright.

### End-to-end tests
- Playwright execute critical user flows and we use real api with real cloudflare
  adapters to test the whole system.

## Workspace tooling

- Use Bun workspaces and Moon for project tasks. Run repository-wide TypeScript,
  Biome, Knip and Cocogitto checks directly
- Package scripts are limited to the required root prepare hook.
- Use Conventional Commits for commit messages and PR titles.
- Before adding project configuration or running repository checks, read
  [the contributor instructions](README.md) for commands and test-task conventions.
