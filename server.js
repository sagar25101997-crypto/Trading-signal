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

async function initOffsets() {
  for (const ch of CHANNELS) {
    try {
      const data = await telegramGet(ch.token, 'getUpdates', { limit: 100 });
      if (data.ok && data.result.length > 0) {
        const lastId = data.result[data.result.length - 1].update_id;
        offsets[ch.chatId] = lastId + 1;
        await telegramGet(ch.token, 'getUpdates', { offset: offsets[ch.chatId], limit: 1 });
        console.log(`✅ ${ch.name} offset set`);
      } else {
        offsets[ch.chatId] = 0;
        console.log(`✅ ${ch.name} no old messages`);
      }
    } catch(e) {
      offsets[ch.chatId] = 0;
      console.log(`⚠️ ${ch.name} init failed`);
    }
  }
}

async function getChannelMessages(channel) {
  try {
    const params = { limit: 50 };
    if (offsets[channel.chatId]) params.offset = offsets[channel.chatId];
    const data = await telegramGet(channel.token, 'getUpdates', params);
    if (!data.ok) return [];
    const messages = data.result
      .filter(u => {
        const msg = u.message || u.channel_post;
        return msg && String(msg.chat.id) === channel.chatId;
      })
      .map(u => {
        const msg = u.message || u.channel_post;
        return { text: msg.text || msg.caption || '', timestamp: msg.date };
      })
      .filter(m => m.text)
      .reverse();
    if (data.result.length > 0) {
      offsets[channel.chatId] = data.result[data.result.length - 1].update_id + 1;
    }
    return messages;
  } catch(e) {
    return [];
  }
}

app.get('/daily', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'DAILY');
  const messages = await getChannelMessages(channel);
  res.json({ messages });
});

app.get('/fvg', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'FVG');
  const messages = await getChannelMessages(channel);
  res.json({ messages });
});

app.get('/crt', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'CRT');
  const messages = await getChannelMessages(channel);
  res.json({ messages });
});

app.get('/reset', async (req, res) => {
  await initOffsets();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('Server running on port', PORT);
  await initOffsets();
});
