"""
Inject the Adam intro video section into the APG homepage (page id 1213).

Placement: between the HERO and the "HOW IT WORKS" section.
Style: full-bleed gold-100 band, max-w-5xl video card, paper-coloured
chrome — alternates the section background per `feedback_wp_design.md`
(hero=ink, NEW=gold-100, how=paper).

Read-before-write: fetches the live content, validates we haven't already
injected the section (idempotent on the marker `id="apg-intro-video"`),
patches in memory, PUTs back.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request

PAGE_ID = 1213
AUTH_HEADER = "Basic dXhhbXgxMTp2ZWFSIFdvdWIgWVZvTyBERHM3IHFFc1kgVUpNcg=="
ENDPOINT = f"https://atompropertygroup.com/wp-json/wp/v2/pages/{PAGE_ID}"

VIDEO_URL = "https://atompropertygroup.com/wp-content/uploads/2026/06/apg-1-web-1080p.mp4"
POSTER_URL = "https://atompropertygroup.com/wp-content/uploads/2026/06/apg-1-hero.jpg"

INSERT_MARKER = "<!-- ============================================================ -->\n<!-- HOW IT WORKS"

VIDEO_SECTION = """
<!-- ============================================================ -->
<!-- INTRO VIDEO — gold band, full-bleed                          -->
<!-- ============================================================ -->
<section id="apg-intro-video" class="bg-gold-100 py-20 lg:py-28 border-y border-gold/30">
  <div class="max-w-5xl mx-auto px-6 lg:px-10">
    <div class="text-center mb-10 lg:mb-12">
      <div class="text-xs font-bold text-gold-700 uppercase tracking-widest mb-3">Meet APG</div>
      <h2 class="font-display text-4xl lg:text-5xl font-bold text-ink mb-4">Watch how we buy houses <span class="italic text-gold-700">in 14 days.</span></h2>
      <p class="text-lg text-ash max-w-2xl mx-auto">A 56-second walkthrough of who we are and exactly what happens after you call.</p>
    </div>

    <div class="relative rounded-2xl overflow-hidden shadow-2xl shadow-ink/20 border border-gold/40 bg-ink">
      <video
        class="w-full h-auto block"
        controls
        playsinline
        preload="metadata"
        poster="POSTER_URL_HERE">
        <source src="VIDEO_URL_HERE" type="video/mp4">
        Your browser does not support HTML5 video. <a href="VIDEO_URL_HERE" class="text-gold underline">Download the video</a>.
      </video>
    </div>

    <div class="text-center mt-8">
      <a href="#hero-form" class="inline-flex items-center gap-2 bg-ink text-paper px-6 py-3 rounded-md font-semibold hover:bg-ink-900 transition-colors">
        Get my cash offer
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
      </a>
    </div>
  </div>
</section>

"""

VIDEO_SECTION = (
    VIDEO_SECTION
    .replace("VIDEO_URL_HERE", VIDEO_URL)
    .replace("POSTER_URL_HERE", POSTER_URL)
)


def http_json(url: str, method: str = "GET", body: dict | None = None) -> dict:
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", AUTH_HEADER)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode("utf-8")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    page = http_json(f"{ENDPOINT}?context=edit")
    content = page["content"]["raw"]
    print(f"Fetched page id={page['id']} slug={page['slug']} title={page['title']['raw']!r}")
    print(f"Current content length: {len(content)}")

    if 'id="apg-intro-video"' in content:
        print("Already injected — nothing to do (idempotent).")
        return 0

    if INSERT_MARKER not in content:
        print("ERROR: insert marker not found. Aborting to avoid mangling the page.")
        return 2

    new_content = content.replace(INSERT_MARKER, VIDEO_SECTION + INSERT_MARKER, 1)
    print(f"New content length: {len(new_content)} (added {len(new_content) - len(content)} chars)")

    payload = {"content": new_content}
    updated = http_json(ENDPOINT, method="POST", body=payload)
    print(f"Saved. Modified GMT: {updated.get('modified_gmt')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
