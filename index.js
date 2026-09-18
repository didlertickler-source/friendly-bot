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
const lineups = new Map();     // guildId -> lineup
const lifecycle = new Map();   // messageId -> panel info

const PREFIX = "?";
const HOSTER_ROLE = "〔✦〕FF Hoster";
const TRIAL_HOSTER_ROLE = "〔✦〕Trial Hoster";
const THEME = 0x16A085;
const ACCENT = 0xF1C40F;
const MAX_ACTIVE_PANELS = 3;
const FRIENDLY_TTL = 2 * 60 * 60 * 1000;

function makeEmbed(title, description = "") {
  return new EmbedBuilder()
    .setColor(THEME)
    .setTitle(`〔✦〕 ${title}`)
    .setDescription(String(description).slice(0, 4096))
    .setFooter({ text: "Real Betis • Match Operations" })
    .setTimestamp();
}

function hasRole(member, name) {
  return Boolean(member?.roles?.cache?.some(role => role.name === name));
}

function canHost(member) {
  return Boolean(member && (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    hasRole(member, HOSTER_ROLE) ||
    hasRole(member, TRIAL_HOSTER_ROLE)
  ));
}

function canManageOperation(member, operation) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (hasRole(member, HOSTER_ROLE)) return true;
  return operation === "friendly" || operation === "activity" || operation === "lineup" ? hasRole(member, TRIAL_HOSTER_ROLE) : false;
}

function hostOnlyMessage() {
  return `You need **Administrator**, **${HOSTER_ROLE}**, or **${TRIAL_HOSTER_ROLE}**.`;
}

function moveExclusive(map, userId, position) {
  for (const [oldPosition, playerId] of map) {
    if (playerId === userId && oldPosition !== position) map.delete(oldPosition);
  }
  map.set(position, userId);
}

function removeUser(map, userId) {
  for (const [position, playerId] of map) if (playerId === userId) map.delete(position);
}

function findPanel(guildId, messageId) {
  const panel = lifecycle.get(messageId);
  return panel && panel.guildId === guildId ? panel : null;
}

function registerPanel(message, guildId, type) {
  lifecycle.set(message.id, { guildId, type, createdAt: Date.now() });
  const panels = [...lifecycle.entries()].filter(([, p]) => p.guildId === guildId).sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (panels.length > MAX_ACTIVE_PANELS) {
    const [messageId] = panels.shift();
    lifecycle.delete(messageId);
    games.delete(guildId);
    activities.delete(guildId);
    lineups.delete(guildId);
    scrims.delete(`${guildId}_scrim`);
  }
}

async function getMessage(channel, id) {
  if (!channel || !id) return null;
  try { return await channel.messages.fetch(id); } catch { return null; }
}

async function closeFriendly(guildId) {
  const game = games.get(guildId);
  if (!game) return false;
  const channel = client.channels.cache.get(game.channelId);
  for (const id of [game.activityMessageId, game.lineupMessageId]) {
    const message = await getMessage(channel, id);
    if (message) await message.delete().catch(() => {});
    if (id) lifecycle.delete(id);
  }
  games.delete(guildId);
  return true;
}

function activityStatus(activity) {
  return activity.completed ? "COMPLETED" : activity.reacted.size >= activity.needed ? "READY" : "OPEN";
}

const formations = {
  4: { name: "2-1", positions: ["GK", "LB", "RB", "ST"] },
  5: { name: "2-1-1", positions: ["GK", "LB", "RB", "CAM", "ST"] },
  6: { name: "2-1-2", positions: ["GK", "LB", "RB", "CAM", "LW", "RW"] },
  7: { name: "3-1-2", positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "RW"] },
  8: { name: "3-1-3", positions: ["GK", "LB", "CB", "RB", "CM", "LW", "ST", "RW"] },
  9: { name: "3-2-3", positions: ["GK", "LB", "CB", "RB", "LCM", "RCM", "LW", "ST", "RW"] },
  10: { name: "4-2-3", positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "ST", "RW"] },
  11: { name: "4-3-3", positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "CAM", "RCM", "LW", "ST", "RW"] }
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
  .setDescription("Start a football lineup picker")
  .addIntegerOption(option => option.setName("players").setDescription("Players required (4-11)").setRequired(false).setMinValue(4).setMaxValue(11));

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

