# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Rules

- All UI text must be in **English** (labels, buttons, placeholders, tooltips)
- Timing accuracy is the top priority — preserve the lookahead scheduler architecture
- Consolidate shared logic rather than duplicating it across features
- **Planning sessions use Claude Opus; implementation (code writing) uses Claude Sonnet**
- Keep this file focused on rules and topic links only — detailed docs live in `docs/`
- Non-permanent artifacts (drafts, scratch files, generated output) go under `tmp/` — it is gitignored

## Docs

- [Architecture, audio engine, state variables, key functions](docs/claude/architecture.md)
- [BPM acceleration feature design spec](docs/superpowers/specs/2026-03-18-bpm-acceleration-design.md)
- [BPM acceleration implementation plan](docs/superpowers/plans/2026-03-18-bpm-acceleration.md)
