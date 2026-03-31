# 🎵 Discord Music Bot

Bot musik Discord yang mendukung YouTube dan Spotify. Deploy mudah ke Railway.

---

## ⚡ Fitur

- ▶️ Putar musik dari **YouTube** (URL & pencarian)
- 🎵 Putar dari **Spotify** (Track, Album, Playlist)
- 📋 Queue / antrian lagu
- 🔂 Loop lagu / 🔁 Loop queue
- 🔀 Shuffle antrian
- 🔊 Kontrol volume (0–200%)
- ⏸️ Pause / Resume / Skip / Stop
- 🎛️ Tombol interaktif di Discord

---

## 🛠️ Cara Setup

### 1. Discord Bot Token

1. Buka https://discord.com/developers/applications
2. Klik **New Application** → beri nama
3. Pergi ke tab **Bot** → klik **Add Bot**
4. Copy **Token** (simpan, ini = `DISCORD_TOKEN`)
5. Di bagian **Privileged Gateway Intents**, aktifkan:
   - ✅ `MESSAGE CONTENT INTENT`
   - ✅ `SERVER MEMBERS INTENT`
6. Pergi ke **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Embed Links`, `Read Message History`, `Use Slash Commands`
7. Copy URL dan invite bot ke server kamu

### 2. Spotify API

1. Buka https://developer.spotify.com/dashboard
2. Login → **Create App**
3. Isi nama & deskripsi → centang Terms → Create
4. Copy **Client ID** dan **Client Secret**

### 3. Deploy ke Railway

1. **Push ke GitHub** dulu:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/USERNAME/REPO.git
   git push -u origin main
   ```

2. Buka https://railway.app → **New Project** → **Deploy from GitHub Repo**

3. Pilih repo kamu

4. Klik **Variables** → tambahkan:
   | Key | Value |
   |-----|-------|
   | `DISCORD_TOKEN` | Token bot Discord kamu |
   | `SPOTIFY_CLIENT_ID` | Client ID Spotify |
   | `SPOTIFY_CLIENT_SECRET` | Client Secret Spotify |
   | `PREFIX` | `!` (atau bebas) |

5. Railway otomatis deploy! Cek **Logs** untuk memastikan bot online.

---

## 📋 Daftar Perintah

| Perintah | Alias | Deskripsi |
|----------|-------|-----------|
| `!play <lagu>` | `!p` | Putar dari YouTube atau Spotify URL |
| `!pause` | — | Jeda musik |
| `!resume` | `!r` | Lanjutkan musik |
| `!skip` | `!s` | Skip lagu saat ini |
| `!stop` | `!dc` | Stop & keluar voice channel |
| `!queue` | `!q` | Lihat antrian lagu |
| `!nowplaying` | `!np` | Info lagu yang sedang diputar |
| `!volume <0-200>` | `!vol` | Atur volume |
| `!loop` | — | Toggle loop lagu |
| `!loopqueue` | `!lq` | Toggle loop antrian |
| `!shuffle` | — | Acak antrian |
| `!remove <no>` | `!rm` | Hapus lagu dari antrian |
| `!help` | `!h` | Tampilkan bantuan |

---

## 💡 Contoh Penggunaan

```
!play Raisa Jatuh Hati
!play https://www.youtube.com/watch?v=xxxxx
!play https://open.spotify.com/track/xxxxx
!play https://open.spotify.com/playlist/xxxxx
!play https://open.spotify.com/album/xxxxx
!volume 80
!loop
!shuffle
```

---

## 🔧 Troubleshooting

**Bot tidak merespons?**
- Pastikan `MESSAGE CONTENT INTENT` aktif di Developer Portal
- Cek log di Railway

**Lagu tidak bisa diputar?**
- YouTube kadang memblokir; coba lagu lain
- Pastikan bot punya izin Speak di voice channel

**Spotify tidak bekerja?**
- Pastikan Client ID & Secret sudah benar
- Cek log Railway untuk error token
