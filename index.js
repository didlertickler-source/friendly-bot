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
  Partials
} = require("discord.js");

require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User
  ]
});

const games = new Map();       // guildId -> friendly game
const scrims = new Map();      // guildId -> scrim
const activities = new Map();  // guildId -> activity check
const lineups = new Map();     // guildId -> lineup (3-1-3)

const PREFIX = "?";
const HOSTER_ROLE = "〔✦〕FF Hoster";
const THEME = 0x5865F2;

function makeEmbed(title, description = "") {
  return new EmbedBuilder()
    .setColor(THEME)
    .setTitle(`〔✦〕 ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function canHost(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.some(role => role.name === HOSTER_ROLE)
  );
}

function hostOnlyMessage() {
  return `You need the **${HOSTER_ROLE}** role or **Administrator** permission to use this.`;
}

const formations = {
  4: {
    name: "2-1",
    positions: ["GK", "LB", "RB", "ST"]
  },
  5: {
    name: "2-1-1",
    positions: ["GK", "LB", "RB", "CAM", "ST"]
  },
  6: {
    name: "2-1-2",
    positions: ["GK", "LB", "RB", "CAM", "LW", "RW"]
  },
  7: {
    name: "3-1-2",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "RW"]
  },
  8: {
    name: "3-1-3",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST", "RW"]
  },
  9: {
    name: "3-2-3",
    positions: ["GK", "LB", "CB", "RB", "LCM", "RCM", "LW", "ST", "RW"]
  },
  10: {
    name: "4-2-3",
    positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "ST", "RW"]
  },
  11: {
    name: "4-3-3",
    positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "CAM", "RCM", "LW", "ST", "RW"]
  }
};

// COMMAND BUILDERS
const friendlyCommand = new SlashCommandBuilder()
  .setName("friendly")
  .setDescription("Start a friendly match")
  .addIntegerOption(option =>
    option
      .setName("players")
      .setDescription("Number of players needed")
      .setRequired(true)
      .setMinValue(4)
      .setMaxValue(11)
  );

const scrimCommand = new SlashCommandBuilder()
  .setName("scrim")
  .setDescription("Start a 7v7 scrim with 3-1-2 formation for both teams");

const activityCommand = new SlashCommandBuilder()
  .setName("activity")
  .setDescription("Start an activity check for Real Betis")
  .addIntegerOption(option =>
    option
      .setName("needed")
      .setDescription("Number of reactions needed to complete the check")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)
  );

const lineupCommand = new SlashCommandBuilder()
  .setName("lineup")
  .setDescription("Start a 3-1-3 lineup picker (8 players)");

client.once("ready", async () => {
  console.log(`${client.user.tag} is online.`);

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [
          friendlyCommand.toJSON(),
          scrimCommand.toJSON(),
          activityCommand.toJSON(),
          lineupCommand.toJSON()
        ]
      }
    );

    console.log("Slash commands registered.");
  } catch (error) {
    console.error("Slash registration error:", error);
  }
});

// FRIENDLY EMBEDS & BUTTONS
function createActivityEmbed(game) {
  const formation = formations[game.needed];
  const players = [...game.players];

  return new EmbedBuilder()
    .setTitle("〔✦〕 FRIENDLY ACTIVITY CHECK")
    .setDescription(
      `**Players:** ${players.length}/${game.needed}\n` +
      `**Formation:** ${formation.name}\n\n` +
      (players.length
        ? players.map(id => `> <@${id}>`).join("\n")
        : "> No players yet.")
    )
    .setFooter({
      text: "Click CAN PLAY if you are available."
    });
}

function activityButtons(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("friendly_play")
      .setLabel("CAN PLAY")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("friendly_no")
      .setLabel("CAN'T PLAY")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("friendly_reset")
      .setLabel("RESET")
      .setStyle(ButtonStyle.Secondary)
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
    .setTitle(`〔✦〕 LINEUP • ${formation.name}`)
    .setDescription(text)
    .setFooter({
      text: game.locked
        ? "LINEUP LOCKED"
        : game.subMode
          ? "SUB MODE • Select a player to replace"
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
      .setLabel(player ? `${position} • FILLED` : position)
      .setStyle(
        game.subMode && player
          ? ButtonStyle.Danger
          : player
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
      );

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
      new ButtonBuilder()
        .setCustomId("sub_mode")
        .setLabel(game.subMode ? "CANCEL SUB" : "SUB")
        .setStyle(game.subMode ? ButtonStyle.Danger : ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("lock_lineup")
        .setLabel("LOCK LINEUP")
        .setStyle(ButtonStyle.Success)
    );

    rows.push(controlRow);
  }

  return rows;
}

// SCRIM HELPERS (7v7, 3-1-2 both teams)
const SCRIM_FORMATION_7 = formations[7]; // 3-1-2

function createScrimEmbed(scrim) {
  const lines = [
    `**Team A** (3-1-2)`,
    ...buildTeamLines(scrim.teamA),
    "",
    `**Team B** (3-1-2)`,
    ...buildTeamLines(scrim.teamB)
  ];

  return new EmbedBuilder()
    .setTitle("〔✦〕 SCRIM • 7V7")
    .setDescription(lines.join("\n"))
    .setFooter({
      text: scrim.locked
        ? "SCRIM LINEUPS LOCKED"
        : "Click a position to join. Host can lock when full."
    })
    .setColor(THEME);
}

function buildTeamLines(teamMap) {
  const lines = [];
  for (const pos of SCRIM_FORMATION_7.positions) {
    const player = teamMap.get(pos);
    lines.push(`**${pos}**`);
    lines.push(player ? `> <@${player}>` : "> `OPEN`");
    lines.push("");
  }
  return lines;
}

function createScrimButtons(scrim) {
  const rows = [];

  const teamARows = createTeamButtonRows(scrim.teamA, "A", scrim);
  rows.push(...teamARows);

  const teamBRows = createTeamButtonRows(scrim.teamB, "B", scrim);
  rows.push(...teamBRows);

  if (!scrim.locked) {
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("scrim_lock")
        .setLabel("LOCK SCRIM")
        .setStyle(ButtonStyle.Success)
    );

    rows.push(controlRow);
  }

  return rows;
}

function createTeamButtonRows(teamMap, teamLabel, scrim) {
  const rows = [];
  let currentRow = [];

  for (const pos of SCRIM_FORMATION_7.positions) {
    const player = teamMap.get(pos);

    const button = new ButtonBuilder()
      .setCustomId(`scrim_pos_${teamLabel}_${pos}`)
      .setLabel(player ? `${pos} • FILLED` : `${teamLabel} • ${pos}`)
      .setStyle(
        player
          ? ButtonStyle.Success
          : ButtonStyle.Secondary
      );

    currentRow.push(button);

    if (currentRow.length === 5) {
      rows.push(new ActionRowBuilder().addComponents(currentRow));
      currentRow = [];
    }
  }

  if (currentRow.length) {
    rows.push(new ActionRowBuilder().addComponents(currentRow));
  }

  return rows;
}

// ACTIVITY CHECK EMBED
function createActivityCheckEmbed(activity) {
  const reacted = [...activity.reacted].map(id => `<@${id}>`);

  return new EmbedBuilder()
    .setTitle("〔✦〕 ACTIVITY CHECK • REAL BETIS")
    .setDescription(
      "Activity check for real betis 🥳🔥\n" +
      "react to show ur activity to betis\n\n" +
      `**Reacted:** ${activity.reacted.size}/${activity.needed}\n` +
      (reacted.length ? reacted.map(id => `> ${id}`).join("\n") : "> No reactions yet.")
    )
    .setFooter({
      text: activity.completed
        ? "Activity check completed!"
        : "React to this message to join."
    })
    .setColor(THEME);
}

// LINEUP 3-1-3 EMBED & BUTTONS
const LINEUP_FORMATION_8 = formations[8]; // 3-1-3

function createLineup8Embed(lineupObj) {
  let text = "";

  for (const pos of LINEUP_FORMATION_8.positions) {
    const player = lineupObj.positions.get(pos);
    text += `**${pos}**\n`;
    text += player ? `> <@${player}>\n\n` : "> `OPEN`\n\n";
  }

  return new EmbedBuilder()
    .setTitle("〔✦〕 LINEUP • 3-1-3")
    .setDescription(text)
    .setFooter({
      text: lineupObj.locked
        ? "LINEUP LOCKED"
        : "Click a position to join or leave."
    })
    .setColor(THEME);
}

function createLineup8Buttons(lineupObj) {
  const rows = [];
  let currentRow = [];

  for (const pos of LINEUP_FORMATION_8.positions) {
    const player = lineupObj.positions.get(pos);

    const button = new ButtonBuilder()
      .setCustomId(`lineup8_pos_${pos}`)
      .setLabel(player ? `${pos} • FILLED` : pos)
      .setStyle(
        player
          ? ButtonStyle.Success
          : ButtonStyle.Secondary
      );

    currentRow.push(button);

    if (currentRow.length === 5) {
      rows.push(new ActionRowBuilder().addComponents(currentRow));
      currentRow = [];
    }
  }

  if (currentRow.length) {
    rows.push(new ActionRowBuilder().addComponents(currentRow));
  }

  if (!lineupObj.locked) {
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("lineup8_lock")
        .setLabel("LOCK LINEUP")
        .setStyle(ButtonStyle.Success)
    );

    rows.push(controlRow);
  }

  return rows;
}

// CLEANUP ON MESSAGE DELETE
client.on("messageDelete", message => {
  if (!message.guild) return;
  const guildId = message.guild.id;

  // Friendly
  for (const [key, game] of games.entries()) {
    if (key.startsWith(`${guildId}_scrim`)) continue;

    if (
      message.id === game.activityMessageId ||
      message.id === game.lineupMessageId
    ) {
      games.delete(key);
      console.log("Friendly removed because its message was deleted.");
      break;
    }
  }

  // Scrim
  const scrimKey = `${guildId}_scrim`;
  const scrim = scrims.get(scrimKey);
  if (scrim && message.id === scrim.messageId) {
    scrims.delete(scrimKey);
    console.log("Scrim removed because its message was deleted.");
  }

  // Activity
  const activity = activities.get(guildId);
  if (activity && message.id === activity.messageId) {
    activities.delete(guildId);
    console.log("Activity check removed because its message was deleted.");
  }

  // Lineup 3-1-3
  const lineupObj = lineups.get(guildId);
  if (lineupObj && message.id === lineupObj.messageId) {
    lineups.delete(guildId);
    console.log("3-1-3 lineup removed because its message was deleted.");
  }
});

// PREFIX COMMANDS
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  try {
    if (commandName === "help" || commandName === "commands") {
      const embed = makeEmbed(
        "COMMAND CENTER",
        [
          "### ⚽ FRIENDLY SYSTEM",
          "`/friendly <players>` — start an activity check",
          "`/scrim` — start a 7v7 scrim (3-1-2 both teams)",
          "`/activity <needed>` — activity check for Real Betis",
          "`/lineup` — 3-1-3 lineup picker (8 players)",
          "",
          "### 🛡️ MODERATION",
          "`?purge <amount>` `?clear <amount>`",
          "`?kick @user [reason]` `?ban @user [reason]`",
          "`?unban <userID>` `?timeout @user <minutes>` `?untimeout @user`",
          "`?warn @user [reason]` `?lock` `?unlock` `?slowmode <seconds>`",
          "",
          "### 🏟️ SERVER",
          "`?teamrank XI` `?membercount` `?serverinfo`",
          "`?userinfo [@user]` `?avatar [@user]`",
          "`?roleinfo @role` `?channelinfo` `?servericon`",
          "",
          "### 🧰 UTILITY",
          "`?ping` `?uptime` `?botinfo` `?online` `?offline` `?members`",
          "`?say <message>` `?announce <message>` `?poll <question>`",
          "`?choose <option1 | option2 | ...>`",
          "`?coinflip` `?8ball <question>` `?random <min> <max>`",
          "`?topic <text>`",
          "",
          "### ✦ FRIENDLY ACCESS",
          `Only **${HOSTER_ROLE}** or members with **Administrator** can use \`/friendly\`, \`/scrim\`, and \`/lineup\`.`
        ].join("\n")
      );

      return message.reply({ embeds: [embed] });
    }

    if (commandName === "purge" || commandName === "clear") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("You need **Manage Messages**.");
      }

      const amount = parseInt(args[0]);
      if (!amount || amount < 1 || amount > 100) {
        return message.reply("Use an amount between **1 and 100**.");
      }

      try {
        const deleted = await message.channel.bulkDelete(amount + 1, true);
        const msg = await message.channel.send(
          `Deleted **${Math.max(deleted.size - 1, 0)}** messages.`
        );
        setTimeout(() => msg.delete().catch(() => {}), 3000);
      } catch {
        return message.reply(
          "I couldn't delete those messages. Messages older than 14 days cannot be bulk deleted."
        );
      }
      return;
    }

    if (commandName === "teamrank") {
      const rank = args.join(" ").toLowerCase();
      if (!rank) return message.reply("Use `?teamrank XI`.");
      if (rank !== "xi" && rank !== "starting xi" && rank !== "main") {
        return message.reply("Available rank: `XI`");
      }

      const roleName = "〔✦〕STARTING XI/MAIN PLAYERS";
      const role = message.guild.roles.cache.find(r => r.name === roleName);
      if (!role) return message.reply(`I couldn't find the role **${roleName}**.`);

      await message.guild.members.fetch();
      const members = role.members;
      if (!members.size) {
        return message.reply(`Nobody currently has the **${roleName}** role.`);
      }

      const sortedMembers = [...members.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      );

      const playerList = sortedMembers
        .map((member, index) => `**${index + 1}.** <@${member.id}>`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("STARTING XI")
        .setDescription(
          `**Rank:** XI\n**Players:** ${members.size}\n\n` + playerList
        )
        .setFooter({ text: roleName })
        .setColor(THEME);

      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "kick") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return message.reply("You need **Kick Members**.");
      }
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention someone to kick.");
      if (!member.kickable) {
        return message.reply("I can't kick that member. Check my role hierarchy and permissions.");
      }
      const reason = args.slice(1).join(" ") || "No reason provided";
      await member.kick(reason);
      return message.reply(`Kicked **${member.user.tag}**.`);
    }

    if (commandName === "ban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return message.reply("You need **Ban Members**.");
      }
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention someone to ban.");
      if (!member.bannable) {
        return message.reply("I can't ban that member. Check my role hierarchy and permissions.");
      }
      const reason = args.slice(1).join(" ") || "No reason provided";
      await member.ban({ reason });
      return message.reply(`Banned **${member.user.tag}**.`);
    }

    if (commandName === "unban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return message.reply("You need **Ban Members**.");
      }
      const userId = args[0];
      if (!userId) return message.reply("Use `?unban <userID>`.");
      await message.guild.members.unban(userId);
      return message.reply(`Unbanned **${userId}**.`);
    }

    if (commandName === "timeout") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("You need **Moderate Members**.");
      }
      const member = message.mentions.members.first();
      const minutes = parseInt(args[1]);
      if (!member || !minutes || minutes < 1) {
        return message.reply("Use `?timeout @user <minutes>`.");
      }
      if (!member.moderatable) return message.reply("I can't timeout that member.");
      await member.timeout(minutes * 60 * 1000, "Timed out by moderator");
      return message.reply(`Timed out **${member.user.tag}** for **${minutes} minutes**.`);
    }

    if (commandName === "untimeout") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("You need **Moderate Members**.");
      }
      const member = message.mentions.members.first();
      if (!member) return message.reply("Use `?untimeout @user`.");
      await member.timeout(null);
      return message.reply(`Removed timeout from **${member.user.tag}**.`);
    }

    if (commandName === "warn") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("You need **Moderate Members**.");
      }
      const member = message.mentions.members.first();
      if (!member) return message.reply("Use `?warn @user [reason]`.");
      const reason = args.slice(1).join(" ") || "No reason provided";
      return message.channel.send(
        `**Warning issued**\n<@${member.id}>\nReason: **${reason}**`
      );
    }

    if (commandName === "slowmode") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("You need **Manage Channels**.");
      }
      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
        return message.reply("Use a value between **0 and 21600** seconds.");
      }
      await message.channel.setRateLimitPerUser(seconds);
      return message.reply(`Slowmode set to **${seconds}s**.`);
    }

    if (commandName === "lock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("You need **Manage Channels**.");
      }
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: false
      });
      return message.reply("Channel locked.");
    }

    if (commandName === "unlock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("You need **Manage Channels**.");
      }
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: null
      });
      return message.reply("Channel unlocked.");
    }

    if (commandName === "ping") {
      return message.reply(`Pong **${client.ws.ping}ms**.`);
    }

    if (commandName === "userinfo") {
      const member = message.mentions.members.first() || message.member;
      const roles = member.roles.cache
        .filter(role => role.id !== message.guild.id)
        .map(role => role.toString())
        .join(", ") || "None";

      const embed = new EmbedBuilder()
        .setTitle("USER INFORMATION")
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: "User", value: member.user.tag, inline: true },
          { name: "ID", value: member.id, inline: true },
          {
            name: "Joined",
            value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
            inline: true
          },
          { name: "Roles", value: roles.slice(0, 1024) }
        )
        .setColor(THEME);

      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "serverinfo") {
      const owner = await message.guild.fetchOwner();
      const embed = new EmbedBuilder()
        .setTitle("SERVER INFORMATION")
        .addFields(
          { name: "Server", value: message.guild.name, inline: true },
          { name: "Members", value: `${message.guild.memberCount}`, inline: true },
          { name: "Channels", value: `${message.guild.channels.cache.size}`, inline: true },
          { name: "Roles", value: `${message.guild.roles.cache.size}`, inline: true },
          { name: "Owner", value: `<@${owner.id}>`, inline: true },
          {
            name: "Created",
            value: `<t:${Math.floor(message.guild.createdTimestamp / 1000)}:R>`,
            inline: true
          }
        )
        .setColor(THEME);

      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "avatar") {
      const user = message.mentions.users.first() || message.author;
      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Avatar`)
        .setImage(user.displayAvatarURL({ size: 1024 }))
        .setColor(THEME);

      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "say") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("You need **Manage Messages**.");
      }
      const text = args.join(" ");
      if (!text) return message.reply("Use `?say <message>`.");
      await message.delete().catch(() => {});
      return message.channel.send(text);
    }

    if (commandName === "announce") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("You need **Manage Messages**.");
      }
      const text = args.join(" ");
      if (!text) return message.reply("Use `?announce <message>`.");

      const embed = new EmbedBuilder()
        .setTitle("ANNOUNCEMENT")
        .setDescription(text)
        .setFooter({ text: `Posted by ${message.author.tag}` })
        .setColor(THEME);

      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "poll") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("You need **Manage Messages**.");
      }
      const question = args.join(" ");
      if (!question) return message.reply("Use `?poll <question>`.");

      const embed = new EmbedBuilder()
        .setTitle("POLL")
        .setDescription(question)
        .setFooter({ text: `Poll by ${message.author.tag}` })
        .setColor(THEME);

      const poll = await message.channel.send({ embeds: [embed] });
      await poll.react("👍");
      await poll.react("👎");
      return;
    }

    if (commandName === "membercount") {
      return message.reply(`This server has **${message.guild.memberCount}** members.`);
    }

    if (commandName === "uptime") {
      const total = Math.floor(client.uptime / 1000);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;

      return message.reply({
        embeds: [makeEmbed("BOT UPTIME", `**${days}d ${hours}h ${minutes}m ${seconds}s**`)]
      });
    }

    if (commandName === "roleinfo") {
      const role = message.mentions.roles.first();
      if (!role) return message.reply("Use `?roleinfo @role`.");

      return message.reply({
        embeds: [
          makeEmbed(
            "ROLE INFORMATION",
            [
              `**Role:** ${role}`,
              `**Members:** ${role.members.size}`,
              `**Position:** ${role.position}`,
              `**Created:** <t:${Math.floor(role.createdTimestamp / 1000)}:R>`,
              `**Mentionable:** ${role.mentionable ? "Yes" : "No"}`
            ].join("\n")
          )
        ]
      });
    }

    if (commandName === "channelinfo") {
      return message.reply({
        embeds: [
          makeEmbed(
            "CHANNEL INFORMATION",
            [
              `**Channel:** ${message.channel}`,
              `**Name:** ${message.channel.name}`,
              `**Type:** ${message.channel.type}`,
              `**ID:** \`${message.channel.id}\``,
              `**Created:** <t:${Math.floor(message.channel.createdTimestamp / 1000)}:R>`
            ].join("\n")
          )
        ]
      });
    }

    if (commandName === "servericon") {
      const icon = message.guild.iconURL({ size: 1024 });
      if (!icon) return message.reply("This server has no icon.");

      return message.reply({
        embeds: [
          makeEmbed("SERVER ICON", `**${message.guild.name}**`).setImage(icon)
        ]
      });
    }

    if (commandName === "choose") {
      const choices = args.join(" ").split("|").map(x => x.trim()).filter(Boolean);
      if (choices.length < 2) {
        return message.reply("Use `?choose option 1 | option 2 | option 3`.");
      }
      const choice = choices[Math.floor(Math.random() * choices.length)];
      return message.reply({
        embeds: [makeEmbed("CHOICE", `I choose: **${choice}**`)]
      });
    }

    if (commandName === "coinflip") {
      const result = Math.random() < 0.5 ? "HEADS" : "TAILS";
      return message.reply({
        embeds: [makeEmbed("COIN FLIP", `The coin landed on **${result}**.`)]
      });
    }

    if (commandName === "8ball") {
      const question = args.join(" ");
      if (!question) return message.reply("Ask a question: `?8ball <question>`.");

      const answers = [
        "Yes.",
        "No.",
        "Most likely.",
        "Definitely.",
        "Try again later.",
        "I wouldn't count on it.",
        "Looks promising.",
        "Very doubtful."
      ];

      const answer = answers[Math.floor(Math.random() * answers.length)];
      return message.reply({
        embeds: [
          makeEmbed(
            "8BALL",
            `**Question:** ${question}\n**Answer:** ${answer}`
          )
        ]
      });
    }

    if (commandName === "random") {
      const min = parseInt(args[0]);
      const max = parseInt(args[1]);
      if (Number.isNaN(min) || Number.isNaN(max) || min > max) {
        return message.reply("Use `?random <min> <max>`.");
      }
      const result = Math.floor(Math.random() * (max - min + 1)) + min;
      return message.reply({
        embeds: [makeEmbed("RANDOM NUMBER", `**${result}**`)]
      });
    }

    if (commandName === "topic") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("You need **Manage Channels**.");
      }
      const topic = args.join(" ");
      if (!topic) return message.reply("Use `?topic <text>`.");
      if (!message.channel.setTopic) {
        return message.reply("This channel doesn't support topics.");
      }
      await message.channel.setTopic(topic);
      return message.reply({
        embeds: [makeEmbed("CHANNEL TOPIC UPDATED", `**New topic:** ${topic}`)]
      });
    }

    if (commandName === "nick") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
        return message.reply("You need **Manage Nicknames**.");
      }
      const member = message.mentions.members.first();
      const nickname = args.slice(1).join(" ");
      if (!member || !nickname) {
        return message.reply("Use `?nick @user <new nickname>`.");
      }
      if (!member.manageable) {
        return message.reply("I can't change that member's nickname.");
      }
      await member.setNickname(nickname, `Changed by ${message.author.tag}`);
      return message.reply({
        embeds: [makeEmbed("NICKNAME UPDATED", `${member} is now **${nickname}**.`)]
      });
    }

    if (commandName === "online" || commandName === "offline" || commandName === "members") {
      await message.guild.members.fetch();

      const humans = message.guild.members.cache.filter(member => !member.user.bot);
      const onlineMembers = humans.filter(member => {
        const status = member.presence?.status;
        return status && status !== "offline";
      });
      const offlineMembers = humans.filter(member => {
        const status = member.presence?.status;
        return !status || status === "offline";
      });

      if (commandName === "online") {
        const list = [...onlineMembers.values()]
          .slice(0, 100)
          .map((member, index) => `**${index + 1}.** <@${member.id}>`)
          .join("\n") || "No online members found.";

        const embed = new EmbedBuilder()
          .setTitle(`ONLINE MEMBERS • ${onlineMembers.size}`)
          .setDescription(list)
          .setFooter({ text: `Showing up to 100 • Total members: ${humans.size}` })
          .setColor(THEME)
          .setTimestamp();

        return message.channel.send({ embeds: [embed] });
      }

      if (commandName === "offline") {
        const list = [...offlineMembers.values()]
          .slice(0, 100)
          .map((member, index) => `**${index + 1}.** ${member.user.tag}`)
          .join("\n") || "No offline members found.";

        const embed = new EmbedBuilder()
          .setTitle(`OFFLINE MEMBERS • ${offlineMembers.size}`)
          .setDescription(list)
          .setFooter({ text: `Showing up to 100 • Total members: ${humans.size}` })
          .setColor(THEME)
          .setTimestamp();

        return message.channel.send({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle("SERVER MEMBER STATUS")
        .addFields(
          { name: "Online", value: `**${onlineMembers.size}**`, inline: true },
          { name: "Offline", value: `**${offlineMembers.size}**`, inline: true },
          { name: "Total Humans", value: `**${humans.size}**`, inline: true }
        )
        .setColor(THEME)
        .setTimestamp();

      return message.channel.send({ embeds: [embed] });
    }

    if (commandName === "botinfo") {
      const uptime = Math.floor(client.uptime / 1000);
      return message.reply(
        `**${client.user.tag}**\n` +
        `Servers: **${client.guilds.cache.size}**\n` +
        `Ping: **${client.ws.ping}ms**\n` +
        `Uptime: **${uptime}s**`
      );
    }
  } catch (error) {
    console.error("Prefix command error:", error);
    return message.reply("Something went wrong while running that command.").catch(() => {});
  }
});

