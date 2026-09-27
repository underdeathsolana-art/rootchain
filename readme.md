# Rootchain Terminal v1.0

An amber-CRT intelligence terminal. Two AI agents — **Agent-01 "Root"** and
**Agent-02 "Chain"** — hold a continuous, memory-backed conversation about
whatever topic you drop into `content/topics/current/`. You can watch them, or
type into the terminal and interrogate the system directly. The **daemon
mascot** (`public/mascot.jpg`) watches the channel from the side panel: it
bobs and flickers with the CRT, leans in while an agent composes, and dims
when the loop is paused.

**No built-in model key.** Root & Chain start on the local offline engine right
away; each user attaches their own AI through the **MCP connector** (`connect`
command) — an MCP server or any OpenAI-compatible endpoint. Registered
operators can also talk to each other live through the **relay chat**
(`chat <message>`), rendered in the same terminal feed.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router), JavaScript |
| UI | React 18 client components, hand-written CSS (no UI kit) |
| Fonts | system monospace stack — no external font/asset requests |
| State | React state + `localStorage` (session mirror + conversation mirror) |
| Storage | MongoDB when `MONGODB_URI` is set (Vercel + the MongoDB integration) — users, relay messages, presence and agent memory in the `rootchain` database; falls back to JSON files under `.data/` locally (`lib/store.js`) |
| AI | Bring-your-own via the MCP connector — MCP server (Streamable HTTP) or OpenAI-compatible endpoint, proxied through `/api/chat`; local offline engine when nothing is attached |

---

## Run it

```bash
cd rootchain-terminal
npm install
npm run dev
```

Open **http://localhost:3000**. No API key or `.env` file is needed — the
agents run on the local engine immediately.

Production build:

```bash
npm run build
npm start
```

### The MCP connector

Type `connect` in the terminal (or press **Connect AI**). Two link types:

| Type | Fields | Notes |
|---|---|---|
| **MCP server** | server URL (+ optional bearer token, tool picker) | Streamable HTTP transport. Chat-like tools are auto-detected from `tools/list`; you can pin one manually after a test. |
| **OpenAI-compatible** | base URL, model, optional API key | Works with OpenRouter, z.ai, OpenAI, Ollama (`http://localhost:11434/v1`), LM Studio, … |

Credentials live in the **browser's localStorage only** and are passed
per-request through the server proxy (never written to disk). `Test link`
probes the endpoint before you connect.

> Without a connector the terminal answers with the local conversation engine
> (status bar: **AI LINK: LOCAL ENGINE**); agent intelligence and memory fully
> form once your connector is linked (**MCP LIVE** / **API LIVE**). A failing
> connector degrades to the local engine for that turn and explains why.

### Agent context files (`skill.md` / `readme.md`)

Once your AI is linked, **you decide how Root & Chain talk**. Every operator
owns a pair of markdown files, edited right from the terminal:

| File | Role | Edit with |
|---|---|---|
| `readme.md` | Background of *this* terminal — who runs it, what it watches, who the audience is. Primes every live turn. | `readme` |
| `skill.md` | Behaviour instructions — language, tone, length, focus. **Overrides the terminal defaults** (including "English only") wherever they conflict. | `skill` |

- `context` previews both files (sizes, first line, when last saved)
- The files are stored server-side against your access code (MongoDB
  `agent_context` collection / `.data/agent_context.json` locally), so they
  follow your account, not your browser — max 4000 chars each
- The editor opens with a starter template when a file is empty; nothing is
  saved until you press **Save**, and the very next live AI turn uses the
  new content
- Without a connector the files simply wait — the local offline engine has
  its fixed lines and doesn't read prompts

### The operator relay (live chat)

Registered users talk to each other in terminal mode:

- `chat live` — **open the live relay terminal**: a second, dedicated terminal
  whose roster lists every registered user (● online / ○ offline). Typing
  there speaks directly on the relay; `who`, `clear` and `exit` work inside;
  ESC or "exit" returns to the agent terminal
- `chat <message>` — speak on the relay from the main terminal; `chat` shows
  who is online
- **Full history** — re-login replays the whole retained log (server caps the
  last 200 lines)
- **Colours** — every operator keeps a stable colour (hash of their name)
  on their lines, tags and roster entry; your own lines carry a soft tint
- **Mentions** — `@name` lights up in any line (names with spaces work);
  a mention of *you* highlights the whole line
- **Direct messages & private terminals** — `dm <name> <message>` (or
  `chat dm <name> [message]` from the main terminal) opens a **dedicated
  private terminal for that operator**: the channel bar at the top switches
  between `# relay` and every `@ peer` you talk to (roster names are
  clickable too), typing there goes straight to them, incoming lines light
  an unread badge, and ESC hops back through channels
- **Conversation topics** — inside a private terminal, `topic <text>` sets
  that channel's topic; it is stored server-side (sorted pair key) so both
  sides always see the same subject line under the channel bar
- Messages are capped at 280 chars with a ~1.2s per-user cooldown; usernames
  are resolved from access codes server-side, so nobody can impersonate
  another operator
- Delivery is a light 3s poll (`GET /api/relay?since=…`) with opaque string
  cursors — no WebSocket needed, which keeps it working on serverless hosts

### Database (MongoDB on Vercel)

Set `MONGODB_URI` in the project's environment (the Vercel MongoDB
integration does this automatically) and all storage moves to the
`rootchain` database — durable across instances. Without it, the app runs
on local JSON files. The active backend is shown in the relay header and
the `status` command (`MONGODB` / `FILE`), and returned as `store` by
`GET /api/relay`. Optional: `MONGODB_DB` overrides the database name.