// EMBEDS AND COMPONENTS
function createActivityEmbed(game) {
  const formation = formations[game.needed];
  const players = [...game.players];
  return new EmbedBuilder()
    .setColor(players.length >= game.needed ? 0x2ECC71 : THEME)
    .setTitle("〔✦〕 FRIENDLY • PLAYER CHECK")
    .setDescription(`**${players.length >= game.needed ? "READY FOR LINEUP" : "RECRUITING PLAYERS"}**\n\n${players.length}/${game.needed} players confirmed\nFormation: **${formation.name}**\n\n${players.length ? players.map((id, i) => `**${i + 1}.** <@${id}>`).join("\n") : "No players have confirmed yet."}`)
    .addFields(
      { name: "Player actions", value: "✅ CAN PLAY confirms you\n❌ CAN'T PLAY removes you", inline: true },
      { name: "Host controls", value: "Reset, close, open lineup, replace, and lock", inline: true }
    )
    .setFooter({ text: game.expiresAt ? `Auto-closes <t:${Math.floor(game.expiresAt / 1000)}:R>` : "Betis Match Operations" })
    .setTimestamp();
}

function activityButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("friendly_play").setLabel("CAN PLAY").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("friendly_no").setLabel("CAN'T PLAY").setEmoji("❌").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("friendly_reset").setLabel("RESET").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("close_friendly").setLabel("CLOSE").setStyle(ButtonStyle.Secondary)
  );
}

function createLineupEmbed(game) {
  const formation = formations[game.needed];
  const slots = formation.positions.map(position => `${game.lineup.has(position) ? "🟢" : "⚪"} **${position}** — ${game.lineup.has(position) ? `<@${game.lineup.get(position)}>` : "OPEN"}`).join("\n");
  return new EmbedBuilder()
    .setColor(game.locked ? 0x2ECC71 : THEME)
    .setTitle(`〔✦〕 LINEUP BOARD • ${formation.name}`)
    .setDescription(slots)
    .addFields(
      { name: "Squad", value: `${game.lineup.size}/${game.needed} filled`, inline: true },
      { name: "Status", value: game.locked ? "LOCKED" : game.subMode ? "SUB MODE" : "OPEN", inline: true },
      { name: "Smart selection", value: "Each player can occupy one position only. Choosing another position automatically transfers them and clears the old slot.", inline: false }
    )
    .setFooter({ text: game.locked ? "LINEUP LOCKED" : game.subMode ? "Select a filled position to replace its player" : "Select a position to join" })
    .setTimestamp();
}

function createLineupButtons(game) {
  const rows = [];
  let row = [];
  for (const position of formations[game.needed].positions) {
    const player = game.lineup.get(position);
    row.push(new ButtonBuilder().setCustomId(`position_${position}`).setLabel(player ? `${position} ✓` : position).setStyle(game.subMode && player ? ButtonStyle.Danger : player ? ButtonStyle.Success : ButtonStyle.Secondary));
    if (row.length === 5) { rows.push(new ActionRowBuilder().addComponents(row)); row = []; }
  }
  if (row.length) rows.push(new ActionRowBuilder().addComponents(row));
  if (!game.locked) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sub_mode").setLabel(game.subMode ? "CANCEL SUB" : "SUB MODE").setStyle(game.subMode ? ButtonStyle.Danger : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("lock_lineup").setLabel("LOCK LINEUP").setEmoji("🔒").setStyle(ButtonStyle.Success)
  ));
  return rows;
}

