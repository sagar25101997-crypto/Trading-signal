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
let openSignals = { DAILY: [], FVG: [], CRT: [] };

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

// Parse signal
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
  if (/TP\s*[12]?\s*(HIT|REACHED|DONE)|TARGET\s*(HIT|REACHED)/.test(t)) return 'tp';
  if (/SL\s*(HIT|REACHED|TRIGGERED)|STOP\s*LOSS\s*(HIT|TRIGGERED)/.test(t)) return 'sl';
  return null;
}

// Process messages and update openSignals
function processMessages(channelName, messages) {
  messages.forEach(msg => {
    const parsed = parseSignal(msg.text);
    if (parsed && parsed.dir && parsed.pair) {
      const hitType = parseTPSL(msg.text);
      
      if (hitType === 'tp' || hitType === 'sl') {
        // Remove closed signal
        openSignals[channelName] = openSignals[channelName].filter(s => 
          !(s.pair === parsed.pair && s.dir === parsed.dir)
        );
        console.log(`❌ ${channelName}: ${parsed.dir} ${parsed.pair} CLOSED (${hitType})`);
      } else {
        // Add new open signal
        const exists = openSignals[channelName].some(s => 
          s.pair === parsed.pair && s.dir === parsed.dir
        );
        if (!exists) {
          openSignals[channelName].unshift({
            ...parsed,
            ts: msg.timestamp,
            id: Date.now() + Math.random(),
            hitType: null,
            pnl: null
          });
          console.log(`✅ ${channelName}: NEW ${parsed.dir} ${parsed.pair} @ ${parsed.entry}`);
        }
      }
    }
  });
  
  // Keep only last 100
  if (openSignals[channelName].length > 100) {
    openSignals[channelName] = openSignals[channelName].slice(0, 100);
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

    // Process messages to update openSignals
    if (messages.length > 0) {
      processMessages(channel.name, messages);
    }

    if (data.result.length > 0) {
      offsets[channel.chatId] = data.result[data.result.length - 1].update_id + 1;
    }

    return messages;
  } catch(e) {
    console.error(`Error ${channel.name}:`, e.message);
    return [];
  }
}

async function initOffsets() {
  for (const ch of CHANNELS) {
    try {
      const data = await telegramGet(ch.token, 'getUpdates', { limit: 100 });
      if (data.ok && data.result.length > 0) {
        const lastId = data.result[data.result.length - 1].update_id;
        offsets[ch.chatId] = lastId + 1;
        
        // Load old messages into openSignals
        const oldMessages = data.result
          .filter(u => {
            const msg = u.message || u.channel_post;
            return msg && String(msg.chat.id) === ch.chatId;
          })
          .map(u => {
            const msg = u.message || u.channel_post;
            return { text: msg.text || msg.caption || '', timestamp: msg.date };
          })
          .filter(m => m.text);
        
        if (oldMessages.length > 0) {
          processMessages(ch.name, oldMessages);
          console.log(`📊 ${ch.name}: Loaded ${openSignals[ch.name].length} open signals`);
        }
        
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
  console.log(`\n📊 Current open signals:`);
  console.log(`   DAILY: ${openSignals.DAILY.length}`);
  console.log(`   FVG:   ${openSignals.FVG.length}`);
  console.log(`   CRT:   ${openSignals.CRT.length}`);
}

// Endpoints
app.get('/daily', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'DAILY');
  const messages = await getChannelMessages(channel);
  res.json({ messages, openSignals: openSignals.DAILY });
});

app.get('/fvg', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'FVG');
  const messages = await getChannelMessages(channel);
  res.json({ messages, openSignals: openSignals.FVG });
});

app.get('/crt', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'CRT');
  const messages = await getChannelMessages(channel);
  res.json({ messages, openSignals: openSignals.CRT });
});

app.get('/open-signals', (req, res) => res.json(openSignals));

app.get('/reset', async (req, res) => {
  openSignals = { DAILY: [], FVG: [], CRT: [] };
  await initOffsets();
  res.json({ ok: true, message: 'Reset complete' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('🚀 Server running on port', PORT);
  await initOffsets();
});
