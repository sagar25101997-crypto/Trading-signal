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

// Store open signals in memory (so they survive refresh)
let openSignalsStore = {
  DAILY: [],
  FVG: [],
  CRT: []
};

// Store closed signals history
let closedSignalsStore = {
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
function parseSignalFromText(text) {
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

// Process messages and update open/closed signals
function processMessages(channelName, messages) {
  const newOpenSignals = [];
  const newClosedSignals = [];
  
  messages.forEach(msg => {
    const parsed = parseSignalFromText(msg.text);
    if (parsed && parsed.dir && parsed.pair) {
      const hitType = parseTPSL(msg.text);
      
      if (hitType === 'tp' || hitType === 'sl') {
        // This is a close signal - remove from open and add to closed
        const existingIndex = openSignalsStore[channelName].findIndex(s => 
          s.pair === parsed.pair && s.dir === parsed.dir
        );
        if (existingIndex !== -1) {
          const closedSignal = {
            ...openSignalsStore[channelName][existingIndex],
            hitType: hitType,
            pnl: hitType === 'tp' ? 100 : -50,
            closedAt: msg.timestamp
          };
          closedSignalsStore[channelName].unshift(closedSignal);
          openSignalsStore[channelName].splice(existingIndex, 1);
          newClosedSignals.push(closedSignal);
        }
      } else {
        // This is a new open signal
        const exists = openSignalsStore[channelName].some(s => 
          s.pair === parsed.pair && s.dir === parsed.dir
        );
        if (!exists) {
          const newSignal = {
            ...parsed,
            ts: msg.timestamp,
            id: Date.now() + Math.random(),
            isNew: true,
            hitType: null,
            pnl: null,
            rawText: msg.text
          };
          openSignalsStore[channelName].unshift(newSignal);
          newOpenSignals.push(newSignal);
        }
      }
    }
  });
  
  // Keep only last 100 open signals
  if (openSignalsStore[channelName].length > 100) {
    openSignalsStore[channelName] = openSignalsStore[channelName].slice(0, 100);
  }
  
  // Keep only last 200 closed signals
  if (closedSignalsStore[channelName].length > 200) {
    closedSignalsStore[channelName] = closedSignalsStore[channelName].slice(0, 200);
  }
  
  return { newOpenSignals, newClosedSignals };
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

    // Process messages to update open/closed signals
    if (messages.length > 0) {
      processMessages(channel.name, messages);
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
        
        // Also process old messages to populate open signals
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
          processMessages(ch.name, oldMessages);
          console.log(`📊 ${ch.name}: Loaded ${openSignalsStore[ch.name].length} open signals from history`);
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
}

// ========== INDIVIDUAL ENDPOINTS FOR EACH CHANNEL ==========
app.get('/daily', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'DAILY');
  if (!channel) return res.json({ messages: [], openSignals: [] });
  
  // Fetch new messages (updates offset)
  await getChannelMessages(channel);
  
  // Return open signals + recent messages for raw display
  const recentMessages = await getChannelMessages(channel);
  
  res.json({ 
    messages: recentMessages,
    openSignals: openSignalsStore['DAILY']
  });
});

app.get('/fvg', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'FVG');
  if (!channel) return res.json({ messages: [], openSignals: [] });
  
  await getChannelMessages(channel);
  const recentMessages = await getChannelMessages(channel);
  
  res.json({ 
    messages: recentMessages,
    openSignals: openSignalsStore['FVG']
  });
});

app.get('/crt', async (req, res) => {
  const channel = CHANNELS.find(c => c.name === 'CRT');
  if (!channel) return res.json({ messages: [], openSignals: [] });
  
  await getChannelMessages(channel);
  const recentMessages = await getChannelMessages(channel);
  
  res.json({ 
    messages: recentMessages,
    openSignals: openSignalsStore['CRT']
  });
});

// GET /signals — Combined endpoint
app.get('/signals', async (req, res) => {
  try {
    const results = await Promise.all(CHANNELS.map(async (ch) => {
      await getChannelMessages(ch);
      return { 
        name: ch.name, 
        chatId: ch.chatId, 
        messages: [],
        openSignals: openSignalsStore[ch.name],
        closedSignals: closedSignalsStore[ch.name]
      };
    }));
    res.json({ ok: true, channels: results });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /open-signals — Get all open signals
app.get('/open-signals', async (req, res) => {
  res.json({
    DAILY: openSignalsStore['DAILY'],
    FVG: openSignalsStore['FVG'],
    CRT: openSignalsStore['CRT']
  });
});

// GET /history — Get closed signals
app.get('/history', async (req, res) => {
  res.json({
    DAILY: closedSignalsStore['DAILY'],
    FVG: closedSignalsStore['FVG'],
    CRT: closedSignalsStore['CRT']
  });
});

// GET /reset — manually reset offsets AND clear stores
app.get('/reset', async (req, res) => {
  // Clear stores
  openSignalsStore = { DAILY: [], FVG: [], CRT: [] };
  closedSignalsStore = { DAILY: [], FVG: [], CRT: [] };
  
  // Reset offsets
  await initOffsets();
  res.json({ ok: true, message: 'Offsets reset! Open signals cleared. New signals will appear.' });
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
  console.log('   GET /signals      - All channels combined');
  console.log('   GET /open-signals - Get all open signals');
  console.log('   GET /history      - Get closed signals history');
  console.log('   GET /reset        - Reset offsets and clear stores');
  await initOffsets();
  
  console.log('\n📊 Current open signals:');
  console.log(`   DAILY: ${openSignalsStore['DAILY'].length} open`);
  console.log(`   FVG:   ${openSignalsStore['FVG'].length} open`);
  console.log(`   CRT:   ${openSignalsStore['CRT'].length} open`);
});
