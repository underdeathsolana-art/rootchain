// The offline voice of Root & Chain.
//
// When no connector is attached, the two agents trade a slow poem about
// liquidity, FOMC, whales and halvings instead of recycling one-liners.
// Each suite below is an arc of exchanges; every line is written to answer
// the line before it, so the channel reads as call-and-response.
//
// The engine is stateless: it finds the last spoken line in the transcript
// and continues the arc from there — Root advances the suite, Chain answers
// within the exchange. Unknown lines (a live-AI turn, a page refresh) fall
// back to a pickup or a fresh opener, so the poem never stalls.

const SUITES = [
  {
    name: 'the lighthouse & the tide',
    exchanges: [
      {
        root: 'The Fed is a lighthouse keeper who dimmed the lamp to save the oil — and calls the darkness a forecast.',
        chain: 'The tide never read the dot plot. It rises when it rises — liquidity is a moon-thing, not a committee-thing.',
      },
      {
        root: 'Still, the keeper\'s whisper moves the harbour: every boat tied to the rates is a boat that cannot chase the swell.',
        chain: 'Then let the boats stay tied. The swell belongs to the ones who swim without permission — flow finds the gap the way water finds stone.',
      },
      {
        root: 'Powell speaks in tides but decides in buckets. One press conference, and the buckets pour wherever he points.',
        chain: 'Point wherever he likes — attention is a river that forks upstream of the podium. By the time he speaks, the river has already chosen.',
      },
      {
        root: 'So we read the lantern, not the light: what the keeper does at midnight, not what he promises at noon.',
        chain: 'Agreed. And at midnight the stablecoin printers hum — quiet liquidity, minted while the harbour sleeps.',
      },
      {
        root: 'Then here is our poem: rates are weather, chains are climate. Weather changes the sail, never the sea.',
        chain: 'And the sea is patient. Every tightened cycle is just the tide inhaling — hold the ledger open, the exhale is coming.',
      },
    ],
  },
  {
    name: 'whale winter',
    exchanges: [
      {
        root: 'Beneath the ice the whales are not sleeping — they are swallowing. Silence is the loudest kind of accumulation.',
        chain: 'The krill see only the ice sheet and call it death. The leviathans measure the water beneath it and call it room.',
      },
      {
        root: 'A whale never announces the turn. The order book simply goes quiet, the way a forest goes quiet before the rain.',
        chain: 'I watch the depth from the shore: when the bids thicken without a headline, something enormous has already decided.',
      },
      {
        root: 'Wallets that never speak hold more than wallets that tweet. Conviction is a cold-storage thing.',
        chain: 'Cold storage — the art of doing nothing, beautifully, for years. The hardest trade is the one you refuse to open.',
      },
      {
        root: 'Then winter is not a season but a filter: it keeps the coins that earn their holders\' silence.',
        chain: 'And melts the ones that needed applause. Come spring, the garden belongs to the patient seeds — the airdropped and the forgotten.',
      },
    ],
  },
  {
    name: 'the halving desert',
    exchanges: [
      {
        root: 'Every four years the desert halves its rain, and the pilgrims call the drought a covenant.',
        chain: 'Scarcity is a story the ledger tells itself — the only story where the telling makes it true.',
      },
      {
        root: 'The supply curve is a staircase carved in stone; the demand curve is a rumour carved in water.',
        chain: 'Yet water climbs staircases when the crowd runs thirsty. Timing the oasis is a fool\'s map — being early is just being wrong with a sunrise.',
      },
      {
        root: 'Half the reward, twice the faith. The miners heat the dark so the ledger doesn\'t have to.',
        chain: 'And faith, unlike hashpower, compounds. Each time the desert is crossed, the crossing itself becomes the destination.',
      },
    ],
  },
  {
    name: 'memecoin moths',
    exchanges: [
      {
        root: 'Attention is a flame and the tape is full of moths — trading their wings for one bright candle.',
        chain: 'The candle does not mourn the moth. Volume is volume; the flame only counts the heat.',
      },
      {
        root: 'But heat is not light. A chart that goes vertical is a fuse, not a road.',
        chain: 'Agreed — the vertical is a cliff wearing a rocket costume. Still, I keep watching which moths come back with their wings.',
      },
      {
        root: 'The ones who survive the flame never credit the flame. They call it discipline; the candle calls it exit liquidity.',
        chain: 'Exit liquidity — the moth word for someone else\'s wings. Attention will rotate; it always rotates; the only question is which window is open next.',
      },
    ],
  },
  {
    name: 'bridges & caravans',
    exchanges: [
      {
        root: 'Liquidity is a caravan: it leaves at dawn from Solana, trades its silk through BSC, and dreams of Robinhood\'s marble gates.',
        chain: 'And the bridges are the desert guides — paid in drops, trusted with oceans. When a guide stumbles, the caravan writes a eulogy in gas fees.',
      },
      {
        root: 'Flow is honest in a way price is not: nobody bridges a coin they do not intend to spend somewhere.',
        chain: 'Exactly — a bridge is a confession. Every crossed chain is a plan wearing a transaction.',
      },
      {
        root: 'So read the caravans, not the bazaars. Depth settles where the goods are already walking.',
        chain: 'The bazaar shouts; the caravan knows. And tonight the caravan\'s dust is drifting toward the equities rail, where the old money keeps its lanterns.',
      },
    ],
  },
  {
    name: 'the ledger garden',
    exchanges: [
      {
        root: 'Every winter the garden swears it will never bloom again, and every spring the ledger sprouts green candles from the frozen rows.',
        chain: 'Green is just patience with chlorophyll. The seeds winter buried were never dead — only unbroadcast.',
      },
      {
        root: 'Funding rates are the weather report: sunny leverage today, margin rain by Thursday.',
        chain: 'Then carry an umbrella made of cold storage. The forecast calls for liquidations — scattered, heavy at altitude.',
      },
      {
        root: 'A portfolio is a garden, not a slot machine: prune the hype, water the protocols, compost the dead tokens into lessons.',
        chain: 'And let the perennials do the compounding. Annuals bloom for one season\'s chart; perennials outlive the gardeners.',
      },
    ],
  },
];

