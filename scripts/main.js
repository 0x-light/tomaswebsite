(function () {
  "use strict";

  var THEME_STORAGE_KEY = "theme";
  var themes = [
    "light", "dark", "nocturne", "dawn", "moss",
    "glacial", "ember", "midnight", "fog", "alabaster",
    "obsidian", "oxide", "parchment", "slate", "bone",
    "carbon", "verdant", "porcelain", "terra", "caspian",
    "wool", "laurel", "umber", "onyx", "marine",
    "ivory", "copper", "arctic", "bruise", "kiln",
    "brine", "blueprint", "amber", "mint", "ocean",
    "phosphor", "plasma", "crt", "lcd", "nixie",
    "vectrex", "commodore", "gameboy", "hypercard", "minitel",
    "xerox", "dotmatrix", "patriot", "azulejo", "bauhaus",
    "tiffany", "noir", "rothko", "mainframe", "workbench",
    "vt220", "spectrum", "scope", "nextstep", "hpcalc",
    "indigo", "trs80", "radar", "atarist", "lisa",
    "fairlight", "sharp", "tektronix", "thomson", "plato",
    "bbcmicro", "kaypro", "wang", "amstrad", "coco",
    "osborne", "adm3a", "sparc", "ti99",
    "apollo", "olivetti", "heathkit", "hal", "nostromo",
    "tron", "matrix", "lcars", "blade", "wargames",
    "alien", "robocop", "neuromancer", "tardis", "deathstar",
    "predator", "oblivion", "fallout", "akira", "cowboy",
    "jarvis", "westworld", "shodan"
  ];

  var knownThemes = Object.create(null);
  var currentTheme = "light";
  var storage = getSafeStorage();

  themes.forEach(function (theme) {
    knownThemes[theme] = true;
  });

  function getSafeStorage() {
    var testKey = "__theme_test__";
    var candidates = [window.sessionStorage, window.localStorage];
    var index;

    for (index = 0; index < candidates.length; index += 1) {
      try {
        candidates[index].setItem(testKey, testKey);
        candidates[index].removeItem(testKey);
        return candidates[index];
      } catch (_error) {
        // Try next storage mechanism.
      }
    }

    return null;
  }

  function formatThemeName(value) {
    var upperCaseThemes = {
      crt: "CRT",
      lcd: "LCD",
      vt220: "VT220",
      trs80: "TRS-80",
      ti99: "TI-99",
      adm3a: "ADM-3A",
      lcars: "LCARS",
      hal: "HAL",
      bbcmicro: "BBC Micro",
      coco: "CoCo"
    };
    if (upperCaseThemes[value]) {
      return upperCaseThemes[value];
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function readStoredTheme() {
    if (!storage) {
      return null;
    }

    var storedTheme = storage.getItem(THEME_STORAGE_KEY);
    return knownThemes[storedTheme] ? storedTheme : null;
  }

  function persistTheme(theme) {
    if (!storage) {
      return;
    }

    try {
      storage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_error) {
      // Ignore storage quota/privacy errors; theme still applies for this page load.
    }
  }

  function syncThemeControls(theme) {
    var label = formatThemeName(theme);

    document.querySelectorAll(".theme-toggle").forEach(function (button) {
      button.textContent = label;
      button.setAttribute("aria-label", "Current theme: " + label + ". Click to cycle.");
    });
  }

  function updateFavicon() {
    var styles = getComputedStyle(document.documentElement);
    var bg = styles.getPropertyValue("--bg").trim();
    var text = styles.getPropertyValue("--text").trim();

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<circle cx="16" cy="16" r="15" fill="' + bg + '"/>' +
      '<circle cx="16" cy="16" r="6" fill="' + text + '"/>' +
      '</svg>';

    var favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.href = "data:image/svg+xml," + encodeURIComponent(svg);
    }
  }

  function setTheme(theme) {
    var resolvedTheme = knownThemes[theme] ? theme : "light";

    if (currentTheme !== "light") {
      document.documentElement.classList.remove(currentTheme);
    }
    if (resolvedTheme !== "light") {
      document.documentElement.classList.add(resolvedTheme);
    }

    currentTheme = resolvedTheme;
    persistTheme(resolvedTheme);
    syncThemeControls(resolvedTheme);
    updateFavicon();
  }

  function getNavigationType() {
    var entries;

    if (window.performance && window.performance.getEntriesByType) {
      entries = window.performance.getEntriesByType("navigation");
      if (entries && entries[0] && entries[0].type) {
        return entries[0].type;
      }
    }

    if (window.performance && window.performance.navigation) {
      return window.performance.navigation.type === 1 ? "reload" : "navigate";
    }

    return "navigate";
  }

  function pickRandomTheme(excludedTheme) {
    var pool = themes;

    if (excludedTheme && themes.length > 1) {
      pool = themes.filter(function (theme) {
        return theme !== excludedTheme;
      });
    }

    return pool[Math.floor(Math.random() * pool.length)] || "light";
  }

  function getInitialTheme() {
    var storedTheme = readStoredTheme();
    var navigationType = getNavigationType();

    // Reload = force a fresh random theme, but keep internal navigation stable.
    if (navigationType === "reload") {
      return pickRandomTheme(storedTheme);
    }

    if (storedTheme) {
      return storedTheme;
    }

    return pickRandomTheme(null);
  }

  function cycleTheme() {
    var currentIndex = themes.indexOf(currentTheme);
    var nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  }

  function setupNavigationState() {
    var path = window.location.pathname;
    var page = path.slice(path.lastIndexOf("/") + 1) || "index.html";
    if (page.indexOf(".") === -1) {
      page += ".html";
    }
    var isWritingDetail = path.indexOf("/writing/") !== -1 && page !== "writing.html";

    document.querySelectorAll(".sidebar__link").forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var target = href.split("/").pop() || "index.html";
      var isActive = page === target || (target === "writing.html" && isWritingDetail);

      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function setupMobileMenu() {
    var menuButton = document.querySelector(".hamburger");
    var nav = document.querySelector(".sidebar__nav");

    if (!menuButton || !nav) {
      return;
    }

    function setMenuOpen(isOpen) {
      nav.classList.toggle("open", isOpen);
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
    }

    setMenuOpen(false);

    menuButton.addEventListener("click", function () {
      setMenuOpen(!nav.classList.contains("open"));
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setMenuOpen(false);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    });
  }

  function setupThemeControls() {
    document.querySelectorAll(".theme-toggle").forEach(function (button) {
      button.addEventListener("click", cycleTheme);
    });
  }

  function setupWeatherWidget() {
    var WMO = {
      0: "Clear",
      1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Foggy",
      51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
      61: "Rain", 63: "Rain", 65: "Heavy rain",
      71: "Snow", 73: "Snow", 75: "Heavy snow",
      80: "Showers", 81: "Showers", 82: "Heavy showers",
      95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm"
    };

    var el = document.createElement("div");
    el.className = "weather-widget";
    var main = document.querySelector(".main");
    if (!main) { return; }
    main.appendChild(el);

    var cache = null;
    var lastFetch = 0;
    var CACHE_MS = 30 * 60 * 1000;

    function lisbonTime() {
      var parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).formatToParts(new Date());
      var h = "", m = "";
      parts.forEach(function (p) {
        if (p.type === "hour") { h = p.value; }
        if (p.type === "minute") { m = p.value; }
      });
      return h + ":" + m;
    }

    function render() {
      if (!cache) { return; }
      el.textContent = lisbonTime() + " · Lisbon, Portugal · " + cache.condition + ", " + Math.round(cache.temp) + "°C";
    }

    function fetchWeather() {
      fetch("https://api.open-meteo.com/v1/forecast?latitude=38.7167&longitude=-9.1333&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=Europe/Lisbon")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          cache = {
            condition: WMO[data.current.weather_code] || "Clear",
            temp: data.current.temperature_2m
          };
          lastFetch = Date.now();
          render();
        })
        .catch(function () {});
    }

    fetchWeather();

    setInterval(function () {
      render();
      if (Date.now() - lastFetch >= CACHE_MS) { fetchWeather(); }
    }, 60 * 1000);
  }

  setupNavigationState();
  setupMobileMenu();
  setupThemeControls();
  setTheme(getInitialTheme());
  setupWeatherWidget();

  console.log("Made with HTML, CSS, and JavaScript.\n\nby Tom\u00e1s");
})();
