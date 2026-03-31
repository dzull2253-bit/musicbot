const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const SpotifyWebApi = require('spotify-web-api-node');
const { token, spotifyClientId, spotifyClientSecret } = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Queue map per server
const queues = new Map();

// Spotify setup
const spotifyApi = new SpotifyWebApi({
  clientId: spotifyClientId,
  clientSecret: spotifyClientSecret,
});

async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    // Refresh before expiry
    setTimeout(refreshSpotifyToken, (data.body['expires_in'] - 60) * 1000);
    console.log('✅ Spotify token refreshed');
  } catch (err) {
    console.error('❌ Spotify token error:', err.message);
    setTimeout(refreshSpotifyToken, 60000);
  }
}

// ─── Queue Manager ──────────────────────────────────────────────
function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guild, voiceChannel, textChannel) {
  const queue = {
    guild,
    voiceChannel,
    textChannel,
    connection: null,
    player: null,
    songs: [],
    volume: 80,
    loop: false,
    loopQueue: false,
    playing: false,
  };
  queues.set(guild.id, queue);
  return queue;
}

// ─── Play Song ──────────────────────────────────────────────────
async function playSong(queue, song) {
  if (!song) {
    queue.playing = false;
    queue.connection?.destroy();
    queues.delete(queue.guild.id);
    queue.textChannel.send({ embeds: [makeEmbed('🎵 Queue Kosong', 'Bot keluar dari voice channel.', '#ff6b6b')] });
    return;
  }

  try {
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume?.setVolume(queue.volume / 100);

    queue.player.play(resource);
    queue.playing = true;

    const embed = new EmbedBuilder()
      .setColor('#1db954')
      .setTitle('▶️ Sekarang Diputar')
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: '⏱️ Durasi', value: song.duration || 'Live', inline: true },
        { name: '👤 Diminta oleh', value: song.requestedBy, inline: true },
        { name: '📺 Channel', value: song.channelName || 'Unknown', inline: true }
      )
      .setThumbnail(song.thumbnail)
      .setFooter({ text: `🎵 ${queue.songs.length > 1 ? `${queue.songs.length - 1} lagu di antrian` : 'Tidak ada lagu berikutnya'}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pause_resume').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('skip').setEmoji('⏭️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('queue').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    );

    queue.textChannel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('Play error:', err.message);
    queue.textChannel.send({ embeds: [makeEmbed('❌ Error', `Gagal memutar: ${song.title}\nSkip ke lagu berikutnya...`, '#ff4444')] });
    queue.songs.shift();
    playSong(queue, queue.songs[0]);
  }
}

// ─── Setup Player ───────────────────────────────────────────────
function setupPlayer(queue) {
  const player = createAudioPlayer();
  queue.player = player;
  queue.connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    if (queue.loop && queue.songs.length > 0) {
      playSong(queue, queue.songs[0]);
    } else if (queue.loopQueue && queue.songs.length > 0) {
      const finished = queue.songs.shift();
      queue.songs.push(finished);
      playSong(queue, queue.songs[0]);
    } else {
      queue.songs.shift();
      playSong(queue, queue.songs[0]);
    }
  });

  player.on('error', (err) => {
    console.error('Player error:', err.message);
    queue.songs.shift();
    playSong(queue, queue.songs[0]);
  });
}

// ─── Helper: Search YouTube ─────────────────────────────────────
async function searchYouTube(query) {
  const result = await ytSearch(query);
  return result.videos.slice(0, 1)[0] || null;
}

// ─── Helper: Resolve Spotify ────────────────────────────────────
async function resolveSpotify(url) {
  const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);
  const playlistMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
  const albumMatch = url.match(/album\/([a-zA-Z0-9]+)/);

  if (trackMatch) {
    const data = await spotifyApi.getTrack(trackMatch[1]);
    const track = data.body;
    return [{
      query: `${track.name} ${track.artists[0].name}`,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      thumbnail: track.album.images[0]?.url,
    }];
  }

  if (playlistMatch) {
    const data = await spotifyApi.getPlaylistTracks(playlistMatch[1], { limit: 50 });
    return data.body.items
      .filter(item => item.track)
      .map(item => ({
        query: `${item.track.name} ${item.track.artists[0].name}`,
        title: item.track.name,
        artist: item.track.artists.map(a => a.name).join(', '),
        thumbnail: item.track.album.images[0]?.url,
      }));
  }

  if (albumMatch) {
    const data = await spotifyApi.getAlbumTracks(albumMatch[1], { limit: 50 });
    const albumInfo = await spotifyApi.getAlbum(albumMatch[1]);
    return data.body.items.map(track => ({
      query: `${track.name} ${track.artists[0].name}`,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      thumbnail: albumInfo.body.images[0]?.url,
    }));
  }

  return null;
}

// ─── Helper: Make Embed ─────────────────────────────────────────
function makeEmbed(title, description, color = '#1db954') {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

// ─── Helper: Join Voice ─────────────────────────────────────────
async function ensureVoice(message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    message.reply({ embeds: [makeEmbed('❌ Error', 'Kamu harus join voice channel dulu!', '#ff4444')] });
    return null;
  }
  return voiceChannel;
}

// ─── COMMANDS ───────────────────────────────────────────────────
const prefix = process.env.PREFIX || '!';

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ── !play ──
  if (command === 'play' || command === 'p') {
    const voiceChannel = await ensureVoice(message);
    if (!voiceChannel) return;

    const query = args.join(' ');
    if (!query) return message.reply({ embeds: [makeEmbed('❌ Error', 'Masukkan nama lagu atau URL!', '#ff4444')] });

    const loading = await message.reply({ embeds: [makeEmbed('🔍 Mencari...', `Mencari: **${query}**`)] });

    let songs = [];

    try {
      // Detect Spotify
      if (query.includes('spotify.com')) {
        const spotifyTracks = await resolveSpotify(query);
        if (!spotifyTracks) return loading.edit({ embeds: [makeEmbed('❌ Error', 'URL Spotify tidak valid!', '#ff4444')] });

        loading.edit({ embeds: [makeEmbed('🎵 Spotify', `Mengambil ${spotifyTracks.length} lagu dari Spotify...`)] });

        // Only search first song immediately, rest async
        const first = spotifyTracks[0];
        const firstVideo = await searchYouTube(first.query);
        if (firstVideo) {
          songs.push({
            title: first.title || firstVideo.title,
            url: firstVideo.url,
            duration: firstVideo.duration?.timestamp || 'N/A',
            thumbnail: first.thumbnail || firstVideo.thumbnail,
            channelName: firstVideo.author?.name || 'Spotify',
            requestedBy: message.author.username,
            spotifyData: first,
          });
        }

        // Queue rest async
        (async () => {
          for (let i = 1; i < spotifyTracks.length; i++) {
            const track = spotifyTracks[i];
            const video = await searchYouTube(track.query);
            if (video) {
              const q = getQueue(message.guild.id);
              if (q) {
                q.songs.push({
                  title: track.title || video.title,
                  url: video.url,
                  duration: video.duration?.timestamp || 'N/A',
                  thumbnail: track.thumbnail || video.thumbnail,
                  channelName: video.author?.name || 'Spotify',
                  requestedBy: message.author.username,
                });
              }
            }
          }
          const q = getQueue(message.guild.id);
          if (q) q.textChannel.send({ embeds: [makeEmbed('✅ Spotify', `Berhasil menambahkan **${spotifyTracks.length}** lagu ke antrian!`)] });
        })();

      } else if (ytdl.validateURL(query)) {
        // Direct YouTube URL
        const info = await ytdl.getInfo(query);
        const details = info.videoDetails;
        songs.push({
          title: details.title,
          url: query,
          duration: new Date(parseInt(details.lengthSeconds) * 1000).toISOString().substr(11, 8).replace(/^00:/, ''),
          thumbnail: details.thumbnails.slice(-1)[0]?.url,
          channelName: details.ownerChannelName,
          requestedBy: message.author.username,
        });
      } else {
        // Search YouTube
        const video = await searchYouTube(query);
        if (!video) return loading.edit({ embeds: [makeEmbed('❌ Error', 'Lagu tidak ditemukan!', '#ff4444')] });
        songs.push({
          title: video.title,
          url: video.url,
          duration: video.duration?.timestamp || 'N/A',
          thumbnail: video.thumbnail,
          channelName: video.author?.name || 'Unknown',
          requestedBy: message.author.username,
        });
      }

      if (songs.length === 0) return loading.edit({ embeds: [makeEmbed('❌ Error', 'Lagu tidak ditemukan!', '#ff4444')] });

      let queue = getQueue(message.guild.id);

      if (!queue) {
        queue = createQueue(message.guild, voiceChannel, message.channel);
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        queue.connection = connection;
        setupPlayer(queue);
        queue.songs.push(...songs);
        await loading.delete().catch(() => {});
        playSong(queue, queue.songs[0]);
      } else {
        queue.songs.push(...songs);
        await loading.delete().catch(() => {});
        if (songs.length === 1) {
          message.channel.send({ embeds: [makeEmbed('✅ Ditambahkan', `**${songs[0].title}** ditambahkan ke antrian (#${queue.songs.length})`, '#1db954')] });
        }
      }

    } catch (err) {
      console.error('Play command error:', err.message);
      loading.edit({ embeds: [makeEmbed('❌ Error', `Terjadi kesalahan: ${err.message}`, '#ff4444')] });
    }
  }

  // ── !skip ──
  else if (command === 'skip' || command === 's') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    queue.player.stop();
    message.reply({ embeds: [makeEmbed('⏭️ Skip', 'Lagu di-skip!', '#ffd700')] });
  }

  // ── !stop ──
  else if (command === 'stop' || command === 'dc') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    queue.songs = [];
    queue.player.stop();
    queue.connection.destroy();
    queues.delete(message.guild.id);
    message.reply({ embeds: [makeEmbed('⏹️ Stop', 'Bot berhenti dan keluar dari voice channel.', '#ff6b6b')] });
  }

  // ── !pause ──
  else if (command === 'pause') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    if (queue.player.pause()) {
      message.reply({ embeds: [makeEmbed('⏸️ Pause', 'Musik dijeda.')] });
    }
  }

  // ── !resume ──
  else if (command === 'resume' || command === 'r') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    if (queue.player.unpause()) {
      message.reply({ embeds: [makeEmbed('▶️ Resume', 'Musik dilanjutkan.')] });
    }
  }

  // ── !queue ──
  else if (command === 'queue' || command === 'q') {
    const queue = getQueue(message.guild.id);
    if (!queue || queue.songs.length === 0) return message.reply({ embeds: [makeEmbed('📋 Queue', 'Antrian kosong.')] });

    const embed = new EmbedBuilder()
      .setColor('#1db954')
      .setTitle('📋 Antrian Musik')
      .setDescription(
        queue.songs.slice(0, 10).map((song, i) =>
          `${i === 0 ? '▶️' : `**${i}.**`} [${song.title}](${song.url}) \`${song.duration}\` — ${song.requestedBy}`
        ).join('\n')
      )
      .setFooter({ text: `Total: ${queue.songs.length} lagu | Loop: ${queue.loop ? '🔂 ON' : 'OFF'} | Queue Loop: ${queue.loopQueue ? '🔁 ON' : 'OFF'}` });

    if (queue.songs.length > 10) embed.addFields({ name: '...', value: `Dan ${queue.songs.length - 10} lagu lainnya` });
    message.reply({ embeds: [embed] });
  }

  // ── !volume ──
  else if (command === 'volume' || command === 'vol') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 200) return message.reply({ embeds: [makeEmbed('❌', 'Volume harus antara 0-200!', '#ff4444')] });
    queue.volume = vol;
    message.reply({ embeds: [makeEmbed('🔊 Volume', `Volume diatur ke **${vol}%**`)] });
  }

  // ── !loop ──
  else if (command === 'loop') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    queue.loop = !queue.loop;
    if (queue.loop) queue.loopQueue = false;
    message.reply({ embeds: [makeEmbed('🔂 Loop', `Loop lagu: **${queue.loop ? 'ON' : 'OFF'}**`)] });
  }

  // ── !loopqueue ──
  else if (command === 'loopqueue' || command === 'lq') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Bot tidak sedang memutar musik!', '#ff4444')] });
    queue.loopQueue = !queue.loopQueue;
    if (queue.loopQueue) queue.loop = false;
    message.reply({ embeds: [makeEmbed('🔁 Loop Queue', `Loop antrian: **${queue.loopQueue ? 'ON' : 'OFF'}**`)] });
  }

  // ── !shuffle ──
  else if (command === 'shuffle') {
    const queue = getQueue(message.guild.id);
    if (!queue || queue.songs.length < 2) return message.reply({ embeds: [makeEmbed('❌', 'Antrian terlalu sedikit untuk di-shuffle!', '#ff4444')] });
    const current = queue.songs.shift();
    queue.songs.sort(() => Math.random() - 0.5);
    queue.songs.unshift(current);
    message.reply({ embeds: [makeEmbed('🔀 Shuffle', 'Antrian berhasil di-acak!')] });
  }

  // ── !nowplaying ──
  else if (command === 'nowplaying' || command === 'np') {
    const queue = getQueue(message.guild.id);
    if (!queue || !queue.songs[0]) return message.reply({ embeds: [makeEmbed('❌', 'Tidak ada lagu yang sedang diputar!', '#ff4444')] });
    const song = queue.songs[0];
    message.reply({ embeds: [new EmbedBuilder()
      .setColor('#1db954')
      .setTitle('🎵 Sekarang Diputar')
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields({ name: '⏱️ Durasi', value: song.duration || 'N/A', inline: true }, { name: '👤 Diminta oleh', value: song.requestedBy, inline: true })
      .setThumbnail(song.thumbnail)
    ]});
  }

  // ── !remove ──
  else if (command === 'remove' || command === 'rm') {
    const queue = getQueue(message.guild.id);
    if (!queue) return message.reply({ embeds: [makeEmbed('❌', 'Antrian kosong!', '#ff4444')] });
    const index = parseInt(args[0]);
    if (isNaN(index) || index < 1 || index >= queue.songs.length) return message.reply({ embeds: [makeEmbed('❌', 'Nomor antrian tidak valid!', '#ff4444')] });
    const removed = queue.songs.splice(index, 1);
    message.reply({ embeds: [makeEmbed('🗑️ Dihapus', `**${removed[0].title}** dihapus dari antrian.`)] });
  }

  // ── !help ──
  else if (command === 'help' || command === 'h') {
    const embed = new EmbedBuilder()
      .setColor('#1db954')
      .setTitle('🎵 Music Bot — Daftar Perintah')
      .setDescription(`Prefix: \`${prefix}\``)
      .addFields(
        { name: '🎵 Pemutaran', value: [
          `\`${prefix}play <lagu/url>\` — Putar lagu dari YouTube/Spotify`,
          `\`${prefix}pause\` — Jeda musik`,
          `\`${prefix}resume\` — Lanjutkan musik`,
          `\`${prefix}skip\` — Skip lagu`,
          `\`${prefix}stop\` — Hentikan dan keluar`,
          `\`${prefix}nowplaying\` — Info lagu saat ini`,
        ].join('\n') },
        { name: '📋 Antrian', value: [
          `\`${prefix}queue\` — Lihat antrian`,
          `\`${prefix}shuffle\` — Acak antrian`,
          `\`${prefix}remove <nomor>\` — Hapus dari antrian`,
          `\`${prefix}loop\` — Loop lagu saat ini`,
          `\`${prefix}loopqueue\` — Loop seluruh antrian`,
        ].join('\n') },
        { name: '🔊 Lainnya', value: [
          `\`${prefix}volume <0-200>\` — Atur volume`,
          `\`${prefix}help\` — Tampilkan bantuan ini`,
        ].join('\n') },
        { name: '✅ Sumber yang Didukung', value: '🎥 YouTube URL & pencarian\n🎵 Spotify Track, Album & Playlist' }
      )
      .setFooter({ text: 'Bot Music by Railway Deploy' });
    message.reply({ embeds: [embed] });
  }
});

