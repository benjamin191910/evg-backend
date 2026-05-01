const express = require('express');
const axios   = require('axios');
const path    = require('path');
const crypto  = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.set('trust proxy', 1);

// ── Almacén en memoria (funciona bien en Railway con 1 replica) ───────────────
const store = new Map();

function newToken() { return crypto.randomBytes(32).toString('hex'); }

// ── Servir HTML ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
//  DISCORD OAUTH
// ─────────────────────────────────────────────────────────────────────────────
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope:         'identify'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  const FRONTEND = process.env.FRONTEND_URL;
  if (!code) return res.redirect(`${FRONTEND}?error=no_code`);
  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenRes.data;
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const u = userRes.data;
    const token = newToken();
    store.set(token, {
      discord: {
        id:       u.id,
        username: u.username,
        avatar:   u.avatar
          ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.discriminator || 0) % 5}.png`
      },
      roblox: null
    });
    // Pasar token por URL al frontend
    res.redirect(`${FRONTEND}?discord_ok=1&token=${token}`);
  } catch (err) {
    console.error('Discord error:', err.response?.data || err.message);
    res.redirect(`${FRONTEND}?error=discord_failed`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROBLOX
// ─────────────────────────────────────────────────────────────────────────────
app.post('/auth/roblox', async (req, res) => {
  const { username, token } = req.body;
  const sess = store.get(token);
  if (!sess || !sess.discord) return res.status(401).json({ error: 'Sin sesión de Discord' });
  if (!username) return res.status(400).json({ error: 'Username requerido' });
  try {
    const userRes = await axios.post(
      'https://users.roblox.com/v1/usernames/users',
      { usernames: [username], excludeBannedUsers: true }
    );
    const robloxUser = userRes.data.data?.[0];
    if (!robloxUser) return res.status(404).json({ error: 'Usuario de Roblox no encontrado' });
    const userId = robloxUser.id;
    const avatarRes = await axios.get(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    const avatarUrl = avatarRes.data.data?.[0]?.imageUrl || '';
    let skins = 0;
    try {
      const invRes = await axios.get(
        `https://inventory.roblox.com/v2/users/${userId}/inventory?assetTypes=19&limit=100&sortOrder=Desc`,
        { headers: { 'Accept': 'application/json' } }
      );
      skins = invRes.data.data?.length || 0;
    } catch (_) {}
    sess.roblox = { id: userId, username: robloxUser.name, avatar: avatarUrl, skins, value: 0, coins: 0, trades: 0 };
    store.set(token, sess);
    res.json({ ok: true, roblox: sess.roblox });
  } catch (err) {
    console.error('Roblox error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al conectar con Roblox' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  SESIÓN / LOGOUT
// ─────────────────────────────────────────────────────────────────────────────
app.get('/session', (req, res) => {
  const token = req.query.token;
  const sess  = store.get(token);
  if (!sess) return res.json({ discord: null, roblox: null });
  res.json({ discord: sess.discord, roblox: sess.roblox });
});

app.post('/logout', (req, res) => {
  const { token } = req.body;
  store.delete(token);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EVG Backend en puerto ${PORT}`));
