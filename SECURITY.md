# Security

## Reporting a problem

Please do not report security problems in public issues. Use GitHub's private reporting instead: on the repository page, open the **Security** tab and choose **Report a vulnerability**. Describe what you found and how to reproduce it. You will get an answer as soon as possible.

## How the app protects itself

- Everything the page receives from outside (Google, saved settings) is checked before use and shown as text, never as HTML.
- A Content Security Policy only lets the page's own scripts run, plus Google's Street View script. The build fingerprints the page's scripts, so changed or injected scripts are refused. The page may only connect to Google's Maps service.
- The page refuses to run inside another site's frame.
- The country distributions from Vali are checked by `tools/vali.js` and built into the page; the page never contacts GitHub. The monthly update only proposes changes as a pull request for the owner to review.
- No libraries are loaded from CDNs at runtime; they are embedded by the build (Leaflet, country-coder), pinned to exact versions and covered by the script fingerprints.
- API keys are never committed. The site's Google key is added at publish time from a GitHub secret. It is visible in the published page, as for any browser app, so it must be restricted in the Google Cloud console to the site's address and to the Maps JavaScript API, with a daily quota.
- A visitor's own Google key is kept only for the browser tab, and never shown in error messages.
- An unfinished search (its settings, the locations found and each country's progress) is kept in the visitor's browser only, in IndexedDB, never with the key, and is checked when read back.
- The history of searches is kept in the visitor's browser only. It holds the search settings, never the key or the results, and is checked when read back.
