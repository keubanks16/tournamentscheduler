# Tournament Manager

A one-page baseball tournament manager. No build step and no server: upload `index.html`, `style.css` and `app.js` to the root of a GitHub repository and turn on GitHub Pages.

## What it does
- **Random pool draw** with an animated reveal. The draw order is also the last tiebreaker.
- **Smart scheduling.** Each team gets exactly the number of pool games you pick (or a full round robin), with no repeat matchups and nobody booked on two fields at once. Back-to-back games are kept to a minimum. Fields can have custom names.
- **Live scoreboard.** Enter scores right on each game card. Games are grouped by time slot and marked Final, In progress or Up next.
- **Team view.** Filter the schedule to one team and see its record, rank and run differential.
- **Rain delay.** Push every unplayed game back 15–90 minutes in one step. Bracket times follow.
- **Standings** with win %, head-to-head, run differential (with an optional per-game cap), runs allowed and runs scored. You set the tiebreaker order, and a tag shows which tiebreaker separated two tied teams.
- **Championship bracket.** Single or double elimination, all teams or the top 2/4/6/8. Seeds come from the standings, top seeds get the byes, and winners move on as soon as a final score goes in. Double elimination includes the "if necessary" championship game.
- **Sharing.** Copy the schedule as text for a team chat, share a view-only link, print, or download and restore a backup.

## Home Screen app
The site is an installable web app with its own icon. It opens full screen and works offline.
- **iPhone:** in Safari, tap Share → Add to Home Screen. Or send people `Tournament.mobileconfig` (also linked inside the app under Menu → Add to Home Screen). They open it, go to Settings → Profile Downloaded → Install, and the app icon appears.
- **Android / computer:** Menu → Add to Home Screen → Install now.

Data saves automatically in the browser (localStorage). Tournaments from the previous version load automatically.
