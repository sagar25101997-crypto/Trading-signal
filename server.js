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
const CLOSED_FILE = path.join(__dirname, 'closed_signals.json');

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

function loadClosedSignals() {
  try {
    if (fs.existsSync(CLOSED_FILE)) {
      return JSON.parse(fs.readFileSync(CLOSED_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveClosedSignals(closed) {
  try { fs.writeFileSync(CLOSED_FILE, JSON.stringify(closed), 'utf8'); } catch(e) {}
}

let messageCache = loadCache();
let closedSignals = loadClosedSignals();
const offsets = {};
CHANNELS.forEach(ch => { offsets[ch.chatId] = 0; });

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

function parseSignal(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  let dir = null;
  if (/\bBUY\b/.test(t)) dir = 'buy';
  else if (/\bSELL\b/.test(t)) dir = 'sell';
  const pm = text.match(/\b([A-Z]{3}[\/\.]?[A-Z]{3})\b/i) || text.match(/\b([A-Z]{6})\b/);
  const pair = pm ? pm[1].toUpperCase().replace(/[\/\.]/g, '') : null;
  if (!dir && !pair) return null;
  return { dir, pair };
}

function parseTPSL(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  if (/TP\s*[12]?\s*(HIT|REACHED|DONE)|TARGET\s*(HIT|REACHED)|🎯/.test(t)) return 'tp';
  if (/SL\s*(HIT|REACHED|TRIGGERED)|STOP\s*LOSS\s*(HIT|TRIGGERED)|STOPPED\s*OUT|❌/.test(t)) return 'sl';
  return null;
}

function extractPairFromTPSL(text) {
  if (!text) return null;
  let m = text.match(/(?:TP|SL)\s*(?:HIT|REACHED|TRIGGERED)\s*[:\-·]\s*([A-Z]{3,8})/i);
  if (m) return m[1].toUpperCase().replace(/[\/\.]/g, '');
  m = text.match(/(?:TP|SL)\s*(?:HIT|REACHED|TRIGGERED)\s+([A-Z]{3,8})/i);
  if (m) return m[1].toUpperCase().replace(/[\/\.]/g, '');
  m = text.match(/\b([A-Z]{3}[\/\.]?[A-Z]{3})\b/i) || text.match(/\b([A-Z]{6})\b/);
  return m ? m[1].toUpperCase().replace(/[\/\.]/g, '') : null;
}

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

    // Process TP/SL hits and mark signals as closed
    for (const msg of newMsgs) {
      const hitType = parseTPSL(msg.text);
      if (hitType) {
        const hitPair = extractPairFromTPSL(msg.text);
        if (hitPair) {
          if (!closedSignals[channel.chatId]) closedSignals[channel.chatId] = [];
          const key = `${hitPair}_${hitType}`;
          if (!closedSignals[channel.chatId].includes(key)) {
            closedSignals[channel.chatId].push(key);
            saveClosedSignals(closedSignals);
            console.log(`🔒 ${channel.name}: ${hitPair} marked as ${hitType} closed`);
          }
        }
      }
    }

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
        messageCache[channel.chatId].sort((a, b) => b.timestamp - a.timestamp);
        messageCache[channel.chatId] = messageCache[channel.chatId].slice(0, 200);
        saveCache(messageCache);
      }
    }

    if (data.result.length > 0) {
      offsets[channel.chatId] = data.result[data.result.length - 1].update_id + 1;
    }
  } catch(e) {
    console.error(`Poll error ${channel.name}:`, e.message);
  }
}

// Filter out closed signals before sending to frontend
function filterClosedSignals(channel, messages) {
  const closed = closedSignals[channel.chatId] || [];
  return messages.filter(msg => {
    const parsed = parseSignal(msg.text);
    if (parsed && parsed.pair) {
      const key = `${parsed.pair}_tp`; // Check if this pair was closed
      if (closed.includes(key)) return false;
    }
    return true;
  });
}

async function pollAll() {
  for (const ch of CHANNELS) await pollChannel(ch);
}

setInterval(pollAll, 5000);
pollAll().then(() => console.log('✅ Initial poll done'));

app.get('/daily', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'DAILY');
  const messages = filterClosedSignals(ch, messageCache[ch.chatId] || []);
  res.json({ messages });
});
app.get('/fvg', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'FVG');
  const messages = filterClosedSignals(ch, messageCache[ch.chatId] || []);
  res.json({ messages });
});
app.get('/crt', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'CRT');
  const messages = filterClosedSignals(ch, messageCache[ch.chatId] || []);
  res.json({ messages });
});

app.get('/reset', (req, res) => {
  CHANNELS.forEach(ch => { offsets[ch.chatId] = 0; });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
