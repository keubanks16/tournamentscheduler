# Tournament Pool & Bracket Manager

A zero-backend tournament manager built with plain HTML, CSS, and JavaScript. It works on GitHub Pages.

## Features
- Add any list of teams
- Choose 1–8 pools
- Random, even pool draw
- Re-draw pools
- Automatic round-robin pool games
- Score entry
- Live W/L/T, runs for, runs against, run differential, and win percentage
- Overall tournament seeding
- Automatic single-elimination bracket with byes
- Tap winners to advance them
- Tournament champion display
- Local browser save
- Mobile-friendly

## Put it on GitHub Pages
1. Create a new GitHub repository.
2. Upload `index.html`, `style.css`, and `app.js` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`, then Save.
6. GitHub will provide the public URL after deployment.

## Notes
Tournament data is stored in the browser using localStorage. It does not sync between devices yet.
