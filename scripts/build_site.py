#!/usr/bin/env python3
"""Builds the site's pages from the content below.

Edit the lists (projects, books) or a page's copy here, then run:

    python3 scripts/build_site.py

It writes index.html, work.html, reading.html, contact.html, the Dia pages,
medici.html, and 404.html at the repo root. Styles live in styles/site.css,
behaviour in scripts/site.js. The writing/ pages are not generated.
"""

import html
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://palmeirim.com"
EMAIL = "tomas@palmeirim.com"

e = html.escape


# ── Content ──

PROJECTS = [
    # name, role, description, link
    ("Skiv", "Product, Design, Dev", "AI-powered video hosting with in-video search.", "https://skiv.com/"),
    ("Dia", "Solo", "A simple notes, tasks, and calendar app for iOS and macOS.", "/dia"),
    ("Medici", "Solo", "A tool for saving full-resolution images from zoomable web viewers.", "/medici"),
    ("Sentry", "Solo", "Get the best of your timeline without opening Twitter.", "https://sentry.is"),
    ("Viewport", "Solo", "A portfolio tracker for Hyperliquid, Lighter, and on-chain assets.", "https://viewport.is"),
    ("Three Sigma", "Research", "Code audits and economic risk consulting for crypto protocols.", "https://threesigma.xyz/"),
    ("RetryOn", "Design", "A platform for generating fashion assets without photoshoots.", "https://retryon.com/"),
    ("Unsu", "Product, Design, Dev", "A web-based crypto wallet anyone can use.", "https://unsu.com"),
    ("Guardião", "Design", "Software that detects fraud patterns and alerts citizens to scams.", "https://stopburla.pt/"),
]

BOOKS = [
    # title, year, author, note
    ("Medieval Europe", 2016, "Chris Wickham", "A history of Europe from 500 to 1500, told through how power was held, shared, and lost."),
    ("Swann's Way", 1913, "Marcel Proust", "The first volume of In Search of Lost Time. A childhood in Combray, and Swann's long, jealous love for Odette."),
    ("Chess Story", 1942, "Stefan Zweig", "On a liner to Buenos Aires, the world chess champion meets a passenger who learned the game alone in a Gestapo cell."),
    ("The Remains of the Day", 1989, "Kazuo Ishiguro", "An English butler drives across the country and looks back on decades of service to a lord whose politics he never questioned."),
    ("The Invisible Man", 1897, "H. G. Wells", "A scientist arrives in a Sussex village wrapped in bandages. He has made himself invisible and cannot undo it."),
    ("Butcher's Crossing", 1960, "John Williams", "A young Harvard dropout joins a buffalo hunting expedition into the Colorado wilderness."),
    ("Under the Glacier", 1968, "Halldor Laxness", "A young emissary is sent to investigate a pastor who has stopped performing his duties in a remote Icelandic village."),
    ("There Is No Antimemetics Division", 2020, "qntm", "A division that fights things you can't remember."),
    ("Augustus", 1972, "John Williams", "The life of Rome's first emperor told through letters, memoirs, and documents."),
    ("Vol de Nuit", 1931, "Antoine de Saint-Exupéry", "Night mail flights over the Andes."),
    ("Over the Edge of the World", 2003, "Laurence Bergreen", "Magellan's attempt to circumnavigate the globe. Mutiny, starvation, uncharted seas. Only eighteen of the original 260 men made it back."),
    ("Empire of Blue Water", 2007, "Stephan Talty", "Captain Henry Morgan and his pirate army's reign over the Caribbean."),
    ("Heart of Darkness", 1899, "Joseph Conrad", "A steamboat captain travels up the Congo River to retrieve a man named Kurtz."),
    ("Death in Midsummer", 1966, "Yukio Mishima", "Ten stories of aesthetics, violence, and the rituals of beauty and death."),
    ("The Heart of the Matter", 1948, "Graham Greene", "A police officer in colonial West Africa caught between duty, faith, and an impossible situation."),
    ("The Trial", 1925, "Franz Kafka", "A man is arrested one morning. The charge is never revealed."),
    ("Lord of the Flies", 1954, "William Golding", "Schoolboys stranded on a deserted island attempt to govern themselves."),
    ("The Old Man and the Sea", 1952, "Ernest Hemingway", "An aging Cuban fisherman hooks a giant marlin far out in the Gulf Stream."),
    ("The Pearl", 1947, "John Steinbeck", "A poor diver discovers an enormous pearl and dreams of a better life."),
    ("The Lost World", 1912, "Arthur Conan Doyle", "An expedition to a South American plateau discovers a land where prehistoric creatures still roam."),
    ("Brave New World", 1932, "Aldous Huxley", "A future where humans are engineered for contentment, conditioned from birth to accept their place."),
    ("Blindness", 1995, "Jose Saramago", "A city is struck by an epidemic of white blindness. As the afflicted are quarantined, society unravels. One woman, inexplicably, can still see."),
    ("Tales of the Unexpected", 1979, "Roald Dahl", "Short stories with twist endings. Dahl's adult fiction."),
    ("The New York Trilogy", 1987, "Paul Auster", "Three interlocking detective stories where the investigations turn inward."),
    ("Mahlangeni", 1994, "Kobie Kruger", "A game ranger's wife recounts two decades living in Kruger National Park. Lions at the door, orphaned animals raised by hand."),
]

