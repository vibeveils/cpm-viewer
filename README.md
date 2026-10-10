# CPM Viewer

A browser viewer for [Custom Player Models](https://github.com/tom5454/CustomPlayerModels) (CPM).
It loads a model and plays its animations the way the mod does in game: vanilla poses, status
animations, gestures, custom poses, toggles, sliders, dropdowns and setup/finish stages.

It reads:

- `.cpmproject` editor projects
- `.cpmmodel` exported model files
- model strings (base64) and Gist, GitHub, Pastebin or paste.tom5454.com links
- skin PNGs with a model embedded in them (the linked data is downloaded automatically)

Any loaded model can be saved back out with **Export as project**.

## Running it

It is a static site with no build step. Browsers block `fetch` from `file://` pages, so serve the
folder over HTTP:

```sh
npm start            # node tools/serve.mjs, then open http://localhost:8080/
# or: python3 -m http.server 8080
```

### GitHub Pages

Push the repository and enable **Settings → Pages → Deploy from a branch** with the branch root
(`/`) as the source. The `.nojekyll` file keeps Pages from running Jekyll over the files.

### Single file build

`npm run build:single` writes `dist/cpm-viewer.html` with the CSS, scripts and assets inlined, for
sharing as one file or opening straight from disk.

## Layout

```
index.html           page markup; loads three.js from jsDelivr and the scripts below in order
css/style.css        all styles (light and dark themes via CSS variables)
js/
  io.js              binary reader (IOHelper port), PNG decoder, ZIP reader
  assets.js          loads the files in assets/ (or ASSET_DATA in the single-file build)
  model.js           model parts, cubes, root parts, render effects, definition building
  anim.js            animation engine: interpolators, triggers, staged animations,
                     legacy (ANIMATION_DATA) and new (ANIMATION_NEW) formats, gesture buttons
  project.js         .cpmproject loader (mirrors the editor exporter)
  vanilla.js         vanilla player animation (HumanoidModel.setupAnim) and the per-frame driver
  load.js            input detection: files, links, base64 text, skins with embedded models
  export.js          "Export as project" (.cpmproject writer, PNG and ZIP encoders)
  render.js          three.js scene, box meshes (BoxRender port), textures and transforms
  ui.js              page wiring and the frame loop
assets/textures/     CPM template textures (skin data layout, default skins, cape, elytra, armor)
assets/examples/     example model shown on first load
tools/               serve.mjs (dev server), build-single.mjs (single-file build)
test/                Node round-trip tests (npm test)
```

The scripts are plain `<script>` files that share one global scope, so their order in
`index.html` matters. They need no bundler.

## Tests

`npm test` loads the example project, writes it out in the new binary format, the legacy
binary format, as a skin pointing to linked data, and as an exported project. It then
checks every version animates identically through all gestures, toggles and sliders.
`test/writer.js` and `test/legacy_writer.js` mirror the mod's `write()` methods and exist only for
these tests. Pass extra project paths to test them too: `node test/run.js path/to/model.cpmproject`.

## Notes

- Links are downloaded directly. Gist and GitHub allow cross-origin requests; Pastebin needs a
  CORS proxy (set under "Network options"). When a download fails the page asks you to paste the
  data by hand.
- Templates, held items and the real armor/elytra/cape textures are not rendered.