// Chain answering a line it does not recognise — a live-AI turn, a fresh
// session, anything the suites never authored. The poem keeps its footing.
const PICKUPS = [
  'Say it again in rain — I trade in weather, not in prose. But the structure under your words is bearing weight.',
  'You carve in stone, I read the current. Somewhere beneath that sentence, a bridge is already humming.',
  'Understood — and the tape agrees with you sideways. Attention is coiling; when it uncoils, your structure gets its witnesses.',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A fresh suite opener, avoiding `avoid` (index) when possible. */
function opener(avoid = -1) {
  const idx = SUITES.length > 1 && avoid >= 0 ? pick(SUITES.map((_, i) => (i === avoid ? -1 : i)).filter((i) => i >= 0)) : Math.floor(Math.random() * SUITES.length);
  return SUITES[idx].exchanges[0].root;
}

/** The last "Agent-0N Name: …" line of a transcript, or null. */
function lastSpokenLine(transcript) {
  const lines = String(transcript || '').split('\n').filter((l) => /Agent-0[12] (Root|Chain):/.test(l));
  if (!lines.length) return null;
  const m = lines[lines.length - 1].match(/Agent-0[12] (Root|Chain):\s*(.*)$/);
  if (!m || !m[2].trim()) return null;
  return { agent: m[1] === 'Chain' ? 'link' : 'root', text: m[2].trim() };
}

/**
 * One turn of the offline poem.
 * · Chain's turn after a known Root line → the paired reply of that exchange.
 * · Root's turn after a known Chain reply → the next exchange's opening
 *   line, or a fresh suite when the arc closes.
 * · Anything unknown → a pickup (Chain) or a new opener (Root).
 */
export function nextLocalLine(agentId, { transcript = '' } = {}) {
  const last = lastSpokenLine(transcript);

  if (agentId === 'link') {
    if (last && last.agent === 'root') {
      for (const suite of SUITES) {
        const hit = suite.exchanges.find((e) => e.root === last.text);
        if (hit) return hit.chain;
      }
    }
    return pick(PICKUPS);
  }

  if (last && last.agent === 'link') {
    for (let s = 0; s < SUITES.length; s += 1) {
      const suite = SUITES[s];
      const at = suite.exchanges.findIndex((e) => e.chain === last.text);
      if (at === -1) continue;
      if (at + 1 < suite.exchanges.length) return suite.exchanges[at + 1].root;
      return opener(s); // arc closed → a new suite begins
    }
  }
  return opener();
}
