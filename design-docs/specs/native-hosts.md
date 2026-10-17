# Shared engine and native hosts

Diagram semantics have one TypeScript implementation in `@nodetto/ir`,
`@nodetto/core` and `@nodetto/io`: validation, editing, layout, JSONL, SVG/HTML
export and PDF geometry. The desktop/Web UI executes it in its browser; the
native CLI executes the same code in Boa. Boa belongs to the CLI host.

| Layer | Owns |
| --- | --- |
| Shared TypeScript packages | Document semantics and export geometry/limits |
| `crates/native` | Atomic file writes, confined attachment reads, security-scoped bookmark mechanics |
| Desktop Rust adapter | Tauri commands, dialogs, document grants, container path and scope lifetime |
| CLI Rust adapter | Arguments/MCP, stdin, folder picker, its own container path and headless renderer |
| Browser export adapter | Canvas/Blob resources and cancellation |

Two native write entrypoints express different access grants. Directory access
uses a flushed sibling temporary file, preserves symlinks/modes and renames
atomically. A selected-file grant uses Foundation's replacement-file API on
macOS, since an individual document grant does not permit arbitrary siblings.
Other platforms use the directory writer for both entrypoints.

Bookmark encoding, restore, RAII scope release and private atomic persistence
are shared. Each app supplies its existing store path and retains the returned
scopes for its own lifetime. Picker behavior and sandbox identity remain at the
entrypoints. Bookmark bytes and the existing JSON store format are preserved.

Attachment validation and the 32 MiB read bound have one Rust implementation.
Portable TypeScript and Rust path guards use the same fixtures, including
control characters, Unicode whitespace, traversal and UTF-8 byte limits.

`render-profile.ts` owns CLI font candidates; `@nodetto/core` owns raster limits.
The existing engine build emits a typed-data JSON profile for Rust, so native
allocation guards and reference/browser export policies stay aligned.

Browser canvas and native resvg/PDF rendering remain host adapters. They consume
the same SVG and geometry without adding a native dependency to web exports.
The Bun CLI remains an independent regression reference for the shipped CLI.

`mise run test-cli` tests the native crate independently before CLI parity and
MCP checks against the release binary. Linux CI also runs all Rust workspace
tests, including desktop adapters. Independent crate tests catch dependencies
accidentally supplied by Cargo feature unification with a host.
