# MCP Dock Catalog

Catalog of MCP servers for [MCP Dock](https://github.com/OmniAI-Stack/MCP-Dock). One YAML file per server holds the install settings and the texts in six languages. A build script checks the files and turns them into the JSON the app reads. Every server is reviewed before it is listed.

> [!NOTE]
> Early prototype. The file format may still change. MCP Dock downloads the published `dist/` from this repository, checks the signature of `manifest.json` and the checksum of every file, and keeps the copy on disk. For testing, the app can also read a catalog from a folder (Settings → Server catalog); that folder is not signed.

## Technologies

| What | Used for |
|---|---|
| **YAML** (1.2) | The sources people edit: servers, publishers, categories, tags. Easy to read, allows comments, has no brackets and quotes everywhere. |
| **JSON** | The generated files in `dist/` that the app reads. JSON is what the app (Rust and TypeScript) parses natively, so the app needs no YAML library. Nobody edits it. |
| **Node.js** (ES modules, tested with 22 and 24) | Runs the build script `scripts/build.mjs` and the starter `scripts/run.mjs`. Uses only built-in modules (`node:fs`, `node:path`, `node:crypto`, `node:child_process`) plus one package. |
| **npm** | Runs the commands (`npm run build`, `npm run check`, `npm run keygen`, `npm run release`) and installs the package. |
| **`yaml` package** (2.8.1) | The only dependency. Reads the YAML files. Pinned to an exact version. |
| **SHA-256** | The checksums in `manifest.json` and `index.json` (`node:crypto`). They show that a file was not changed or damaged. |
| **Ed25519** | The signature of `manifest.json` (`dist/manifest.sig`), made and checked with `node:crypto`. The private key stays on the maintainer's computer, the public key is in this repository and in the app. See "Signing". |
| **Git and GitHub** | Versioning, review of pull requests, tags of the published catalogs. |

`dist/` is served as plain files from this repository (`raw.githubusercontent.com`), the app downloads it from there.

There is no database, no server and no framework: the catalog is plain files, and everything the build needs is in this repository.

## Layout

```
servers/<publisher>/<id>.yaml   one file per server, grouped by who publishes it
publishers.yaml                 publisher slug → name and homepage
categories.yaml                 the fixed list of categories, names in six languages
tags.yaml                       the fixed list of tags, names in six languages
scripts/build.mjs               checks the sources and generates dist/
scripts/run.mjs                 entry of `npm run build`: installs the packages on the first run, then runs build.mjs
scripts/keygen.mjs              creates the signing key pair, once (`npm run keygen`)
scripts/sign.mjs                signs dist/manifest.json and verifies the signature (`npm run sign`)
scripts/signing.mjs             helpers shared by the two signing scripts
package.json                    the commands (`build`, `check`, `keygen`, `sign`, `release`), one dependency (`yaml`)
signing-public-key.txt          the public key (created by keygen, committed, built into the app)
_private/                       the private key and private notes, ignored by git, exists only on the maintainer's computer
dist/                           generated JSON for the app, never edited by hand (manifest.sig is the signature)
.gitattributes                  forces LF line endings, so the checksums stay valid on every computer
```

Servers are grouped by publisher (`servers/google/`, `servers/modelcontextprotocol/`). The folder is only for order: the server `id` is unique in the whole catalog and does not depend on the folder, so a server can move without breaking anybody's installation.

## Build

Run these in a terminal in the repository folder. `npm run build` installs the packages itself on the first run, so no separate `npm install` is needed. Node.js is required.

```
npm run build     # checks and writes dist/ (installs packages on the first run)
npm run check     # checks the sources and verifies the signature (CI)
npm run keygen    # once, maintainer only: creates the signing key pair
npm run release   # maintainer only: build and sign, use this before publishing
```

The build fails when a file is wrong, and it says what to do about it. A mistyped category or tag gets a "Did you mean ...?" and the exact line to add to `tags.yaml` or `categories.yaml`. When the build fails, `dist/` is left untouched. It fails for example on: a missing English text, an unknown category, tag or publisher, a `publisher` that differs from the folder name, a duplicate `id`, a `{{placeholder}}` without an input.

## What the build does

You edit only the YAML files. `npm run build` reads them and writes the folder `dist/` from scratch. Step by step:

1. **Reads** `categories.yaml`, `publishers.yaml` and every `servers/<publisher>/<id>.yaml`.
2. **Checks** them (the rules above). On the first problem it prints it and stops, `dist/` stays as it was.
3. **Writes one detail file per server**, `dist/servers/<id>.json`: the whole server in one place (install settings plus the texts in all languages). The app opens it when the user opens that server.
4. **Writes the list of servers**, `dist/index.json`: one short line per server (id, name, publisher, category, tags, verified, short English summary, checksum of its detail file). The app shows the whole list from this one small file, without opening any detail.
5. **Writes the list of short summaries per language**, `dist/index.<lang>.json` (`cs`, `de`, `es`, `fr`, `pt`): just `id → summary` in that language. The app loads only the language it is set to and puts it over the English summary from the list.
6. **Writes the names** for filters and labels: `dist/categories.json`, `dist/tags.json` and `dist/publishers.json`.
7. **Writes `dist/manifest.json` last**: the catalog version, the schema number, the minimum app version, the number of servers and a checksum of every other file. The app reads this file first to know what it has. `npm run release` then signs it (`dist/manifest.sig`).

With the two servers in the catalog now the result is:

```
dist/
  manifest.json            version 2026.11.06.1, 2 servers, checksums
  index.json               2 lines: filesystem, google-stitch
  index.cs.json            { "filesystem": "AI čte a zapisuje soubory ...", "google-stitch": "Návrh ..." }
  index.de.json  index.es.json  index.fr.json  index.pt.json
  categories.json          9 categories, names in 6 languages
  tags.json                4 tags, names in 6 languages
  publishers.json          google, modelcontextprotocol
  servers/
    filesystem.json        everything about Filesystem
    google-stitch.json     everything about Google Stitch
```

The files exist so the app never has to download everything at once. With thousands of servers it loads `manifest.json`, `index.json` and one `index.<lang>.json` (a few hundred kB) and fetches a server's detail only when it is opened.

Never edit `dist/` by hand: the next build overwrites it. The catalog version changes only when some file really changed, so building twice in a row gives the same result.

## A server file

`servers/google/google-stitch.yaml`, shortened. Every line is explained in the comment after it:

```yaml
id: google-stitch            # unique id of the server in the whole catalog. Lowercase letters, digits, dashes. Saved in users' settings, so never change it once published
name: Google Stitch          # name shown to the user and written as the key into the AI app's config (brand name, never translated)
legacyNames: [stitch]        # optional: older names this server was installed under, so MCP Dock can find and clean up old entries
publisher: google            # who publishes the server. Must equal the folder name (servers/google/) and exist in publishers.yaml
homepage: https://stitch.withgoogle.com   # page of the product or the server, opened from the detail
verified: true               # true when the maintainers have checked the command, package and address
category: design             # exactly one main category, from categories.yaml (files, design, development, data, web, ...)
tags: [design, ui]           # keywords for search and filters, any number, but only from tags.yaml (the build stops on an unknown tag)
requires: [node]             # optional: what must be installed on the computer first (not needed here, the server is remote)

transport:                   # HOW the AI app talks to the server. Technical data, never translated
  type: remote-http          # remote-http = a server on the internet; stdio = a program started on this computer (command + args)
  url: https://stitch.googleapis.com/mcp   # address of the remote server (https only)
  headers:                   # HTTP headers sent with every request
    - name: X-Goog-Api-Key   # header name
      value: "{{apiKey}}"    # {{id}} is replaced by what the user typed into the input with that id. Keep the quotes

inputs:                      # what the user has to fill in when adding the server
  - id: apiKey               # id of the field, used as {{apiKey}} above and as the key in texts below
    secret: true             # true = a key or password: hidden in the form and stored in the Windows Credential Manager, not in a file
    placeholder: AQ...       # optional: grey example shown in the empty field
                             # other options: optional: true (may stay empty), kind: folder (system folder picker), multiple: true (more values, e.g. several folders)

test:                        # optional: "Test connection" button
  tool: list_projects        # name of a harmless read-only tool of the server that MCP Dock calls to check that the key works

texts:                       # everything the user reads. One block per language
  en:                        # English is required, other languages are optional (a missing one falls back to English)
    summary: AI design of user interfaces.     # one short line, shown on the card in the list
    description: Google Stitch designs user interfaces with AI. ...   # the full description, shown in the detail
    input:                   # texts of the fields from inputs, by the field id
      apiKey:
        label: API key       # name of the field in the form
        help: Create the API key in the Google Stitch app.   # one line of help under the field
  cs:                        # the same structure in Czech; de, es, fr and pt work the same way
    summary: Návrh uživatelských rozhraní pomocí AI.
    ...
```

Rules:

- English (`texts.en`) is required, with `summary` and `description` and a `label` for every input. Other languages (`cs`, `de`, `es`, `fr`, `pt`) are optional; a missing text falls back to English.
- Never put secrets, API keys or personal paths into a file. A value the user has to enter is an `inputs` entry.
- Pin the version of every package, no `latest`. The build does not check this yet and Filesystem is still unpinned, so for now it is a rule for the reviewer.
- Commands are limited to well-known launchers (`npx`, `uvx`, `node` and similar), also checked by the reviewer, not by the build. MCP Dock shows the exact command and, for remote servers, the domain the key is sent to, always from the technical data and never from translated text.
- Server names are brand names and are not translated.
- Quote values YAML could misread, such as `"{{apiKey}}"` and language codes like `"no"`.

## Categories and tags

Both are fixed lists. A server cannot use a category or a tag that is not on the list, so the same thing is never written in different ways (`ui`, `UI`, `user-interface`) and every name exists in all six languages.

| | Category | Tag |
|---|---|---|
| Meaning | The one main drawer the server belongs to | Extra keywords, as many as fit |
| Per server | exactly one (`category: design`) | any number (`tags: [design, ui]`) |
| List | `categories.yaml` | `tags.yaml` |
| Names | `en`, `cs`, `de`, `es`, `fr`, `pt`, all six required | the same |
| Generated file | `dist/categories.json` | `dist/tags.json` |

A list entry looks the same in both files. The key is the id used in the server file, the value is the name the user sees in each language:

```yaml
ui: { en: UI, cs: UI, de: UI, es: UI, fr: UI, pt: UI }
```

**Check during the build.** `npm run build` compares every `category` and every tag of every server with the lists:

- A name that is on the list passes.
- A name that is not on the list stops the build. Nothing is written, `dist/` stays as it was, and the build tells you the file, the unknown name, a "Did you mean ...?" for a likely typo, the line to add to the list and the names that exist.
- Each list entry must have all six languages and an id of lowercase letters, digits and dashes, otherwise the build stops too.

Example of what you see when a server uses a tag that is not on the list:

```
The catalog was NOT built: 1 problem(s). dist/ was left as it was.

1. servers/google/google-stitch.yaml
   tag "usability" is not in tags.yaml, so the catalog was NOT built
   How to fix: If it is really a new tag, add it to tags.yaml with its name in all six languages:
    usability: { en: ..., cs: ..., de: ..., es: ..., fr: ..., pt: ... }
  Known tags: design, ui, files, local
```

**Adding a new tag or category:** add one line to `tags.yaml` or `categories.yaml` with all six names, then run `npm run build` again. A new entry goes in only when no existing one fits. Reusing an existing one is preferred, so the lists stay short.

**How it is shown.** The build passes the lists to the app in `dist/categories.json` and `dist/tags.json`, and every server carries its category and tags in `dist/index.json`. The app writes the name in the language the user has chosen. Showing categories and tags in the Discover page (labels and filters) is planned and not in the app yet, so for now they are only carried in the data.

## Adding a new server

What you touch, in order:

1. **Pick the publisher.** This is who makes the server (a company, a project or a person), as a lowercase slug, for example `github`, `notion`, `modelcontextprotocol`.
   - Publisher already exists: look in `publishers.yaml`.
   - New publisher: add it to `publishers.yaml` with a `name` and a `homepage`:
  
     ```yaml
     notion:
       name: Notion
       homepage: https://www.notion.so
     ```
     
2. **Create the file** `servers/<publisher>/<id>.yaml`. Create the folder `servers/<publisher>/` when it does not exist. The easiest start is to copy an existing file with the same kind of transport: `servers/google/google-stitch.yaml` for a remote server with a key, `servers/modelcontextprotocol/filesystem.yaml` for a program started on the computer.
3. **Fill it in** as described in "A server file" above. The values of `publisher`, `category` and `tags` must exist in the lists, and the build checks that:
   - `id` is new and unique in the whole catalog (the build refuses a duplicate), `publisher` equals the folder name.
   - `category` is one of the ids in `categories.yaml`. A category that is missing there is added there first, with the name in all six languages (otherwise the build fails).
   - `tags` come only from `tags.yaml`. A tag that is missing there is added there first, with the name in all six languages. Use existing tags where they fit. The build stops on an unknown tag, tells you which one and prints the line to add.
   - `transport` and `inputs`: everything the user has to type is an input, and it is used as `{{id}}` in the `transport`. Never write a key, a token or a personal path into the file.
   - Pin the package version in the command (`@scope/package@1.2.3`).
   - `texts.en` with `summary`, `description` and a `label` for every input. Add `cs`, `de`, `es`, `fr` and `pt` too if you can, otherwise the user sees English.
4. **Build:** `npm run build`. The build checks the new file and writes `dist/`. It compares the `publisher`, the `category` and every tag with `publishers.yaml`, `categories.yaml` and `tags.yaml` (see "Categories and tags"). If one of them is missing there, the build stops, says which one and prints the line to add. Add it to the list, then run the build again, until it prints `OK`.
5. **Try it in MCP Dock:** Settings → Server catalog → Choose catalog folder, pick this repository. The new server appears in Discover. Open it, fill in the inputs and use Test connection where the server has a `test`.
6. **Publish.** `dist/` is generated, but it is committed, because the app reads it, and it must be signed. The maintainer runs `npm run release` and commits the YAML files together with `dist/` (including `manifest.sig`). A contributor sends only the new `servers/<publisher>/<id>.yaml` and the changed `publishers.yaml`, `categories.yaml` or `tags.yaml` if any, in a pull request; `dist/` is built and signed by the maintainer after the merge.

Checklist before you send it:

- [ ] the file is in `servers/<publisher>/` and `publisher` equals that folder name
- [ ] the publisher is in `publishers.yaml`, the category in `categories.yaml`, every tag in `tags.yaml`
- [ ] `id` is unique and will not change
- [ ] no secrets or personal paths, the package version is pinned
- [ ] `texts.en` is complete
- [ ] `npm run check` passes (the maintainer builds and signs `dist/` with `npm run release` after the merge)
- [ ] the server installs and, if it has a `test`, the test passes in MCP Dock

Changing an existing server is the same without steps 1 and 2. Removing one means deleting its file and building again. Do not rename the `id` of a server that was already published, add a new file instead and keep the old name in `legacyNames` when the name shown to the user changed.

## Signing

The app only trusts a catalog whose `dist/manifest.json` is signed. The signature (`dist/manifest.sig`, Ed25519) covers the exact bytes of the manifest, and the manifest lists the SHA-256 of every other file, so one signature protects the whole catalog. The public key is in `signing-public-key.txt` and is built into the app. The private key stays in the folder `_private/`, which git ignores, so it never reaches the repository.

- `npm run keygen` creates the key pair once. It refuses to overwrite an existing key and to put the key anywhere in the repository except `_private/`.
- `npm run release` builds `dist/` and signs it. Use it instead of `npm run build` before every publish, then commit `dist/` including `manifest.sig`.
- `npm run check` validates the sources and verifies the signature.
- Only the maintainer who holds the private key can publish a catalog the app accepts. A contributor's pull request changes sources only.
- Losing the private key means a new app version with a new public key. The app can trust several keys at once for the switch.

## Versions of the catalog

- The catalog version is a date and a counter, `YYYY.MM.DD.N` (for example `2026.11.06.1`). The build bumps it only when the content changed, so building twice gives the same version.
- `schema` is a separate whole number that changes only when the generated format breaks. An app that does not know the schema refuses the catalog and keeps the one it has.
- `minAppVersion` in the manifest tells which app version can read the catalog.
- A server has no version of its own: its checksum in `index.json` is enough to know it changed. The package version a server starts is pinned inside its `transport`.
- Planned: every published catalog gets a Git tag (`catalog-2026.11.06.1`), so an older state can be restored. Not done yet.

## Contributing

Open a pull request with one new or changed file in `servers/<publisher>/`. A maintainer checks the command, package and address before anything is merged. Changes to the install settings are always reviewed. A change that touches only `texts` is the quickest to approve. By submitting a pull request you agree that your contribution is licensed under the same license as this repository.

## License

[PolyForm Shield License 1.0.0](LICENSE). In short: you may use, change and share this catalog for any purpose, except to provide a product that competes with MCP Dock or with another product OmniAI-Stack provides using it. This is a source-available license, not an open source license as defined by the OSI. See the license text for the exact terms, the text is the only thing that counts.

Required Notice: Copyright 2026 OmniAI-Stack
