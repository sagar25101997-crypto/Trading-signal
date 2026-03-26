const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');
const app = express();
app.use(cors());

const CHANNELS = [
  { name: 'DAILY', token: '8517848241:AAFqisy45BmSTk9PpUWN2KxliyY3YTJ-Iqs', chatId: '-1003823176395' },
  { name: 'FVG',   token: '8748227924:AAG09vfNAI_O3T9b-E_aWTaeR81J4QDynCE', chatId: '-1003842429805' },
  { name: 'CRT',   token: '8379004300:AAEAmp9LoA5LTbIdxHoIpsKAmAVfUr0iapM', chatId: '-1003562279289' },
];

// In-memory cache — server jab tak live hai, messages yaad rakhta hai
const offsets = {};
const messageCache = {}; // chatId -> [{ text, timestamp }]
CHANNELS.forEach(ch => {
  offsets[ch.chatId] = 0;
  messageCache[ch.chatId] = [];
});

function telegramGet(token, method, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Telegram se naye messages fetch karo aur cache mein add karo
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
      // Cache mein add karo, duplicates avoid karo (timestamp+text key se)
      const existingKeys = new Set(
        messageCache[channel.chatId].map(m => `${m.timestamp}_${m.text}`)
      );
      newMsgs.forEach(m => {
        const key = `${m.timestamp}_${m.text}`;
        if (!existingKeys.has(key)) {
          messageCache[channel.chatId].push(m);
          existingKeys.add(key);
        }
      });

      // Last 200 messages rakho, purane hatao
      messageCache[channel.chatId].sort((a, b) => b.timestamp - a.timestamp);
      if (messageCache[channel.chatId].length > 200) {
        messageCache[channel.chatId] = messageCache[channel.chatId].slice(0, 200);
      }

      console.log(`📨 ${channel.name}: ${newMsgs.length} new msg(s), cache=${messageCache[channel.chatId].length}`);
    }

    if (data.result.length > 0) {
      offsets[channel.chatId] = data.result[data.result.length - 1].update_id + 1;
    }
  } catch(e) {
    console.error(`Poll error ${channel.name}:`, e.message);
  }
}

// Har 5 second mein sabhi channels poll karo
async function pollAll() {
  for (const ch of CHANNELS) {
    await pollChannel(ch);
  }
}
setInterval(pollAll, 5000);

// Startup pe ek baar turant poll karo
pollAll().then(() => console.log('✅ Initial poll done'));

// Routes — cache se return karo (server restart pe bhi cached data hai jab tak process live hai)
app.get('/daily', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'DAILY');
  res.json({ messages: messageCache[ch.chatId] });
});

app.get('/fvg', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'FVG');
  res.json({ messages: messageCache[ch.chatId] });
});

app.get('/crt', (req, res) => {
  const ch = CHANNELS.find(c => c.name === 'CRT');
  res.json({ messages: messageCache[ch.chatId] });
});

app.get('/reset', (req, res) => {
  CHANNELS.forEach(ch => { offsets[ch.chatId] = 0; });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
