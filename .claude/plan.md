# Plan: 12 Themes

## CSS changes (`styles/main.css`)

### 1. Add `--accent` and `--accent-dim` to `:root` (light default)
So that accent-colored links work off variables in every theme, not just `html.dark`.

### 2. Replace `html.dark` with 12 theme classes
Each sets: `--bg`, `--bg-hover`, `--text`, `--text-2`, `--text-3`, `--text-dim`, `--accent`, `--accent-dim`, `--border`, `--border-light`

Themes (names are the CSS class and the display label):

1. **Light** — `:root` default (warm off-white, near-black text). No class needed.
2. **Dark** — `html.dark` (near-black bg, light gray text, blue accent)
3. **Nocturne** — `html.nocturne` (deep navy #0a0e1a, silver text, pale gold accent)
4. **Dawn** — `html.dawn` (warm cream #faf6f0, dark brown text, terracotta accent)
5. **Moss** — `html.moss` (dark forest #0c120e, sage text, warm green accent)
6. **Glacial** — `html.glacial` (ice white #f0f4f8, slate text, steel blue accent)
7. **Ember** — `html.ember` (charcoal #1a1210, warm gray text, burnt orange accent)
8. **Sand** — `html.sand` (desert tan #f5f0e8, dark warm text, sienna accent)
9. **Ink** — `html.ink` (pure white #fff, pure black text, no accent — monochrome)
10. **Midnight** — `html.midnight` (true black #000, cool gray text, violet accent)
11. **Fog** — `html.fog` (soft gray #eaeaea, muted dark text, slate blue accent)
12. **Solarized** — `html.sol` (cream #fdf6e3, dark text, teal accent — inspired by solarized light)

### 3. Replace `html.dark .about a` / `html.dark .post__body a` rules
Use a single approach: `.about a` and `.post__body a` always use `var(--accent)` for color when accent is defined. Add `--accent` to `:root` as `inherit` (so links stay default text color in light), and set it per theme. Actually simpler: just make all link styles use `--accent` with a default that works for light, and override per theme.

### 4. Remove hardcoded `rgba(121, 180, 222, 0.3)` — use `var(--accent-dim)` instead

## JS changes (`scripts/main.js`)

### 1. Define theme list as array of `{ class, label }` objects
- `{ class: "", label: "Light" }` (no class = default)
- `{ class: "dark", label: "Dark" }`
- etc.

### 2. Rewrite `setTheme(name)`
- Remove all theme classes from `<html>`
- Add the selected theme class (if not default)
- Store theme name in localStorage
- Button text stays "Theme"

### 3. Click handler cycles to next theme in array
- Read current theme from localStorage
- Find index, advance by 1 (wrap)
- Call `setTheme(next)`

### 4. Init from localStorage or system preference
- If stored theme name exists, use it
- Else if `prefers-color-scheme: dark`, use "dark"
- Else use "" (light default)
