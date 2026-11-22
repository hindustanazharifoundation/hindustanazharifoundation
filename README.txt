HINDUSTAN AZHARI FOUNDATION WEBSITE

FILES (keep all in the same folder)
  index.html, style.css, script.js   -> the public site
  admin/ (index.html, admin.js, admin.css) -> admin panel, open yoursite.com/admin (no login)
  firebase-config.js                 -> paste your Firebase config here
  firestore.rules                    -> paste into Firebase Firestore Rules
  logo.jpg                           -> YOU add this (same folder as index.html)

FIREBASE SETUP
  1. Firebase Console -> Add project.
  2. (No Authentication needed - admin panel has no login.)
  3. Build -> Firestore Database -> Create database (production mode).
     Rules tab -> paste firestore.rules -> Publish.
  4. Project settings -> Your apps -> Web (</>) -> copy config into firebase-config.js.

NOTE: the site must be opened through a web server / hosting (not by double-clicking
the file), because it uses JavaScript modules. Locally use VS Code "Live Server".