DIA_FEATURES = [
    ("Notes", "Autosave, links, pinning, archives, sharing, and export."),
    ("Tasks", "Quick scheduling, repeating reminders, reordering, and actionable notifications."),
    ("Agenda", "Calendar events and scheduled tasks in one chronological view."),
    ("Calendars", "Apple Calendar, Apple Reminders, and Google Calendar integration."),
    ("Your files", "Store them locally or sync through your own iCloud Drive folder."),
    ("No account", "No advertising, tracking, analytics, or developer-operated cloud."),
]

DIA_PRIVACY = [
    "Dia does not collect your personal data. It has no developer-operated servers, accounts, advertising, analytics, tracking, or telemetry.",
    "Your notes, tasks, preferences, and reminder information stay on your device or in a folder you choose. If you use iCloud Drive, Calendar, Reminders, Maps, or another system service, that service may process or synchronize data under its own privacy policy. Dia’s developer cannot access it.",
    'If you connect Google Calendar to invite guests, Dia sends the event details and guest email addresses directly to Google. This information is used only to create the event and send invitations. Dia does not read your existing Google Calendar events, and its developer does not receive your Google data. Dia’s use of Google data complies with the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.',
    "You control your data through Dia, your selected storage folder, device settings, and connected services. Uninstalling Dia removes app-local data, but may not remove files or events stored separately in iCloud, Calendar, Reminders, or Google Calendar.",
    f'Questions: <a href="mailto:{EMAIL}">{EMAIL}</a>',
]

DIA_TERMS = [
    "You may use Dia for lawful, personal purposes. Dia is licensed, not sold. You may not redistribute, sell, disrupt, or misuse the app.",
    "You own the notes, tasks, and other content you create or import. You are responsible for maintaining appropriate backups.",
    "Dia may interact with services provided by Apple, Google, and other applications you choose. Those services are governed by their own terms and privacy policies.",
    "Dia is provided “as is,” without guarantees of uninterrupted or error-free operation. Reminders, notifications, synchronization, and storage can fail, so do not rely on Dia for emergencies or critical deadlines.",
    "To the extent permitted by law, the Dia team is not liable for data loss or indirect damages arising from your use of Dia. Nothing in these Terms limits consumer rights that cannot legally be limited.",
    f'We may update Dia or these Terms when necessary. Questions: <a href="mailto:{EMAIL}">{EMAIL}</a>',
]

DIA_SUPPORT = [
    f'Email <a href="mailto:{EMAIL}">{EMAIL}</a>. Include the device and operating system version you use, along with a short description of the issue.',
]

