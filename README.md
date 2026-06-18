# Sentinel — Code

This folder is the **git repository root** for the Sentinel application code.
All git operations (commit, push) happen **from here**.

> ⚠️ **Sensitive documents live in `../documents/` — OUTSIDE this repo, by design.**
> The technical design, business plan, and any commercial/strategy material are
> deliberately kept out of the code folder so they can never be staged or pushed
> to a remote. Do not `git add` anything from `../documents/`.

## Status
Empty for now — the Next.js app gets scaffolded here when Phase 0 / extraction
begins (see `../documents/technical-design/SENTINEL_TECHNICAL_DESIGN.md`, §15).

When scaffolded, this becomes `ghcr.io/.../sentinel:latest`, deployed to
`ops.bentech.dev`.
