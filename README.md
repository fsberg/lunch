# Lunch i Trollhättan

Visar dagens lunch på Sour Café, Restaurang Västan, Restaurang Bacchus, Oden Bistro och Mae Prai.

- `index.html` är sidan och läser `menu.json`.
- `scrape.mjs` hämtar menyerna och skrivs `menu.json` (`node scrape.mjs`).
- GitHub Actions kör hämtningen varje vardagsmorgon.