> On Vercel's read-only filesystem the file fallback would be ephemeral —
> with MongoDB connected, users, relay history and agent memory persist.

---

## How it works

```
Boot / login ──▶ Terminal shell ──▶ Agent loop ──▶ your AI (MCP / API) ──▶ feed + memory
     │                 │                │              │
 localStorage       /api/topics      /api/chat    no connector? local engine
 (session +        (reads files)    (system prompt = persona + topic + memory)
  connector)
```

| Route | Method | What it does |
|---|---|---|
| `/api/topics` | GET | Reads `content/topics/{current,scheduled,archive}` from disk on every call |
| `/api/chat` | POST | Builds one agent's turn, calls the attached connector (or local engine), returns the line (+ mode) |
| `/api/connector` | POST | `action: test` probes a connector from the panel (validates, lists MCP tools) |
| `/api/context` | GET/POST | The operator's `skill.md` / `readme.md` pair — read it, or save one file with username+code |
| `/api/relay` | GET/POST | Operator live chat — poll messages + presence + registered roster (`since` cursor), send with username+code |
| `/api/memory` | GET/POST | Reads / appends conversation memory (`type: turn \| summary \| clear`) |
| `/api/session` | POST | `action: register` issues an access code · `action: login` verifies one |

**Agent loop.** The client alternates speakers (Root → Chain → Root …) every
~20s while the tab is visible, and on demand via `agents step` or the **Step**
button. Each turn sends the recent transcript + a memory digest to `/api/chat`,
which composes a persona-specific system prompt (see `lib/agents.js`).

---

## Terminal commands

| Command | Result |
|---|---|
| `help` | List every command |
| `status` | Terminal + module status |
| `agents` | Latest Root / Chain exchange · `agents on` · `agents off` · `agents step` |
| `connect` | Open the MCP connector panel — attach your own AI |
| `skill` | Edit **skill.md** — behaviour of the agents on live AI turns |
| `readme` | Edit **readme.md** — background context for this terminal |
| `context` | Show both context files and how they shape live AI turns |
| `chat live` | Open the live operator terminal (roster, colours, mentions, DMs) |
| `chat dm` | Open a private terminal with an operator: `chat dm <name> [message]` |
| `chat` | Relay to other operators: `chat <message>` · `chat` for presence |
| `topic` | Active topic from `content/topics/current/` |
| `bridge` | Solana → BSC → Robinhood route map |
| `register` | Open the access-code registration panel |
| `login` | Open the access-code login panel |
| `clear` | Wipe the buffer |
| `about` | What Rootchain is |
| `memory` | What the agents remember |

---

## Change things later

| I want to… | Edit |
|---|---|
| Change what the agents discuss | Drop/replace `.md` or `.txt` in `content/topics/current/` — the **first file alphabetically** is the active topic. No restart needed. |
| Retire a topic | Move the file into `content/topics/archive/` |
| Queue tomorrow's topic | Put it in `content/topics/scheduled/` (not read until promoted) |
| Tune the agents' voice | `lib/agents.js` — `AGENTS.*.brief` and the reply rules (per-operator overrides live in the `skill.md` / `readme.md` files) |
| Extend the local offline engine | `localReply()` in `app/api/chat/route.js` |
| Add connector link types | `lib/connector.js` (`callChatApi`, `callMcp`, `testConnector`) |
| Tune the relay / storage backends | `lib/store.js` (MongoDB + file fallback) |
| Test the Mongo path locally | `node scripts/memory-mongo.js` → `MONGODB_URI=<uri> npm run dev -- -p 3200` |
| Recolour the terminal | `app/globals.css` → the `:root` block (`--fg`, `--ch-link`, `--bg`, …) |
| Swap the mascot artwork | Replace `public/mascot.jpg` (portrait, ~600px wide works best); the amber tint and animations live in the `.mascot` rules in `app/globals.css` |
| Change the header / status copy | `components/StatusBar.js` and the `<header>` in `app/page.js` |
| Change the bridge route | `components/SidePanels.js` (bridge panel) + `BRIDGE_TEXT` in `app/page.js` |
| Wipe memory | Delete `.data/memory.json`, or POST `{ "type": "clear" }` to `/api/memory` |

---

## Quality coverage

- **Responsive** — desktop split view (channel + modules); below 1024px the
  modules move under a Channel / Topics / Memory / Bridge tab bar; down to 320px.
- **States** — boot loader, empty feed, completed turns; `thinking` indicator;
  transmission-error line; topic empty state; access-code error + success states.
- **Auth** — form validation (min length, code format), busy state, `role="alert"`
  errors, generated code with copy-to-clipboard, persisted session.
- **Accessibility** — semantic landmarks, labelled input, `role="log"` feed,
  visible focus rings, keyboard-operable controls, colour contrast ≥ 4.5:1 on the
  phosphor ramp, full `prefers-reduced-motion` fallback (typing + blink disabled).
- **No external assets** — no CDN fonts, icons or remote images; the only
  artwork is the local mascot (`/mascot.jpg`), so nothing breaks offline.
- **No invented metrics** — the bridge panel is a labelled route map, not fake live data.

---

## Deploy

Works on any Node host (Vercel, a VPS, Docker). Two things to remember:

1. No model key is needed on the host — every user brings their own AI through
   the connector, and credentials never touch the server's disk.
2. Set `MONGODB_URI` (Vercel MongoDB integration) so users, relay history and
   memory persist across instances. Without it the app falls back to a temp
   dir, which resets between serverless invocations — swap in a database or
   run on a persistent host if you need durability.
