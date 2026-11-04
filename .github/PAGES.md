# The hosted copy: what a maintainer does, once

`.github/workflows/pages.yml` tests, builds and publishes `dist/nextbook.html` to
`https://nextbook.ryankelln.com` on every push to `main`. Two steps are the repo owner's, and only
once. Until they are done the workflow still runs, but the published site is not at that address.

## 1. Pages source = GitHub Actions

Repo → **Settings** → **Pages** → **Build and deployment** → **Source: GitHub Actions**.

That is the whole setting. No branch, no folder: the workflow uploads the folder itself.

Then, once after the first successful run:

- Tick **Enforce HTTPS** (it appears only after GitHub has issued the certificate, which can take a
  few minutes after the DNS record is right).
- Open the site on a laptop and on a phone. A phone is the check that matters: the file is one page.

## 2. The DNS record

One record, at the DNS host for `ryankelln.com`:

| Type  | Host (name) | Value               | TTL  |
|-------|-------------|---------------------|------|
| CNAME | `nextbook`  | `rkelln.github.io.` | auto |

`nextbook` is the name only, not the whole domain: the DNS host appends `ryankelln.com`. The value is
the account's Pages host, because the repo is `RKelln/nextbook`, so GitHub serves it from
`rkelln.github.io`. Check the name the same way the neighbouring site is set up, which resolves to
GitHub today:

    dig +short searchdesk.ryankelln.com CNAME      # rkelln.github.io.

Do not add a second record for the same name (no A records beside the CNAME). If the DNS host
refuses a CNAME on the bare domain, that is fine: this is a subdomain, so a CNAME is the right type.

## What the workflow does on each push

    node --test tests/*.test.js
    node tools/check-mode.js --all
    python3 -m unittest discover -s tests -p 'test_*.py'
    python3 tools/build.py                 # dist/nextbook.html
    cp dist/nextbook.html _site/index.html; CNAME -> _site/CNAME

If any test fails, nothing is published: the deploy job needs the build job. `dist/` is gitignored,
so the checkout never carries an older file to publish, and `_site/` holds exactly `index.html` and
`CNAME`.

No step fetches the catalogue, holds a secret, or needs a private pack. The Python tests
skip the pack tests when `NEXTBOOK_PACK` is unset, and it is never set here.
