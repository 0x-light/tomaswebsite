(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var root = document.documentElement;
  var EMAIL = "tomas@palmeirim.com";
  var PAGES = ["/", "/work", "/reading", "/contact"];

  function fold(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  // ── Themes ──
  // A random theme per visit, kept while you browse (and shared with any page
  // reading the "theme" key). T, or the footer button, moves to the next one;
  // Shift+T goes back.

  var THEMES = [
    "light", "dark", "nocturne", "dawn", "moss", "glacial", "ember", "midnight", "fog", "alabaster",
    "obsidian", "oxide", "parchment", "slate", "bone", "carbon", "verdant", "porcelain", "terra", "caspian",
    "wool", "laurel", "umber", "onyx", "marine", "ivory", "copper", "arctic", "bruise", "kiln",
    "brine", "blueprint", "amber", "mint", "ocean", "phosphor", "plasma", "crt", "lcd", "nixie",
    "vectrex", "commodore", "gameboy", "hypercard", "minitel", "xerox", "dotmatrix", "patriot", "azulejo", "bauhaus",
    "tiffany", "noir", "rothko", "mainframe", "workbench", "vt220", "spectrum", "scope", "nextstep", "hpcalc",
    "indigo", "trs80", "radar", "atarist", "lisa", "fairlight", "sharp", "tektronix", "thomson", "plato",
    "bbcmicro", "kaypro", "wang", "amstrad", "coco", "osborne", "adm3a", "sparc", "ti99", "apollo",
    "olivetti", "heathkit", "hal", "nostromo", "tron", "matrix", "lcars", "blade", "wargames", "alien",
    "robocop", "neuromancer", "tardis", "deathstar", "predator", "oblivion", "fallout", "akira", "cowboy", "jarvis",
    "westworld", "shodan"
  ];

  var theme = "light";

  var themeStore = (function () {
    try { sessionStorage.setItem("__t", "1"); sessionStorage.removeItem("__t"); return sessionStorage; } catch (_e) {}
    try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return localStorage; } catch (_e) {}
    return null;
  })();

  function applyTheme(name) {
    if (THEMES.indexOf(name) === -1) name = "light";
    THEMES.forEach(function (t) { root.classList.remove(t); });
    if (name !== "light") root.classList.add(name);
    favicon();
    $$(".js-theme-name").forEach(function (el) { el.textContent = name; });
    return name;
  }

  function setTheme(name) {
    theme = applyTheme(name);
    try { if (themeStore) themeStore.setItem("theme", theme); } catch (_e) {}
    var btn = $(".js-theme");
    if (btn) btn.setAttribute("aria-label", "Theme: " + theme + ". Next theme");
  }

  function initialTheme() {
    var stored = null;
    try { stored = themeStore && themeStore.getItem("theme"); } catch (_e) {}
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (stored && THEMES.indexOf(stored) !== -1 && !(nav && nav.type === "reload")) return stored;
    var pool = THEMES.filter(function (t) { return t !== stored; });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function favicon() {
    var cs = getComputedStyle(root);
    var bg = cs.getPropertyValue("--bg").trim(), fg = cs.getPropertyValue("--text").trim();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<circle cx="16" cy="16" r="15" fill="' + bg + '"/>' +
      '<circle cx="16" cy="16" r="6" fill="' + fg + '"/></svg>';
    var link = $('link[rel="icon"]');
    if (link) link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function cycleTheme(delta) {
    var i = (THEMES.indexOf(theme) + delta + THEMES.length) % THEMES.length;
    setTheme(THEMES[i]);
  }

  // ── Tables: rows that open into a full-width block ──
  // One open per table. An open row's slug goes in the URL (#the-trial), so the
  // address bar always holds a link to what you're looking at.

  function toggleRow(row, open, quiet) {
    var btn = $(".xrow__toggle", row), note = row.nextElementSibling;
    if (open === undefined) open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    if (open) fitNote(note);
    note.hidden = !open;
    row.classList.toggle("is-open", open);
    if (!quiet) setHash(open ? row.dataset.slug : "");
  }

  function setHash(slug) {
    var url = location.pathname + location.search + (slug ? "#" + slug : "");
    history.replaceState(null, "", url);
  }

  // A note spans exactly the visible columns. Spanning a column that small
  // screens hide would conjure a phantom column and shift the others.
  function fitNote(note) {
    var heads = $$("thead th", note.closest("table"));
    note.firstElementChild.colSpan = heads.filter(function (th) { return th.offsetParent !== null; }).length || heads.length;
  }

  window.addEventListener("resize", function () {
    $$(".xrow.is-open + .note").forEach(fitNote);
  });

  function closeRows(tbody, quiet) {
    $$(".xrow.is-open", tbody).forEach(function (r) { toggleRow(r, false, quiet); });
  }

  $$(".js-xtable").forEach(function (tbody) {
    // Quick repeat clicks shouldn't select text over the open block.
    tbody.addEventListener("mousedown", function (e) {
      if (e.detail > 1 && e.target.closest(".xrow")) e.preventDefault();
    });

    tbody.addEventListener("click", function (e) {
      if (e.target.closest(".note a")) return;
      var row = e.target.closest(".xrow");
      if (!row) return;
      var wasOpen = row.classList.contains("is-open");
      closeRows(tbody, true);
      toggleRow(row, !wasOpen);
    });
  });

  // Open the row named in the URL, e.g. /reading#the-trial.
  function openFromHash() {
    var slug = decodeURIComponent(location.hash.slice(1));
    if (!slug) return;
    var row = $('.xrow[data-slug="' + slug.replace(/"/g, "") + '"]');
    if (!row) return;
    closeRows(row.parentNode, true);
    toggleRow(row, true, true);
    row.scrollIntoView({ block: "center" });
  }

  window.addEventListener("hashchange", openFromHash);

  // Coming back with the back button restores the old page from memory;
  // start it fresh instead, with nothing left open.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    $$(".js-xtable").forEach(function (tbody) { closeRows(tbody, true); });
    setHash("");
  });

  // ── Reading: sort ──

  var books = $(".js-books");
  var lastName = function (a) { var p = a.split(" "); return p[p.length - 1]; };
  var bare = function (t) { return t.replace(/^The /, ""); };

  var SORTS = {
    shelf: function (a, b) { return a.dataset.i - b.dataset.i; },
    year: function (a, b) { return a.dataset.year - b.dataset.year; },
    title: function (a, b) { return bare(a.dataset.title).localeCompare(bare(b.dataset.title)); },
    author: function (a, b) { return lastName(a.dataset.author).localeCompare(lastName(b.dataset.author)); }
  };

  $$(".sort [data-sort]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      $$(".sort [data-sort]").forEach(function (b) { b.setAttribute("aria-checked", String(b === btn)); });
      $$(".xrow", books).sort(SORTS[btn.dataset.sort]).forEach(function (row) {
        var note = row.nextElementSibling;
        books.appendChild(row);
        books.appendChild(note);
      });
    });
  });

  // ── Filter ──
  // / shows a filter line above the table; typing narrows the rows, Esc clears.

  var filter = $(".js-filter");
  var filterInput = filter && $(".filter__input", filter);
  var filterTable = filter && $(".js-xtable", filter.parentNode);

  function applyFilter() {
    var q = fold(filterInput.value.trim()), shown = 0;
    $$(".xrow", filterTable).forEach(function (row) {
      var note = row.nextElementSibling;
      var hit = !q || fold(row.textContent + " " + note.textContent).indexOf(q) !== -1;
      if (!hit && row.classList.contains("is-open")) toggleRow(row, false);
      row.hidden = !hit;
      if (hit) shown += 1;
    });
    $(".js-empty", filter.parentNode).hidden = shown > 0;
  }

  function openFilter() {
    if (!filter) return false;
    filter.hidden = false;
    filterInput.focus();
    filterInput.select();
    return true;
  }

  function closeFilter() {
    filterInput.value = "";
    applyFilter();
    filter.hidden = true;
  }

  if (filter) {
    filterInput.addEventListener("input", applyFilter);
    filterInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeFilter(); }
      else if (e.key === "ArrowDown" || e.key === "Enter") {
        var first = $(".xrow:not([hidden])", filterTable);
        if (first) { e.preventDefault(); focusRow(first); }
      }
    });
  }

  // ── Lisbon time and weather ──

  function lisbonTime() {
    var p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { hour: p.hour === "24" ? "00" : p.hour, minute: p.minute };
  }

  function tick() {
    var t = lisbonTime();
    $$(".js-time").forEach(function (el) { el.textContent = t.hour + ":" + t.minute; });
  }

  function fetchWeather() {
    if (!$(".js-temp")) return;
    fetch("https://api.open-meteo.com/v1/forecast?latitude=38.7167&longitude=-9.1333&current=temperature_2m&timezone=Europe/Lisbon")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        $$(".js-temp").forEach(function (el) { el.textContent = " · " + Math.round(d.current.temperature_2m) + "°C"; });
      })
      .catch(function () { setTimeout(fetchWeather, 20000); });
  }

  // ── Copy email ──

  var copy = $(".js-copy");
  if (copy) {
    copy.addEventListener("click", function () {
      var label = $(".js-copy-label");
      if (!navigator.clipboard) { location.href = "mailto:" + EMAIL; return; }
      navigator.clipboard.writeText(EMAIL).then(function () {
        label.textContent = "Copied " + EMAIL;
        setTimeout(function () { label.textContent = "Copy my email address"; }, 1800);
      });
    });
  }

  // ── Keyboard ──
  // 1–4 pages · arrows (or j/k) move through a table · Enter opens · Esc closes
  // / filter · T next theme (Shift+T previous)

  $$(".js-theme").forEach(function (b) { b.addEventListener("click", function () { cycleTheme(1); }); });

  function focusRow(tr) {
    $(".xrow__toggle", tr).focus({ preventScroll: true });
    tr.scrollIntoView({ block: "nearest" });
  }

  // Move to the next or previous visible row, starting in the page's table.
  function moveRow(delta) {
    var active = document.activeElement && document.activeElement.closest && document.activeElement.closest("tr.xrow");
    var tbody = active ? active.parentNode : $(".js-xtable");
    if (!tbody) return false;

    var rows = $$(".xrow:not([hidden])", tbody);
    var i = active ? rows.indexOf(active) + delta : (delta > 0 ? 0 : rows.length - 1);
    var next = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!next) return false;

    // While a row is open, moving opens the next one, so you can read through them.
    if ($(".xrow.is-open", tbody) && !next.classList.contains("is-open")) {
      closeRows(tbody, true);
      toggleRow(next, true);
    }
    focusRow(next);
    return true;
  }

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.target.matches && e.target.matches("input, textarea, select")) return;

    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var handled = true;

    if (k >= "1" && k <= "4") location.href = PAGES[+k - 1];
    else if (k === "t") cycleTheme(e.shiftKey ? -1 : 1);
    else if (k === "/") handled = openFilter();
    // Arrows (or j/k) move through the page's table; with no table they scroll as usual.
    else if (k === "ArrowDown" || k === "j") handled = moveRow(1);
    else if (k === "ArrowUp" || k === "k") handled = moveRow(-1);
    else if (k === "Escape" && $(".xrow.is-open")) {
      var open = $(".xrow.is-open");
      closeRows(open.parentNode);
      focusRow(open);
    }
    else if (k === "Escape" && filter && !filter.hidden) closeFilter();
    else handled = false;

    if (handled) e.preventDefault();
  });

  // ── Start ──

  setTheme(initialTheme());
  openFromHash();
  tick();
  fetchWeather();
  setInterval(tick, 30000);
})();
