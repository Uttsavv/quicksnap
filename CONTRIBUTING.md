# Contributing to Quicksnap

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and ideas

[Open an issue](https://github.com/Uttsavv/quicksnap/issues/new/choose) and pick
a template. For bugs, include your browser, OS and what you were recording
(screen, window or tab): most problems depend on them.

Security problems go through
[private reporting](https://github.com/Uttsavv/quicksnap/security/advisories/new),
not public issues.

## Running it locally

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # must pass before a PR
npm run build
```

The README's *How it works* and *Code map* sections explain the layout.
`docs/PLAN.md` has the product decisions and browser limits.

## Pull requests

- For anything bigger than a small fix, open an issue first so we can agree on
  the approach before you spend time on it.
- Keep each PR focused on one change.
- Test in Chrome, and in Firefox or Safari too if you touched recording or export.
- Make sure `npm run typecheck` passes.

By contributing, you agree that your work is released under the
[MIT License](LICENSE).
