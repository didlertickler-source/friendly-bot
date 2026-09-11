const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType
} = require("discord.js");

require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates // Needed for voice commands
  ]
});

const games = new Map();
const afkUsers = new Map(); // New map to track AFK users
const PREFIX = "?";

const formations = {
  4: { name: "2-1", positions: ["GK", "LB", "RB", "ST"] },
  5: { name: "2-1-1", positions: ["GK", "LB", "RB", "CAM", "ST"] },
  6: { name: "2-1-2", positions: ["GK", "LB", "RB", "CAM", "LW", "RW"] },
  7: { name: "3-1-2", positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "RW"] },
  8: { name: "3-1-3", positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST", "RW"] },
  9: { name: "3-2-3", positions: ["GK", "LB", "CB", "RB", "LCM", "RCM", "LW", "ST", "RW"] },
  10: { name: "4-2-3", positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "ST", "RW"] },
  11: { name: "4-3-3", positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "CAM", "RCM", "LW", "ST", "RW"] }
};

const command = new SlashCommandBuilder()
  .setName("friendly")
  .setDescription("Start a friendly match (Hosters only)")
  .addIntegerOption(option =>
    option
      .setName("players")
      .setDescription("Number of players needed")
      .setRequired(true)
      .setMinValue(4)
      .setMaxValue(11)
  );

client.once("ready", async () => {
  console.log(`✅ ${client.user.tag} is online and ready.`);

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [command.toJSON()] }
    );
    console.log("✅ Slash commands registered globally.");
  } catch (error) {
    console.error("❌ Slash registration error:", error);
  }
});

function createActivityEmbed(game) {
  const formation = formations[game.needed];
  const players = [...game.players];

  return new EmbedBuilder()
    .setTitle("⚽ FRIENDLY ACTIVITY CHECK")
    .setDescription(
      `**Players:** ${players.length}/${game.needed}\n` +
      `**Formation:** ${formation.name}\n\n` +
      (players.length ? players.map(id => `> <@${id}>`).join("\n") : "> No players yet.")
    )
    .setColor(0x00FF00)
    .setFooter({ text: "Click CAN PLAY if you are available." });
}

function activityButtons(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("friendly_play").setLabel("CAN PLAY").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("friendly_no").setLabel("CAN'T PLAY").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("friendly_reset").setLabel("RESET").setStyle(ButtonStyle.Secondary)
  );
}

function createLineupEmbed(game) {
  const formation = formations[game.needed];
  let text = "";

  for (const position of formation.positions) {
    const player = game.lineup.get(position);
    text += `**${position}**\n`;
    text += player ? `> <@${player}>\n\n` : "> `OPEN`\n\n";
  }

  return new EmbedBuilder()
    .setTitle(`📋 LINEUP • ${formation.name}`)
    .setDescription(text)
    .setColor(0x0099FF)
    .setFooter({
      text: game.locked
        ? "🔒 LINEUP LOCKED"
        : game.subMode
          ? "🔄 SUB MODE • Select a player to replace"
          : "Select a position to join the lineup."
    });
}

function createLineupButtons(game) {
  const formation = formations[game.needed];
  const rows = [];
  let currentRow = [];

  for (const position of formation.positions) {
    const player = game.lineup.get(position);
    const button = new ButtonBuilder()
      .setCustomId(`position_${position}`)
      .setLabel(player ? `${position} • ${game.lineup.get(position) === player ? "FILLED" : ""}` : position)
      .setStyle(game.subMode && player ? ButtonStyle.Danger : player ? ButtonStyle.Success : ButtonStyle.Secondary);

    currentRow.push(button);
    if (currentRow.length === 5) {
      rows.push(new ActionRowBuilder().addComponents(currentRow));
      currentRow = [];
    }
  }
  if (currentRow.length) {
    rows.push(new ActionRowBuilder().addComponents(currentRow));
  }

  if (!game.locked) {
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sub_mode").setLabel(game.subMode ? "CANCEL SUB" : "SUB").setStyle(game.subMode ? ButtonStyle.Danger : ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("lock_lineup").setLabel("LOCK LINEUP").setStyle(ButtonStyle.Success)
    );
    rows.push(controlRow);
  }
  return rows;
}