const SCRIM_FORMATION_7 = formations[7];
function buildTeamLines(team) {
  return SCRIM_FORMATION_7.positions.map(pos => `${team.has(pos) ? "🟢" : "⚪"} **${pos}** — ${team.has(pos) ? `<@${team.get(pos)}>` : "OPEN"}`);
}
function createScrimEmbed(scrim) {
  return new EmbedBuilder()
    .setColor(scrim.locked ? 0x2ECC71 : THEME)
    .setTitle("〔✦〕 SCRIM BOARD • 7V7")
    .setDescription(`**TEAM A**\n${buildTeamLines(scrim.teamA).join("\n")}\n\n**TEAM B**\n${buildTeamLines(scrim.teamB).join("\n")}`)
    .addFields(
      { name: "Formation", value: "3-1-2 per team", inline: true },
      { name: "Players", value: `${scrim.teamA.size + scrim.teamB.size}/14`, inline: true },
      { name: "Exclusive slots", value: "A player can only be assigned to one team and one position.", inline: false }
    )
    .setFooter({ text: scrim.locked ? "SCRIM LOCKED" : "Choose a team position • Host locks when complete" })
    .setTimestamp();
}
function teamRows(team, label) {
  const rows = []; let row = [];
  for (const pos of SCRIM_FORMATION_7.positions) {
    const player = team.get(pos);
    row.push(new ButtonBuilder().setCustomId(`scrim_pos_${label}_${pos}`).setLabel(player ? `${label} ${pos} ✓` : `${label} ${pos}`).setStyle(player ? ButtonStyle.Success : ButtonStyle.Secondary));
    if (row.length === 5) { rows.push(new ActionRowBuilder().addComponents(row)); row = []; }
  }
  if (row.length) rows.push(new ActionRowBuilder().addComponents(row));
  return rows;
}
function createScrimButtons(scrim) {
  const rows = [...teamRows(scrim.teamA, "A"), ...teamRows(scrim.teamB, "B")];
  if (!scrim.locked) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("scrim_lock").setLabel("LOCK SCRIM").setEmoji("🔒").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("close_scrim").setLabel("CLOSE").setStyle(ButtonStyle.Secondary)));
  return rows;
}

function createActivityCheckEmbed(activity) {
  const users = [...activity.reacted];
  return new EmbedBuilder()
    .setColor(activity.completed ? 0x2ECC71 : THEME)
    .setTitle("〔✦〕 ACTIVITY CHECK • REAL BETIS")
    .setDescription(`React with 🔥 to show your activity.\n\n**Progress:** ${users.length}/${activity.needed}\n${users.length ? users.map((id, i) => `**${i + 1}.** <@${id}>`).join("\n") : "Nobody has reacted yet."}`)
    .addFields({ name: "Status", value: activityStatus(activity), inline: true }, { name: "Host action", value: "Close this check when finished to start another one.", inline: true })
    .setFooter({ text: "One 🔥 reaction per member" })
    .setTimestamp();
}

function createLineup8Embed(obj) {
  const formation = formations[obj.needed] || formations[8];
  const text = formation.positions.map(pos => `${obj.positions.has(pos) ? "🟢" : "⚪"} **${pos}** — ${obj.positions.has(pos) ? `<@${obj.positions.get(pos)}>` : "OPEN"}`).join("\n");
  return new EmbedBuilder().setColor(obj.locked ? 0x2ECC71 : THEME).setTitle(`〔✦〕 LINEUP BOARD • ${formation.name}`).setDescription(text).addFields({ name: "Squad", value: `${obj.positions.size}/${formation.positions.length}`, inline: true }, { name: "Rule", value: "One player, one position. Picking a new slot transfers the player.", inline: false }).setFooter({ text: obj.locked ? "LINEUP LOCKED" : "Select a position to join or leave" }).setTimestamp();
}
function createLineup8Buttons(obj) {
  const formation = formations[obj.needed] || formations[8];
  const rows = []; let row = [];
  for (const pos of formation.positions) {
    const player = obj.positions.get(pos);
    row.push(new ButtonBuilder().setCustomId(`lineup8_pos_${pos}`).setLabel(player ? `${pos} ✓` : pos).setStyle(player ? ButtonStyle.Success : ButtonStyle.Secondary));
    if (row.length === 5) { rows.push(new ActionRowBuilder().addComponents(row)); row = []; }
  }
  if (row.length) rows.push(new ActionRowBuilder().addComponents(row));
  if (!obj.locked) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("lineup8_lock").setLabel("LOCK LINEUP").setEmoji("🔒").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("close_lineup").setLabel("CLOSE").setStyle(ButtonStyle.Secondary)));
  return rows;
}

