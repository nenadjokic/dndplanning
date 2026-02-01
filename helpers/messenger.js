const db = require('../db/connection');

class MessengerService {
  constructor() {
    this._discordClient = null;
    this._discordReady = false;
    this.config = null;
    this.reload();
  }

  reload() {
    this.config = db.prepare('SELECT * FROM notification_config WHERE id = 1').get();
  }

  async send(type, data) {
    try {
      if (!this.config || this.config.active_provider === 'none') return;

      const message = this._formatMessage(type, data);
      if (!message) return;

      switch (this.config.active_provider) {
        case 'discord':
          await this._sendDiscord(message);
          break;
        case 'telegram':
          await this._sendTelegram(message);
          break;
        case 'viber':
          await this._sendViber(message, data);
          break;
      }
    } catch (err) {
      console.error(`[Messenger] Error sending ${type} via ${this.config?.active_provider}:`, err.message);
    }
  }

  async test() {
    const message = this._formatMessage('test', {});
    if (!this.config || this.config.active_provider === 'none') {
      throw new Error('No provider configured');
    }

    switch (this.config.active_provider) {
      case 'discord':
        await this._sendDiscord(message);
        break;
      case 'telegram':
        await this._sendTelegram(message);
        break;
      case 'viber':
        await this._sendViber(message, {});
        break;
    }
  }

  destroy() {
    if (this._discordClient) {
      this._discordClient.destroy();
      this._discordClient = null;
      this._discordReady = false;
    }
  }

  _formatMessage(type, data) {
    const link = this._buildLink(data.link);
    const linkText = link ? ` — ${link}` : '';

    switch (type) {
      case 'session_created':
        return {
          emoji: '\ud83d\udcc5',
          title: 'New Quest',
          text: `New Quest: "${data.title}" — Vote now!${linkText}`,
          color: 0xd4a843,
          description: data.description || '',
          link
        };
      case 'session_confirmed':
        return {
          emoji: '\u2705',
          title: 'Quest Confirmed',
          text: `Quest Confirmed: "${data.title}" on ${data.date || ''} at ${data.time || ''}${linkText}`,
          color: 0x2ecc71,
          description: data.label ? `Time slot: ${data.label}` : '',
          link
        };
      case 'session_cancelled':
        return {
          emoji: '\u274c',
          title: 'Quest Cancelled',
          text: `Quest Cancelled: "${data.title}"${linkText}`,
          color: 0xe74c3c,
          description: '',
          link
        };
      case 'session_reopened':
        return {
          emoji: '\ud83d\udd04',
          title: 'Quest Reopened',
          text: `Quest Reopened: "${data.title}" — Vote now!${linkText}`,
          color: 0xd4a843,
          description: '',
          link
        };
      case 'session_completed':
        return {
          emoji: '\u2694\ufe0f',
          title: 'Quest Completed',
          text: `Quest Completed: "${data.title}"${data.summary ? ' — Recap available!' : ''}${linkText}`,
          color: 0x9b59b6,
          description: data.summary ? (data.summary.length > 200 ? data.summary.substring(0, 200) + '...' : data.summary) : '',
          link
        };
      case 'session_recap':
        return {
          emoji: '\ud83d\udcdc',
          title: 'Quest Recap Updated',
          text: `Recap updated for: "${data.title}"${linkText}`,
          color: 0x3498db,
          description: data.summary ? (data.summary.length > 200 ? data.summary.substring(0, 200) + '...' : data.summary) : '',
          link
        };
      case 'test':
        return {
          emoji: '\ud83c\udff0',
          title: 'Connection Test',
          text: 'Hello from Quest Planner! Connection verified.',
          color: 0xd4a843,
          description: '',
          link: null
        };
      default:
        return null;
    }
  }

  _buildLink(relativePath) {
    if (!relativePath) return null;
    if (this.config && this.config.public_url) {
      const base = this.config.public_url.replace(/\/+$/, '');
      return base + relativePath;
    }
    return null;
  }

