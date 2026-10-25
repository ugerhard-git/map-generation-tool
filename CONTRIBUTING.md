# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a problem

Open an issue and include:

- what you did,
- what you expected and what happened,
- the error text, if there was one,
- your browser.

Please don't post API keys in issues.

## Making a change

For a bigger change or a new feature, open an issue first so we can agree on the approach before you build it. Small fixes can go straight to a pull request.

1. Fork the repository and create a branch.
2. `npm install`, then `npm run build` and `npm test`. See the README.
3. Make your change in `src/`. Never edit `dist/` or `src/data/vali.json`; they are generated (`tools/vali.js` makes the Vali data). [How the code works](docs/how-the-code-works.md) explains where things are.
4. Add or update a test in `tests/` for what you changed. The tests simulate Google and the map tiles, so they run offline.
5. Run the checks:

   ```sh
   npm run format      # Prettier
   npm run lint        # ESLint; must be clean
   npm run build
   npm test            # browser tests; all files must pass
   ```

6. Open a pull request that says what changed, why, and how you tested it. For visual changes, include before and after screenshots.

The formatting check, the linter and the tests run automatically on every pull request. In VS Code, install the recommended extensions when asked: files are then formatted when you save, and likely mistakes are underlined as you type.

## Code for people

The code is read by the owner and by developers who don't know the project. Write it so they can follow it without help.

- **Clear before clever.** Choose the plain version over the shortest or fastest one, unless the speed matters and a comment says why.
- **Every file explains itself.** Start with a short comment on what the file does. In `src/app.js`, the overview at the top covers how the app works, the shared state and what is saved in the browser.
- **Comments say why, not what.** Explain decisions, limits and edge cases; the code already shows what it does.
- **Keep to the sections.** `app.js` is one file, split into sections with the same names as in `page.html` and `style.css`. Put new code in the section it belongs to. Functions that only compute (such as `cleanPano`, `distance`, `exportJson`) don't touch the page, so they can be tested on their own.
- **Names a reader understands:** whole words, matching the interface where possible, no private abbreviations.
- **Type notes (JSDoc)** on shared data shapes and central functions, so editors can help.
- **Follow the existing patterns.** Reuse the helpers (`$`, `store`, `esc`, `cleanText`) before writing new ones.
- **Code shared with Lookout.** Much of the code is copied from [Lookout (osm-tool)](https://github.com/ugerhard-git/osm-tool). Before writing something Lookout already has, copy its version over. Copy only what a feature needs.
- **No new tools without a reason.** Every dependency or build step is one more thing to learn; propose it in an issue first.
- **Keep the documentation true.** When the code changes, update its comments, the overview in `app.js`, [How the code works](docs/how-the-code-works.md) and `README.md` in the same pull request.

## A simple interface

The tool should feel easy on first sight, also as settings are added. Every change that adds or moves a setting follows these rules (agreed with the owner, October 2026):

- **Every setting has a good default.** A visitor who changes nothing gets a sensible search.
- **The first screen shows only what most visitors need:** where, the main criteria, how many, and "Find locations". Any other setting goes into a closed "More options" section for its topic.
- **Nothing changed stays hidden.** A closed section shows a one-line summary of what is set, marks what differs from the default, and offers "Reset to defaults".
- **Little text on the page.** At most a short hint under a setting. A longer explanation goes into a help dialog, opened by a small "?" button next to the setting.
- **Related choices that exclude each other are one choice**, not tick boxes that can contradict each other (such as "Arrows: any, end of coverage, intersection"). A setting that does not apply is greyed out, not hidden.
- **Every setting is part of the shared description of the settings,** so the history, the unfinished search and the settings file all keep it.
- **Keyboard and screen readers** must work for every control, including drawings such as the camera direction.

## Things that must not break

- **Saved settings.** The names saved in the browser (`mapgen.…`, listed at the top of `src/app.js`) stay as they are, so visitors keep their choices. When an option is removed, clear its saved value when the page loads. When a saved setting changes shape, move the old one over on load.
- **Shared links.** Once the app has shareable links, links people have already sent must keep opening, including links with parameters that no longer exist (they are ignored). Everything read from a link is checked before use.
- **The security policy.** Only the page's own scripts may run. The build fingerprints them, so inline event handlers (`onclick="…"`) and new outside scripts will not run; wire events up in `app.js`. Do not loosen the policy to make a change work. A feature that needs a new service adds just that host to `connect-src` in `src/build.js`. `tests/security.js` checks the policy, and [SECURITY.md](SECURITY.md) lists the protections.
- **Untrusted input.** Treat everything from outside (Google, uploaded files, shared links, saved settings) as untrusted: check it, and put it on the page as text, never as HTML.
- **Keys.** Never put keys in the repository, in shared links or in error messages. The site key comes from the `GOOGLE_API_KEY` environment variable at build time.

## Also keep in mind

- **One self-contained page.** No runtime CDNs or trackers. Libraries are installed with npm and embedded by the build.
- **Interface text for non-technical users:** plain words, sentence case, no jargon; say what happened and what to do next.
- **Be kind to free services** such as the OpenStreetMap servers. Don't add features that multiply requests to them.