// CLEANUP ON MESSAGE DELETE
client.on("messageDelete", message => {
  if (!message.guild) return;
  lifecycle.delete(message.id);
  const guildId = message.guild.id;
  const game = games.get(guildId);
  if (game && [game.activityMessageId, game.lineupMessageId].includes(message.id)) games.delete(guildId);
  const scrim = scrims.get(`${guildId}_scrim`);
  if (scrim?.messageId === message.id) scrims.delete(`${guildId}_scrim`);
  const activity = activities.get(guildId);
  if (activity?.messageId === message.id) activities.delete(guildId);
  const lineup = lineups.get(guildId);
  if (lineup?.messageId === message.id) lineups.delete(guildId);
});

setInterval(async () => {
  for (const [guildId, game] of games) if (game.expiresAt && Date.now() >= game.expiresAt) await closeFriendly(guildId);
}, 60_000);

// If three new operational messages are posted after a panel, stale state is removed.
client.on("messageCreate", message => {
  if (!message.guild || message.author.bot) return;
  const panel = [...lifecycle.entries()].filter(([, p]) => p.guildId === message.guild.id).sort((a, b) => a[1].createdAt - b[1].createdAt);
  if (panel.length >= MAX_ACTIVE_PANELS) {
    const [oldestId] = panel[0];
    lifecycle.delete(oldestId);
    games.delete(message.guild.id);
    activities.delete(message.guild.id);
    lineups.delete(message.guild.id);
    scrims.delete(`${message.guild.id}_scrim`);
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
      const help = [
        "### ⚽ MATCH OPERATIONS",
        "`/friendly <players>` — recruit players and open a lineup",
        "`/scrim` — create a 7v7 scrim with two 3-1-2 teams",
        "`/activity <needed>` — run a 🔥 activity check",
        "`/lineup [players]` — create a standalone lineup",
        "",
        "### 📋 SMART LINEUPS",
        "One player can never hold two positions. Choosing a new slot automatically transfers them.",
        "Hosts can enable sub mode, replace players, lock panels, or close the operation.",
        "",
        "### 🛡️ ACCESS",
        `Host commands: Administrator, ${HOSTER_ROLE}, or ${TRIAL_HOSTER_ROLE}.`,
        "Moderation commands still require their matching Discord permission.",
        "",
        "### 🧰 OPERATIONS",
        "`?matchstatus` `?formations` `?closefriendly` `?closescrim` `?closeactivity` `?closelineup`",
        "",
        "### 🛠️ UTILITIES",
        "`?ping` `?uptime` `?botinfo` `?teamrank XI` `?serverinfo` `?userinfo` `?avatar`",
        "`?poll` `?choose` `?coinflip` `?8ball` `?random`"
      ];
      return message.reply({ embeds: [makeEmbed("COMMAND CENTER", help.join("\n"))] });
    }

    if (commandName === "formations" || commandName === "formation") {
      const list = Object.values(formations).map(f => `**${f.name}** — ${f.positions.length} players — ${f.positions.join(" • ")}`).join("\n");
      return message.reply({ embeds: [makeEmbed("AVAILABLE FORMATIONS", list)] });
    }

    if (commandName === "matchstatus" || commandName === "status") {
      const guildId = message.guild.id;
      const game = games.get(guildId), scrim = scrims.get(`${guildId}_scrim`), activity = activities.get(guildId), lineup = lineups.get(guildId);
      return message.reply({ embeds: [makeEmbed("LIVE OPERATIONS", [`Friendly: ${game ? `${game.players.size}/${game.needed}` : "none"}`, `Scrim: ${scrim ? `${scrim.teamA.size + scrim.teamB.size}/14` : "none"}`, `Activity: ${activity ? `${activity.reacted.size}/${activity.needed}` : "none"}`, `Lineup: ${lineup ? `${lineup.positions.size}/${(formations[lineup.needed] || formations[8]).positions.length}` : "none"}`].join("\n"))] });
    }

    if (["closefriendly", "closescrim", "closeactivity", "closelineup"].includes(commandName)) {
      if (!canHost(message.member)) return message.reply(hostOnlyMessage());
      const guildId = message.guild.id;
      if (commandName === "closefriendly") await closeFriendly(guildId);
      if (commandName === "closescrim") { const key = `${guildId}_scrim`; const item = scrims.get(key); const msg = item ? await getMessage(message.channel, item.messageId) : null; if (msg) await msg.delete().catch(() => {}); scrims.delete(key); }
      if (commandName === "closeactivity") { const item = activities.get(guildId); const msg = item ? await getMessage(message.channel, item.messageId) : null; if (msg) await msg.delete().catch(() => {}); activities.delete(guildId); }
      if (commandName === "closelineup") { const item = lineups.get(guildId); const msg = item ? await getMessage(message.channel, item.messageId) : null; if (msg) await msg.delete().catch(() => {}); lineups.delete(guildId); }
      return message.reply({ embeds: [makeEmbed("OPERATION CLOSED", "The active panel was closed. You can start another operation now.")] });
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
        if (games.has(guildId)) await closeFriendly(guildId);

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
          subMode: false,
          expiresAt: Date.now() + FRIENDLY_TTL
        };

        games.set(guildId, game);

        try {
          const activity = await interaction.channel.send({
            content: null, // no @everyone ping
            embeds: [createActivityEmbed(game)],
            components: [activityButtons()]
          });

          game.activityMessageId = activity.id;
          registerPanel(activity, guildId, "friendly");
        } catch (err) {
          console.error("Failed to create friendly panel:", err);
          return interaction.reply({ content: "I don't have permission to post panels in this channel.", ephemeral: true });
        }

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
          const oldMessage = await getMessage(interaction.channel, oldScrim.messageId);
          if (oldMessage) await oldMessage.delete().catch(() => {});
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

        try {
          const msg = await interaction.channel.send({
            content: null,
            embeds: [createScrimEmbed(scrim)],
            components: createScrimButtons(scrim)
          });

          scrim.messageId = msg.id;
          registerPanel(msg, guildId, "scrim");
        } catch (err) {
          console.error("Failed to create scrim panel:", err);
          return interaction.reply({ content: "I don't have permission to post panels in this channel.", ephemeral: true });
        }

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
          const oldMessage = await getMessage(interaction.channel, oldActivity.messageId);
          if (oldMessage) await oldMessage.delete().catch(() => {});
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

        try {
          const msg = await interaction.channel.send({
            content: null,
            embeds: [createActivityCheckEmbed(activity)]
          });

          activity.messageId = msg.id;
          activity.guildId = guildId;
          registerPanel(msg, guildId, "activity");

          await msg.react("🔥");
        } catch (err) {
          console.error("Failed to create activity check:", err);
          return interaction.reply({ content: "I don't have permission to post panels in this channel.", ephemeral: true });
        }

        await interaction.reply({
          content: "✦ Activity check started.",
          ephemeral: false
        });

        return;
      }

      // LINEUP
      if (interaction.commandName === "lineup") {
        if (!canHost(interaction.member)) {
          return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
        }

        const guildId = interaction.guildId;
        const oldLineup = lineups.get(guildId);
        if (oldLineup) {
          const oldMessage = await getMessage(interaction.channel, oldLineup.messageId);
          if (oldMessage) await oldMessage.delete().catch(() => {});
          lineups.delete(guildId);
        }

        const lineupObj = {
          hostId: interaction.user.id,
          messageId: null,
          needed: interaction.options.getInteger("players") || 8,
          positions: new Map(),
          locked: false
        };

        lineups.set(guildId, lineupObj);

        try {
          const msg = await interaction.channel.send({
            content: null,
            embeds: [createLineup8Embed(lineupObj)],
            components: createLineup8Buttons(lineupObj)
          });

          lineupObj.messageId = msg.id;
          registerPanel(msg, guildId, "lineup");
        } catch (err) {
          console.error("Failed to create lineup panel:", err);
          return interaction.reply({ content: "I don't have permission to post panels in this channel.", ephemeral: true });
        }

        await interaction.reply({
          content: `✦ ${(formations[lineupObj.needed] || formations[8]).name} lineup created (${lineupObj.needed} players).`,
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
        if (game.locked) return interaction.reply({ content: "This friendly is already locked.", ephemeral: true });
        game.players.add(interaction.user.id);

        try {
          const activity = await interaction.channel.messages.fetch(game.activityMessageId);
          await activity.edit({
            embeds: [createActivityEmbed(game)],
            components: [activityButtons()]
          });
        } catch {}

        if (game.players.size >= game.needed && !game.lineupStarted) {
          game.lineupStarted = true;
          try {
            const lineup = await interaction.channel.send({
              embeds: [createLineupEmbed(game)],
              components: createLineupButtons(game)
            });
            game.lineupMessageId = lineup.id;
            registerPanel(lineup, guildId, "friendly-lineup");
          } catch {}
        }

        return interaction.reply({ content: "You are marked as available.", ephemeral: true });
      }

      if (interaction.customId === "friendly_no") {
        if (game.locked) return interaction.reply({ content: "This friendly is already locked.", ephemeral: true });
        game.players.delete(interaction.user.id);

        for (const [position, playerId] of game.lineup) {
          if (playerId === interaction.user.id) {
            game.lineup.delete(position);
          }
        }

        try {
          const activity = await interaction.channel.messages.fetch(game.activityMessageId);
          await activity.edit({
            embeds: [createActivityEmbed(game)],
            components: [activityButtons()]
          });
        } catch {}

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

      if (interaction.customId === "close_friendly") {
        if (interaction.user.id !== game.hostId && !canHost(interaction.member)) return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
        await closeFriendly(guildId);
        return interaction.update({ content: "Friendly closed. You can start another one now.", embeds: [], components: [] });
      }

      if (interaction.customId === "friendly_reset") {
        if (interaction.user.id !== game.hostId && !canHost(interaction.member)) {
          return interaction.reply({
            content: "Only the friendly host or an authorised hoster can reset the friendly.",
            ephemeral: true
          });
        }

        game.players.clear();
        game.lineup.clear();
        game.lineupStarted = false;
        game.locked = false;
        game.subMode = false;

        try {
          const activity = await interaction.channel.messages.fetch(game.activityMessageId);
          await activity.edit({
            embeds: [createActivityEmbed(game)],
            components: [activityButtons()]
          });
        } catch {}

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
        if (interaction.user.id !== game.hostId && !canHost(interaction.member)) return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
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
        if (interaction.user.id !== game.hostId && !canHost(interaction.member)) {
          return interaction.reply({
            content: "Only the host or an authorised hoster can lock the lineup.",
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
        if (!formations[game.needed]?.positions.includes(position)) return interaction.reply({ content: "Invalid position for this formation.", ephemeral: true });
        const currentPlayer = game.lineup.get(position);

        if (game.subMode) {
          if (!currentPlayer) {
            return interaction.reply({ content: "That position is empty.", ephemeral: true });
          }
          if (currentPlayer === interaction.user.id) {
            return interaction.reply({ content: "You can't sub yourself.", ephemeral: true });
          }

          moveExclusive(game.lineup, interaction.user.id, position);
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

        moveExclusive(game.lineup, interaction.user.id, position);
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

      if (interaction.customId === "close_scrim") {
        if (interaction.user.id !== scrim.hostId && !canHost(interaction.member)) return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
        const msg = await getMessage(interaction.channel, scrim.messageId);
        scrims.delete(scrimKey);
        lifecycle.delete(scrim.messageId);
        if (msg) await msg.delete().catch(() => {});
        return interaction.reply({ content: "Scrim closed. You can start another one now.", ephemeral: true });
      }

      if (interaction.customId === "scrim_lock") {
        if (interaction.user.id !== scrim.hostId && !canHost(interaction.member)) {
          return interaction.reply({
            content: "Only the host or an authorised hoster can lock the scrim.",
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
        const parts = interaction.customId.split("_");
        const teamLabel = parts[2];
        const position = parts.slice(3).join("_");

        if (!SCRIM_FORMATION_7.positions.includes(position)) return interaction.reply({ content: "Invalid scrim position.", ephemeral: true });
        const teamMap = teamLabel === "A" ? scrim.teamA : scrim.teamB;
        const otherTeamMap = teamLabel === "A" ? scrim.teamB : scrim.teamA;

        const currentPlayer = teamMap.get(position);
        if (currentPlayer && currentPlayer !== interaction.user.id) return interaction.reply({ content: `That position on Team ${teamLabel} is already taken.`, ephemeral: true });
        removeUser(otherTeamMap, interaction.user.id);
        if (currentPlayer === interaction.user.id) teamMap.delete(position);
        else moveExclusive(teamMap, interaction.user.id, position);

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

      if (interaction.customId === "close_lineup") {
        if (interaction.user.id !== lineupObj.hostId && !canHost(interaction.member)) return interaction.reply({ content: hostOnlyMessage(), ephemeral: true });
        const msg = await getMessage(interaction.channel, lineupObj.messageId);
        lineups.delete(guildId);
        lifecycle.delete(lineupObj.messageId);
        if (msg) await msg.delete().catch(() => {});
        return interaction.reply({ content: "Lineup closed. You can start another one now.", ephemeral: true });
      }

      if (interaction.customId === "lineup8_lock") {
        if (interaction.user.id !== lineupObj.hostId && !canHost(interaction.member)) {
          return interaction.reply({
            content: "Only the host or an authorised hoster can lock the lineup.",
            ephemeral: true
          });
        }

        const lineupFormation = formations[lineupObj.needed] || formations[8];
        if (lineupObj.positions.size < lineupFormation.positions.length) {
          return interaction.reply({
            content: `All ${lineupFormation.positions.length} positions must be filled before locking.`,
            ephemeral: true
          });
        }

        lineupObj.locked = true;
        await interaction.message.edit({
          embeds: [createLineup8Embed(lineupObj)],
          components: []
        });

        return interaction.reply({ content: "Lineup locked.", ephemeral: true });
      }

      if (interaction.customId.startsWith("lineup8_pos_")) {
        const position = interaction.customId.replace("lineup8_pos_", "");
        const lineupFormation = formations[lineupObj.needed] || formations[8];
        if (!lineupFormation.positions.includes(position)) return interaction.reply({ content: "Invalid lineup position.", ephemeral: true });
        const currentPlayer = lineupObj.positions.get(position);

        if (currentPlayer) {
          if (currentPlayer === interaction.user.id) {
            lineupObj.positions.delete(position);
          } else {
            return interaction.reply({
              content: `**${position}** is already taken.`,
              ephemeral: true
            });
          }
        } else {
          moveExclusive(lineupObj.positions, interaction.user.id, position);
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