// ─── Button Interactions ─────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const queue = getQueue(interaction.guild.id);

  if (!queue) {
    return interaction.reply({ content: '❌ Tidak ada musik yang sedang diputar!', ephemeral: true });
  }

  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member?.voice?.channel || member.voice.channel.id !== queue.voiceChannel.id) {
    return interaction.reply({ content: '❌ Kamu harus berada di voice channel yang sama!', ephemeral: true });
  }

  if (interaction.customId === 'pause_resume') {
    if (queue.player.state.status === AudioPlayerStatus.Playing) {
      queue.player.pause();
      await interaction.reply({ content: '⏸️ Musik dijeda.', ephemeral: true });
    } else {
      queue.player.unpause();
      await interaction.reply({ content: '▶️ Musik dilanjutkan.', ephemeral: true });
    }
  } else if (interaction.customId === 'skip') {
    queue.player.stop();
    await interaction.reply({ content: '⏭️ Lagu di-skip!', ephemeral: true });
  } else if (interaction.customId === 'stop') {
    queue.songs = [];
    queue.player.stop();
    queue.connection.destroy();
    queues.delete(interaction.guild.id);
    await interaction.reply({ content: '⏹️ Bot berhenti dan keluar dari voice channel.', ephemeral: true });
  } else if (interaction.customId === 'queue') {
    const list = queue.songs.slice(0, 8).map((s, i) => `${i === 0 ? '▶️' : `${i}.`} ${s.title}`).join('\n');
    await interaction.reply({ content: `📋 **Antrian:**\n${list || 'Kosong'}`, ephemeral: true });
  } else if (interaction.customId === 'loop') {
    queue.loop = !queue.loop;
    await interaction.reply({ content: `🔂 Loop: **${queue.loop ? 'ON' : 'OFF'}**`, ephemeral: true });
  }
});

// ─── Ready ──────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot online sebagai: ${client.user.tag}`);
  client.user.setActivity('🎵 !help | Music Bot', { type: 2 });
  await refreshSpotifyToken();
});

client.login(token);
