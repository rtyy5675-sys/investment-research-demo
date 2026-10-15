# UI source attribution

The following MIT-licensed component sources were adapted on 2026-10-15. They are local, editable UI components; the application retains its existing task, model, MCP, memory and persistence runtime.

## prompt-kit (primary chat UI)

- Project: https://github.com/ibelick/prompt-kit
- Commit: `5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a`
- Local source: `src/components/prompt-kit/`
- Copyright and full license: `src/components/prompt-kit/LICENCE.md`
- Adaptations: shared Radix/shadcn primitives, application Markdown, Chinese labels, IME-safe input, source drawer callbacks, no favicon requests, a scroll-to-bottom control. See `docs/research/promptkit-integration-notes.md`.

## assistant-ui (standalone RunActivity)

- Project: https://github.com/assistant-ui/assistant-ui
- Commit: `2bdd534a3d8da45e6c7a9ee6553862b83713059d`
- Local source: `src/components/assistant-ui/elements/`
- Copyright and full license: `src/components/assistant-ui/LICENSE`
- Adaptations: shared Collapsible, local theme, optional entry state metadata. No assistant-ui runtime or cloud integration. See `docs/research/assistant-ui-integration-notes.md`.

## shadcn/ui (shared primitives)

- Project: https://github.com/shadcn-ui/ui
- Source: `apps/v4/registry/new-york-v4/ui/` on upstream `main`, retrieved 2026-10-15.
- Local source: `src/components/ui/`
- Copyright and full license: `licenses/shadcn-ui-MIT.txt`
- Adaptations: local import paths and shared application theme. This source retrieval was not pinned to a commit; the checked-in local copies are the integration's source of truth.

Other installed dependencies, including Radix, Tailwind CSS, use-stick-to-bottom and liquid-gooey, retain their respective package licenses.
