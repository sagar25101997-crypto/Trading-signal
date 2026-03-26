const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');
const app = express();
app.use(cors());

const CHANNELS = [
  { name: 'DAILY SIGNAL', token: '8517848241:AAFqisy45BmSTk9PpUWN2KxliyY3YTJ-Iqs', chatId: '-1003823176395' },
  { name: 'FVG SIGNAL',   token: '8748227924:AAG09vfNAI_O3T9b-E_aWTaeR81J4QDynCE', chatId: '-1003842429805' },
  { name: 'CRT SIGNAL',   token: '8379004300:AAEAmp9LoA5LTbIdxHoIpsKAmAVfUr0iapM', chatId: '-1003562279289' },
];

// Har channel ka offset track karo
const offsets = {};

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

// Server start hote hi sabka offset reset karo (purane messages skip)
async function initOffsets() {
  for (const ch of CHANNELS) {
    try {
      const data = await telegramGet(ch.token, 'getUpdates', {
        limit: 100,
        allowed_updates: JSON.stringify(['message', 'channel_post'])
      });
      if (data.ok && data.result.length > 0) {
        // Sabse last update ka offset set karo — purane sab skip
        const lastId = data.result[data.result.length - 1].update_id;
        offsets[ch.chatId] = lastId + 1;
        // Telegram ko bhi batao — consume kar lo purane
        await telegramGet(ch.token, 'getUpdates', {
          offset: offsets[ch.chatId],
          limit: 1,
          allowed_updates: JSON.stringify(['message', 'channel_post'])
        });
        console.log(`✅ ${ch.name} offset set: ${offsets[ch.chatId]}`);
      } else {
        offsets[ch.chatId] = 0;
        console.log(`✅ ${ch.name} no old messages`);
      }
    } catch(e) {
      offsets[ch.chatId] = 0;
      console.log(`⚠️ ${ch.name} offset init failed:`, e.message);
    }
  }
  console.log('🚀 All offsets initialized — only NEW messages will show!');
}

// GET /signals — sirf naye messages return karo
app.get('/signals', async (req, res) => {
  try {
    const results = await Promise.all(CHANNELS.map(async (ch) => {
      try {
        const params = {
          limit: 50,
          allowed_updates: JSON.stringify(['message', 'channel_post'])
        };
        // Offset set hai toh naye messages hi lo
        if (offsets[ch.chatId]) {
          params.offset = offsets[ch.chatId];
        }

        const data = await telegramGet(ch.token, 'getUpdates', params);
        if (!data.ok) return { name: ch.name, chatId: ch.chatId, messages: [], error: data.description };

        const messages = data.result.filter(u => {
          const msg = u.message || u.channel_post;
          return msg && String(msg.chat.id) === ch.chatId;
        }).reverse();

        // Offset update karo next call ke liye
        if (data.result.length > 0) {
          const lastId = data.result[data.result.length - 1].update_id;
          offsets[ch.chatId] = lastId + 1;
        }

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

// GET /reset — manually reset karo (optional)
app.get('/reset', async (req, res) => {
  await initOffsets();
  res.json({ ok: true, message: 'Offsets reset! Sirf naye signals dikhenge.' });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('Server running on port', PORT);
  await initOffsets(); // Server start hote hi purane messages skip karo
});
