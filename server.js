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

// Store open signals in memory
let openSignals = {
  DAILY: [],
  FVG: [],
  CRT: []
};

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

// Parse signal from text
function parseSignal(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  let dir = null;
  if (/\bBUY\b/.test(t)) dir = 'buy';
  else if (/\bSELL\b/.test(t)) dir = 'sell';
  const pm = text.match(/\b([A-Z]{3}[\/\.]?[A-Z]{3})\b/i) || text.match(/\b([A-Z]{6})\b/);
  const pair = pm ? pm[1].toUpperCase().replace(/[\/\.]/g, '') : null;
  const em = text.match(/(?:ENTRY|PRICE|@)\s*[:\-]?\s*([0-9]+\.?[0-9]*)/i);
  const sm = text.match(/(?:SL|STOP[- ]?LOSS)\s*[:\-]?\s*([0-9]+\.?[0-9]*)/i);
  const tm = text.match(/(?:TP\s*[12]?|TAKE[- ]?PROFIT\s*[12]?)\s*[:\-]?\s*([0-9]+\.?[0-9]*)/i);
  const entry = em ? em[1] : null, sl = sm ? sm[1] : null, tp = tm ? tm[1] : null;
  if (!dir && !pair) return null;
  let rr = null;
  if (entry && sl && tp) {
    const e = parseFloat(entry), sv = parseFloat(sl), t2 = parseFloat(tp);
    const risk = Math.abs(e - sv), reward = Math.abs(t2 - e);
    if (risk > 0) rr = '1:' + (reward / risk).toFixed(1);
  }
  return { dir, pair, entry, sl, tp, rr };
}

function parseTPSL(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  if (/TP\s*[12]?\s*(HIT|REACHED|DONE)|TARGET\s*(HIT|REACHED)|🎯/.test(t)) return 'tp';
  if (/SL\s*(HIT|REACHED|TRIGGERED)|STOP\s*LOSS\s*(HIT|TRIGGERED)|STOPPED\s*OUT|❌/.test(t)) return 'sl';
  return null;
}

// Update open signals from messages
function updateOpenSignals(channelName, messages) {
  messages.forEach(msg => {
    const parsed = parseSignal(msg.text);
    if (parsed && parsed.dir && parsed.pair) {
      const hitType = parseTPSL(msg.text);
      
      if (hitType === 'tp' || hitType === 'sl') {
        // Remove closed signal
        openSignals[channelName] = openSignals[channelName].filter(s => 
          !(s.pair === parsed.pair && s.dir === parsed.dir)
        );
      } else {
        // Add new open signal (avoid duplicates)
        const exists = openSignals[channelName].some(s => 
          s.pair === parsed.pair && s.dir === parsed.dir
        );
        if (!exists) {
          openSignals[channelName].unshift({
            ...parsed,
            ts: msg.timestamp,
            id: Date.now() + Math.random(),
            isNew: true,
            hitType: null,
            pnl: null
          });
        }
      }
    }
  });
  
  // Keep only last 50 open signals
  if (openSignals[channelName].length > 50) {
    openSignals[channelName] = openSignals[channelName].slice(0, 50);
  }
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

    // Update open signals with new messages
    if (messages.length > 0) {
      updateOpenSignals(channel.name, messages);
    }

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

// Server start hote hi sabka offset reset karo
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
        
        // Load old messages into open signals
        const oldMessages = data.result
          .filter(u => {
            const msg = u.message || u.channel_post;
            return msg && String(msg.chat.id) === ch.chatId;
          })
          .map(u => {
            const msg = u.message || u.channel_post;
            return {
              text: msg.text || msg.caption || '',
              timestamp: msg.date
            };
          })
          .filter(m => m.text);
        
        if (oldMessages.length > 0) {
          updateOpenSignals(ch.name, oldMessages);
          console.log(`📊 ${ch.name}: Loaded ${openSignals[ch.name].length} open signals from history`);
        }
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
  console.log(`\n📊 Current open signals:`);
  console.log(`   DAILY: ${openSignals.DAILY.length} open`);
  console.log(`   FVG:   ${openSignals.FVG.length} open`);
  console.log(`   CRT:   ${openSignals.CRT.length} open`);
}

// ========== ENDPOINTS (HTML ke liye same) ==========
app.get('/daily', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'DAILY');
  if (!channel) return res.json({ messages: [] });
  const messages = await getChannelMessages(channel);
  res.json({ messages, openSignals: openSignals.DAILY });
});

app.get('/fvg', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'FVG');
  if (!channel) return res.json({ messages: [] });
  const messages = await getChannelMessages(channel);
  res.json({ messages, openSignals: openSignals.FVG });
});

app.get('/crt', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'CRT');
  if (!channel) return res.json({ messages: [] });
  const messages = await getChannelMessages(channel);
  res.json({ messages, openSignals: openSignals.CRT });
});

// GET /open-signals — Get all open signals
app.get('/open-signals', async (req, res) => {
  res.json(openSignals);
});

// GET /reset — manually reset offsets
app.get('/reset', async (req, res) => {
  // Clear open signals
  openSignals = { DAILY: [], FVG: [], CRT: [] };
  await initOffsets();
  res.json({ ok: true, message: 'Offsets reset! Open signals cleared.' });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('🚀 Server running on port', PORT);
  console.log('📡 Endpoints:');
  console.log('   GET /daily        - DAILY channel signals + open signals');
  console.log('   GET /fvg          - FVG channel signals + open signals');
  console.log('   GET /crt          - CRT channel signals + open signals');
  console.log('   GET /open-signals - Get all open signals');
  console.log('   GET /reset        - Reset offsets');
  await initOffsets();
});