client.on("messageDelete", message => {
  for (const [guildId, game] of games) {
    if (message.id === game.activityMessageId || message.id === game.lineupMessageId) {
      games.delete(guildId);
      break;
    }
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // --- AFK SYSTEM LOGIC ---
  if (afkUsers.has(message.author.id)) {
    afkUsers.delete(message.author.id);
    message.reply("👋 Welcome back! I've removed your AFK status.")
      .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
  }
  message.mentions.users.forEach(user => {
    if (afkUsers.has(user.id)) {
      message.reply(`💤 **${user.tag}** is currently AFK: ${afkUsers.get(user.id)}`);
    }
  });
  // -------------------------

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  try {
    // ----------------------------------------------------
    // HELP COMMAND
    // ----------------------------------------------------
    if (commandName === "help" || commandName === "commands") {
      const embed = new EmbedBuilder()
        .setTitle("🤖 BOT COMMANDS")
        .setDescription(
          `**⚽ FRIENDLY**\n\`/friendly <players>\` — Start a match (Requires 〔✦〕FF Hoster role)\n\n` +
          `**🛡️ MODERATION**\n\`?purge <amt>\` — Delete messages\n\`?kick @user [rsn]\` — Kick\n\`?ban @user [rsn]\` — Ban\n\`?unban <ID>\` — Unban\n\`?timeout @user <mins>\` — Timeout\n\`?untimeout @user\` — Remove timeout\n\`?warn @user [rsn]\` — Warn\n\`?lock\` / \`?unlock\` — Lock/Unlock channel\n\`?slowmode <secs>\` — Set slowmode\n\`?nuke\` — Recreates & clears the channel\n\`?vmute @user\` / \`?vunmute @user\` — Voice mute/unmute\n\`?nickname @user <name>\` — Change nickname\n\`?addrole @user @role\` / \`?removerole @user @role\` — Manage roles\n\n` +
          `**🌐 SERVER**\n\`?teamrank XI\` — Show Starting XI\n\`?membercount\` — Server population\n\`?serverinfo\` — Server stats\n\`?userinfo [@user]\` — User stats\n\`?roles\` — List all server roles\n\n` +
          `**🔧 UTILITY & FUN**\n\`?ping\` — Bot latency\n\`?say <msg>\` — Bot repeats you\n\`?announce <msg>\` — Announcement\n\`?poll <q>\` — Create a poll\n\`?botinfo\` — Bot stats\n\`?afk [rsn]\` — Set AFK status\n\`?remind <mins> <msg>\` — Set a reminder\n\`?8ball <question>\` — Magic 8-ball\n\`?coinflip\` — Flip a coin\n\`?roll <max>\` — Roll a dice\n\`?rps <choice>\` — Rock, Paper, Scissors\n\`?choose <1>, <2>\` — Let the bot decide\n\`?math <n1> <op> <n2>\` — Basic calculator`
        )
        .setColor(0x2b2d31);
      return message.reply({ embeds: [embed] });
    }

    // ----------------------------------------------------
    // 15 NEW COMMANDS ADDED HERE
    // ----------------------------------------------------

    // 1. AFK
    if (commandName === "afk") {
      const reason = args.join(" ") || "AFK";
      afkUsers.set(message.author.id, reason);
      return message.reply(`💤 I set your AFK: **${reason}**`);
    }

    // 2. Remind
    if (commandName === "remind") {
      const time = parseInt(args[0]);
      const reminder = args.slice(1).join(" ");
      if (isNaN(time) || !reminder) return message.reply("Usage: `?remind <minutes> <message>`");
      message.reply(`⏰ I will remind you in **${time} minutes**.`);
      setTimeout(() => {
        message.channel.send(`🔔 <@${message.author.id}>, Reminder: **${reminder}**`);
      }, time * 60000);
      return;
    }

    // 3. Nuke
    if (commandName === "nuke") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("You need **Manage Channels**.");
      const channel = message.channel;
      const position = channel.position;
      const cloned = await channel.clone();
      await cloned.setPosition(position);
      await channel.delete();
      return cloned.send("💥 **Channel has been nuked and reset.**");
    }

    // 4. Voice Mute
    if (commandName === "vmute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.MuteMembers)) return message.reply("You need **Mute Members**.");
      const member = message.mentions.members.first();
      if (!member || !member.voice.channel) return message.reply("Mention a user currently in a voice channel.");
      await member.voice.setMute(true, "Muted by moderator");
      return message.reply(`🔇 Server muted **${member.user.tag}**.`);
    }

    // 5. Voice Unmute
    if (commandName === "vunmute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.MuteMembers)) return message.reply("You need **Mute Members**.");
      const member = message.mentions.members.first();
      if (!member || !member.voice.channel) return message.reply("Mention a user currently in a voice channel.");
      await member.voice.setMute(false, "Unmuted by moderator");
      return message.reply(`🔊 Server unmuted **${member.user.tag}**.`);
    }

    // 6. Add Role
    if (commandName === "addrole") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return message.reply("You need **Manage Roles**.");
      const member = message.mentions.members.first();
      const role = message.mentions.roles.first();
      if (!member || !role) return message.reply("Usage: `?addrole @user @role`");
      await member.roles.add(role);
      return message.reply(`✅ Added **${role.name}** to **${member.user.tag}**.`);
    }

    // 7. Remove Role
    if (commandName === "removerole") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return message.reply("You need **Manage Roles**.");
      const member = message.mentions.members.first();
      const role = message.mentions.roles.first();
      if (!member || !role) return message.reply("Usage: `?removerole @user @role`");
      await member.roles.remove(role);
      return message.reply(`✅ Removed **${role.name}** from **${member.user.tag}**.`);
    }

    // 8. Nickname
    if (commandName === "nickname") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageNicknames)) return message.reply("You need **Manage Nicknames**.");
      const member = message.mentions.members.first();
      const newNick = args.slice(1).join(" ");
      if (!member) return message.reply("Usage: `?nickname @user <new nickname>`");
      await member.setNickname(newNick.length ? newNick : null);
      return message.reply(`✅ Nickname changed for **${member.user.tag}**.`);
    }

    // 9. Roles List
    if (commandName === "roles") {
      const roles = message.guild.roles.cache.sort((a, b) => b.position - a.position).map(r => `${r.name} (${r.members.size} members)`).slice(0, 20).join("\n");
      const embed = new EmbedBuilder().setTitle(`Roles in ${message.guild.name}`).setDescription(roles + "\n\n*(Showing top 20 roles)*").setColor(0x111111);
      return message.reply({ embeds: [embed] });
    }

    // 10. 8Ball
    if (commandName === "8ball") {
      if (!args[0]) return message.reply("Ask a question! `?8ball <question>`");
      const answers = ["Yes.", "No.", "Maybe.", "Definitely.", "Absolutely not.", "Ask again later.", "I wouldn't count on it."];
      const answer = answers[Math.floor(Math.random() * answers.length)];
      return message.reply(`🎱 **Question:** ${args.join(" ")}\n💬 **Answer:** ${answer}`);
    }

    // 11. Coinflip
    if (commandName === "coinflip") {
      const result = Math.random() < 0.5 ? "Heads" : "Tails";
      return message.reply(`🪙 You flipped a coin and got: **${result}**!`);
    }

    // 12. Roll Dice
    if (commandName === "roll") {
      const max = parseInt(args[0]) || 6;
      const result = Math.floor(Math.random() * max) + 1;
      return message.reply(`🎲 You rolled a **${result}** (1-${max}).`);
    }

    // 13. Rock Paper Scissors
    if (commandName === "rps") {
      const choices = ["rock", "paper", "scissors"];
      const userChoice = args[0]?.toLowerCase();
      if (!choices.includes(userChoice)) return message.reply("Choose `rock`, `paper`, or `scissors`.");
      const botChoice = choices[Math.floor(Math.random() * choices.length)];
      let result = "It's a tie!";
      if ((userChoice === "rock" && botChoice === "scissors") || (userChoice === "paper" && botChoice === "rock") || (userChoice === "scissors" && botChoice === "paper")) {
        result = "You win! 🎉";
      } else if (userChoice !== botChoice) {
        result = "I win! 😈";
      }
      return message.reply(`You chose **${userChoice}**, I chose **${botChoice}**. ${result}`);
    }

    // 14. Choose
    if (commandName === "choose") {
      const options = message.content.slice(PREFIX.length + 6).split(",");
      if (options.length < 2) return message.reply("Give me at least two options separated by a comma. Ex: `?choose Pizza, Burger`");
      const choice = options[Math.floor(Math.random() * options.length)].trim();
      return message.reply(`🤔 I choose: **${choice}**`);
    }

    // 15. Simple Math
    if (commandName === "math") {
      const n1 = parseFloat(args[0]);
      const op = args[1];
      const n2 = parseFloat(args[2]);
      if (isNaN(n1) || isNaN(n2) || !["+", "-", "*", "/"].includes(op)) return message.reply("Usage: `?math <num> <+|-|*|/> <num>`");
      let ans;
      if (op === "+") ans = n1 + n2;
      if (op === "-") ans = n1 - n2;
      if (op === "*") ans = n1 * n2;
      if (op === "/") ans = n2 === 0 ? "Cannot divide by zero!" : n1 / n2;
      return message.reply(`🧮 Result: **${ans}**`);
    }

    // ----------------------------------------------------
    // EXISTING MODERATION & SERVER COMMANDS
    // ----------------------------------------------------

    if (commandName === "purge" || commandName === "clear") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply("You need **Manage Messages**.");
      const amount = parseInt(args[0]);
      if (!amount || amount < 1 || amount > 100) return message.reply("Use an amount between **1 and 100**.");
      try {
        const deleted = await message.channel.bulkDelete(amount + 1, true);
        const msg = await message.channel.send(`Deleted **${Math.max(deleted.size - 1, 0)}** messages.`);
        setTimeout(() => msg.delete().catch(() => {}), 3000);
      } catch {
        return message.reply("I couldn't delete those messages. Messages older than 14 days cannot be bulk deleted.");
      }
      return;
    }

    if (commandName === "teamrank") {
      const rank = args.join(" ").toLowerCase();
      if (!rank) return message.reply("Use `?teamrank XI`.");
      if (rank !== "xi" && rank !== "starting xi" && rank !== "main") return message.reply("Available rank: `XI`");

      const roleName = "〔✦〕STARTING XI/MAIN PLAYERS";
      const role = message.guild.roles.cache.find(r => r.name === roleName);
      if (!role) return message.reply(`I couldn't find the role **${roleName}**.`);

      await message.guild.members.fetch();
      const members = role.members;
      if (!members.size) return message.reply(`Nobody currently has the **${roleName}** role.`);

      const sortedMembers = [...members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
      const playerList = sortedMembers.map((member, index) => `**${index + 1}.** <@${member.id}>`).join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🛡️ STARTING XI")
        .setDescription(`**Rank:** XI\n**Players:** ${members.size}\n\n${playerList}`)
        .setFooter({ text: roleName })
        .setColor(0x111111);
      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "kick") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) return message.reply("You need **Kick Members**.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention someone to kick.");
      if (!member.kickable) return message.reply("I can't kick that member. Check my role hierarchy.");
      const reason = args.slice(1).join(" ") || "No reason provided";
      await member.kick(reason);
      return message.reply(`👞 Kicked **${member.user.tag}**.`);
    }

    if (commandName === "ban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return message.reply("You need **Ban Members**.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention someone to ban.");
      if (!member.bannable) return message.reply("I can't ban that member.");
      const reason = args.slice(1).join(" ") || "No reason provided";
      await member.ban({ reason });
      return message.reply(`🔨 Banned **${member.user.tag}**.`);
    }

    if (commandName === "unban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return message.reply("You need **Ban Members**.");
      const userId = args[0];
      if (!userId) return message.reply("Use `?unban <userID>`.");
      await message.guild.members.unban(userId);
      return message.reply(`✅ Unbanned **${userId}**.`);
    }

    if (commandName === "timeout") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("You need **Moderate Members**.");
      const member = message.mentions.members.first();
      const minutes = parseInt(args[1]);
      if (!member || !minutes || minutes < 1) return message.reply("Use `?timeout @user <minutes>`.");
      if (!member.moderatable) return message.reply("I can't timeout that member.");
      await member.timeout(minutes * 60 * 1000, "Timed out by moderator");
      return message.reply(`⏱️ Timed out **${member.user.tag}** for **${minutes} minutes**.`);
    }

    if (commandName === "untimeout") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("You need **Moderate Members**.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Use `?untimeout @user`.");
      await member.timeout(null);
      return message.reply(`✅ Removed timeout from **${member.user.tag}**.`);
    }

    if (commandName === "warn") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("You need **Moderate Members**.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Use `?warn @user [reason]`.");
      const reason = args.slice(1).join(" ") || "No reason provided";
      return message.channel.send(`⚠️ **Warning issued to** <@${member.id}>\n**Reason:** ${reason}`);
    }

    if (commandName === "slowmode") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("You need **Manage Channels**.");
      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply("Use a value between **0 and 21600** seconds.");
      await message.channel.setRateLimitPerUser(seconds);
      return message.reply(`🐌 Slowmode set to **${seconds}s**.`);
    }

    if (commandName === "lock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("You need **Manage Channels**.");
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.reply("🔒 Channel locked.");
    }

    if (commandName === "unlock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("You need **Manage Channels**.");
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      return message.reply("🔓 Channel unlocked.");
    }

    if (commandName === "ping") {
      return message.reply(`🏓 Pong! **${client.ws.ping}ms**.`);
    }

    if (commandName === "userinfo") {
      const member = message.mentions.members.first() || message.member;
      const roles = member.roles.cache.filter(role => role.id !== message.guild.id).map(role => role.toString()).join(", ") || "None";
      const embed = new EmbedBuilder()
        .setTitle("👤 USER INFORMATION")
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: "User", value: member.user.tag, inline: true },
          { name: "ID", value: member.id, inline: true },
          { name: "Joined", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: "Roles", value: roles.slice(0, 1024) }
        )
        .setColor(0x111111);
      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "serverinfo") {
      const owner = await message.guild.fetchOwner();
      const embed = new EmbedBuilder()
        .setTitle("📊 SERVER INFORMATION")
        .addFields(
          { name: "Server", value: message.guild.name, inline: true },
          { name: "Members", value: `${message.guild.memberCount}`, inline: true },
          { name: "Channels", value: `${message.guild.channels.cache.size}`, inline: true },
          { name: "Roles", value: `${message.guild.roles.cache.size}`, inline: true },
          { name: "Owner", value: `<@${owner.id}>`, inline: true },
          { name: "Created", value: `<t:${Math.floor(message.guild.createdTimestamp / 1000)}:R>`, inline: true }
        )
        .setColor(0x111111);
      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "avatar") {
      const user = message.mentions.users.first() || message.author;
      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Avatar`)
        .setImage(user.displayAvatarURL({ size: 1024 }))
        .setColor(0x111111);
      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "say") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply("You need **Manage Messages**.");
      const text = args.join(" ");
      if (!text) return message.reply("Use `?say <message>`.");
      await message.delete().catch(() => {});
      return message.channel.send(text);
    }

    if (commandName === "announce") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply("You need **Manage Messages**.");
      const text = args.join(" ");
      if (!text) return message.reply("Use `?announce <message>`.");
      const embed = new EmbedBuilder()
        .setTitle("📢 ANNOUNCEMENT")
        .setDescription(text)
        .setFooter({ text: `Posted by ${message.author.tag}` })
        .setColor(0x111111);
      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "poll") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply("You need **Manage Messages**.");
      const question = args.join(" ");
      if (!question) return message.reply("Use `?poll <question>`.");
      const embed = new EmbedBuilder()
        .setTitle("📊 POLL")
        .setDescription(question)
        .setFooter({ text: `Poll by ${message.author.tag}` })
        .setColor(0x111111);
      const poll = await message.channel.send({ embeds: [embed] });
      await poll.react("👍");
      await poll.react("👎");
      return;
    }

    if (commandName === "membercount") {
      return message.reply(`This server has **${message.guild.memberCount}** members.`);
    }

    if (commandName === "botinfo") {
      const uptime = Math.floor(client.uptime / 1000);
      return message.reply(`**${client.user.tag}**\nServers: **${client.guilds.cache.size}**\nPing: **${client.ws.ping}ms**\nUptime: **${uptime}s**`);
    }

  } catch (error) {
    console.error("Prefix command error:", error);
    return message.reply("Something went wrong while running that command.").catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "friendly") return;

      // -----------------------------------------------------------------
      // ✅ ROLE RESTRICTION FOR /FRIENDLY
      // Checks if the user is an Admin OR has the "〔✦〕FF Hoster" role.
      // -----------------------------------------------------------------
      const hasHosterRole = interaction.member.roles.cache.some(r => r.name === "〔✦〕FF Hoster");
      const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
      
      if (!hasHosterRole && !isAdmin) {
        return interaction.reply({
          content: "❌ You must have the **〔✦〕FF Hoster** role to host a friendly.",
          ephemeral: true
        });
      }

      const guildId = interaction.guildId;
      const oldGame = games.get(guildId);

      if (oldGame) {
        let oldActivityExists = false;
        let oldLineupExists = false;
        try {
          await interaction.channel.messages.fetch(oldGame.activityMessageId);
          oldActivityExists = true;
        } catch {}

        if (oldGame.lineupMessageId) {
          try {
            await interaction.channel.messages.fetch(oldGame.lineupMessageId);
            oldLineupExists = true;
          } catch {}
        }
        if (oldActivityExists || oldLineupExists) {
          return interaction.reply({ content: "There is already an active friendly in this server.", ephemeral: true });
        }
        games.delete(guildId);
      }

      const needed = interaction.options.getInteger("players");
      const game = {
        hostId: interaction.user.id,
        needed,
        channelId: interaction.channelId,
        activityMessageId: null,
        lineupMessageId: null,
        players: new Set(),
        lineup: new Map(),
        lineupStarted: false,
        locked: false,
        subMode: false
      };
      games.set(guildId, game);

      const activity = await interaction.channel.send({
        content: "@everyone",
        embeds: [createActivityEmbed(game)],
        components: [activityButtons(game)]
      });
      game.activityMessageId = activity.id;

      await interaction.reply({ content: "✅ Friendly created successfully.", ephemeral: true });
      return;
    }

    if (!interaction.isButton()) return;
    const game = games.get(interaction.guildId);

    if (!game || (interaction.message.id !== game.activityMessageId && interaction.message.id !== game.lineupMessageId)) {
      return interaction.reply({ content: "This friendly is no longer active.", ephemeral: true });
    }

    if (interaction.customId === "friendly_play") {
      game.players.add(interaction.user.id);
      const activity = await interaction.channel.messages.fetch(game.activityMessageId);
      await activity.edit({ embeds: [createActivityEmbed(game)], components: [activityButtons(game)] });

      if (game.players.size >= game.needed && !game.lineupStarted) {
        game.lineupStarted = true;
        const lineup = await interaction.channel.send({
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });
        game.lineupMessageId = lineup.id;
      }
      return interaction.reply({ content: "You are marked as available.", ephemeral: true });
    }

    if (interaction.customId === "friendly_no") {
      game.players.delete(interaction.user.id);
      for (const [position, playerId] of game.lineup) {
        if (playerId === interaction.user.id) game.lineup.delete(position);
      }
      const activity = await interaction.channel.messages.fetch(game.activityMessageId);
      await activity.edit({ embeds: [createActivityEmbed(game)], components: [activityButtons(game)] });

      if (game.lineupMessageId) {
        try {
          const lineup = await interaction.channel.messages.fetch(game.lineupMessageId);
          await lineup.edit({ embeds: [createLineupEmbed(game)], components: createLineupButtons(game) });
        } catch {}
      }
      return interaction.reply({ content: "You are marked as unavailable.", ephemeral: true });
    }

    if (interaction.customId === "friendly_reset") {
      if (interaction.user.id !== game.hostId && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "Only the host or an Admin can reset the friendly.", ephemeral: true });
      }
      game.players.clear();
      game.lineup.clear();
      game.lineupStarted = false;
      game.locked = false;
      game.subMode = false;

      const activity = await interaction.channel.messages.fetch(game.activityMessageId);
      await activity.edit({ embeds: [createActivityEmbed(game)], components: [activityButtons(game)] });

      if (game.lineupMessageId) {
        try {
          const lineup = await interaction.channel.messages.fetch(game.lineupMessageId);
          await lineup.delete();
        } catch {}
      }
      game.lineupMessageId = null;
      return interaction.reply({ content: "Friendly reset.", ephemeral: true });
    }

    if (interaction.customId === "sub_mode") {
      if (game.locked) return interaction.reply({ content: "The lineup is locked.", ephemeral: true });
      game.subMode = !game.subMode;
      await interaction.message.edit({ embeds: [createLineupEmbed(game)], components: createLineupButtons(game) });
      return interaction.reply({ content: game.subMode ? "SUB mode enabled." : "SUB mode disabled.", ephemeral: true });
    }

    if (interaction.customId === "lock_lineup") {
      if (interaction.user.id !== game.hostId && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "Only the host or Admin can lock the lineup.", ephemeral: true });
      }
      if (game.lineup.size < game.needed) return interaction.reply({ content: "Every position must be filled first.", ephemeral: true });
      
      game.locked = true;
      game.subMode = false;
      await interaction.message.edit({ embeds: [createLineupEmbed(game)], components: [] });
      return interaction.reply({ content: "Lineup locked.", ephemeral: true });
    }

    if (interaction.customId.startsWith("position_")) {
      if (game.locked) return interaction.reply({ content: "The lineup is locked.", ephemeral: true });
      const position = interaction.customId.replace("position_", "");
      const currentPlayer = game.lineup.get(position);

      if (game.subMode) {
        if (!currentPlayer) return interaction.reply({ content: "That position is empty.", ephemeral: true });
        if (currentPlayer === interaction.user.id) return interaction.reply({ content: "You can't sub yourself.", ephemeral: true });

        game.lineup.set(position, interaction.user.id);
        game.players.add(interaction.user.id);
        game.subMode = false;

        await interaction.message.edit({ embeds: [createLineupEmbed(game)], components: createLineupButtons(game) });
        return interaction.reply({ content: `You replaced <@${currentPlayer}> at **${position}**.`, ephemeral: true });
      }

      if (!game.players.has(interaction.user.id)) return interaction.reply({ content: "You must click CAN PLAY first.", ephemeral: true });

      if (currentPlayer) {
        if (currentPlayer === interaction.user.id) {
          game.lineup.delete(position);
          await interaction.message.edit({ embeds: [createLineupEmbed(game)], components: createLineupButtons(game) });
          return interaction.reply({ content: `You left **${position}**.`, ephemeral: true });
        }
        return interaction.reply({ content: `**${position}** is already taken.`, ephemeral: true });
      }

      for (const [oldPosition, playerId] of game.lineup) {
        if (playerId === interaction.user.id) game.lineup.delete(oldPosition);
      }

      game.lineup.set(position, interaction.user.id);
      await interaction.message.edit({ embeds: [createLineupEmbed(game)], components: createLineupButtons(game) });
      return interaction.reply({ content: `You are now **${position}**.`, ephemeral: true });
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