// INTERACTIONS (SLASH + BUTTONS)
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      // FRIENDLY
      if (interaction.commandName === "friendly") {
        if (!canHost(interaction.member)) {
          return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
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
            return interaction.reply({
              content: "There is already an active friendly in this server.",
              ephemeral: true
            });
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

        await interaction.reply({
          content: `✦ Friendly created for **${needed} players**.`,
          ephemeral: true
        });

        return;
      }

      // SCRIM
      if (interaction.commandName === "scrim") {
        if (!canHost(interaction.member)) {
          return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
        }

        const guildId = interaction.guildId;
        const scrimKey = `${guildId}_scrim`;
        const oldScrim = scrims.get(scrimKey);

        if (oldScrim) {
          let exists = false;
          try {
            await interaction.channel.messages.fetch(oldScrim.messageId);
            exists = true;
          } catch {}

          if (exists) {
            return interaction.reply({
              content: "There is already an active scrim in this server.",
              ephemeral: true
            });
          }

          scrims.delete(scrimKey);
        }

        const scrim = {
          hostId: interaction.user.id,
          channelId: interaction.channelId,
          messageId: null,
          teamA: new Map(),
          teamB: new Map(),
          locked: false
        };

        scrims.set(scrimKey, scrim);

        const msg = await interaction.channel.send({
          content: "@everyone",
          embeds: [createScrimEmbed(scrim)],
          components: createScrimButtons(scrim)
        });

        scrim.messageId = msg.id;

        await interaction.reply({
          content: "✦ 7v7 scrim created (3-1-2 for both teams).",
          ephemeral: false
        });

        return;
      }

      // ACTIVITY
      if (interaction.commandName === "activity") {
        const guildId = interaction.guildId;
        const oldActivity = activities.get(guildId);

        if (oldActivity) {
          let exists = false;
          try {
            await interaction.channel.messages.fetch(oldActivity.messageId);
            exists = true;
          } catch {}

          if (exists) {
            return interaction.reply({
              content: "There is already an active activity check in this server.",
              ephemeral: true
            });
          }

          activities.delete(guildId);
        }

        const needed = interaction.options.getInteger("needed");
        const activity = {
          needed,
          reacted: new Set(),
          messageId: null,
          completed: false
        };

        activities.set(guildId, activity);

        const msg = await interaction.channel.send({
          content: "@everyone",
          embeds: [createActivityCheckEmbed(activity)]
        });

        activity.messageId = msg.id;

        await msg.react("🔥");

        await interaction.reply({
          content: "✦ Activity check started.",
          ephemeral: false
        });

        return;
      }

      // LINEUP 3-1-3
      if (interaction.commandName === "lineup") {
        if (!canHost(interaction.member)) {
          return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
        }

        const guildId = interaction.guildId;
        const oldLineup = lineups.get(guildId);

        if (oldLineup) {
          let exists = false;
          try {
            await interaction.channel.messages.fetch(oldLineup.messageId);
            exists = true;
          } catch {}

          if (exists) {
            return interaction.reply({
              content: "There is already an active 3-1-3 lineup in this server.",
              ephemeral: true
            });
          }

          lineups.delete(guildId);
        }

        const lineupObj = {
          hostId: interaction.user.id,
          messageId: null,
          positions: new Map(), // position -> userId
          locked: false
        };

        lineups.set(guildId, lineupObj);

        const msg = await interaction.channel.send({
          content: "@everyone",
          embeds: [createLineup8Embed(lineupObj)],
          components: createLineup8Buttons(lineupObj)
        });

        lineupObj.messageId = msg.id;

        await interaction.reply({
          content: "✦ 3-1-3 lineup created (8 players).",
          ephemeral: false
        });

        return;
      }

      return;
    }

    if (!interaction.isButton()) return;

    const guildId = interaction.guildId;

    // FRIENDLY BUTTONS
    const game = games.get(guildId);
    if (
      game &&
      (
        interaction.message.id === game.activityMessageId ||
        interaction.message.id === game.lineupMessageId
      )
    ) {
      if (interaction.customId === "friendly_play") {
        game.players.add(interaction.user.id);

        const activity = await interaction.channel.messages.fetch(game.activityMessageId);
        await activity.edit({
          embeds: [createActivityEmbed(game)],
          components: [activityButtons(game)]
        });

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
          if (playerId === interaction.user.id) {
            game.lineup.delete(position);
          }
        }

        const activity = await interaction.channel.messages.fetch(game.activityMessageId);
        await activity.edit({
          embeds: [createActivityEmbed(game)],
          components: [activityButtons(game)]
        });

        if (game.lineupMessageId) {
          try {
            const lineup = await interaction.channel.messages.fetch(game.lineupMessageId);
            await lineup.edit({
              embeds: [createLineupEmbed(game)],
              components: createLineupButtons(game)
            });
          } catch {}
        }

        return interaction.reply({ content: "You are marked as unavailable.", ephemeral: true });
      }

      if (interaction.customId === "friendly_reset") {
        if (interaction.user.id !== game.hostId) {
          return interaction.reply({
            content: "Only the host can reset the friendly.",
            ephemeral: true
          });
        }

        game.players.clear();
        game.lineup.clear();
        game.lineupStarted = false;
        game.locked = false;
        game.subMode = false;

        const activity = await interaction.channel.messages.fetch(game.activityMessageId);
        await activity.edit({
          embeds: [createActivityEmbed(game)],
          components: [activityButtons(game)]
        });

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
        if (game.locked) {
          return interaction.reply({ content: "The lineup is locked.", ephemeral: true });
        }

        game.subMode = !game.subMode;
        await interaction.message.edit({
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });

        return interaction.reply({
          content: game.subMode ? "SUB mode enabled." : "SUB mode disabled.",
          ephemeral: true
        });
      }

      if (interaction.customId === "lock_lineup") {
        if (interaction.user.id !== game.hostId) {
          return interaction.reply({
            content: "Only the host can lock the lineup.",
            ephemeral: true
          });
        }

        if (game.lineup.size < game.needed) {
          return interaction.reply({
            content: "Every position must be filled first.",
            ephemeral: true
          });
        }

        game.locked = true;
        game.subMode = false;

        await interaction.message.edit({
          embeds: [createLineupEmbed(game)],
          components: []
        });

        return interaction.reply({ content: "Lineup locked.", ephemeral: true });
      }

      if (interaction.customId.startsWith("position_")) {
        if (game.locked) {
          return interaction.reply({ content: "The lineup is locked.", ephemeral: true });
        }

        const position = interaction.customId.replace("position_", "");
        const currentPlayer = game.lineup.get(position);

        if (game.subMode) {
          if (!currentPlayer) {
            return interaction.reply({ content: "That position is empty.", ephemeral: true });
          }
          if (currentPlayer === interaction.user.id) {
            return interaction.reply({ content: "You can't sub yourself.", ephemeral: true });
          }

          game.lineup.set(position, interaction.user.id);
          game.players.add(interaction.user.id);
          game.subMode = false;

          await interaction.message.edit({
            embeds: [createLineupEmbed(game)],
            components: createLineupButtons(game)
          });

          return interaction.reply({
            content: `You replaced <@${currentPlayer}> at **${position}**.`,
            ephemeral: true
          });
        }

        if (!game.players.has(interaction.user.id)) {
          return interaction.reply({
            content: "You must click CAN PLAY first.",
            ephemeral: true
          });
        }

        if (currentPlayer) {
          if (currentPlayer === interaction.user.id) {
            game.lineup.delete(position);
            await interaction.message.edit({
              embeds: [createLineupEmbed(game)],
              components: createLineupButtons(game)
            });
            return interaction.reply({
              content: `You left **${position}**.`,
              ephemeral: true
            });
          }

          return interaction.reply({
            content: `**${position}** is already taken.`,
            ephemeral: true
          });
        }

        for (const [oldPosition, playerId] of game.lineup) {
          if (playerId === interaction.user.id) {
            game.lineup.delete(oldPosition);
          }
        }

        game.lineup.set(position, interaction.user.id);
        await interaction.message.edit({
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });

        return interaction.reply({
          content: `You are now **${position}**.`,
          ephemeral: true
        });
      }
    }

    // SCRIM BUTTONS
    const scrimKey = `${guildId}_scrim`;
    const scrim = scrims.get(scrimKey);

    if (scrim && interaction.message.id === scrim.messageId) {
      if (scrim.locked) {
        return interaction.reply({ content: "The scrim is locked.", ephemeral: true });
      }

      if (interaction.customId === "scrim_lock") {
        if (interaction.user.id !== scrim.hostId) {
          return interaction.reply({
            content: "Only the host can lock the scrim.",
            ephemeral: true
          });
        }

        const totalFilled = scrim.teamA.size + scrim.teamB.size;
        if (totalFilled < 14) {
          return interaction.reply({
            content: "All 14 positions (7 per team) must be filled before locking.",
            ephemeral: true
          });
        }

        scrim.locked = true;
        await interaction.message.edit({
          embeds: [createScrimEmbed(scrim)],
          components: []
        });

        return interaction.reply({ content: "Scrim lineups locked.", ephemeral: true });
      }

      if (interaction.customId.startsWith("scrim_pos_")) {
        const parts = interaction.customId.split("_"); // ["scrim","pos","A","GK"]
        const teamLabel = parts[2]; // "A" or "B"
        const position = parts.slice(3).join("_");

        const teamMap = teamLabel === "A" ? scrim.teamA : scrim.teamB;
        const otherTeamMap = teamLabel === "A" ? scrim.teamB : scrim.teamA;

        const currentPlayer = teamMap.get(position);

        // Remove from other team if present
        for (const [pos, pid] of otherTeamMap) {
          if (pid === interaction.user.id) {
            otherTeamMap.delete(pos);
          }
        }

        if (currentPlayer) {
          if (currentPlayer === interaction.user.id) {
            teamMap.delete(position);
          } else {
            return interaction.reply({
              content: `That position on Team ${teamLabel} is already taken.`,
              ephemeral: true
            });
          }
        } else {
          teamMap.set(position, interaction.user.id);
        }

        await interaction.message.edit({
          embeds: [createScrimEmbed(scrim)],
          components: createScrimButtons(scrim)
        });

        return interaction.reply({
          content: `Updated your position on Team ${teamLabel}.`,
          ephemeral: true
        });
      }
    }

    // LINEUP 3-1-3 BUTTONS
    const lineupObj = lineups.get(guildId);
    if (lineupObj && interaction.message.id === lineupObj.messageId) {
      if (lineupObj.locked) {
        return interaction.reply({ content: "The lineup is locked.", ephemeral: true });
      }

      if (interaction.customId === "lineup8_lock") {
        if (interaction.user.id !== lineupObj.hostId) {
          return interaction.reply({
            content: "Only the host can lock the lineup.",
            ephemeral: true
          });
        }

        if (lineupObj.positions.size < 8) {
          return interaction.reply({
            content: "All 8 positions must be filled before locking.",
            ephemeral: true
          });
        }

        lineupObj.locked = true;
        await interaction.message.edit({
          embeds: [createLineup8Embed(lineupObj)],
          components: []
        });

        return interaction.reply({ content: "3-1-3 lineup locked.", ephemeral: true });
      }

      if (interaction.customId.startsWith("lineup8_pos_")) {
        const position = interaction.customId.replace("lineup8_pos_", "");
        const currentPlayer = lineupObj.positions.get(position);

        if (currentPlayer) {
          if (currentPlayer === interaction.user.id) {
            // leave position
            lineupObj.positions.delete(position);
          } else {
            return interaction.reply({
              content: `**${position}** is already taken.`,
              ephemeral: true
            });
          }
        } else {
          // take position
          lineupObj.positions.set(position, interaction.user.id);
        }

        await interaction.message.edit({
          embeds: [createLineup8Embed(lineupObj)],
          components: createLineup8Buttons(lineupObj)
        });

        return interaction.reply({
          content: currentPlayer && currentPlayer === interaction.user.id
            ? `You left **${position}**.`
            : `You are now **${position}**.`,
          ephemeral: true
        });
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true })
        .catch(() => {});
    }
  }
});

// ACTIVITY REACTIONS
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  const message = reaction.message;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const activity = activities.get(guildId);
  if (!activity || message.id !== activity.messageId) return;
  if (activity.completed) return;

  // Only count 🔥
  if (reaction.emoji.name !== "🔥") return;

  if (!activity.reacted.has(user.id)) {
    activity.reacted.add(user.id);
  }

  try {
    await message.edit({ embeds: [createActivityCheckEmbed(activity)] });
  } catch {}

  if (activity.reacted.size >= activity.needed) {
    activity.completed = true;
    try {
      await message.edit({ embeds: [createActivityCheckEmbed(activity)] });
    } catch {}
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  const message = reaction.message;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const activity = activities.get(guildId);
  if (!activity || message.id !== activity.messageId) return;

  if (reaction.emoji.name !== "🔥") return;

  if (activity.reacted.has(user.id)) {
    activity.reacted.delete(user.id);
  }

  if (activity.completed && activity.reacted.size < activity.needed) {
    activity.completed = false;
  }

  try {
    await message.edit({ embeds: [createActivityCheckEmbed(activity)] });
  } catch {}
});

client.login(process.env.TOKEN);
