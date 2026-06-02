# vscode-freight TODO

## Debug adapter

- [ ] **Stop-on-entry option** — expose `stopAtEntry` in launch config; when set, add
  `stopAtBeginningOfMainSubprogram: true` to the launch args forwarded to GDB/LLDB so
  VS Code can step from the very first instruction.

- [ ] **Program args passthrough** — `args` array in launch config should be appended to
  the `launch` arguments forwarded to GDB so the debuggee receives them.  Currently `args`
  is used for `freight run` but not plumbed into the DAP launch path.

- [ ] **Environment variables** — add an `env` map to the launch config
  (`"env": {"FOO": "bar"}`) and forward it to the native adapter.

- [ ] **Pre-launch task** — honour `preLaunchTask` so users can run a custom build step
  before `freight dap` starts (freight already builds internally, but some projects
  need extra steps like code generation).

- [ ] **Attach to process** — the `attach` request is wired in `freight dap` but the
  extension doesn't expose an attach configuration provider.  Add a `request: "attach"`
  config shape with `pid` and `processName` fields.

- [ ] **Multi-binary workspaces** — when a `freight.toml` has multiple `[[bin]]` targets,
  surface a quick-pick to choose which binary to debug if `bin` is not set in the launch
  config.

## Language server (freight lsp)

- [ ] **Completion for dep versions** — query the local registry msgpack cache to suggest
  known versions when the user types `libfoo = "`.

- [ ] **Inlay hints** — show latest available version alongside each dependency entry
  (`# latest: 1.4.2`).

- [ ] **Code action: update to latest** — "Update version constraint to ^1.4.2" code
  action on each dep, resolved from the registry cache.

- [ ] **Go-to-definition for path deps** — `path = "../libfoo"` should open that
  project's `freight.toml`.  Scaffolded but not yet wired to the LSP client.

- [ ] **Diagnostics for unknown keys** — warn on unrecognised `freight.toml` keys
  (e.g. typos in `[compiler]`).

## Explorer panel

- [ ] **Wire up the explorer view** — `FreightExplorerProvider` in `src/explorer.js` is
  implemented but commented out in `extension.js` (search for "deferred").  Uncomment,
  register the tree view, and test that package metadata, deps, and targets render.

- [ ] **Refresh on save** — watch `freight.toml` for changes and call
  `FreightExplorerProvider.refresh()` so the tree updates without a restart.

- [ ] **Run/debug from explorer** — add inline buttons on `[[bin]]` tree nodes to
  trigger `freight.run` / `freight.debug` for that specific target.

## Status bar

- [ ] **Show current profile** — display `dev` or `release` in the status bar item;
  clicking it should toggle and trigger a rebuild.

- [ ] **Last build result** — show ✓ / ✗ after each build; clicking should open the
  Problems panel.

- [ ] **Active debugger** — show which debugger (`gdb`/`lldb`) freight resolved so the
  user knows what's running.

## Packaging / distribution

- [ ] **Bundle with `vsce package`** — verify `bun run package` produces a clean `.vsix`
  with no missing activation events or broken paths.

- [ ] **Marketplace publish** — set up a CI step (`vsce publish`) triggered on version
  tags; bump `version` in `package.json` and add a `CHANGELOG.md` first.

- [ ] **Extension icon** — add a `icon.png` (128×128) to `package.json`'s `"icon"` field.
