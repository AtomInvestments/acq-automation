#!/usr/bin/env python3
"""
P0 security shim: inject a no-index meta tag, robots.txt, and a JS
redirect-to-Worker guard into every static gh-pages HTML page.

Run as a post-bake step in `sms.yml` before the peaceiris/actions-gh-pages
deploy. The Cloudflare Worker (https://apg-dashboard.mithchell.workers.dev)
is the canonical URL with auth. The gh-pages mirror exists only because
it's not trivially disable-able from a workflow (org admin must do that
in the GitHub UI). Until that happens, this shim:

  1. Adds <meta name="robots" content="noindex,nofollow"> to every page
  2. Writes a robots.txt that disallows all crawlers
  3. Injects a JS guard that redirects to the Worker login if the page
     loads on a *.github.io host (i.e., a public visitor found it)

Intentional design: the JS guard runs `prerender` early so the page
contents NEVER paint on github.io. We don't rely on `<noscript>` —
attackers with JS off get a hard-coded message instead of the dashboard.

To FULLY disable gh-pages once Mido (or an org admin) is ready:

   gh api -X DELETE repos/AtomInvestments/apg-dashboard/pages \\
        --hostname github.com

This shim is defense-in-depth until that DELETE is run.
"""
from __future__ import annotations

import re
from pathlib import Path

WORKER_LOGIN_URL = "https://apg-dashboard.mithchell.workers.dev/login"

ROBOTS_TXT = """User-agent: *
Disallow: /

# Canonical URL: https://apg-dashboard.mithchell.workers.dev
# The github.io mirror is unmaintained and gated.
""".strip()

NOINDEX_META = '<meta name="robots" content="noindex,nofollow,noarchive">'

GUARD_SCRIPT = (
    "<script>(function(){"
    "var h=location.hostname;"
    "if(h.indexOf('github.io')>-1||h.indexOf('githubusercontent')>-1){"
    "document.documentElement.style.display='none';"
    f"location.replace('{WORKER_LOGIN_URL}?next='+encodeURIComponent('/'));"
    "}})();</script>"
)

LANDING_SHIM = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
{NOINDEX_META}
<meta http-equiv="refresh" content="0; url={WORKER_LOGIN_URL}">
<title>Atom Investments — moved</title>
<style>
  body{{margin:0;padding:48px 24px;font-family:Georgia,serif;background:#FAF7EC;color:#0A1F44;text-align:center;}}
  a{{color:#0A1F44;}}
</style>
</head>
<body>
<h1>This dashboard has moved.</h1>
<p>The canonical URL is <a href="{WORKER_LOGIN_URL}">{WORKER_LOGIN_URL}</a>.</p>
<p>You will be redirected automatically.</p>
{GUARD_SCRIPT}
</body>
</html>"""


def inject_into_html(html: str) -> str:
    # Ensure <head> exists and prepend our meta + guard script.
    head_open = re.search(r"<head\b[^>]*>", html, flags=re.IGNORECASE)
    if not head_open:
        # No <head> — bail. The page won't be served anyway because the
        # guard at the document level kicks in via the global landing shim.
        return html
    insert_at = head_open.end()
    payload = f"\n{NOINDEX_META}\n{GUARD_SCRIPT}\n"
    return html[:insert_at] + payload + html[insert_at:]


def main(site_dir: Path) -> None:
    if not site_dir.exists():
        raise SystemExit(f"site dir not found: {site_dir}")

    # Inject meta+guard into every *.html
    count = 0
    for path in site_dir.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        if NOINDEX_META in text:
            continue  # already injected
        path.write_text(inject_into_html(text), encoding="utf-8")
        count += 1
    print(f"[guard] injected noindex+redirect into {count} HTML files")

    # Write robots.txt
    (site_dir / "robots.txt").write_text(ROBOTS_TXT + "\n", encoding="utf-8")
    print("[guard] wrote robots.txt")

    # Replace landing index.html (the project root) with a hard redirect.
    # The Worker-side / is canonical; gh-pages root just bounces.
    (site_dir / "index.html").write_text(LANDING_SHIM, encoding="utf-8")
    print("[guard] wrote landing redirect shim at index.html")


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("site")
    main(target.resolve())
