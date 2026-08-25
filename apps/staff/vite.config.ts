import { defineConfig } from 'vite'

/**
 * The page asks for its session and its board at relative paths, so something
 * has to put the page and the API on one origin. In development that is the
 * proxy below.
 *
 * One prefix, not two. Everything this page fetches is under `/staff`, and the
 * guest's `/tables` and `/restaurants` are deliberately absent: this app has no
 * reader for either, and a rule for a path nothing asks for is a rule nobody
 * would notice breaking.
 *
 * A port of its own, because the guest's dev server already has 5173 and two
 * servers that pick a port by falling forward would swap addresses depending on
 * which was started first -- which is exactly what a run step cannot say.
 *
 * There is deliberately no `preview.proxy` here, for the reason `apps/guest`
 * records: the preview server is what the acceptance test measures, that test
 * supplies its own rule pointing at the API it started on an ephemeral port, and
 * a default here would let the suite reach whatever is listening on 3000 -- a
 * developer's own API -- and pass against a server it did not start.
 */
export default defineConfig({
  server: {
    port: 5174,
    // A rule missing here does not fail loudly: the dev server answers its own
    // index.html instead, so the page receives a document where it expects a
    // session or a board.
    proxy: {
      '/staff': 'http://127.0.0.1:3000',
    },
  },
})
