# Changelog

## 0.3.1

- Syntax-highlight C++20 module statements via an injected grammar:
  `import <header>;` / `import "header";`, `import std;`, and
  `export module …;` / `module;`. VS Code's built-in C++ grammar leaves these
  uncoloured (and clangd's semantic tokens don't cover the `import`/`module`
  keyword or an unresolved header unit), so the directive now reads as a keyword
  + include/module name.

## 0.3.0

- Enable semantic highlighting by default for C/C++/CUDA/Obj-C languages so the
  colors from `freight lsp` (clangd's semantic tokens — types, functions,
  variables, members, etc.) actually show, regardless of the theme's default.
  Needed when the Microsoft C/C++ extension is disabled, since nothing else
  provides that coloring.

## 0.2.0

- C/C++ document symbols, folding, references, document highlight, and semantic
  highlighting now flow through `freight lsp` (served by `clangd` by default).
- New experimental setting `freight.lsp.useClangBridge` (default off): route
  those C/C++ features to Freight's in-process clang bridge instead of clangd.
  Off while the bridge matures — `clangd` remains the reliable path.

## 0.1.0

- Initial release: `freight.toml` language support, `freight lsp` client, task
  provider, run/debug configurations, explorer panel, and status bar.