# Markup the Medici tool (scripts/medici.js) looks up by id. Keep the ids as they are.
MEDICI_TOOL = """
      <div class="medici-tool" data-medici>
        <form class="medici-form" id="medici-form">
          <label class="medici-label" for="medici-source">URL</label>
          <textarea id="medici-source" class="medici-source" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste URL here"></textarea>

          <div class="medici-actions">
            <button id="medici-analyze" class="medici-button" type="submit">Get Image</button>
            <label class="medici-format">
              <span class="medici-label">Format</span>
              <select id="medici-output">
                <option value="image/jpeg">JPEG</option>
                <option value="image/png">PNG, lossless</option>
              </select>
            </label>
          </div>
        </form>

        <section id="medici-status" class="medici-section" aria-live="polite" hidden>
          <div class="medici-alert" id="medici-alert" hidden></div>
          <dl id="medici-stats" class="medici-stats" hidden>
            <div>
              <dt>Detected</dt>
              <dd id="medici-detected">-</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd id="medici-size">-</dd>
            </div>
            <div>
              <dt>Tiles</dt>
              <dd id="medici-tiles">-</dd>
            </div>
            <div>
              <dt>Pixels</dt>
              <dd id="medici-memory">-</dd>
            </div>
          </dl>

          <div id="medici-progress-wrap" class="medici-progress-wrap" hidden>
            <div class="medici-progress" aria-hidden="true">
              <div id="medici-progress-bar"></div>
            </div>
            <div class="medici-progress-text" id="medici-progress-text">Idle</div>
          </div>

          <div class="medici-actions medici-actions--run">
            <button id="medici-save" class="medici-button" type="button" hidden>Save full resolution</button>
            <button id="medici-stop" class="medici-button" type="button" hidden>Stop</button>
          </div>
        </section>

        <section id="medici-preview" class="medici-section medici-preview-section" hidden>
          <canvas id="medici-canvas" class="medici-canvas" width="1" height="1"></canvas>
          <div id="medici-output-actions" class="medici-actions medici-actions--output" hidden>
            <a id="medici-download" class="medici-button" href="#" aria-disabled="true"><span>Download</span><span id="medici-download-size" class="medici-download-size" hidden></span></a>
          </div>
        </section>

        <details id="medici-details" class="medici-section medici-details" hidden>
          <summary>Details</summary>
          <pre id="medici-log" class="medici-log">Ready.</pre>
        </details>
      </div>
"""


# ── Helpers ──

def slug(text):
    text = unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("'", "")).strip("-")


def ext(href):
    return ' target="_blank" rel="noopener noreferrer"' if href.startswith("http") else ""


def host(href):
    if href.startswith("/"):
        return "palmeirim.com" + href
    return href.split("://", 1)[-1].rstrip("/")


def links(items):
    rows = []
    for label, href in items:
        rows.append(
            f'<li><a href="{e(href)}"{ext(href)}><span class="links__icon" aria-hidden="true">→</span>'
            f"<span>{label}</span></a></li>"
        )
    return '<ul class="links">' + "".join(rows) + "</ul>"


def keys_hint(keys, touch):
    return (
        f'<p class="hint"><span class="hint--keys">{keys}</span>'
        f'<span class="hint--touch">{touch}</span></p>'
    )


def filter_line(table_id):
    return (
        f'<div class="filter js-filter" hidden><label class="chip" for="filter-{table_id}"><kbd>/</kbd>'
        f'<span class="chip__label">Filter</span></label><input class="filter__input" id="filter-{table_id}" '
        f'type="text" autocomplete="off" spellcheck="false" placeholder="Type to narrow the list. Esc clears."></div>'
    )


def section(title, body):
    return f'<section class="sec"><h2 class="sec__title">{title}</h2><div class="sec__body">{body}</div></section>'


def prose(paragraphs):
    return '<div class="prose">' + "".join(f"<p>{p}</p>" for p in paragraphs) + "</div>"


# ── Tables ──

def work_table():
    rows = []
    for name, role, desc, href in PROJECTS:
        s = slug(name)
        rows.append(
            f'<tr class="row xrow" data-slug="{s}">'
            f'<td class="nowrap"><button class="xrow__toggle" type="button" aria-expanded="false" aria-controls="project-{s}">{e(name)}</button></td>'
            f"<td>{e(role)}</td>"
            f'<td class="col-site">{e(host(href))}</td>'
            f"</tr>"
            f'<tr class="note" id="project-{s}" hidden><td colspan="3">{e(desc)} '
            f'<a href="{e(href)}"{ext(href)}>Open {e(host(href))}</a></td></tr>'
        )
    return (
        filter_line("work")
        + '<table class="tbl tbl--work"><thead><tr><th>Project</th><th>Role</th><th class="col-site">Site</th></tr></thead>'
        + '<tbody class="js-xtable">' + "".join(rows) + "</tbody></table>"
        + '<p class="empty js-empty" hidden>No projects match.</p>'
        + keys_hint(
            "<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> details · <kbd>esc</kbd> close · <kbd>/</kbd> filter",
            "Tap a project for details.",
        )
    )


