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

// Common function to get messages from a channel
async function getChannelMessages(channel) {
  try {
    const params = {
      limit: 50,
      allowed_updates: JSON.stringify(['message', 'channel_post'])
    };
    if (offsets[channel.chatId]) {
      params.offset = offsets[channel.chatId];
    }

    const data = await telegramGet(channel.token, 'getUpdates', params);
    if (!data.ok) return [];

    const messages = data.result
      .filter(u => {
        const msg = u.message || u.channel_post;
        return msg && String(msg.chat.id) === channel.chatId;
      })
      .map(u => {
        const msg = u.message || u.channel_post;
        return {
          text: msg.text || msg.caption || '',
          timestamp: msg.date,
          update_id: u.update_id
        };
      })
      .filter(m => m.text)
      .reverse();

    // Offset update karo next call ke liye
    if (data.result.length > 0) {
      const lastId = data.result[data.result.length - 1].update_id;
      offsets[channel.chatId] = lastId + 1;
    }

    return messages;
  } catch(e) {
    console.error(`Error fetching ${channel.name}:`, e.message);
    return [];
  }
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
        const lastId = data.result[data.result.length - 1].update_id;
        offsets[ch.chatId] = lastId + 1;
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

// ========== INDIVIDUAL ENDPOINTS FOR EACH CHANNEL ==========
app.get('/daily', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'DAILY');
  if (!channel) return res.json({ messages: [] });
  const messages = await getChannelMessages(channel);
  res.json({ messages });
});

app.get('/fvg', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'FVG');
  if (!channel) return res.json({ messages: [] });
  const messages = await getChannelMessages(channel);
  res.json({ messages });
});

app.get('/crt', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'CRT');
  if (!channel) return res.json({ messages: [] });
  const messages = await getChannelMessages(channel);
  res.json({ messages });
});

// GET /signals — Combined endpoint (backward compatibility)
app.get('/signals', async (req, res) => {
  try {
    const results = await Promise.all(CHANNELS.map(async (ch) => {
      const messages = await getChannelMessages(ch);
      return { name: ch.name, chatId: ch.chatId, messages };
    }));
    res.json({ ok: true, channels: results });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /reset — manually reset karo
app.get('/reset', async (req, res) => {
  await initOffsets();
  res.json({ ok: true, message: 'Offsets reset! Sirf naye signals dikhenge.' });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('🚀 Server running on port', PORT);
  console.log('📡 Endpoints:');
  console.log('   GET /daily  - DAILY channel signals');
  console.log('   GET /fvg    - FVG channel signals');
  console.log('   GET /crt    - CRT channel signals');
  console.log('   GET /signals - All channels combined');
  console.log('   GET /reset  - Reset offsets');
  await initOffsets();
});
