# Changelog

## 0.2.0

- C/C++ language features now served by Freight's built-in clang bridge (via
  `freight lsp`), no separate clangd required:
  - Document symbols (Outline view & "Go to Symbol in File").
  - Folding ranges, including multi-line comment blocks and statement bodies.
  - Find All References and document highlight (read/write aware).
  - Semantic highlighting (namespaces, types, functions, methods, properties,
    variables, parameters, enum members, macros — including type references and
    template-parameter uses).
- These complement the existing hover, go-to-definition, completion, signature
  help, inlay hints, and diagnostics.

## 0.1.0

- Initial release: `freight.toml` language support, `freight lsp` client, task
  provider, run/debug configurations, explorer panel, and status bar.
