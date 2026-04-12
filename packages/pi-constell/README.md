# PI Constell

PI Constell is a pi package that adds a Constellagent-friendly plan mode.

## What it does

- adds `/plan` read-only planning mode to pi
- exports valid plans to `.pi-constell/plans`
- writes Constellagent-compatible frontmatter:
  - `built: false`
  - `codingAgent: <provider/model>`
  - `buildHarness: pi-constell`
- emits Constellagent workspace notifications when pi is launched from Constellagent with `AGENT_ORCH_WS_ID` and `AGENT_ORCH_AGENT_TYPE=pi-constell`

## Install locally

From a repo where you want PI Constell available:

```bash
pi install -l /absolute/path/to/packages/pi-constell
```

Or globally:

```bash
pi install /absolute/path/to/packages/pi-constell
```

## Usage

```bash
pi /plan
```

Then ask pi to investigate and produce a markdown plan with a numbered `Plan` section.

When a valid plan is produced, PI Constell saves it under:

```text
.pi-constell/plans/
```

Constellagent can then discover the file via the Plans button or `⌘⇧M`.
