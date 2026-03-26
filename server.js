const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(cors());

const CHANNELS = [
  { name: 'DAILY', token: '8517848241:AAFqisy45BmSTk9PpUWN2KxliyY3YTJ-Iqs', chatId: '-1003823176395' },
  { name: 'FVG',   token: '8748227924:AAG09vfNAI_O3T9b-E_aWTaeR81J4QDynCE', chatId: '-1003842429805' },
  { name: 'CRT',   token: '8379004300:AAEAmp9LoA5LTbIdxHoIpsKAmAVfUr0iapM', chatId: '-1003562279289' },
];

const DATA_FILE = path.join(__dirname, 'messages_cache.json');

// ── Persistent cache load/save ────────────────────────────────────────────────
function loadCache() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch(e) {}
  const empty = {};
  CHANNELS.forEach(ch => { empty[ch.chatId] = []; });
  return empty;
}

function saveCache(cache) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(cache), 'utf8'); } catch(e) {}
}

let messageCache = loadCache();
const offsets = {};
CHANNELS.forEach(ch => { offsets[ch.chatId] = 0; });

// ── Telegram helper ───────────────────────────────────────────────────────────
function telegramGet(token, method, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── Poll one channel, append to persistent cache ──────────────────────────────
async function pollChannel(channel) {
  try {
    const params = { limit: 100, timeout: 0 };
    if (offsets[channel.chatId] > 0) params.offset = offsets[channel.chatId];

    const data = await telegramGet(channel.token, 'getUpdates', params);
    if (!data.ok) return;

    const newMsgs = data.result
      .filter(u => {
        const msg = u.message || u.channel_post;
        return msg && String(msg.chat.id) === channel.chatId;
      })
      .map(u => {
        const msg = u.message || u.channel_post;
        return { text: msg.text || msg.caption || '', timestamp: msg.date };
      })
      .filter(m => m.text);

    if (newMsgs.length > 0) {
      if (!messageCache[channel.chatId]) messageCache[channel.chatId] = [];

      const existingKeys = new Set(
        messageCache[channel.chatId].map(m => `${m.timestamp}_${m.text}`)
      );
      let added = 0;
      newMsgs.forEach(m => {
        const key = `${m.timestamp}_${m.text}`;
        if (!existingKeys.has(key)) {
          messageCache[channel.chatId].push(m);
          existingKeys.add(key);
          added++;
        }
      });

      if (added > 0) {
        // Sort newest first, keep last 200
        messageCache[channel.chatId].sort((a, b) => b.timestamp - a.timestamp);
        messageCache[channel.chatId] = messageCache[channel.chatId].slice(0, 200);
        saveCache(messageCache);
        console.log(`📨 ${channel.name}: +${added} new, total=${messageCache[channel.chatId].length}`);
      }
    }

    if (data.result.length > 0) {
      offsets[channel.chatId] = data.result[data.result.length - 1].update_id + 1;
    }
  } catch(e) {
    console.error(`Poll error ${channel.name}:`, e.message);
  }
}

async function pollAll() {
  for (const ch of CHANNELS) await pollChannel(ch);
}

// Poll every 5 seconds
setInterval(pollAll, 5000);
pollAll().then(() => console.log('✅ Initial poll done'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/daily', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'DAILY');
  res.json({ messages: messageCache[ch.chatId] || [] });
});
app.get('/fvg', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'FVG');
  res.json({ messages: messageCache[ch.chatId] || [] });
});
app.get('/crt', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'CRT');
  res.json({ messages: messageCache[ch.chatId] || [] });
});

app.get('/reset', (req, res) => {
  CHANNELS.forEach(ch => { offsets[ch.chatId] = 0; });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
