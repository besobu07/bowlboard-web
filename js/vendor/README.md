# Vendored libraries

- `supabase-2.119.2.min.js`: `@supabase/supabase-js` 2.119.2 (UMD build, MIT licence, https://github.com/supabase/supabase-js), saved as served by jsDelivr from
  `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.min.js`. Kept in the repo so sign-in and sync do not depend on a CDN and the app starts offline.
  To update: download the new version's file, save it here under its version, change the `<script>` in `index.html` and the path in `sw.js`, run `npm run stamp`, then `npm test`.
