# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository's Security tab, not as a public issue. Expect a reply within a week.

The things that matter most here:
- **Model API keys:** in the hosted version they live in the visitor's browser. Anything that could leak them, such as script injection or an over-broad CSP, is serious.
- **Notebook isolation:** one user must never read or change another user's notebook.
- **The page fetcher (`worker/fetch.js`):** it must not reach internal or non-public targets.
- **The local server:** it must not be drivable by other websites open in your browser.
