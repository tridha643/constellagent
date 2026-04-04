# Universal Orchestrator — Manual Testing

## Prerequisites

1. **Claude Code logged in**: Run `claude login` and complete auth
2. **SendBlue account**: Get your key ID and secret key from the [sendblue.co](https://sendblue.co) dashboard
3. **Tunnel URL**: Set up a public tunnel to your local webhook port
   - Option A: `npx cloudflared tunnel --url http://localhost:3847`
   - Option B: `ngrok http 3847`
4. **SendBlue webhook**: Configure the tunnel URL as your webhook endpoint in SendBlue dashboard

## Setup Checklist

- [ ] `bun install` in `desktop/` (installs `@anthropic-ai/claude-code`)
- [ ] `bun run dev` — app starts without errors
- [ ] Orchestrator button (⬡) appears in sidebar footer
- [ ] Click Orchestrator — panel opens with "Idle" status badge
- [ ] Navigate to Settings — SendBlue section is visible

## Test Cases

### Test 1: UI Command via OrchestratorPanel

1. Open the Orchestrator panel
2. Type "Create a new feature branch for login page" in the command textarea
3. Press Enter or click Send
4. **Expected**: Message appears in thread, status transitions to "Running" then back to "Idle"
5. **Expected**: A session card appears in the Worktree Sessions column

### Test 2: SendBlue SMS Command (inbound)

1. Configure SendBlue settings (key ID, optional secret key, phone number, webhook URL, port)
2. Click "Start" in the Orchestrator panel
3. Send an SMS to the configured SendBlue number: "fix the failing tests"
4. **Expected**: Webhook receives the message, message appears in Orchestrator thread
5. **Expected**: Orchestrator creates task plan and displays sessions
6. **Expected**: You receive an SMS acknowledgment plus a queued-tasks summary

Manual inbound webhook simulation:

```bash
curl -X POST http://127.0.0.1:3847/ \
  -H 'Content-Type: application/json' \
  -d '{
    "from_number": "+15551234567",
    "content": "fix the failing tests"
  }'
```

### Test 3: SendBlue Outbound API Check

1. Complete Test 2 setup
2. Send a command that creates tasks, or click "Test" in Settings
3. **Expected**: Receive a SendBlue SMS from the configured `sendbluePhoneNumber`
4. **Expected**: SendBlue accepts `from_number` and both auth headers

Equivalent direct API call:

```bash
curl -X POST https://api.sendblue.co/api/send-message \
  -H 'Content-Type: application/json' \
  -H 'sb-api-key-id: YOUR_KEY_ID' \
  -H 'sb-api-secret-key: YOUR_SECRET_KEY' \
  -d '{
    "number": "+15551234567",
    "from_number": "+15557654321",
    "content": "Constellagent connected"
  }'
```

Note: queued-task SMS is implemented. True task-completion SMS is not wired yet because orchestrator task execution does not currently emit completion events.

### Test 4: Stop Orchestrator

1. Start the orchestrator (should show "Stop" button)
2. Click "Stop"
3. **Expected**: Webhook server stops, button changes to "Start"
4. **Expected**: Status returns to "Idle"

### Test 5: Invalid Command Handling

1. Open Orchestrator panel
2. Send an empty command (should be blocked by UI)
3. Force an error scenario (e.g., disconnect network)
4. **Expected**: Error message appears in thread, status shows "Error"

### Test 6: Settings Persistence

1. Configure all SendBlue settings in Settings panel
2. Quit and relaunch the app
3. **Expected**: All SendBlue settings are preserved

### Test 7: Test Connection Button

1. Enter a valid SendBlue key ID, optional secret key, and phone number in Settings
2. Click "Test" button in SendBlue section
3. **Expected**: Receive a test SMS saying "Constellagent connected"
4. **Expected**: Toast notification confirms "Test message sent via SendBlue"

## Troubleshooting

- **"Start" button disabled**: Ensure a SendBlue key ID is configured in Settings
- **No webhook messages**: Verify tunnel is running and URL is configured in SendBlue dashboard
- **Outbound send fails**: Confirm the SendBlue line is entered as `sendbluePhoneNumber` and that your key ID / secret key match the SendBlue dashboard
- **Claude Code SDK errors**: Ensure `claude login` has been completed
- **Port conflict on 3847**: Change the webhook port in Settings