def books_table():
    rows = []
    for i, (title, year, author, note) in enumerate(BOOKS):
        s = slug(title)
        rows.append(
            f'<tr class="row xrow" data-slug="{s}" data-i="{i}" data-year="{year}" data-title="{e(title)}" data-author="{e(author)}">'
            f"<td>{year}</td>"
            f'<td><button class="xrow__toggle" type="button" aria-expanded="false" aria-controls="book-{s}">{e(title)}<span class="by"> by {e(author)}</span></button></td>'
            f'<td class="col-author">{e(author)}</td>'
            f"</tr>"
            f'<tr class="note" id="book-{s}" hidden><td colspan="3">{e(note)}</td></tr>'
        )
    return (
        '<div class="sort" role="radiogroup" aria-label="Sort books"><span class="sort__label">Sort</span>'
        '<button type="button" role="radio" aria-checked="true" data-sort="shelf">Shelf</button>'
        '<button type="button" role="radio" aria-checked="false" data-sort="year">Year</button>'
        '<button type="button" role="radio" aria-checked="false" data-sort="title">Title</button>'
        '<button type="button" role="radio" aria-checked="false" data-sort="author">Author</button></div>'
        + filter_line("books")
        + '<table class="tbl tbl--books"><thead><tr><th>Year</th><th>Title</th><th class="col-author">Author</th></tr></thead>'
        + '<tbody class="js-xtable js-books">' + "".join(rows) + "</tbody></table>"
        + '<p class="empty js-empty" hidden>No books match.</p>'
        + keys_hint(
            "<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> read the note · <kbd>esc</kbd> close · <kbd>/</kbd> filter",
            "Tap a book to read its note.",
        )
    )


def facts_table(rows):
    body = "".join(f"<tr><td>{e(a)}</td><td>{e(b)}</td></tr>" for a, b in rows)
    return f'<table class="tbl tbl--facts"><thead><tr><th>Feature</th><th>What it does</th></tr></thead><tbody>{body}</tbody></table>'


# ── Page template ──

NAV = [("about", "About", "/"), ("work", "Work", "/work"), ("reading", "Reading", "/reading"), ("contact", "Contact", "/contact")]


def page(path, title, description, current, main, scripts=()):
    current_attr = ' aria-current="page"'
    nav = "".join(
        f'<a class="chip" href="{href}"{current_attr if key == current else ""}>'
        f'<kbd>{n}</kbd><span class="chip__label">{label}</span></a>'
        for n, (key, label, href) in enumerate(NAV, 1)
    )
    extra = "".join(f'\n  <script src="{s}" defer></script>' for s in scripts)
    canonical = SITE + ("/" if path == "index" else "/" + path)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{e(title)}</title>
  <meta name="description" content="{e(description)}" />
  <link rel="canonical" href="{canonical}" />
  <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/styles/themes.css" />
  <link rel="stylesheet" href="/styles/site.css" />
  <script>
    // Apply the visit's theme before first paint.
    try {{
      var t = sessionStorage.getItem("theme") || localStorage.getItem("theme");
      if (t && t !== "light") document.documentElement.className = t;
    }} catch (_e) {{}}
  </script>
</head>
<body>
  <header class="bar">
    <nav class="nav" aria-label="Pages">{nav}</nav>
  </header>

  <main class="page">
{main}
  </main>

  <footer class="foot">
    <span class="foot__tools">
      <button class="foot__set js-theme" type="button"><span class="chip"><kbd>T</kbd><span class="chip__label">Theme</span></span><span class="js-theme-name">light</span></button>
    </span>
  </footer>

  <script src="/scripts/site.js" defer></script>{extra}
