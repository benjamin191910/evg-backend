const express = require('express');
const axios   = require('axios');
const session = require('express-session');
const path    = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// ── Servir el HTML como página principal ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Sesiones ──────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'evg-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

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
    req.session.discord = {
      id:       u.id,
      username: u.username,
      avatar:   u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.discriminator || 0) % 5}.png`
    };
    res.redirect(`${FRONTEND}?discord_ok=1`);
  } catch (err) {
    console.error('Discord OAuth error:', err.response?.data || err.message);
    res.redirect(`${FRONTEND}?error=discord_failed`);
  }
});

app.post('/auth/roblox', async (req, res) => {
  if (!req.session.discord) return res.status(401).json({ error: 'No Discord session' });
  const { username } = req.body;
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
    req.session.roblox = {
      id: userId, username: robloxUser.name, avatar: avatarUrl,
      skins, value: 0, coins: 0, trades: 0
    };
    res.json({ ok: true, roblox: req.session.roblox });
  } catch (err) {
    console.error('Roblox error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al conectar con Roblox' });
  }
});

app.get('/session', (req, res) => {
  res.json({ discord: req.session.discord || null, roblox: req.session.roblox || null });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EVG Backend corriendo en puerto ${PORT}`));
