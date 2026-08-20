import { defineConfig } from 'vite'

/**
 * The page asks for the menu at a relative path, so something has to put the
 * page and the API on one origin. In development that is the proxy below.
 *
 * There is deliberately no `preview.proxy` here. The preview server is what the
 * acceptance test measures, and that test supplies its own rule pointing at the
 * API it started on an ephemeral port. A default here would be a second answer
 * to the same question: if the test's rule ever stopped being applied, the
 * suite would quietly reach whatever is listening on 3000 -- a developer's own
 * API -- and pass against a server it did not start.
 */
export default defineConfig({
  server: {
    // Both prefixes the page fetches. A rule missing here does not fail
    // loudly: the dev server answers its own index.html instead, so the page
    // receives a document where it expects a menu.
    proxy: {
      '/restaurants': 'http://127.0.0.1:3000',
      '/tables': 'http://127.0.0.1:3000',
    },
  },
})
