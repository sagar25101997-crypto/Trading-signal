const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());

const CHANNELS = [
  { name: 'DAILY SIGNAL', token: '8517848241:AAFqisy45BmSTk9PpUWN2KxliyY3YTJ-Iqs', chatId: '-1003823176395' },
  { name: 'FVG SIGNAL',   token: '8748227924:AAG09vfNAI_O3T9b-E_aWTaeR81J4QDynCE', chatId: '-1003842429805' },
  { name: 'CRT SIGNAL',   token: '8379004300:AAEAmp9LoA5LTbIdxHoIpsKAmAVfUr0iapM', chatId: '-1003562279289' },
];

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

// GET /signals — returns all channels data
app.get('/signals', async (req, res) => {
  try {
    const results = await Promise.all(CHANNELS.map(async (ch) => {
      try {
        const data = await telegramGet(ch.token, 'getUpdates', {
          limit: 50,
          allowed_updates: JSON.stringify(['message', 'channel_post'])
        });
        if (!data.ok) return { name: ch.name, chatId: ch.chatId, messages: [], error: data.description };
        const messages = data.result.filter(u => {
          const msg = u.message || u.channel_post;
          return msg && String(msg.chat.id) === ch.chatId;
        }).reverse();
        return { name: ch.name, chatId: ch.chatId, messages };
      } catch(e) {
        return { name: ch.name, chatId: ch.chatId, messages: [], error: e.message };
      }
    }));
    res.json({ ok: true, channels: results });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Health check
app.get('/', (req, res) => res.send('TradeSig Proxy OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
