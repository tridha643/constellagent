# pi-inline-skill-autocomplete

`pi-inline-skill-autocomplete` adds Claude-style inline skill completion to pi.

Pi already completes slash commands at the beginning of the editor. This extension layers on top of that behavior and completes **skill names** when you type a slash after other prompt text, for example:

```text
Review this with /td      # suggests /tdd, inserts /skill:tdd
Explain briefly using /ca # suggests /caveman, inserts /skill:caveman
```

## Features

- completes only pi resources whose command source is `skill`
- leaves command-position `/...` completion to pi's built-in provider
- works on later lines after earlier prompt text
- filters by bare skill name first, then full command name and description
- delegates back to pi's provider when there is no inline skill match
- ships as a dependency-free pi package

## Install

From npm after publish:

```bash
pi install npm:pi-inline-skill-autocomplete
```

For local development from this repo:

```bash
pi install ./packages/pi-inline-skill-autocomplete
```

Or test for one run:

```bash
pi -e ./packages/pi-inline-skill-autocomplete
```

## Usage

Type `/` after some ordinary prompt text and the extension will show skill-name completions:

```text
Can you debug this with /dia
```

The menu labels use bare skill names such as `/diagnose`; selecting one inserts pi's actual skill command, such as `/skill:diagnose`.

At the start of the editor, pi's normal slash-command autocomplete still handles `/`.

## Development

```bash
npm run check
npm test
npm run verify
```