  async _sendDiscord(message) {
    const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

    if (!this.config.discord_bot_token || !this.config.discord_channel_id) {
      throw new Error('Discord bot token and channel ID are required');
    }

    try {
      if (!this._discordClient || !this._discordReady) {
        if (this._discordClient) {
          this._discordClient.destroy();
        }
        this._discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
        await this._discordClient.login(this.config.discord_bot_token);
        this._discordReady = true;
      }
    } catch (err) {
      this._discordClient = null;
      this._discordReady = false;
      if (err.code === 'TokenInvalid' || (err.message && err.message.includes('TOKEN_INVALID'))) {
        throw new Error('Invalid bot token. Go to discord.com/developers/applications → your app → Bot → Reset Token and paste the new token.');
      }
      throw err;
    }

    let channel;
    try {
      channel = await this._discordClient.channels.fetch(this.config.discord_channel_id);
    } catch (err) {
      if (err.code === 50001 || (err.message && err.message.includes('Missing Access'))) {
        throw new Error('Missing Access — the bot is not in your server or cannot see this channel. Go to discord.com/developers/applications → your app → OAuth2 → URL Generator → check "bot" scope + "Send Messages" & "Embed Links" permissions → copy the URL → open it to invite the bot to your server.');
      }
      if (err.code === 10003) {
        throw new Error('Unknown Channel — the channel ID is incorrect. Right-click the channel in Discord (with Developer Mode enabled) → Copy Channel ID.');
      }
      throw err;
    }

    if (!channel) {
      throw new Error('Discord channel not found. Check that the channel ID is correct.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`${message.emoji} ${message.title}`)
      .setDescription(message.text)
      .setColor(message.color)
      .setTimestamp();

    if (message.description) {
      embed.addFields({ name: 'Details', value: message.description });
    }

    if (message.link) {
      embed.setURL(message.link);
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      if (err.code === 50013) {
        throw new Error('Missing Permissions — the bot can see the channel but cannot send messages. Make sure the bot role has "Send Messages" and "Embed Links" permissions in that channel.');
      }
      throw err;
    }
  }

  async _sendTelegram(message) {
    const TelegramBot = require('node-telegram-bot-api');

    if (!this.config.telegram_bot_token || !this.config.telegram_chat_id) {
      throw new Error('Telegram bot token and chat ID are required');
    }

    const bot = new TelegramBot(this.config.telegram_bot_token);
    const linkHtml = message.link ? `\n<a href="${message.link}">Open in Quest Planner</a>` : '';
    const html = `<b>${message.emoji} ${message.title}</b>\n${message.text}${linkHtml}`;

    await bot.sendMessage(this.config.telegram_chat_id, html, { parse_mode: 'HTML' });
  }

  async _sendViber(message, data) {
    const axios = require('axios');

    if (!this.config.viber_auth_token || !this.config.viber_admin_id) {
      throw new Error('Viber auth token and admin ID are required');
    }

    const body = {
      receiver: this.config.viber_admin_id,
      type: 'text',
      text: `${message.emoji} ${message.title}\n${message.text}`
    };

    if (message.link) {
      body.type = 'rich_media';
      body.rich_media = {
        Type: 'rich_media',
        ButtonsGroupColumns: 6,
        ButtonsGroupRows: 2,
        BgColor: '#1a1a2e',
        Buttons: [
          {
            ActionBody: message.link,
            ActionType: 'open-url',
            Text: `<b>${message.emoji} ${message.title}</b><br>${message.text}`,
            TextSize: 'medium',
            TextVAlign: 'middle',
            TextHAlign: 'left',
            Rows: 1,
            Columns: 6
          },
          {
            ActionBody: message.link,
            ActionType: 'open-url',
            Text: 'Open in Quest Planner',
            TextSize: 'small',
            Rows: 1,
            Columns: 6
          }
        ]
      };
      delete body.text;
    }

    await axios.post('https://chatapi.viber.com/pa/send_message', body, {
      headers: {
        'X-Viber-Auth-Token': this.config.viber_auth_token
      }
    });
  }

  async registerViberWebhook(publicUrl) {
    const axios = require('axios');

    if (!this.config.viber_auth_token || !publicUrl) return;

    const webhookUrl = publicUrl.replace(/\/+$/, '') + '/webhooks/viber';
    await axios.post('https://chatapi.viber.com/pa/set_webhook', {
      url: webhookUrl,
      event_types: ['delivered', 'seen']
    }, {
      headers: {
        'X-Viber-Auth-Token': this.config.viber_auth_token
      }
    });
  }
}

const messenger = new MessengerService();

module.exports = messenger;
