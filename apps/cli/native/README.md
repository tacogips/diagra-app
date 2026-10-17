# Native CLI engine

The Rust CLI and MCP server embed the shared diagram JavaScript bundle in Boa
0.22, a Rust-written interpreter. QuickJS and its C FFI bindings are not used.
Bun is a build dependency that bundles TypeScript; it is not a runtime dependency.
Boa default features are disabled: the CLI supplies only the host APIs it uses.

Each invocation creates a fresh context. Context-owned Rust data holds stdin and
project-directory state. Safe native callbacks copy typed-array views, including
offsets, before filesystem or rendering operations. Promise jobs are drained
before returning a command result; rejection and unresolved promises return errors.
MCP stdin is always explicit tool input and never consumes transport stdin.

Execution limits are 512 recursive calls, Boa's default 10,240 operand-stack slots,
100 million iterations per loop, and 512 MiB per ArrayBuffer allocation. Crypto
requests are capped at 65,536 bytes. Attachment and render limits remain in the
filesystem and renderer modules. Unlike the previous QuickJS runtime, Boa does
not expose an aggregate heap quota; the per-buffer limit is not a total memory
limit. Documents should be treated as local application data, not arbitrary code.

`engine_tests.rs` contains host-boundary regression contracts. The first seven
were committed and passed on QuickJS before migration. The same assertions pass
on Boa; only the test evaluation adapter changed. Additional tests cover promise
jobs and execution limits. `apps/cli/src/native-parity.test.ts` compares commands
and exports against the shared TypeScript CLI and golden document fixtures;
`mcp-stdio.test.ts` exercises the real transport with an MCP client.
