# Rust

How to write good Rust.

- Proactively add readable whitespace within code. I don't want to read 10 lines of code smushed
  together.
- Proactively add logging & telemetry to your code when you write it, using the conventions of the
  project. Code you cannot diagnose in production is broken code.
- Avoid dynamic dispatch when at all possible, unless explicitly required by the user or the
  constraints of the project (e.g. building a library where calling a user-provided trait
  implementation is required). Default to using `enum_dispatch` to express polymorphism.
- Use `thiserror` within modules to clearly express the error boundaries of that module. Do not
  allow error types to leak everywhere. Use `anyhow` only at top-level boundaries.
- Proactively identify features that you can exclude from external crates to speed up compilation
  time.
- Write doc-comments with examples that run with `cargo test` for publicly exported traits, methods,
  and functions. Do not write non-doc-comments within code.