</body>
</html>
"""


def intro(name, badge, paragraphs):
    ps = "".join(f"<p>{p}</p>" for p in paragraphs)
    return f'<section class="intro"><h1><span>{name}</span> <span class="badge">{badge}</span></h1>{ps}</section>'


CLOCK = '<span class="js-time">--:--</span> Lisbon<span class="js-temp"></span>'
HOME_INTRO = intro("Tomás Thor Palmeirim", CLOCK, ['Product at <a href="https://skiv.com" target="_blank" rel="noopener noreferrer">Skiv</a>'])
WORK_BODY = "<p>Things I've worked on.</p>" + work_table()

DIA_LINKS = [("Dia", "/dia"), ("Privacy policy", "/dia-privacy"), ("Terms of use", "/dia-terms"), ("Support", "/dia-support")]


def dia_page(path, title, heading, lead, body):
    others = [(label, href) for label, href in DIA_LINKS if href != "/" + path]
    main = (
        intro("Dia", "iOS · macOS", ["Notes, tasks, and calendar for iOS and macOS."])
        + section(heading, f"<p>{lead}</p>" + body + links(others))
    )
    return page(path, title, "Dia is a notes, tasks, and calendar app for iOS and macOS.", "work", main)


PAGES = {
    "index": page(
        "index", "Tomás Thor Palmeirim",
        "Product at Skiv, in Lisbon. Projects, books, and how to get in touch.",
        "about", HOME_INTRO + section("Work", WORK_BODY),
    ),
    "work": page(
        "work", "Work · Tomás Thor Palmeirim", "Things Tomás Thor Palmeirim has worked on.",
        "work", section("Work", WORK_BODY),
    ),
    "reading": page(
        "reading", "Reading · Tomás Thor Palmeirim", "Books Tomás Thor Palmeirim liked, each with a short note.",
        "reading", section("Reading", "<p>Books I liked.</p>" + books_table()),
    ),
    "contact": page(
        "contact", "Contact · Tomás Thor Palmeirim", "How to reach Tomás Thor Palmeirim.",
        "contact", section(
            "Contact",
            '<p>Get in touch.</p>'
            '<ul class="links">'
            f'<li><a href="mailto:{EMAIL}"><span class="links__icon" aria-hidden="true">→</span><span>Write to {EMAIL}</span></a></li>'
            '<li><button class="js-copy" type="button"><span class="links__icon" aria-hidden="true">→</span><span class="js-copy-label">Copy my email address</span></button></li>'
            '<li><a href="https://x.com/0x_light" target="_blank" rel="noopener noreferrer"><span class="links__icon" aria-hidden="true">→</span><span>Follow me on X</span></a></li>'
            "</ul>",
        ),
    ),
    "dia": page(
        "dia", "Dia · Notes, tasks, and calendar",
        "Dia is a notes, tasks, and calendar app for iOS and macOS with Google Calendar integration.",
        "work",
        intro("Dia", "iOS · macOS", [
            "Dia helps you write notes, plan tasks, and see your schedule in one place.",
            "Connect Google Calendar to view, create, edit, and manage calendar events alongside your scheduled tasks in one agenda.",
        ])
        + section("What Dia does", facts_table(DIA_FEATURES) + links(DIA_LINKS[1:])),
    ),
    "dia-privacy": dia_page("dia-privacy", "Privacy Policy · Dia", "Privacy policy", "Effective August 22, 2026.", prose(DIA_PRIVACY)),
    "dia-terms": dia_page("dia-terms", "Terms of Use · Dia", "Terms of use", "Effective August 22, 2026.", prose(DIA_TERMS)),
    "dia-support": dia_page("dia-support", "Support · Dia", "Support", "Questions, problems, or feedback.", prose(DIA_SUPPORT)),
    "medici": page(
        "medici", "Medici · Tomás Thor Palmeirim", "Save full-resolution images from zoomable web viewers.",
        "work",
        intro("Medici", "Web tool", ["Saves full-resolution images from zoomable web viewers. Paste the page or the image manifest."])
        + MEDICI_TOOL,
        scripts=("/scripts/medici.js",),
    ),
    "404": page(
        "404", "Not found · Tomás Thor Palmeirim", "This page doesn't exist.", "",
        section("Not found", '<p>There is no page at this address.</p>' + links([("Go to the home page", "/")])),
    ),
}


def main():
    for name, html_text in PAGES.items():
        out = ROOT / f"{name}.html"
        out.write_text(html_text)
        print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
