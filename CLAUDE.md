# Working on this repository

Notes for Claude. The rules for everyone who changes the code are in `CONTRIBUTING.md`: how to make a change, the checks, "Code for people" and the things that must not break. How the code fits together is in `docs/how-the-code-works.md`. Read both before changing code. This file only adds what is specific to working as Claude for the owner.

## Pull requests

- **Check earlier pull requests first.** Before starting work for a new pull request, and before pushing to an existing branch, look at the state of every earlier pull request.
  - If one has been merged, start a new branch from the latest `main`. Never push to a branch whose pull request is already merged.
  - If one is still open, ask the owner whether to add to it or open a separate pull request.
- **The owner approves and merges.** Open pull requests; never merge them.
- **Plan first when asked.** When the owner asks to plan or discuss a change, agree on it before building.
- **No new tools without asking the owner.**
- Describe in each pull request what changed and how it was tested. For visual changes, include before/after screenshots.

## Before every pull request

```sh
npm run format && npm run lint && npm run build && npm test
```

Lint must be clean and all test files must pass. Add a test file or cases in `tests/` for new behaviour; how to write one is in `docs/how-the-code-works.md` under "Tests".

## Code shared with Lookout

Much of this app is copied from Lookout, [ugerhard-git/osm-tool](https://github.com/ugerhard-git/osm-tool). The two repositories keep separate copies on purpose; there is no shared package.

- When a feature needs something Lookout already has (Overpass queries, the official-coverage check, street names, shareable links, history), copy that part over and adapt it, rather than writing it again. Lookout's `src/app.js` and its `docs/how-the-code-works.md` say where each part is.
- Copy only what the feature needs, not ahead of time.
- When fixing a bug in copied code, check whether Lookout has the same bug and tell the owner, so it can be fixed there too.

## Never break (details in CONTRIBUTING.md)

- Saved settings (`mapgen.…`): keep the names; clear the saved value of a removed option; move an old shape over on load (one `country` → `countries`).
- `src/data/vali.json` is made by `tools/vali.js`; never edit it by hand. The monthly workflow (`.github/workflows/vali.yml`) updates it through a pull request.
- Once shared links exist, links people have already sent keep opening.
- The security policy: no inline event handlers, no new outside scripts, never loosened.
- Keys: never in the repository, links or error messages.
